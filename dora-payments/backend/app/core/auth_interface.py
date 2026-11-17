from abc import ABC, abstractmethod
from typing import Optional
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.security import decode_access_token

security = HTTPBearer(auto_error=False)

class AuthUser:
    def __init__(self, user_id: str, role: str = "user"):
        self.user_id = user_id
        self.role = role

class AuthProvider(ABC):
    """Abstract interface so DORA core or central hub can plug in its own auth."""
    @abstractmethod
    def authenticate(self, credentials: Optional[HTTPAuthorizationCredentials]) -> AuthUser:
        pass

class DevAuthProvider(AuthProvider):
    """Dev version issues and accepts demo JWT tokens or falls back to demo-user."""
    def authenticate(self, credentials: Optional[HTTPAuthorizationCredentials]) -> AuthUser:
        if not credentials:
            # For quick dev/watch preview mode if no header is supplied
            return AuthUser(user_id="dora_demo_user", role="demo")
        token = credentials.credentials
        payload = decode_access_token(token)
        if not payload or "sub" not in payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return AuthUser(user_id=payload["sub"], role=payload.get("role", "user"))

_current_auth_provider: AuthProvider = DevAuthProvider()

def get_auth_provider() -> AuthProvider:
    return _current_auth_provider

def set_auth_provider(provider: AuthProvider):
    global _current_auth_provider
    _current_auth_provider = provider

def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Security(security)) -> AuthUser:
    return get_auth_provider().authenticate(credentials)
