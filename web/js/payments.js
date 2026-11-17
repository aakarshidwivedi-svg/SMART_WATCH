/* =========================================================================
   Universal Payment Controller
   Reuses existing window.DoraAPI (/payment-static/js/api.js) and the
   existing dora-payments FastAPI backend (/api/v1/wallet, /api/v1/payments,
   /manifest, QRService, SimulatedNFC, SimulatedQR).
   ========================================================================= */

(function () {
  "use strict";

  class PaymentController {
    constructor(onWalletUpdate) {
      this.onWalletUpdate = onWalletUpdate || (() => {});
      this.currentTxn = null;
      this.enteredPin = "";
      this.balancePaise = 0;

      this.hostEl = document.getElementById("pay-viewport-host");
      this.bindUI();
      this.init();
    }

    formatINR(paise) {
      return "₹" + (paise / 100).toFixed(2);
    }

    showScreen(screenId) {
      document.querySelectorAll(".pay-screen").forEach((s) => s.classList.remove("active"));
      const target = document.getElementById(screenId);
      if (target) target.classList.add("active");
    }

    async init() {
      await Promise.all([
        this.refreshWallet(),
        this.refreshTransactions(),
        this.loadManifest(),
        this.refreshQr(),
      ]);
    }

    async loadManifest() {
      try {
        const res = await fetch("/manifest");
        const json = await res.json();
        if (!json.ok) return;
        const lim = json.data.default_limits;
        const el = document.getElementById("pay-manifest-strip");
        if (el && lim) {
          el.textContent = `DORA Module v${json.data.version} · Max ${this.formatINR(lim.max_per_txn_paise)}/txn · Daily ${this.formatINR(lim.daily_limit_paise)}`;
        }
      } catch (_) {}
    }

    async refreshWallet() {
      try {
        const wallet = await window.DoraAPI.getWallet();
        this.balancePaise = wallet.balance_paise;
        const el = document.getElementById("pay-wallet-val");
        if (el) el.textContent = this.formatINR(wallet.balance_paise);
        this.onWalletUpdate(wallet.balance_paise);
      } catch (err) {
        console.error("[Payments] Wallet load error:", err);
      }
    }

    async refreshTransactions() {
      const tbody = document.getElementById("pay-txn-tbody");
      if (!tbody) return;
      try {
        const txns = await window.DoraAPI.request("/payments?limit=10");
        if (!txns || txns.length === 0) {
          tbody.innerHTML = `<tr><td colspan="4" class="muted-sm">No transactions yet. Initiate a payment to test!</td></tr>`;
          return;
        }
        tbody.innerHTML = txns.map((t) => `
          <tr>
            <td><strong>${t.merchant_name}</strong></td>
            <td class="mono muted-sm">${t.payment_method}</td>
            <td class="mono">${this.formatINR(t.amount_paise)}</td>
            <td><span class="txn-pill txn-${t.state}">${t.state}</span></td>
          </tr>
        `).join("");
      } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" class="muted-sm">Unable to load ledger.</td></tr>`;
      }
    }

    updatePinDisplay() {
      const display = document.getElementById("pay-pin-dots");
      if (display) display.textContent = "•".repeat(this.enteredPin.length);
    }

    async initiatePayment(merchantName, amountPaise, method = "WALLET", merchantVpa = null, description = "SmartWatch X Payment") {
      try {
        const txn = await window.DoraAPI.createPayment({
          amountPaise,
          merchantName,
          merchantVpa: merchantVpa || undefined,
          method,
          description,
        });
        this.currentTxn = txn;
        this.enteredPin = "";
        this.updatePinDisplay();

        const set = (id, txt) => {
          const el = document.getElementById(id);
          if (el) el.textContent = txt;
        };
        set("pay-pin-error", "");
        set("pay-confirm-merchant", txn.merchant_name);
        set("pay-confirm-amt", this.formatINR(txn.amount_paise));
        set("pay-confirm-method", txn.payment_method);
        this.showScreen("pay-screen-pin");
        await this.refreshTransactions();
      } catch (err) {
        const errEl = document.getElementById("pay-pin-error");
        if (errEl) errEl.textContent = err.message || "Failed to initiate payment";
        alert(err.message || "Failed to initiate payment");
      }
    }

    async submitPin() {
      if (!this.currentTxn) return;
      const errEl = document.getElementById("pay-pin-error");
      if (this.enteredPin.length !== 4) {
        if (errEl) errEl.textContent = "Enter 4-digit PIN (Demo: 1234)";
        return;
      }
      const pin = this.enteredPin;
      this.enteredPin = "";
      this.updatePinDisplay();
      if (errEl) errEl.textContent = "Authorizing...";

      try {
        const res = await window.DoraAPI.authorizePayment(this.currentTxn.txn_id, pin);
        if (errEl) errEl.textContent = "";
        document.getElementById("pay-success-amt").textContent = this.formatINR(res.amount_paise);
        document.getElementById("pay-success-merchant").textContent = res.merchant_name;
        document.getElementById("pay-success-txnid").textContent = `TXN: ${res.txn_id}`;
        await Promise.all([this.refreshWallet(), this.refreshTransactions()]);
        this.showScreen("pay-screen-success");
      } catch (err) {
        if (errEl) errEl.textContent = err.message || "Authorization failed";
        await this.refreshTransactions();
      }
    }

    async cancelCurrent() {
      if (this.currentTxn) {
        await window.DoraAPI.cancelPayment(this.currentTxn.txn_id).catch(() => {});
        this.currentTxn = null;
      }
      this.enteredPin = "";
      this.updatePinDisplay();
      this.showScreen("pay-screen-home");
      await this.refreshTransactions();
    }

    async topUpDemo() {
      try {
        await window.DoraAPI.topUpWallet(50000);
        await this.refreshWallet();
      } catch (err) {
        alert(err.message || "Top-up failed");
      }
    }

    async refreshQr() {
      const merchant = (document.getElementById("pay-custom-merchant")?.value || "Dora Cyber Cafe").trim();
      const vpa = (document.getElementById("pay-custom-vpa")?.value || "dora_cafe@upi").trim();
      const amtInr = Math.max(1, Number(document.getElementById("pay-custom-amount")?.value || 150));
      const amtPaise = Math.round(amtInr * 100);
      try {
        const qs = new URLSearchParams({
          payee_vpa: vpa,
          payee_name: merchant,
          amount_paise: String(amtPaise),
          note: "SmartWatch X UPI QR",
        });
        const data = await window.DoraAPI.request(`/payments/qr/generate?${qs.toString()}`);
        const img = document.getElementById("pay-qr-img");
        const uriEl = document.getElementById("pay-qr-uri");
        const stEl = document.getElementById("pay-qr-status");
        if (img) img.src = data.qr_image_data_url;
        if (uriEl) uriEl.textContent = data.upi_uri;
        if (stEl) stEl.textContent = `${data.payee_name} · ${this.formatINR(data.amount_paise)}`;
      } catch (err) {
        console.error("[Payments] QR gen error:", err);
      }
    }

    async scanAndPayQr() {
      try {
        const scan = await window.DoraAPI.request("/payments/qr/scan", { method: "POST" });
        const p = scan.parsed;
        await this.initiatePayment(
          p.payee_name || "Dora Cafe",
          p.amount_paise || 15000,
          "UPI_QR",
          p.payee_vpa || "dora_cafe@upi",
          p.note || "UPI QR Scan Payment"
        );
      } catch (err) {
        alert(err.message || "QR scan failed");
      }
    }

    async triggerNfcTap() {
      const detEl = document.getElementById("pay-nfc-details");
      try {
        const data = await window.DoraAPI.request("/payments/nfc/scan", { method: "POST" });
        if (detEl) {
          detEl.textContent =
            `NFC HANDSHAKE OK (${data.tag.type})\n` +
            `Tag ID: ${data.tag.tag_id} · Terminal: ${data.tag.terminal_id}\n` +
            `Merchant: ${data.merchant_name} (${data.tag.merchant_vpa}) · ${this.formatINR(data.amount_paise)}`;
        }
        await this.initiatePayment(
          data.merchant_name,
          data.amount_paise,
          "NFC_TAP",
          data.tag.merchant_vpa,
          `NFC Tap (${data.tag.terminal_id})`
        );
      } catch (err) {
        if (detEl) detEl.textContent = err.message || "NFC tap failed";
      }
    }

    bindUI() {
      // Display mode toggle (Watch UI Round vs Hologram Simulation)
      document.querySelectorAll(".mode-switch-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".mode-switch-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          if (this.hostEl) this.hostEl.setAttribute("data-mode", btn.dataset.payMode);
        });
      });

      // Payment method tabs
      document.querySelectorAll(".method-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          const target = tab.dataset.payTab;
          document.querySelectorAll(".method-tab").forEach((t) => t.classList.toggle("active", t === tab));
          document.querySelectorAll(".method-pane").forEach((p) => p.classList.remove("active"));
          const pane = document.getElementById(`pay-pane-${target}`);
          if (pane) pane.classList.add("active");
          if (target === "qr") this.refreshQr();
        });
      });

      // Watch Quick Action Buttons (preserving exact existing actions!)
      document.getElementById("pay-quick-cafe")?.addEventListener("click", () => {
        this.initiatePayment("Dora Cyber Cafe", 15000, "WALLET", "cafe@upi", "Quick Demo Payment");
      });
      document.getElementById("pay-quick-metro")?.addEventListener("click", () => {
        this.initiatePayment("Metro Transit Gate", 4500, "NFC_TAP", "metro@upi", "Metro Transit Tap");
      });
      document.getElementById("pay-quick-topup")?.addEventListener("click", () => this.topUpDemo());
      document.getElementById("pay-btn-topup-side")?.addEventListener("click", () => this.topUpDemo());

      // PIN keypad
      document.querySelectorAll("#pay-keypad .pay-key").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const val = btn.dataset.key;
          if (val === "C") {
            this.enteredPin = "";
          } else if (val === "OK") {
            await this.submitPin();
            return;
          } else if (this.enteredPin.length < 4) {
            this.enteredPin += val;
          }
          this.updatePinDisplay();
        });
      });

      document.getElementById("pay-btn-cancel")?.addEventListener("click", () => this.cancelCurrent());
      document.getElementById("pay-btn-done")?.addEventListener("click", () => this.showScreen("pay-screen-home"));

      // Custom Payment Submit
      document.getElementById("pay-btn-custom-submit")?.addEventListener("click", () => {
        const merchant = (document.getElementById("pay-custom-merchant")?.value || "Dora Merchant").trim();
        const vpa = (document.getElementById("pay-custom-vpa")?.value || "").trim();
        const amtInr = Number(document.getElementById("pay-custom-amount")?.value || 0);
        const method = document.getElementById("pay-custom-method")?.value || "WALLET";
        if (!amtInr || amtInr <= 0) {
          alert("Enter a valid payment amount in INR.");
          return;
        }
        this.initiatePayment(merchant, Math.round(amtInr * 100), method, vpa || null, "Custom Watch Payment");
      });

      // QR & NFC Buttons
      document.getElementById("pay-btn-refresh-qr")?.addEventListener("click", () => this.refreshQr());
      document.getElementById("pay-btn-scan-qr")?.addEventListener("click", () => this.scanAndPayQr());
      document.getElementById("pay-btn-nfc-trigger")?.addEventListener("click", () => this.triggerNfcTap());
      document.getElementById("pay-nfc-pad")?.addEventListener("click", () => this.triggerNfcTap());
      document.getElementById("pay-btn-refresh-txns")?.addEventListener("click", () => this.refreshTransactions());
    }
  }

  window.PaymentController = PaymentController;
})();
