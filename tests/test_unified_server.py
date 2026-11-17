"""End-to-end integration tests for the Unified SmartWatch X FastAPI server.

Verifies all four integrated subsystems on the single unified application:
  1. Dashboard & Static Assets
  2. Hologram (holowatch geometry, telemetry, Pillow screen rendering)
  3. SOS Mode (neon_sos contacts, GPS update, log, alert dispatch)
  4. Universal Payment (existing dora-payments wallet, create, PIN auth, cancel, QR, NFC, ledger)
  5. Self-Transforming (modular smartwatch components & stages)
"""
import os
import sys

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

# Use an isolated in-memory SQLite DB for tests so real demo DB isn't polluted
os.environ["DATABASE_URL"] = "sqlite:///:memory:"

from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session
from sqlmodel.pool import StaticPool

import server
from app.db import get_session

test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


def _override_session():
    with Session(test_engine) as session:
        yield session


server.app.dependency_overrides[get_session] = _override_session
SQLModel.metadata.create_all(test_engine)
client = TestClient(server.app)


def test_dashboard_and_static_assets():
    res = client.get("/")
    assert res.status_code == 200
    html = res.text
    for expected in ("HOLOGRAM", "SOS MODE", "UNIVERSAL PAYMENT", "SELF-TRANSFORMING"):
        assert expected in html

    assert client.get("/assets/css/dashboard.css").status_code == 200
    assert client.get("/assets/js/app.js").status_code == 200
    assert client.get("/assets/js/hologram3d.js").status_code == 200
    assert client.get("/assets/js/sos.js").status_code == 200
    assert client.get("/assets/js/payments.js").status_code == 200
    assert client.get("/assets/js/transform.js").status_code == 200
    # Existing dora-payments JS client served directly
    assert client.get("/payment-static/js/api.js").status_code == 200


def test_health_and_manifest():
    h = client.get("/health")
    assert h.status_code == 200
    assert h.json()["ok"] is True
    assert len(h.json()["data"]["features"]) == 4

    m = client.get("/manifest")
    assert m.status_code == 200
    assert "payment.upi_qr" in m.json()["data"]["capabilities"]


def test_hologram_integration():
    g = client.get("/api/v1/hologram/geometry")
    assert g.status_code == 200
    gdata = g.json()["data"]
    assert len(gdata["parts"]) >= 16
    part_names = {p["name"] for p in gdata["parts"]}
    assert {"frame", "glass", "crown", "battery", "pcb", "soc"}.issubset(part_names)

    tel = client.get("/api/v1/hologram/telemetry")
    assert tel.status_code == 200
    tdata = tel.json()["data"]
    assert 60 <= tdata["bpm"] <= 95
    assert len(tdata["ecg"]) > 50

    pg = client.post("/api/v1/hologram/screen/page/1")
    assert pg.status_code == 200
    assert pg.json()["data"]["page_name"] == "HEALTH"

    png = client.get("/api/v1/hologram/screen.png")
    assert png.status_code == 200
    assert png.headers["content-type"] == "image/png"
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"


def test_sos_integration():
    st = client.get("/api/v1/sos/status")
    assert st.status_code == 200
    sdata = st.json()["data"]
    assert len(sdata["contacts"]) >= 2
    assert sdata["countdown_seconds"] == 5

    loc = client.post("/api/v1/sos/location")
    assert loc.status_code == 200
    assert "LAT" in loc.json()["data"]["lat_text"]

    lg = client.post("/api/v1/sos/log", json={"message": "Automated test SOS event"})
    assert lg.status_code == 200
    assert lg.json()["data"]["logged"] is True

    disp = client.post("/api/v1/sos/dispatch")
    assert disp.status_code == 200
    assert len(disp.json()["data"]["alerts"]) >= 2


def test_universal_payment_existing_flow():
    # 1. Wallet balance
    w = client.get("/api/v1/wallet")
    assert w.status_code == 200
    assert w.json()["data"]["balance_paise"] == 50000

    # 2. Top-up +500 INR
    tu = client.post("/api/v1/wallet/topup", json={"amount_paise": 50000})
    assert tu.status_code == 200
    assert tu.json()["data"]["balance_paise"] == 100000

    # 3. Create & authorize WALLET payment with demo PIN 1234
    cr = client.post(
        "/api/v1/payments",
        json={
            "amount_paise": 15000,
            "merchant_name": "Dora Cyber Cafe",
            "merchant_vpa": "cafe@upi",
            "payment_method": "WALLET",
        },
    )
    assert cr.status_code == 200
    txn_id = cr.json()["data"]["txn_id"]

    # Wrong PIN fails properly
    bad = client.post(f"/api/v1/payments/{txn_id}/authorize", json={"pin": "9999"})
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "INVALID_PIN"

    # Correct PIN succeeds
    ok = client.post(f"/api/v1/payments/{txn_id}/authorize", json={"pin": "1234"})
    assert ok.status_code == 200
    assert ok.json()["data"]["state"] == "SUCCESS"

    # Wallet deducted cleanly: 100000 - 15000 = 85000
    w2 = client.get("/api/v1/wallet")
    assert w2.json()["data"]["balance_paise"] == 85000

    # 4. QR code generation & simulated scan
    qr = client.get("/api/v1/payments/qr/generate?amount_paise=15000")
    assert qr.status_code == 200
    assert qr.json()["data"]["qr_image_data_url"].startswith("data:image/png;base64,")

    qscan = client.post("/api/v1/payments/qr/scan")
    assert qscan.status_code == 200
    assert qscan.json()["data"]["parsed"]["amount_paise"] == 15000

    # 5. NFC scan simulation
    nfc = client.post("/api/v1/payments/nfc/scan")
    assert nfc.status_code == 200
    assert nfc.json()["data"]["emulated"] is True

    # 6. Transaction list includes completed payment
    txns = client.get("/api/v1/payments?limit=5")
    assert txns.status_code == 200
    assert any(t["txn_id"] == txn_id for t in txns.json()["data"])


def test_self_transforming_modules():
    res = client.get("/api/v1/transform/modules")
    assert res.status_code == 200
    data = res.json()["data"]
    assert len(data["components"]) == 6
    assert len(data["stages"]) == 5
