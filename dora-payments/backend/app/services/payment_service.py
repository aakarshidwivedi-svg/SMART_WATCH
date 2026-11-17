import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlmodel import Session, select, func

from app.config import settings
from app.models import (
    Transaction, PaymentState, PaymentMethod, Wallet,
    UserSecurity, AuditLog, CreatePaymentRequest, utc_now
)
from app.api.errors import DoraPaymentException
from app.providers.mock_provider import MockProvider
from app.core.security import verify_pin, hash_pin
from app.core.events import event_bus

class PaymentService:
    def __init__(self, session: Session):
        self.session = session
        self.provider = MockProvider()

    def get_or_create_wallet(self, user_id: str) -> Wallet:
        stmt = select(Wallet).where(Wallet.user_id == user_id)
        wallet = self.session.exec(stmt).first()
        if not wallet:
            wallet = Wallet(user_id=user_id, balance_paise=50000) # Initial ₹500 demo balance
            self.session.add(wallet)
            self.session.commit()
            self.session.refresh(wallet)
        return wallet

    def get_or_create_security(self, user_id: str) -> UserSecurity:
        stmt = select(UserSecurity).where(UserSecurity.user_id == user_id)
        sec = self.session.exec(stmt).first()
        if not sec:
            # Default watch PIN for demo: 1234
            h, s = hash_pin("1234")
            sec = UserSecurity(user_id=user_id, pin_hash=h, pin_salt=s)
            self.session.add(sec)
            self.session.commit()
            self.session.refresh(sec)
        return sec

    def check_limits(self, user_id: str, amount_paise: int):
        # 1. Per-transaction limit
        if amount_paise > settings.MAX_PER_TRANSACTION_LIMIT_PAISE:
            raise DoraPaymentException(
                code="LIMIT_EXCEEDED",
                message=f"Amount exceeds per-transaction limit of ₹{settings.MAX_PER_TRANSACTION_LIMIT_PAISE / 100:.2f}"
            )

        # 2. Daily limit check
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = (
            select(func.sum(Transaction.amount_paise))
            .where(Transaction.user_id == user_id)
            .where(Transaction.state == PaymentState.SUCCESS)
            .where(Transaction.created_at >= today_start)
        )
        spent_today = self.session.exec(stmt).first() or 0
        if spent_today + amount_paise > settings.DAILY_LIMIT_PAISE:
            raise DoraPaymentException(
                code="DAILY_LIMIT_EXCEEDED",
                message=f"Payment exceeds daily spending limit of ₹{settings.DAILY_LIMIT_PAISE / 100:.2f}"
            )

    async def create_payment(
        self,
        user_id: str,
        req: CreatePaymentRequest,
        idempotency_key: Optional[str] = None
    ) -> Transaction:
        # Idempotency check: prevent duplicate charges on watch retries
        if idempotency_key:
            existing = self.session.exec(
                select(Transaction).where(
                    Transaction.idempotency_key == idempotency_key,
                    Transaction.user_id == user_id
                )
            ).first()
            if existing:
                return existing

        # Validate limits
        self.check_limits(user_id, req.amount_paise)

        wallet = self.get_or_create_wallet(user_id)
        if req.payment_method == PaymentMethod.WALLET and wallet.balance_paise < req.amount_paise:
            raise DoraPaymentException(
                code="INSUFFICIENT_FUNDS",
                message="Wallet balance is insufficient to complete this payment."
            )

        txn = Transaction(
            txn_id=f"tx_{uuid.uuid4().hex[:14]}",
            idempotency_key=idempotency_key,
            user_id=user_id,
            wallet_id=wallet.id,
            amount_paise=req.amount_paise,
            payment_method=req.payment_method,
            state=PaymentState.CREATED,
            merchant_name=req.merchant_name,
            merchant_vpa=req.merchant_vpa,
            description=req.description,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.PAYMENT_TIMEOUT_SECONDS)
        )
        self.session.add(txn)
        self.session.commit()
        self.session.refresh(txn)

        self._log_audit(txn.id, user_id, None, PaymentState.CREATED.value, "PAYMENT_CREATED")
        await event_bus.publish("payment.created", {"txn_id": txn.txn_id, "amount_paise": txn.amount_paise})
        return txn

    async def authorize_and_pay(self, user_id: str, txn_id: str, pin: str) -> Transaction:
        txn = self.session.exec(
            select(Transaction).where(Transaction.txn_id == txn_id, Transaction.user_id == user_id)
        ).first()

        if not txn:
            raise DoraPaymentException(code="NOT_FOUND", message="Transaction not found", status_code=404)

        if txn.state != PaymentState.CREATED:
            raise DoraPaymentException(
                code="INVALID_STATE",
                message=f"Transaction is in {txn.state.value} state and cannot be authorized"
            )

        now_utc = datetime.now(timezone.utc)
        # Check expiration (60s default)
        if now_utc > txn.expires_at:
            txn.state = PaymentState.EXPIRED
            txn.failure_reason = "Payment request expired"
            self.session.commit()
            self._log_audit(txn.id, user_id, PaymentState.CREATED.value, PaymentState.EXPIRED.value, "PAYMENT_EXPIRED")
            raise DoraPaymentException(code="EXPIRED", message="Payment request has timed out.")

        # Check PIN lockout & verify
        sec = self.get_or_create_security(user_id)
        if sec.locked_until and sec.locked_until > now_utc:
            remaining_mins = int((sec.locked_until - now_utc).total_seconds() // 60) + 1
            raise DoraPaymentException(
                code="PIN_LOCKED",
                message=f"PIN entry locked due to multiple failed attempts. Try again in {remaining_mins} minutes."
            )

        if not verify_pin(pin, sec.pin_hash, sec.pin_salt):
            sec.failed_attempts += 1
            if sec.failed_attempts >= settings.MAX_PIN_ATTEMPTS:
                sec.locked_until = now_utc + timedelta(minutes=settings.PIN_LOCKOUT_MINUTES)
                self.session.commit()
                raise DoraPaymentException(
                    code="PIN_LOCKED",
                    message="Incorrect PIN. Security lockout activated for 15 minutes."
                )
            self.session.commit()
            remaining = settings.MAX_PIN_ATTEMPTS - sec.failed_attempts
            raise DoraPaymentException(
                code="INVALID_PIN",
                message=f"Incorrect PIN. {remaining} attempt(s) remaining."
            )

        # Reset failed attempts on success
        sec.failed_attempts = 0
        sec.locked_until = None
        txn.state = PaymentState.AUTHORIZED
        self.session.commit()
        self._log_audit(txn.id, user_id, PaymentState.CREATED.value, PaymentState.AUTHORIZED.value, "PIN_VERIFIED")

        # Provider processing
        provider_res = await self.provider.authorize(txn.amount_paise, txn.payment_method, {"txn_id": txn.txn_id})

        if not provider_res.success:
            txn.state = PaymentState.FAILED
            txn.failure_reason = provider_res.error_message
            self.session.commit()
            self._log_audit(txn.id, user_id, PaymentState.AUTHORIZED.value, PaymentState.FAILED.value, "GATEWAY_FAILED", provider_res.error_message)
            await event_bus.publish("payment.failed", {"txn_id": txn.txn_id, "reason": provider_res.error_message})
            raise DoraPaymentException(code="GATEWAY_DECLINED", message=provider_res.error_message or "Payment was declined by provider.")

        # Deduct wallet balance if wallet method
        if txn.payment_method == PaymentMethod.WALLET:
            wallet = self.get_or_create_wallet(user_id)
            if wallet.balance_paise < txn.amount_paise:
                txn.state = PaymentState.FAILED
                txn.failure_reason = "Insufficient funds at settlement"
                self.session.commit()
                raise DoraPaymentException(code="INSUFFICIENT_FUNDS", message="Wallet balance insufficient")
            wallet.balance_paise -= txn.amount_paise
            wallet.updated_at = now_utc

        txn.state = PaymentState.SUCCESS
        txn.updated_at = now_utc
        self.session.commit()
        self.session.refresh(txn)

        self._log_audit(txn.id, user_id, PaymentState.AUTHORIZED.value, PaymentState.SUCCESS.value, "PAYMENT_SETTLED")
        await event_bus.publish("payment.success", {
            "txn_id": txn.txn_id,
            "amount_paise": txn.amount_paise,
            "merchant_name": txn.merchant_name
        })
        return txn

    async def cancel_payment(self, user_id: str, txn_id: str) -> Transaction:
        txn = self.session.exec(
            select(Transaction).where(Transaction.txn_id == txn_id, Transaction.user_id == user_id)
        ).first()
        if not txn:
            raise DoraPaymentException(code="NOT_FOUND", message="Transaction not found", status_code=404)
        if txn.state != PaymentState.CREATED:
            raise DoraPaymentException(code="CANNOT_CANCEL", message=f"Cannot cancel transaction in state {txn.state}")

        txn.state = PaymentState.CANCELLED
        txn.updated_at = datetime.now(timezone.utc)
        self.session.commit()
        self._log_audit(txn.id, user_id, PaymentState.CREATED.value, PaymentState.CANCELLED.value, "USER_CANCELLED")
        return txn

    def _log_audit(self, txn_id: int, user_id: str, from_state: Optional[str], to_state: str, action: str, details: Optional[str] = None):
        log = AuditLog(
            transaction_id=txn_id,
            user_id=user_id,
            from_state=from_state,
            to_state=to_state,
            action=action,
            details=details
        )
        self.session.add(log)
        self.session.commit()
