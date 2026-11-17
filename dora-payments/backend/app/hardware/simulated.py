import uuid
from typing import Optional, Dict, Any
from app.hardware.interfaces import NFCReader, QRScanner, BiometricSensor, DisplayAdapter

class SimulatedNFC(NFCReader):
    def scan_tag(self) -> Optional[Dict[str, Any]]:
        return {
            "tag_id": f"04:{uuid.uuid4().hex[:8]}",
            "type": "NFC_FORUM_TYPE_4",
            "merchant_vpa": "tap_merchant@upi",
            "terminal_id": "POS_TERM_001"
        }

    def emulate_card_tap(self, token_payload: str) -> bool:
        # Simulates contactless tap handshake with POS terminal
        return True

class SimulatedQR(QRScanner):
    def scan_camera_frame(self, frame_bytes: Optional[bytes] = None) -> Optional[str]:
        # Returns standard UPI format QR payload for testing
        return "upi://pay?pa=dora_cafe@upi&pn=Dora%20Cafe&am=150.00&cu=INR&tn=Coffee%20and%20Snacks"

class SimulatedBiometric(BiometricSensor):
    def verify_fingerprint(self, user_id: str) -> bool:
        # In simulation mode, accept demo user fingerprint
        return True

class SimulatedDisplay(DisplayAdapter):
    def __init__(self, mode: str = "watch", diameter_px: int = 240):
        self.mode = mode
        self.diameter_px = diameter_px
        self.current_screen = "IDLE"
        self.last_view_model = {}

    def render_screen(self, screen_id: str, view_model: Dict[str, Any]):
        self.current_screen = screen_id
        self.last_view_model = view_model
        print(f"[DisplayAdapter:{self.mode}] Switched to screen: {screen_id}")
