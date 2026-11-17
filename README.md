# SmartWatch X — Unified Locally Hosted Prototype

A single, locally hosted futuristic smartwatch platform combining all four core subsystems into **one unified glassmorphism dashboard** at `http://localhost:8000`:

1. **HOLOGRAM** — Real-time interactive 3D WebGL holographic watch projection powered directly by the procedural 16-part 3D geometry (`holowatch/watch_model.py`), live Pillow watch OS screen (`holowatch/screen.py`), and real-time health telemetry/ECG (`holowatch/telemetry.py`).
2. **SOS MODE** — Interactive Neon SOS smartwatch simulation (`neon_sos/`) with 1-second press-and-hold safeguard, 5-second safety countdown, instant cancellation (`CANCEL` / `Esc`), pulsing emergency mode, simulated GPS beacon + `UPDATE LOCATION`, ICE contact dispatch (`neon_sos/contacts.txt`), and persistent logs (`neon_sos/sos_log.txt`, `neon_sos/sos_outbox.txt`).
3. **UNIVERSAL PAYMENT** — Directly reuses and integrates the existing **DORA Universal Payment** FastAPI backend (`dora-payments/`), SQLite database, Watch UI (Round) & Hologram Simulation views, live wallet balance & top-up, Tap-to-Pay, UPI QR generation & scan (`QRService` + `qrcode`), NFC contactless tap (`SimulatedNFC`), 4-digit PIN authentication (`1234`), confirmation flow, and live transaction ledger.
4. **SELF-TRANSFORMING** — Redesigned interactive **Modular Smartwatch Assembly Studio** featuring a modular watch preview, detachable AMOLED screen module, circular magnetic wristband & cradle, 6-layer exploded assembly view, animated component movement, smooth reassembly with magnetic lock confirmation, and **Start, Pause, Next, Previous, and Reset** controls.

> All health telemetry, GPS coordinates, emergency alerts, and payment transactions run in local demo mode.

---

## Project Structure

```text
smartwatch/
├── main.py                      # Single entry point (starts localhost:8000 unified app)
├── server.py                    # Unified FastAPI server integrating all 4 modules
├── requirements.txt             # All unified Python dependencies
├── web/                         # Unified futuristic glassmorphism dashboard frontend
│   ├── index.html               # Single-page dashboard + 4 integrated feature panels
│   ├── css/dashboard.css        # Dark glassmorphism + cyan/blue/green/red theme
│   └── js/
│       ├── app.js               # Unified shell navigation, live watch preview & sync
│       ├── hologram3d.js        # Interactive 3D WebGL hologram engine
│       ├── sos.js               # Interactive Neon SOS watch & command console
│       ├── payments.js          # Integrated DORA Universal Payment UI
│       └── transform.js         # Modular Self-Transforming smartwatch studio
├── dora-payments/               # Existing Universal Payment FastAPI backend & DB (reused)
├── holowatch/                   # Existing 3D Hologram watch meshes, screen & telemetry
├── neon_sos/                    # Existing SOS contacts, logs & outbox files
├── stem_cell_simulator/         # Original standalone simulator (preserved)
└── tests/
    ├── test_core.py             # Core holowatch unit tests
    └── test_unified_server.py   # End-to-end unified API & integration tests
```

---

## Installation Instructions

### Prerequisites
- Python **3.9 – 3.12**

### Setup (Windows PowerShell)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Setup (macOS / Linux)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## One-Command Local Startup

Run the entire unified smartwatch prototype locally with a single command:

```bash
python main.py
```

Then open (or let it auto-open):

- **Unified Dashboard:** `http://localhost:8000`
- **Interactive REST API Docs:** `http://localhost:8000/docs`

### Optional Flags
```bash
python main.py --no-browser       # Start server without auto-opening browser
python main.py --port 8080        # Run on a custom local port
python main.py --mode=panda3d     # Launch original Panda3D desktop window
```

---

## Demo Quick Guide

- **Dashboard**: View the Live Smartwatch Preview and balanced 2×2 feature grid (`HOLOGRAM`, `SOS MODE`, `UNIVERSAL PAYMENT`, `SELF-TRANSFORMING`). Click any card or nav pill to open its panel inside the same application, and click `← Back to Dashboard` to return.
- **Hologram**: Drag to orbit 360°, scroll to zoom, toggle **Wireframe**, **Particles**, **Scanning**, **X-Ray Internals**, **Disassemble**, and **360° Inspect**, or switch live watch OS pages (`HOME`–`SOS`).
- **SOS Mode**: Press and hold the red **SOS** button on the watch for 1 second (or click **Hold / Trigger Demo SOS**) to launch the 5-second countdown. Click **CANCEL** (or press `Esc`) to abort safely, or let it complete to enter **SOS ACTIVE**, update simulated GPS, inspect generated alerts, and click **RESET**.
- **Universal Payment**: Toggle between **Watch UI (Round)** and **Hologram Simulation**, pay via **Wallet Tap**, **UPI QR Code**, or **NFC Tap**, authenticate with demo PIN **`1234`**, view confirmation, top up `+₹500`, and inspect live transactions.
- **Self-Transforming**: Click **Start** to animate the detachable screen module, circular wristband cradle, 6-layer exploded assembly view, and magnetic reassembly — or use **Pause**, **Next**, **Previous**, **Reset**, the manual explode slider, and clickable module inspector.

---

## Verification & Tests

Run all automated tests:
```bash
python tests/test_core.py
python -m pytest tests/test_unified_server.py -v
```
And run the existing DORA payment backend suite:
```bash
cd dora-payments/backend
pytest tests/test_payments.py -v
```
