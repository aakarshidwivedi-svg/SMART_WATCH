from fastapi import APIRouter, Depends, Header, Request
from typing import Optional, List
from sqlmodel import Session, select

from app.db import get_session
from app.core.auth_interface import get_current_user, AuthUser
from app.models import (
    CreatePaymentRequest, AuthorizePaymentRequest, PaymentResponseData,
    Transaction, PaymentState
)
from app.api.errors import success_envelope, DoraPaymentException
from app.services.payment_service import PaymentService

router = APIRouter(prefix="/payments", tags=["payments"])

@router.post("", summary="Create a new payment request")
async def create_payment(
    req: CreatePaymentRequest,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_create")
    service = PaymentService(session)
    txn = await service.create_payment(user.user_id, req, idempotency_key=idempotency_key)
    
    return success_envelope(
        data=PaymentResponseData(
            txn_id=txn.txn_id,
            amount_paise=txn.amount_paise,
            currency=txn.currency,
            state=txn.state,
            merchant_name=txn.merchant_name,
            merchant_vpa=txn.merchant_vpa,
            payment_method=txn.payment_method,
            created_at=txn.created_at,
            expires_at=txn.expires_at,
            description=txn.description
        ).model_dump(),
        request_id=req_id
    )

@router.post("/{txn_id}/authorize", summary="Authorize payment with PIN")
async def authorize_payment(
    txn_id: str,
    auth_req: AuthorizePaymentRequest,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_auth")
    service = PaymentService(session)
    txn = await service.authorize_and_pay(user.user_id, txn_id, auth_req.pin)
    
    return success_envelope(
        data=PaymentResponseData(
            txn_id=txn.txn_id,
            amount_paise=txn.amount_paise,
            currency=txn.currency,
            state=txn.state,
            merchant_name=txn.merchant_name,
            merchant_vpa=txn.merchant_vpa,
            payment_method=txn.payment_method,
            created_at=txn.created_at,
            expires_at=txn.expires_at,
            description=txn.description
        ).model_dump(),
        request_id=req_id
    )

@router.post("/{txn_id}/cancel", summary="Cancel a pending payment")
async def cancel_payment(
    txn_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_cancel")
    service = PaymentService(session)
    txn = await service.cancel_payment(user.user_id, txn_id)
    return success_envelope(
        data={"txn_id": txn.txn_id, "state": txn.state.value},
        request_id=req_id
    )

@router.get("/{txn_id}", summary="Get payment transaction status")
async def get_payment_status(
    txn_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_status")
    txn = session.exec(
        select(Transaction).where(Transaction.txn_id == txn_id, Transaction.user_id == user.user_id)
    ).first()
    if not txn:
        raise DoraPaymentException(code="NOT_FOUND", message="Transaction not found", status_code=404)

    return success_envelope(
        data=PaymentResponseData(
            txn_id=txn.txn_id,
            amount_paise=txn.amount_paise,
            currency=txn.currency,
            state=txn.state,
            merchant_name=txn.merchant_name,
            merchant_vpa=txn.merchant_vpa,
            payment_method=txn.payment_method,
            created_at=txn.created_at,
            expires_at=txn.expires_at,
            description=txn.description
        ).model_dump(),
        request_id=req_id
    )

@router.get("", summary="List recent payments")
async def list_payments(
    request: Request,
    limit: int = 10,
    user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session)
):
    req_id = request.headers.get("X-Request-Id", "req_list")
    txns = session.exec(
        select(Transaction)
        .where(Transaction.user_id == user.user_id)
        .order_by(Transaction.created_at.desc())
        .limit(limit)
    ).all()

    return success_envelope(
        data=[
            PaymentResponseData(
                txn_id=t.txn_id,
                amount_paise=t.amount_paise,
                currency=t.currency,
                state=t.state,
                merchant_name=t.merchant_name,
                merchant_vpa=t.merchant_vpa,
                payment_method=t.payment_method,
                created_at=t.created_at,
                expires_at=t.expires_at,
                description=t.description
            ).model_dump()
            for t in txns
        ],
        request_id=req_id
    )
