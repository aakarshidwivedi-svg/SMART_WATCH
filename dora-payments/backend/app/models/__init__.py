import enum
from datetime import datetime, timezone
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship

def utc_now():
    return datetime.now(timezone.utc)

class PaymentState(str, enum.Enum):
    CREATED = "CREATED"
    AUTHORIZED = "AUTHORIZED"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"

class PaymentMethod(str, enum.Enum):
    WALLET = "WALLET"
    UPI_QR = "UPI_QR"
    NFC_TAP = "NFC_TAP"
    SIMULATED_CARD = "SIMULATED_CARD"

# --- DB Models ---

class Wallet(SQLModel, table=True):
    __tablename__ = "wallets"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, unique=True)
    balance_paise: int = Field(default=0)
    currency: str = Field(default="INR")
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    # Relationships
    transactions: List["Transaction"] = Relationship(back_populates="wallet")

class UserSecurity(SQLModel, table=True):
    __tablename__ = "user_securities"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(index=True, unique=True)
    pin_hash: str
    pin_salt: str
    failed_attempts: int = Field(default=0)
    locked_until: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=utc_now)

class PaymentToken(SQLModel, table=True):
    __tablename__ = "payment_tokens"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: str = Field(index=True)
    token_str: str = Field(index=True, unique=True)  # Mock virtual card/token
    card_last4: str = Field(default="8888")
    card_brand: str = Field(default="RuPay")         # e.g., RuPay, Visa, UPI-Virtual
    is_active: bool = Field(default=True)
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)

class Transaction(SQLModel, table=True):
    __tablename__ = "transactions"

    id: Optional[int] = Field(default=None, primary_key=True)
    txn_id: str = Field(index=True, unique=True) # external/api-facing UUID
    idempotency_key: Optional[str] = Field(default=None, index=True)
    user_id: str = Field(index=True)
    wallet_id: Optional[int] = Field(default=None, foreign_key="wallets.id")
    
    amount_paise: int
    currency: str = Field(default="INR")
    payment_method: PaymentMethod
    state: PaymentState = Field(default=PaymentState.CREATED)
    
    merchant_name: str
    merchant_vpa: Optional[str] = None # e.g. merchant@upi
    description: Optional[str] = None
    
    failure_reason: Optional[str] = None
    expires_at: datetime
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    wallet: Optional[Wallet] = Relationship(back_populates="transactions")
    audit_logs: List["AuditLog"] = Relationship(back_populates="transaction")

class AuditLog(SQLModel, table=True):
    __tablename__ = "audit_logs"

    id: Optional[int] = Field(default=None, primary_key=True)
    transaction_id: Optional[int] = Field(default=None, foreign_key="transactions.id")
    user_id: str
    from_state: Optional[str] = None
    to_state: str
    action: str
    details: Optional[str] = None
    timestamp: datetime = Field(default_factory=utc_now)

    transaction: Optional[Transaction] = Relationship(back_populates="audit_logs")


# --- API Request & Response Schemas ---

class CreatePaymentRequest(SQLModel):
    amount_paise: int
    merchant_name: str
    merchant_vpa: Optional[str] = None
    payment_method: PaymentMethod = PaymentMethod.WALLET
    description: Optional[str] = None

class AuthorizePaymentRequest(SQLModel):
    pin: str

class WalletTopUpRequest(SQLModel):
    amount_paise: int

class SetPINRequest(SQLModel):
    pin: str

class PaymentResponseData(SQLModel):
    txn_id: str
    amount_paise: int
    currency: str
    state: PaymentState
    merchant_name: str
    merchant_vpa: Optional[str] = None
    payment_method: PaymentMethod
    created_at: datetime
    expires_at: datetime
    description: Optional[str] = None

class WalletResponseData(SQLModel):
    user_id: str
    balance_paise: int
    currency: str
