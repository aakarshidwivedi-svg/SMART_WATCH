from fastapi import APIRouter, Request
from pydantic import BaseModel
from datetime import timedelta
from app.core.security import create_access_token
from app.api.errors import success_envelope

router = APIRouter(prefix="/auth", tags=["auth"])

class LoginRequest(BaseModel):
    user_id: str = "dora_demo_user"

@router.post("/token", summary="Issue a demo JWT access token for DORA client")
async def issue_token(login: LoginRequest, request: Request):
    req_id = request.headers.get("X-Request-Id", "req_token")
    token = create_access_token(
        data={"sub": login.user_id, "role": "dora_wearer"},
        expires_delta=timedelta(hours=24)
    )
    return success_envelope(
        data={
            "access_token": token,
            "token_type": "bearer",
            "user_id": login.user_id,
            "expires_in_hours": 24
        },
        request_id=req_id
    )
