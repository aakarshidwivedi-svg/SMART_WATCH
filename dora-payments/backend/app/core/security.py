import os
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Tuple
from jose import jwt
from app.config import settings

def hash_pin(pin: str, salt: Optional[str] = None) -> Tuple[str, str]:
    """PBKDF2 salted hash for 4-to-6 digit watch PIN."""
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        pin.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return key.hex(), salt

def verify_pin(pin: str, hashed_pin: str, salt: str) -> bool:
    new_hash, _ = hash_pin(pin, salt)
    return secrets.compare_digest(new_hash, hashed_pin)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except Exception:
        return None
