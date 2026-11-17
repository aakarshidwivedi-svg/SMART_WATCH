# DORA Payment Module - Integration & API Guide

## 1. DORA Central Integration Endpoints

### Discoverability & Manifest
- **`GET /manifest`**: Returns module capabilities, display modes, limits, and schema. Used by DORA Hub orchestrator to auto-register capabilities.
- **`GET /health`**: Health status check for watchdog / monitoring.

### Payment Lifecycle API (`/api/v1/payments`)
All endpoints return standard envelopes:
- Success: `{ "ok": true, "data": {...}, "request_id": "..." }`
- Error: `{ "ok": false, "error": { "code": "...", "message": "...", "retryable": false }, "request_id": "..." }`

#### 1. Create Payment
- **Endpoint:** `POST /api/v1/payments`
- **Headers:** `Idempotency-Key` (recommended for watch networks)
- **Body:**
```json
{
  "amount_paise": 15000,
  "merchant_name": "Dora Cyber Cafe",
  "merchant_vpa": "cafe@upi",
  "payment_method": "WALLET",
  "description": "Espresso"
}
```

#### 2. Authorize Payment (PIN)
- **Endpoint:** `POST /api/v1/payments/{txn_id}/authorize`
- **Body:**
```json
{
  "pin": "1234"
}
```

#### 3. Cancel Payment
- **Endpoint:** `POST /api/v1/payments/{txn_id}/cancel`

---

## 2. Running Locally

```bash
cd dora-payments
pip install -r requirements.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```
Open your browser at `http://localhost:8000` to interact with both the Round Watch layout and Hologram perspective.
Interactive API docs are available at `http://localhost:8000/docs`.
