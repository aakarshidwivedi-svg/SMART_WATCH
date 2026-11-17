"""SmartWatch X - Unified Locally Hosted Prototype.

Integrates all four smartwatch features into ONE unified dashboard on localhost:
  1. Hologram          (holowatch 3D geometry, telemetry & Pillow watch OS)
  2. SOS Mode          (neon_sos workflow, contacts, GPS, alerts & logs)
  3. Universal Payment (existing dora-payments FastAPI backend, SQLite, QR, NFC, PIN)
  4. Self-Transforming (modular smartwatch assembly & reassembly studio)

Default one-command local startup:
    python main.py
    -> Serves unified dashboard at http://localhost:8000

Optional legacy desktop modes:
    python main.py --mode=panda3d     (Original Panda3D 3D desktop window)
    python main.py --mode=sos         (Standalone Tkinter Neon SOS window)
    python main.py --mode=cells       (Standalone Tkinter Stem Cell window)
    python main.py --mode=pay-api     (Standalone DORA Payment API server)
"""
import argparse
import os
import subprocess
import sys
import threading
import time
import webbrowser


def _open_browser_later(url: str, delay: float = 1.2):
    def _worker():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass
    threading.Thread(target=_worker, daemon=True).start()


def main():
    ap = argparse.ArgumentParser(description="SmartWatch X - Unified Locally Hosted Prototype")
    ap.add_argument("--host", default="127.0.0.1", help="Host interface to bind (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8000, help="Local port (default: 8000)")
    ap.add_argument("--no-browser", action="store_true", help="Do not auto-open the web browser")
    ap.add_argument("--reload", action="store_true", help="Enable Uvicorn auto-reload for development")
    ap.add_argument(
        "--mode",
        default="web",
        choices=["web", "panda3d", "sos", "cells", "pay-api"],
        help="Execution mode (default: web unified dashboard on http://localhost:8000)",
    )
    # Preserved flags for --mode=panda3d
    ap.add_argument("--skip-intro", action="store_true", help="skip the cinematic startup animation (panda3d mode)")
    ap.add_argument("--fullscreen", action="store_true", help="fullscreen window (panda3d mode)")
    ap.add_argument("--size", default="1366x768", help="window size, e.g. 1600x900 (panda3d mode)")
    ap.add_argument("--bloom", action="store_true", help="enable optional shader bloom (panda3d mode)")
    ap.add_argument("--no-audio", action="store_true", help="disable audio (panda3d mode)")
    args = ap.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))

    if args.mode == "web":
        import uvicorn

        url = f"http://localhost:{args.port}"
        print("=" * 68)
        print("  SMARTWATCH X — UNIFIED LOCALLY HOSTED PROTOTYPE")
        print(f"  Dashboard URL : {url}")
        print(f"  API Docs      : {url}/docs")
        print("  Features      : Hologram | SOS Mode | Universal Payment | Self-Transforming")
        print("  Press Ctrl+C to stop the local server.")
        print("=" * 68)

        if not args.no_browser:
            _open_browser_later(url)

        if args.reload:
            uvicorn.run("server:app", host=args.host, port=args.port, reload=True, app_dir=base_dir)
        else:
            if base_dir not in sys.path:
                sys.path.insert(0, base_dir)
            from server import app as unified_app
            uvicorn.run(unified_app, host=args.host, port=args.port)
        return

    if args.mode == "sos":
        print("[SmartWatch X] Launching standalone Neon SOS console...")
        subprocess.run([sys.executable, os.path.join(base_dir, "neon_sos", "sos_watch.py")])
        return

    if args.mode == "cells":
        print("[SmartWatch X] Launching standalone Stem Cell Simulator...")
        subprocess.run([sys.executable, os.path.join(base_dir, "stem_cell_simulator", "stem_cell_simulator.py")])
        return

    if args.mode == "pay-api":
        print(f"[SmartWatch X] Launching standalone DORA Payment API on port {args.port}...")
        pay_dir = os.path.join(base_dir, "dora-payments")
        subprocess.run(
            [sys.executable, "-m", "uvicorn", "backend.app.main:app", "--port", str(args.port), "--reload"],
            cwd=pay_dir,
        )
        return

    # Legacy Panda3D 3D desktop mode
    from panda3d.core import loadPrcFileData
    w, h = args.size.lower().split("x")
    loadPrcFileData("", f"""
window-title SmartWatch X - Holographic Projection Lab (Unified Platform)
win-size {w} {h}
fullscreen {1 if args.fullscreen else 0}
sync-video 1
framebuffer-multisample 1
multisamples 4
text-encoding utf8
notify-level warning
""")
    from holowatch.app import HoloApp
    HoloApp(skip_intro=args.skip_intro, bloom=args.bloom, audio=not args.no_audio).run()


if __name__ == "__main__":
    main()
