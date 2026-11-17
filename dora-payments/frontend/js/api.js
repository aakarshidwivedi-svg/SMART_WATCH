const API_BASE = "/api/v1";

class DoraPaymentsAPI {
  static async request(endpoint, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        throw json.error || { message: "Network error occurred" };
      }
      return json.data;
    } catch (err) {
      console.error("[API Error]", err);
      throw err;
    }
  }

  static async getWallet() {
    return this.request("/wallet");
  }

  static async topUpWallet(amountPaise) {
    return this.request("/wallet/topup", {
      method: "POST",
      body: JSON.stringify({ amount_paise: amountPaise })
    });
  }

  static async createPayment({ amountPaise, merchantName, merchantVpa, method, description }) {
    const idempotencyKey = "idemp_" + Math.random().toString(36).substring(2, 12);
    return this.request("/payments", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        amount_paise: amountPaise,
        merchant_name: merchantName,
        merchant_vpa: merchantVpa,
        payment_method: method || "WALLET",
        description: description
      })
    });
  }

  static async authorizePayment(txnId, pin) {
    return this.request(`/payments/${txnId}/authorize`, {
      method: "POST",
      body: JSON.stringify({ pin })
    });
  }

  static async cancelPayment(txnId) {
    return this.request(`/payments/${txnId}/cancel`, {
      method: "POST"
    });
  }
}

window.DoraAPI = DoraPaymentsAPI;
