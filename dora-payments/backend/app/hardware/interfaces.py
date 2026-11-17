from abc import ABC, abstractmethod
from typing import Optional, Dict, Any

class NFCReader(ABC):
    @abstractmethod
    def scan_tag(self) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def emulate_card_tap(self, token_payload: str) -> bool:
        pass

class QRScanner(ABC):
    @abstractmethod
    def scan_camera_frame(self, frame_bytes: Optional[bytes] = None) -> Optional[str]:
        pass

class BiometricSensor(ABC):
    @abstractmethod
    def verify_fingerprint(self, user_id: str) -> bool:
        pass

class DisplayAdapter(ABC):
    @abstractmethod
    def render_screen(self, screen_id: str, view_model: Dict[str, Any]):
        pass
