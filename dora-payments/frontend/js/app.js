const state = {
  currentTxn: null,
  enteredPin: "",
  balancePaise: 0
};

// UI Screen Switcher
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
}

// Format paise to INR string
function formatINR(paise) {
  return "₹" + (paise / 100).toFixed(2);
}

async function refreshWallet() {
  try {
    const wallet = await DoraAPI.getWallet();
    state.balancePaise = wallet.balance_paise;
    document.querySelectorAll(".wallet-val").forEach(el => {
      el.textContent = formatINR(wallet.balance_paise);
    });
  } catch (err) {
    console.error("Wallet update error", err);
  }
}

// Mode Selector (Watch vs Hologram)
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const mode = btn.dataset.target;
    document.body.setAttribute("data-mode", mode);
  });
});

// Keypad handler for PIN entry
document.querySelectorAll(".key-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const val = btn.dataset.key;
    if (val === "C") {
      state.enteredPin = "";
    } else if (val === "OK") {
      await submitPin();
      return;
    } else if (state.enteredPin.length < 4) {
      state.enteredPin += val;
    }
    updatePinDisplay();
  });
});

function updatePinDisplay() {
  const display = document.getElementById("pin-dots");
  display.textContent = "•".repeat(state.enteredPin.length);
}

async function submitPin() {
  if (state.enteredPin.length !== 4) return;
  const pin = state.enteredPin;
  state.enteredPin = "";
  updatePinDisplay();

  const errEl = document.getElementById("pin-error");
  errEl.textContent = "Authorizing...";

  try {
    const res = await DoraAPI.authorizePayment(state.currentTxn.txn_id, pin);
    errEl.textContent = "";
    document.getElementById("success-amt").textContent = formatINR(res.amount_paise);
    document.getElementById("success-merchant").textContent = res.merchant_name;
    await refreshWallet();
    showScreen("screen-success");
  } catch (err) {
    errEl.textContent = err.message || "Authorization failed";
  }
}

// Quick Payment Trigger (Simulated Tap or QR scan)
window.initiatePayment = async function(merchantName, amountPaise, method = "WALLET") {
  try {
    const txn = await DoraAPI.createPayment({
      amountPaise,
      merchantName,
      method,
      description: "Quick Demo Payment"
    });
    state.currentTxn = txn;
    state.enteredPin = "";
    updatePinDisplay();
    document.getElementById("pin-error").textContent = "";
    document.getElementById("confirm-merchant").textContent = txn.merchant_name;
    document.getElementById("confirm-amt").textContent = formatINR(txn.amount_paise);
    showScreen("screen-pin");
  } catch (err) {
    alert(err.message || "Failed to initiate payment");
  }
};

window.topUpDemo = async function() {
  try {
    await DoraAPI.topUpWallet(50000); // Add ₹500
    await refreshWallet();
  } catch (err) {
    alert(err.message);
  }
};

window.cancelCurrent = async function() {
  if (state.currentTxn) {
    await DoraAPI.cancelPayment(state.currentTxn.txn_id).catch(() => {});
  }
  showScreen("screen-home");
};

// Initial load
window.addEventListener("DOMContentLoaded", () => {
  refreshWallet();
});
