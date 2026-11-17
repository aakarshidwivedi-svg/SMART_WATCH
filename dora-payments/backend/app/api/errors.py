from fastapi import Request
from fastapi.responses import JSONResponse
from typing import Any, Optional

def success_envelope(data: Any, request_id: Optional[str] = "req_sim_001") -> dict:
    return {
        "ok": True,
        "data": data,
        "request_id": request_id
    }

def error_envelope(code: str, message: str, retryable: bool = False, request_id: Optional[str] = "req_sim_err") -> dict:
    return {
        "ok": False,
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable
        },
        "request_id": request_id
    }

class DoraPaymentException(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, retryable: bool = False):
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retryable = retryable
        super().__init__(message)

async def dora_exception_handler(request: Request, exc: DoraPaymentException):
    req_id = request.headers.get("X-Request-Id", "req_err")
    return JSONResponse(
        status_code=exc.status_code,
        content=error_envelope(code=exc.code, message=exc.message, retryable=exc.retryable, request_id=req_id)
    )
