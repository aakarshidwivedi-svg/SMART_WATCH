"""Unified FastAPI server for SmartWatch X Prototype.

Integrates all four existing smartwatch subsystems into ONE locally hosted
application on http://localhost:8000:
  1. Hologram          -> holowatch (3D procedural meshes, telemetry, Pillow screen)
  2. SOS Mode          -> neon_sos / holowatch.services.EmergencyService
  3. Universal Payment -> dora-payments (existing FastAPI routers, SQLite DB, QR & NFC)
  4. Self-Transforming -> Modular smartwatch assembly & transformation API
"""
from __future__ import annotations

import base64
import datetime
import io
import os
import random
import sys
import threading
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Path wiring: reuse existing dora-payments backend & holowatch modules
# ---------------------------------------------------------------------------
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DORA_DIR = os.path.join(ROOT_DIR, "dora-payments")
DORA_BACKEND_DIR = os.path.join(DORA_DIR, "backend")
DORA_FRONTEND_DIR = os.path.join(DORA_DIR, "frontend")
WEB_DIR = os.path.join(ROOT_DIR, "web")
NEON_SOS_DIR = os.path.join(ROOT_DIR, "neon_sos")

if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)
if DORA_BACKEND_DIR not in sys.path:
    sys.path.insert(0, DORA_BACKEND_DIR)

# Use writable temporary storage on Vercel's read-only serverless filesystem.
if not os.environ.get("DATABASE_URL"):
    db_path = (
        "/tmp/dora_payments.db"
        if os.environ.get("VERCEL") == "1"
        else os.path.join(DORA_DIR, "dora_payments.db").replace("\\", "/")
    )
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"

# Reuse existing DORA Universal Payment backend modules directly (zero duplication)
from app.config import settings as dora_settings
from app.db import init_db
from app.api.errors import DoraPaymentException, dora_exception_handler, success_envelope
from app.api.routes_payments import router as payments_router
from app.api.routes_wallet import router as wallet_router
from app.api.routes_auth import router as auth_router
from app.services.qr_service import QRService
from app.hardware.simulated import SimulatedNFC, SimulatedQR

# Reuse existing Hologram & SOS Python modules directly
from holowatch import config as holo_config
from holowatch.watch_model import build_watch, screen_half_size, SCREEN_Y, outline_ring
from holowatch.telemetry import Telemetry
from holowatch.screen import WatchScreen, PAGES as WATCH_PAGES, W as SCR_W, H as SCR_H
from holowatch.services import EmergencyService, BASE_LAT, BASE_LON

import qrcode


# ---------------------------------------------------------------------------
# Shared live subsystem singletons (thread-safe)
# ---------------------------------------------------------------------------
_holo_lock = threading.Lock()
_telemetry = Telemetry()
_watch_screen = WatchScreen()
_last_tel_tick = time.monotonic()
_cached_geometry: Optional[dict] = None

_sos_lock = threading.Lock()
_emergency_service = EmergencyService()
_sos_last_gps_update = "Initial fix"

_sim_nfc = SimulatedNFC()
_sim_qr = SimulatedQR()


def _tick_holo_locked():
    global _last_tel_tick
    now = time.monotonic()
    dt = min(0.25, max(0.01, now - _last_tel_tick))
    _last_tel_tick = now
    _telemetry.update(dt)
    _watch_screen.update(dt)


def _build_hologram_geometry() -> dict:
    """Serialize exact 3D watch meshes from holowatch.watch_model.build_watch()."""
    parts_data = []
    for part in build_watch():
        m = part.mesh
        parts_data.append({
            "name": part.name,
            "kind": part.kind,
            "color": [round(float(c), 4) for c in part.color],
            "explode": [round(float(e), 4) for e in part.explode],
            "face_alpha": float(part.face_alpha),
            "edge_alpha": float(part.edge_alpha),
            "verts": [round(float(v), 4) for v in m.verts.reshape(-1)],
            "tris": [int(i) for i in m.tris.reshape(-1)],
            "lines": [int(i) for i in m.lines.reshape(-1)],
        })
    hw, hh = screen_half_size()
    ring_front = [round(float(v), 4) for v in outline_ring(-0.40).reshape(-1)]
    ring_back = [round(float(v), 4) for v in outline_ring(0.40, 0.1).reshape(-1)]
    return {
        "parts": parts_data,
        "screen": {
            "half_w": round(float(hw), 4),
            "half_h": round(float(hh), 4),
            "y": round(float(SCREEN_Y), 4),
            "tex_w": SCR_W,
            "tex_h": SCR_H,
            "pages": WATCH_PAGES,
        },
        "platform_z": float(holo_config.PLATFORM_Z),
        "outline_rings": [ring_front, ring_back],
    }


def _read_recent_sos_logs(limit: int = 30) -> list[str]:
    log_path = os.path.join(NEON_SOS_DIR, "sos_log.txt")
    if not os.path.exists(log_path):
        return []
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            lines = [ln.strip() for ln in f.readlines() if ln.strip()]
        return lines[-limit:]
    except OSError:
        return []


def _count_outbox_alerts() -> int:
    outbox_path = os.path.join(NEON_SOS_DIR, "sos_outbox.txt")
    if not os.path.exists(outbox_path):
        return 0
    try:
        with open(outbox_path, "r", encoding="utf-8") as f:
            return sum(1 for ln in f if "SIMULATED SOS ALERT" in ln)
    except OSError:
        return 0


# ---------------------------------------------------------------------------
# FastAPI Lifespan & Application Setup
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _cached_geometry
    init_db()
    _cached_geometry = _build_hologram_geometry()
    yield


app = FastAPI(
    title="SmartWatch X - Unified Locally Hosted Prototype",
    description="Unified smartwatch platform integrating Hologram, SOS Mode, DORA Universal Payment, and Self-Transforming Modular Watch.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_exception_handler(DoraPaymentException, dora_exception_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Existing DORA Payment Module Integration Endpoints (preserved verbatim)
# ---------------------------------------------------------------------------
@app.get("/health", summary="Health check endpoint for DORA orchestrator")
def health_check():
    return success_envelope({
        "status": "healthy",
        "service": dora_settings.DORA_MODULE_NAME,
        "version": dora_settings.DORA_MODULE_VERSION,
        "unified_platform": "SmartWatch X",
        "features": ["hologram", "sos", "universal-payment", "self-transforming"],
    })


@app.get("/manifest", summary="DORA plug-in manifest definition")
def get_manifest():
    return success_envelope({
        "module_id": dora_settings.DORA_MODULE_NAME,
        "version": dora_settings.DORA_MODULE_VERSION,
        "display_modes": ["watch", "hologram"],
        "capabilities": [
            "wallet.balance",
            "wallet.topup",
            "payment.create",
            "payment.authorize",
            "payment.upi_qr",
            "payment.nfc_tap",
        ],
        "default_limits": {
            "max_per_txn_paise": dora_settings.MAX_PER_TRANSACTION_LIMIT_PAISE,
            "daily_limit_paise": dora_settings.DAILY_LIMIT_PAISE,
            "currency": "INR",
        },
    })


# Mount existing DORA Payment API routers at /api/v1
app.include_router(payments_router, prefix="/api/v1")
app.include_router(wallet_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")


# ---------------------------------------------------------------------------
# DORA Payment QR & NFC Hardware Simulation Helpers (reuses QRService & SimulatedNFC)
# ---------------------------------------------------------------------------
@app.get("/api/v1/payments/qr/generate", summary="Generate UPI QR code using existing QRService")
def generate_upi_qr(
    payee_vpa: str = Query("dora_cafe@upi"),
    payee_name: str = Query("Dora Cyber Cafe"),
    amount_paise: int = Query(15000, gt=0),
    note: str = Query("SmartWatch X UPI Payment"),
):
    payload = QRService.build_upi_payload(
        payee_vpa=payee_vpa,
        payee_name=payee_name,
        amount_paise=amount_paise,
        transaction_note=note,
        txn_ref=f"DORA{int(time.time())}",
    )
    qr = qrcode.QRCode(version=1, box_size=6, border=2)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#00f0ff", back_color="#070d1c")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return success_envelope({
        "upi_uri": payload,
        "qr_image_data_url": data_url,
        "payee_vpa": payee_vpa,
        "payee_name": payee_name,
        "amount_paise": amount_paise,
        "note": note,
    })


@app.post("/api/v1/payments/qr/scan", summary="Simulate scanning a UPI QR code via existing SimulatedQR")
def scan_upi_qr():
    raw_payload = _sim_qr.scan_camera_frame()
    parsed = QRService.parse_upi_payload(raw_payload)
    return success_envelope({
        "raw_payload": raw_payload,
        "parsed": parsed,
    })


@app.post("/api/v1/payments/nfc/scan", summary="Simulate NFC terminal tap via existing SimulatedNFC")
def scan_nfc_terminal():
    tag = _sim_nfc.scan_tag()
    emulated = _sim_nfc.emulate_card_tap(tag["tag_id"])
    return success_envelope({
        "tag": tag,
        "emulated": emulated,
        "merchant_name": "Metro Transit Gate",
        "amount_paise": 4500,
    })


# ---------------------------------------------------------------------------
# Feature 1: HOLOGRAM API (powered directly by holowatch/)
# ---------------------------------------------------------------------------
@app.get("/api/v1/hologram/geometry", summary="Get procedural 3D watch meshes from holowatch.watch_model")
def get_hologram_geometry():
    global _cached_geometry
    if _cached_geometry is None:
        _cached_geometry = _build_hologram_geometry()
    return success_envelope(_cached_geometry)


@app.get("/api/v1/hologram/telemetry", summary="Get live simulated telemetry from holowatch.telemetry")
def get_hologram_telemetry():
    with _holo_lock:
        _tick_holo_locked()
        hm, sec, date_str = _telemetry.clock()
        data = {
            "bpm": _telemetry.bpm,
            "spo2": _telemetry.spo2_i,
            "temp": round(float(_telemetry.temp), 1),
            "steps": _telemetry.steps_i,
            "calories": int(round(_telemetry.calories)),
            "distance_km": round(float(_telemetry.distance), 2),
            "workout": _telemetry.workout_str(),
            "battery": _telemetry.battery_i,
            "beat": round(float(_telemetry.beat), 3),
            "ecg": [round(float(v), 3) for v in _telemetry.ecg[-96:]],
            "clock": f"{hm}:{sec}",
            "date": date_str,
            "screen_page": _watch_screen.page,
            "screen_page_name": WATCH_PAGES[_watch_screen.page],
            "pages": WATCH_PAGES,
        }
    return success_envelope(data)


@app.get("/api/v1/hologram/screen.png", summary="Render live watch face texture from holowatch.screen")
def get_hologram_screen_png(page: Optional[int] = Query(None)):
    with _holo_lock:
        if page is not None:
            _watch_screen.set_page(page)
        _tick_holo_locked()
        img = _watch_screen.render(_telemetry, power=1.0)
        if img.size != (SCR_W, SCR_H):
            img = img.resize((SCR_W, SCR_H), resample=1)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


class ScreenTapRequest(BaseModel):
    px: float
    py: float


@app.post("/api/v1/hologram/screen/page/{page_idx}", summary="Switch 3D hologram watch screen page")
def set_hologram_page(page_idx: int):
    with _holo_lock:
        _watch_screen.set_page(page_idx)
        current = _watch_screen.page
    return success_envelope({
        "page": current,
        "page_name": WATCH_PAGES[current],
    })


@app.post("/api/v1/hologram/screen/tap", summary="Send tap coordinates to holowatch.screen.WatchScreen")
def tap_hologram_screen(req: ScreenTapRequest):
    with _holo_lock:
        _watch_screen.render(_telemetry, power=1.0)
        handled = bool(_watch_screen.tap(req.px, req.py))
        current = _watch_screen.page
    return success_envelope({
        "handled": handled,
        "page": current,
        "page_name": WATCH_PAGES[current],
    })


# ---------------------------------------------------------------------------
# Feature 2: SOS MODE API (powered directly by neon_sos/ & EmergencyService)
# ---------------------------------------------------------------------------
class SosLogRequest(BaseModel):
    message: str


@app.get("/api/v1/sos/status", summary="Get SOS contacts, simulated GPS, and recent log entries")
def get_sos_status():
    with _sos_lock:
        _emergency_service.contacts = _emergency_service.load_contacts()
        return success_envelope({
            "contacts": _emergency_service.contacts,
            "latitude": round(_emergency_service.lat, 5),
            "longitude": round(_emergency_service.lon, 5),
            "lat_text": f"LAT  {_emergency_service.lat:.5f} N",
            "lon_text": f"LON  {_emergency_service.lon:.5f} E",
            "gps_updated_at": _sos_last_gps_update,
            "hold_seconds": 1.0,
            "countdown_seconds": 5,
            "trigger_flash_seconds": 0.5,
            "cancel_message_seconds": 2.0,
            "logs": _read_recent_sos_logs(30),
            "outbox_count": _count_outbox_alerts(),
        })


@app.post("/api/v1/sos/location", summary="Simulate a new GPS reading and log to neon_sos/sos_log.txt")
def update_sos_location():
    global _sos_last_gps_update
    with _sos_lock:
        _emergency_service.lat = BASE_LAT + random.uniform(-0.002, 0.002)
        _emergency_service.lon = BASE_LON + random.uniform(-0.002, 0.002)
        _sos_last_gps_update = "Updated " + datetime.datetime.now().strftime("%H:%M:%S")
        _emergency_service.log(
            f"Simulated GPS updated: {_emergency_service.lat:.5f}, {_emergency_service.lon:.5f}"
        )
        return success_envelope({
            "latitude": round(_emergency_service.lat, 5),
            "longitude": round(_emergency_service.lon, 5),
            "lat_text": f"LAT  {_emergency_service.lat:.5f} N",
            "lon_text": f"LON  {_emergency_service.lon:.5f} E",
            "gps_updated_at": _sos_last_gps_update,
        })


@app.post("/api/v1/sos/log", summary="Append SOS state event to neon_sos/sos_log.txt")
def append_sos_log(req: SosLogRequest):
    with _sos_lock:
        _emergency_service.log(req.message)
    return success_envelope({
        "logged": True,
        "time": datetime.datetime.now().strftime("%H:%M:%S"),
        "message": req.message,
    })


@app.post("/api/v1/sos/dispatch", summary="Dispatch simulated emergency alerts to neon_sos/sos_outbox.txt")
def dispatch_sos_alerts():
    with _sos_lock:
        _emergency_service.contacts = _emergency_service.load_contacts()
        summary = _emergency_service.dispatch_alert()
        lat = _emergency_service.lat
        lon = _emergency_service.lon
        alerts = [
            {
                "name": c["name"],
                "phone": c["phone"],
                "relation": c["relation"],
                "status": "SIMULATED - message prepared",
                "transmitted": False,
                "message": f"SOS! Emergency assistance needed. Simulated location: {lat:.5f}, {lon:.5f}",
            }
            for c in _emergency_service.contacts
        ]
        return success_envelope({
            "summary": summary,
            "activated_at": datetime.datetime.now().strftime("%H:%M:%S"),
            "latitude": round(lat, 5),
            "longitude": round(lon, 5),
            "lat_text": f"LAT  {lat:.5f} N",
            "lon_text": f"LON  {lon:.5f} E",
            "alerts": alerts,
            "outbox_count": _count_outbox_alerts(),
        })


# ---------------------------------------------------------------------------
# Feature 4: SELF-TRANSFORMING MODULAR SMARTWATCH API
# ---------------------------------------------------------------------------
MODULAR_COMPONENTS = [
    {
        "id": "lens",
        "code": "MOD-01",
        "name": "Sapphire Holographic Lens",
        "role": "Optical beam diffuser & curved anti-glare sapphire display shield",
        "material": "Synthetic Sapphire + Micro-Prism Film",
        "mass_g": 4.2,
    },
    {
        "id": "screen",
        "code": "MOD-02",
        "name": "Detachable AMOLED Screen Module",
        "role": "Independent pop-out smart display & handheld hologram emitter",
        "material": "CNC Titanium Bezel + LTPO Micro-OLED",
        "mass_g": 16.8,
    },
    {
        "id": "maglock",
        "code": "MOD-03",
        "name": "Magnetic Micro-Lock & Pogo Array",
        "role": "Auto-aligning neodymium quick-release latch with 12-pin data/power bus",
        "material": "N52 Magnetic Ring + Gold Contact Pads",
        "mass_g": 5.4,
    },
    {
        "id": "core",
        "code": "MOD-04",
        "name": "Core SoC, NFC & SOS Sensor Chassis",
        "role": "Houses DORA Payment Secure Element, Bio-Telemetry & Emergency Beacon",
        "material": "Anodized Alloy Frame + SiP Module",
        "mass_g": 11.6,
    },
    {
        "id": "battery",
        "code": "MOD-05",
        "name": "Modular Solid-State Battery Pack",
        "role": "Hot-swappable high-density curved cell with wireless power transfer",
        "material": "Solid-State Li-Ceramic (420 mAh)",
        "mass_g": 9.8,
    },
    {
        "id": "wristband",
        "code": "MOD-06",
        "name": "Circular Magnetic Wristband & Dock",
        "role": "Ergonomic continuous circular band with integrated cradle & secondary antenna",
        "material": "Fluoroelastomer + Titanium Cradle Ring",
        "mass_g": 21.5,
    },
]

TRANSFORM_STAGES = [
    {
        "index": 0,
        "id": "assembled",
        "title": "Assembled Wearable Mode",
        "subtitle": "Unified smartwatch locked into the circular magnetic wristband.",
        "status": "MAGNETIC LOCK ENGAGED",
        "detail": "All 6 modular subsystems are docked seamlessly. Power, telemetry, NFC payments, and SOS circuits form a continuous closed loop.",
    },
    {
        "index": 1,
        "id": "unlock",
        "title": "Magnetic Unlock & Lift",
        "subtitle": "Electro-magnetic latch releases and elevates the display core.",
        "status": "RELEASING MICRO-LOCKS",
        "detail": "The 12-pin magnetic micro-lock ring disengages safely while maintaining wireless telemetry synchronization with the circular wristband.",
    },
    {
        "index": 2,
        "id": "detached",
        "title": "Detachable Screen Module",
        "subtitle": "Display module separates cleanly from the circular wristband dock.",
        "status": "SCREEN DETACHED // STANDALONE",
        "detail": "The detachable screen floats free for handheld interaction, contactless QR/NFC tap, or desktop holographic projection while the circular band stays secured on the wrist.",
    },
    {
        "index": 3,
        "id": "exploded",
        "title": "Exploded Assembly View",
        "subtitle": "Full modular breakdown of lens, screen, locks, core SoC, battery, and wristband.",
        "status": "EXPLODED INSPECTION ACTIVE",
        "detail": "Every hardware layer separates along precision assembly vectors so each hot-swappable component can be inspected, upgraded, or reconfigured.",
    },
    {
        "index": 4,
        "id": "reassemble",
        "title": "Auto-Reassembly & Lock",
        "subtitle": "Guided magnetic alignment snaps all modules back into wearable form.",
        "status": "REASSEMBLY COMPLETE // LOCKED",
        "detail": "Neodymium guidance vectors draw the sapphire lens, AMOLED screen, SoC core, and battery back into the circular wristband cradle with verified seal.",
    },
]


@app.get("/api/v1/transform/modules", summary="Get modular self-transforming smartwatch architecture")
def get_transform_modules():
    return success_envelope({
        "components": MODULAR_COMPONENTS,
        "stages": TRANSFORM_STAGES,
    })


# ---------------------------------------------------------------------------
# Static Frontend Mounts (Unified Dashboard + Existing DORA Payment JS)
# ---------------------------------------------------------------------------
if os.path.exists(DORA_FRONTEND_DIR):
    app.mount("/payment-static", StaticFiles(directory=DORA_FRONTEND_DIR), name="payment-static")

if os.path.exists(WEB_DIR):
    app.mount("/assets", StaticFiles(directory=WEB_DIR), name="assets")

    @app.get("/", include_in_schema=False)
    def serve_unified_dashboard():
        return FileResponse(os.path.join(WEB_DIR, "index.html"))
