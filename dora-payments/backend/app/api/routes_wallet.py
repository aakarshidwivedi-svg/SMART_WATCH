from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from datetime import datetime

from app.db import get_session
from app.core.auth_interface import get_current_user, AuthUser
from app.core.security import hash_pin
from app.models import (
    Wallet, WalletTopUpRequest, SetPINRequest,
    WalletResponseData, UserSecurity
)
from app.api.errors import success_envelope, DoraPaymentException
from app.services.payment_service import PaymentService

router = APIRouter(prefix="/wallet", tags=["wallet"])

@router.get("", summary="Get user wallet balance")
async def get_wallet(
    request: Request,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_wallet")
    service = PaymentService(session)
    wallet = service.get_or_create_wallet(user.user_id)
    return success_envelope(
        data=WalletResponseData(
            user_id=wallet.user_id,
            balance_paise=wallet.balance_paise,
            currency=wallet.currency
        ).model_dump(),
        request_id=req_id
    )

@router.post("/topup", summary="Simulate adding money to wallet")
async def topup_wallet(
    topup: WalletTopUpRequest,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_topup")
    if topup.amount_paise <= 0:
        raise DoraPaymentException(code="INVALID_AMOUNT", message="Top-up amount must be greater than zero.")
    
    service = PaymentService(session)
    wallet = service.get_or_create_wallet(user.user_id)
    wallet.balance_paise += topup.amount_paise
    wallet.updated_at = datetime.utcnow()
    session.commit()
    session.refresh(wallet)

    return success_envelope(
        data=WalletResponseData(
            user_id=wallet.user_id,
            balance_paise=wallet.balance_paise,
            currency=wallet.currency
        ).model_dump(),
        request_id=req_id
    )

@router.post("/pin", summary="Set or update watch security PIN")
async def set_pin(
    pin_req: SetPINRequest,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_pin")
    if not (pin_req.pin.isdigit() and len(pin_req.pin) in [4, 6]):
        raise DoraPaymentException(code="INVALID_PIN_FORMAT", message="PIN must be 4 or 6 numeric digits.")

    service = PaymentService(session)
    sec = service.get_or_create_security(user.user_id)
    h, s = hash_pin(pin_req.pin)
    sec.pin_hash = h
    sec.pin_salt = s
    sec.failed_attempts = 0
    sec.locked_until = None
    sec.updated_at = datetime.utcnow()
    session.commit()

    return success_envelope(
        data={"message": "Watch PIN updated successfully"},
        request_id=req_id
    )
