import pytest
from fastapi.testclient import TestClient
from sqlmodel import SQLModel, create_engine, Session

from app.main import app as fastapi_app
from app.db import get_session
import app.models  # ensure models are registered
from sqlmodel.pool import StaticPool

# Test database
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)

def override_get_session():
    with Session(test_engine) as session:
        yield session

fastapi_app.dependency_overrides[get_session] = override_get_session

@pytest.fixture(autouse=True)
def setup_db():
    SQLModel.metadata.create_all(test_engine)
    yield
    SQLModel.metadata.drop_all(test_engine)

client = TestClient(fastapi_app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    res = response.json()
    assert res["ok"] is True
    assert res["data"]["service"] == "dora-payments"

def test_manifest():
    response = client.get("/manifest")
    assert response.status_code == 200
    res = response.json()
    assert "payment.create" in res["data"]["capabilities"]

def test_wallet_and_payment_flow():
    # 1. Get initial wallet (demo ₹500 = 50000 paise)
    res = client.get("/api/v1/wallet")
    assert res.status_code == 200
    assert res.json()["data"]["balance_paise"] == 50000

    # 2. Create payment ₹150 (15000 paise)
    pay_payload = {
        "amount_paise": 15000,
        "merchant_name": "Dora Cyber Cafe",
        "merchant_vpa": "cybercafe@upi",
        "payment_method": "WALLET",
        "description": "Espresso + Donut"
    }
    create_res = client.post("/api/v1/payments", json=pay_payload)
    assert create_res.status_code == 200
    txn_data = create_res.json()["data"]
    txn_id = txn_data["txn_id"]
    assert txn_data["state"] == "CREATED"

    # 3. Test wrong PIN
    wrong_pin_res = client.post(f"/api/v1/payments/{txn_id}/authorize", json={"pin": "0000"})
    assert wrong_pin_res.status_code == 400
    assert wrong_pin_res.json()["error"]["code"] == "INVALID_PIN"

    # 4. Authorize with correct default PIN (1234)
    auth_res = client.post(f"/api/v1/payments/{txn_id}/authorize", json={"pin": "1234"})
    assert auth_res.status_code == 200
    assert auth_res.json()["data"]["state"] == "SUCCESS"

    # 5. Check updated wallet balance: 50000 - 15000 = 35000
    w_res = client.get("/api/v1/wallet")
    assert w_res.json()["data"]["balance_paise"] == 35000

def test_payment_limit_exceeded():
    # Attempt ₹6,000 (limit is ₹5,000 = 500000 paise)
    over_limit_payload = {
        "amount_paise": 600000,
        "merchant_name": "Luxury Electronics",
        "payment_method": "WALLET"
    }
    res = client.post("/api/v1/payments", json=over_limit_payload)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "LIMIT_EXCEEDED"
