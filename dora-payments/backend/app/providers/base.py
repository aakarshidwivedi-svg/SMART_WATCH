from abc import ABC, abstractmethod
from typing import Dict, Any
from app.models import PaymentMethod

class ProviderResult:
    def __init__(self, success: bool, provider_txn_id: str, error_message: str = None, raw_response: Dict[str, Any] = None):
        self.success = success
        self.provider_txn_id = provider_txn_id
        self.error_message = error_message
        self.raw_response = raw_response or {}

class PaymentProvider(ABC):
    """Abstract payment gateway interface. Real gateways (Razorpay, Stripe, PineLabs) implement this."""
    
    @abstractmethod
    def name(self) -> str:
        pass

    @abstractmethod
    async def authorize(self, amount_paise: int, payment_method: PaymentMethod, metadata: Dict[str, Any]) -> ProviderResult:
        pass

    @abstractmethod
    async def capture(self, provider_txn_id: str, amount_paise: int) -> ProviderResult:
        pass

    @abstractmethod
    async def refund(self, provider_txn_id: str, amount_paise: int) -> ProviderResult:
        pass
