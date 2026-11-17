/* =========================================================================
   SmartWatch X — Unified Dashboard Shell Controller
   Manages navigation between Dashboard and the 4 integrated feature panels,
   live smartwatch preview telemetry, ECG strip, and cross-module status sync.
   ========================================================================= */

(function () {
  "use strict";

  const VIEWS = ["dashboard", "hologram", "sos", "payment", "transform"];
  let activeView = "dashboard";

  let holoCtrl = null;
  let sosCtrl = null;
  let payCtrl = null;
  let tfCtrl = null;

  function setText(id, txt) {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function navigateTo(viewName) {
    if (!VIEWS.includes(viewName)) viewName = "dashboard";
    activeView = viewName;

    // Switch visible panel
    document.querySelectorAll(".view-section").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `view-${viewName}`);
    });

    // Update top nav pills
    document.querySelectorAll(".main-nav .nav-pill").forEach((pill) => {
      pill.classList.toggle("active", pill.dataset.view === viewName);
    });

    // Activate / pause GPU animation loops cleanly
    if (holoCtrl) holoCtrl.setActive(viewName === "hologram");
    if (tfCtrl) tfCtrl.setActive(viewName === "transform");
    if (payCtrl && viewName === "payment") {
      payCtrl.refreshWallet();
      payCtrl.refreshTransactions();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function drawPreviewEcg(samples) {
    const canvas = document.getElementById("preview-ecg-canvas");
    if (!canvas || !Array.isArray(samples) || samples.length < 2) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = 1.7;
    ctx.shadowColor = "#00f0ff";
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = h * 0.72 - samples[i] * (h * 0.56);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function updateLocalClock() {
    const now = new Date();
    const hhmmss = now.toTimeString().slice(0, 8);
    const hhmm = now.toTimeString().slice(0, 5);
    const dateStr = now.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase();
    setText("header-clock", hhmmss);
    setText("preview-time", hhmm);
    setText("preview-date", dateStr);
  }

  async function pollTelemetry() {
    try {
      const res = await fetch("/api/v1/hologram/telemetry");
      const json = await res.json();
      if (!json.ok) return;
      const tel = json.data;

      setText("header-battery", `${tel.battery}%`);
      setText("preview-batt", `${tel.battery}%`);
      setText("preview-bpm", `${tel.bpm}`);
      setText("card-meta-hologram", `${tel.bpm} BPM · ${tel.spo2}% SpO2 · ${tel.screen_page_name}`);
      drawPreviewEcg(tel.ecg);

      if (holoCtrl) {
        holoCtrl.updateTelemetryUI(tel);
      }
    } catch (_) {}
  }

  function handleSosStateChange({ state, contactsCount }) {
    const globalPill = document.getElementById("global-status-pill");
    const globalText = document.getElementById("global-status-text");
    const watchHw = document.getElementById("preview-watch-hardware");
    const modeBadge = document.getElementById("preview-mode-badge");
    const cardStatus = document.getElementById("card-status-sos");
    const dashStat = document.getElementById("dash-stat-sos");
    const cardMeta = document.getElementById("card-meta-sos");

    const isAlert = state === "ACTIVE" || state === "COUNTDOWN" || state === "TRIGGERED";

    if (globalPill && globalText) {
      globalPill.classList.toggle("status-sos", isAlert);
      globalText.textContent =
        state === "ACTIVE"
          ? "SOS EMERGENCY ACTIVE"
          : state === "COUNTDOWN"
          ? "SOS COUNTDOWN..."
          : "SYSTEM ONLINE";
    }
    if (watchHw) watchHw.classList.toggle("sos-alert", isAlert);
    if (modeBadge) {
      modeBadge.textContent = isAlert ? `SOS ${state}` : "OS READY";
      modeBadge.style.color = isAlert ? "#ff2a4d" : "#00f0ff";
    }
    if (cardStatus) {
      cardStatus.innerHTML = `<span class="b-dot"></span>${state === "NORMAL" ? "STANDBY" : state}`;
    }
    if (dashStat) {
      dashStat.textContent =
        state === "NORMAL" ? `STANDBY · ${contactsCount} ICE` : `SOS ${state}`;
      dashStat.className = `mini-stat-val ${isAlert ? "accent-red" : "accent-green"}`;
    }
    if (cardMeta) {
      cardMeta.textContent = `${contactsCount} ICE CONTACTS LOADED`;
    }
  }

  function handleWalletUpdate(balancePaise) {
    const formatted = "₹" + (balancePaise / 100).toFixed(2);
    const shortVal = "₹" + Math.round(balancePaise / 100);
    setText("preview-wallet", shortVal);
    setText("card-meta-payment", `BALANCE ${formatted} · PIN 1234`);
    setText("dash-stat-pay", `${formatted} READY`);
  }

  function handleTransformStageChange({ stageIndex, stageLabel, locked }) {
    const shortStage = stageLabel.split(" ")[0].toUpperCase();
    setText("card-meta-transform", `STAGE ${stageIndex + 1}/5 · ${shortStage}`);
    setText("dash-stat-mod", locked ? "LOCKED · 6 MODS" : `STAGE ${stageIndex + 1} · OPEN`);
    const cardStatus = document.getElementById("card-status-transform");
    if (cardStatus) {
      cardStatus.innerHTML = `<span class="b-dot"></span>${locked ? "MODULAR LOCK" : "TRANSFORMING"}`;
    }
  }

  function bindNavigation() {
    // Top nav pills & Back-to-Dashboard buttons
    document.querySelectorAll("[data-view]").forEach((el) => {
      el.addEventListener("click", () => navigateTo(el.dataset.view));
    });

    // Feature cards & preview watch quick buttons
    document.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", () => navigateTo(el.dataset.open));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateTo(el.dataset.open);
        }
      });
    });

    // Brand logo returns to Dashboard
    const brand = document.getElementById("brand-home");
    if (brand) {
      brand.addEventListener("click", () => navigateTo("dashboard"));
      brand.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateTo("dashboard");
        }
      });
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    bindNavigation();
    updateLocalClock();
    setInterval(updateLocalClock, 1000);

    holoCtrl = new window.HologramController();
    sosCtrl = new window.SosController(handleSosStateChange);
    payCtrl = new window.PaymentController(handleWalletUpdate);
    tfCtrl = new window.TransformController(handleTransformStageChange);

    // Expose controller references for clean debugging/testing
    window.SmartWatchApp = {
      navigateTo,
      holoCtrl,
      sosCtrl,
      payCtrl,
      tfCtrl,
    };

    pollTelemetry();
    setInterval(pollTelemetry, 700);
  });
})();
