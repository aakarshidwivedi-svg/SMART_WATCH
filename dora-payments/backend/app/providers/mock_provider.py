import uuid
from typing import Dict, Any
from app.providers.base import PaymentProvider, ProviderResult
from app.models import PaymentMethod

class MockProvider(PaymentProvider):
    """Simulated payment processor for v1 testing and watch/hologram demos."""

    def name(self) -> str:
        return "DORA-Simulated-Gateway"

    async def authorize(self, amount_paise: int, payment_method: PaymentMethod, metadata: Dict[str, Any]) -> ProviderResult:
        # Simulate gateway validation
        # In mock mode: amounts ending in 999 fail to test failure handling
        if amount_paise % 1000 == 999:
            return ProviderResult(
                success=False,
                provider_txn_id=f"mock_fail_{uuid.uuid4().hex[:8]}",
                error_message="Gateway simulated decline: Insufficient balance or card declined"
            )
        return ProviderResult(
            success=True,
            provider_txn_id=f"mock_auth_{uuid.uuid4().hex[:12]}",
            raw_response={"status": "authorized", "method": payment_method.value}
        )

    async def capture(self, provider_txn_id: str, amount_paise: int) -> ProviderResult:
        return ProviderResult(
            success=True,
            provider_txn_id=f"mock_cap_{uuid.uuid4().hex[:12]}",
            raw_response={"status": "captured", "amount_paise": amount_paise}
        )

    async def refund(self, provider_txn_id: str, amount_paise: int) -> ProviderResult:
        return ProviderResult(
            success=True,
            provider_txn_id=f"mock_ref_{uuid.uuid4().hex[:12]}",
            raw_response={"status": "refunded", "amount_paise": amount_paise}
        )
