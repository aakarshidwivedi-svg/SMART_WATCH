/* =========================================================================
   SOS Mode Controller (Integrated Neon SOS Smartwatch Simulation)
   Connected directly to /api/v1/sos/* -> neon_sos/contacts.txt,
   neon_sos/sos_log.txt, and neon_sos/sos_outbox.txt.
   ========================================================================= */

(function () {
  "use strict";

  const BG = "#05070f";
  const CYAN = "#00f0ff";
  const BLUE = "#2f7bff";
  const PURPLE = "#b026ff";
  const RED = "#ff2a4d";
  const AMBER = "#ffb020";
  const WHITE = "#e8f4ff";
  const GREY = "#7d8ba5";
  const DARK_GREY = "#26304a";

  class SosController {
    constructor(onStateChange) {
      this.onStateChange = onStateChange || (() => {});
      this.canvas = document.getElementById("sos-watch-canvas");
      this.ctx = this.canvas ? this.canvas.getContext("2d") : null;

      this.state = "NORMAL"; // NORMAL | TRIGGERED | COUNTDOWN | ACTIVE | CANCELLED
      this.holdSeconds = 1.0;
      this.countdownSeconds = 5;
      this.triggerFlashSeconds = 0.5;
      this.cancelMessageSeconds = 2.0;

      this.holding = false;
      this.holdStartMs = 0;
      this.phaseEndMs = 0;
      this.activeSinceMs = 0;
      this.activationTime = "";

      this.contacts = [];
      this.latText = "LAT  12.97160 N";
      this.lonText = "LON  77.59460 E";
      this.battery = 87;
      this.netBars = 3;
      this.tick = 0;

      // Geometry on 360x540 canvas
      this.CX = 180;
      this.SOS_Y = 278;
      this.SOS_R = 58;
      this.cancelRect = { x1: 88, y1: 356, x2: 272, y2: 408 };
      this.resetRect = { x1: 88, y1: 416, x2: 272, y2: 460 };

      this.bindEvents();
      this.loadStatus();
      this.startLoop();
    }

    async loadStatus() {
      try {
        const res = await fetch("/api/v1/sos/status");
        const json = await res.json();
        if (!json.ok) return;
        const d = json.data;
        this.contacts = d.contacts || [];
        this.latText = d.lat_text;
        this.lonText = d.lon_text;
        this.holdSeconds = d.hold_seconds || 1.0;
        this.countdownSeconds = d.countdown_seconds || 5;
        this.renderContacts();
        this.updateGpsDom(d.lat_text, d.lon_text, d.gps_updated_at);
        const outboxBadge = document.getElementById("sos-outbox-badge");
        if (outboxBadge) outboxBadge.textContent = `Outbox alerts: ${d.outbox_count || 0}`;
        this.renderInitialLogs(d.logs || []);
        this.onStateChange({ state: this.state, contactsCount: this.contacts.length });
      } catch (err) {
        console.error("[SOS] loadStatus error:", err);
      }
    }

    renderContacts() {
      const grid = document.getElementById("sos-contacts-grid");
      if (!grid) return;
      grid.innerHTML = this.contacts.slice(0, 3).map((c, idx) => `
        <div class="contact-card">
          <div class="contact-rel">0${idx + 1}  ${c.relation.toUpperCase()}</div>
          <div class="contact-name">${c.name}</div>
          <div class="contact-phone">${c.phone}</div>
        </div>
      `).join("");
    }

    renderInitialLogs(lines) {
      const box = document.getElementById("sos-log-box");
      if (!box) return;
      box.innerHTML = "";
      lines.slice(-14).forEach((ln) => {
        const parts = ln.split(" - ");
        const timePart = parts[0] ? parts[0].split(" ").pop() : "--:--:--";
        const msgPart = parts.slice(1).join(" - ") || ln;
        this.appendLogDom(timePart, msgPart);
      });
    }

    appendLogDom(timeStr, msg) {
      const box = document.getElementById("sos-log-box");
      if (!box) return;
      const div = document.createElement("div");
      div.className = "sos-log-line";
      div.innerHTML = `<span class="log-time">${timeStr}</span><span>${msg}</span>`;
      box.appendChild(div);
      box.scrollTop = box.scrollHeight;
    }

    async logEvent(message) {
      const nowStr = new Date().toTimeString().slice(0, 8);
      this.appendLogDom(nowStr, message);
      try {
        await fetch("/api/v1/sos/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
      } catch (_) {}
    }

    updateGpsDom(lat, lon, updatedAt) {
      const latEl = document.getElementById("sos-gps-lat");
      const lonEl = document.getElementById("sos-gps-lon");
      const upEl = document.getElementById("sos-gps-updated");
      if (latEl) latEl.textContent = lat;
      if (lonEl) lonEl.textContent = lon;
      if (upEl && updatedAt) upEl.textContent = `Simulated GPS · ${updatedAt}`;
    }

    setState(newState) {
      this.state = newState;
      const chip = document.getElementById("sos-header-chip");
      if (chip) chip.textContent = `STATE: ${newState}`;

      document.querySelectorAll("#sos-flow-strip .flow-pill").forEach((pill) => {
        pill.className = "flow-pill";
        if (pill.dataset.sosState === newState) {
          pill.classList.add(`active-${newState.toLowerCase()}`);
        }
      });

      const cancelBtn = document.getElementById("sos-btn-cancel-ext");
      const resetBtn = document.getElementById("sos-btn-reset-ext");
      const holdBtn = document.getElementById("sos-btn-hold-sim");
      if (cancelBtn) cancelBtn.disabled = !(newState === "TRIGGERED" || newState === "COUNTDOWN");
      if (resetBtn) resetBtn.disabled = newState !== "ACTIVE";
      if (holdBtn) holdBtn.disabled = newState !== "NORMAL";

      this.onStateChange({ state: newState, contactsCount: this.contacts.length });
    }

    triggerSos() {
      this.setState("TRIGGERED");
      this.phaseEndMs = performance.now() + this.triggerFlashSeconds * 1000;
      this.logEvent(`SOS triggered (button held ${this.holdSeconds} s)`);
    }

    startCountdown() {
      this.setState("COUNTDOWN");
      this.phaseEndMs = performance.now() + this.countdownSeconds * 1000;
      this.logEvent(`Countdown started - ${this.countdownSeconds} s to cancel`);
    }

    cancelSos() {
      if (this.state !== "TRIGGERED" && this.state !== "COUNTDOWN") return;
      this.holding = false;
      this.setState("CANCELLED");
      this.phaseEndMs = performance.now() + this.cancelMessageSeconds * 1000;
      const alertBox = document.getElementById("sos-alerts-box");
      if (alertBox) {
        alertBox.classList.remove("alerts-active");
        alertBox.textContent = "SOS cancelled by user.\nNo alert was prepared.";
      }
      this.logEvent("SOS cancelled by user - no alert prepared");
    }

    returnToNormal() {
      this.setState("NORMAL");
      const alertBox = document.getElementById("sos-alerts-box");
      if (alertBox) {
        alertBox.classList.remove("alerts-active");
        alertBox.textContent = "STANDBY — No alerts prepared.\nAlerts appear here when SOS becomes active.";
      }
      this.logEvent("Returned to normal watch screen");
    }

    async activateSos() {
      this.setState("ACTIVE");
      this.activeSinceMs = performance.now();
      this.activationTime = new Date().toTimeString().slice(0, 8);
      this.logEvent("SOS ACTIVATED - emergency mode on");

      try {
        const res = await fetch("/api/v1/sos/dispatch", { method: "POST" });
        const json = await res.json();
        if (json.ok) {
          const d = json.data;
          this.latText = d.lat_text;
          this.lonText = d.lon_text;
          this.updateGpsDom(d.lat_text, d.lon_text, `Alert at ${d.activated_at}`);
          const alertBox = document.getElementById("sos-alerts-box");
          if (alertBox) {
            alertBox.classList.add("alerts-active");
            alertBox.textContent = d.alerts
              .map((a) => `» ${a.name}  ${a.phone}\n   [${a.status}]`)
              .join("\n");
          }
          const outboxBadge = document.getElementById("sos-outbox-badge");
          if (outboxBadge) outboxBadge.textContent = `Outbox alerts: ${d.outbox_count}`;
          this.appendLogDom(
            d.activated_at,
            `Simulated messages prepared for ${d.alerts.length} contacts (sos_outbox.txt)`
          );
        }
      } catch (err) {
        console.error("[SOS] dispatch error:", err);
      }
    }

    resetSystem() {
      if (this.state !== "ACTIVE") return;
      this.setState("NORMAL");
      const alertBox = document.getElementById("sos-alerts-box");
      if (alertBox) {
        alertBox.classList.remove("alerts-active");
        alertBox.textContent = "STANDBY — No alerts prepared.\nAlerts appear here when SOS becomes active.";
      }
      this.logEvent("System reset - back to normal");
    }

    async updateLocation() {
      try {
        const res = await fetch("/api/v1/sos/location", { method: "POST" });
        const json = await res.json();
        if (json.ok) {
          const d = json.data;
          this.latText = d.lat_text;
          this.lonText = d.lon_text;
          this.updateGpsDom(d.lat_text, d.lon_text, d.gps_updated_at);
          this.appendLogDom(
            new Date().toTimeString().slice(0, 8),
            `Simulated GPS updated: ${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`
          );
        }
      } catch (err) {
        console.error("[SOS] location error:", err);
      }
    }

    // ---- Canvas pointer interaction ----
    getCanvasCoords(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * this.canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * this.canvas.height,
      };
    }

    inRect(pt, r) {
      return pt.x >= r.x1 && pt.x <= r.x2 && pt.y >= r.y1 && pt.y <= r.y2;
    }

    bindEvents() {
      if (this.canvas) {
        this.canvas.addEventListener("pointerdown", (e) => {
          const pt = this.getCanvasCoords(e);
          if (this.state === "NORMAL") {
            if (Math.hypot(pt.x - this.CX, pt.y - this.SOS_Y) <= this.SOS_R + 8) {
              this.holding = true;
              this.holdStartMs = performance.now();
              this.logEvent("SOS button pressed - holding...");
              this.canvas.setPointerCapture(e.pointerId);
            }
          } else if (this.state === "TRIGGERED" || this.state === "COUNTDOWN") {
            if (this.inRect(pt, this.cancelRect)) {
              this.cancelSos();
            }
          } else if (this.state === "ACTIVE") {
            if (this.inRect(pt, this.resetRect)) {
              this.resetSystem();
            }
          }
        });

        this.canvas.addEventListener("pointermove", (e) => {
          const pt = this.getCanvasCoords(e);
          if (this.holding && Math.hypot(pt.x - this.CX, pt.y - this.SOS_Y) > this.SOS_R + 12) {
            this.holding = false;
            this.logEvent(`Released before ${this.holdSeconds} s - SOS not triggered`);
          }
          // Pointer cursor hint
          let hover = false;
          if (this.state === "NORMAL" && Math.hypot(pt.x - this.CX, pt.y - this.SOS_Y) <= this.SOS_R + 8) hover = true;
          if ((this.state === "TRIGGERED" || this.state === "COUNTDOWN") && this.inRect(pt, this.cancelRect)) hover = true;
          if (this.state === "ACTIVE" && this.inRect(pt, this.resetRect)) hover = true;
          this.canvas.style.cursor = hover ? "pointer" : "default";
        });

        const release = () => {
          if (this.holding) {
            this.holding = false;
            this.logEvent(`Released before ${this.holdSeconds} s - SOS not triggered`);
          }
        };
        this.canvas.addEventListener("pointerup", release);
        this.canvas.addEventListener("pointercancel", release);
      }

      // External console buttons (accessible & easy to demonstrate)
      const holdBtn = document.getElementById("sos-btn-hold-sim");
      if (holdBtn) {
        holdBtn.addEventListener("click", () => {
          if (this.state === "NORMAL") {
            this.holding = false;
            this.triggerSos();
          }
        });
      }
      const cancelBtn = document.getElementById("sos-btn-cancel-ext");
      if (cancelBtn) cancelBtn.addEventListener("click", () => this.cancelSos());

      const resetBtn = document.getElementById("sos-btn-reset-ext");
      if (resetBtn) resetBtn.addEventListener("click", () => this.resetSystem());

      const gpsBtn = document.getElementById("sos-btn-update-gps");
      if (gpsBtn) gpsBtn.addEventListener("click", () => this.updateLocation());

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && (this.state === "TRIGGERED" || this.state === "COUNTDOWN")) {
          this.cancelSos();
        }
      });
    }

    // ---- Canvas Rendering ----
    roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    drawWatchShell(ctx) {
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

      // Top & bottom straps
      ctx.fillStyle = "#0a1020";
      ctx.strokeStyle = "#182444";
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, 114, 0, 132, 62, 12);
      ctx.fill(); ctx.stroke();
      this.roundRect(ctx, 114, 478, 132, 62, 12);
      ctx.fill(); ctx.stroke();

      for (let y = 12; y <= 50; y += 12) {
        ctx.strokeStyle = "#14203b";
        ctx.beginPath();
        ctx.moveTo(128, y); ctx.lineTo(232, y);
        ctx.moveTo(128, 540 - y); ctx.lineTo(232, 540 - y);
        ctx.stroke();
      }

      // Case with neon glow outline
      const glowColor = this.state === "ACTIVE" || this.state === "COUNTDOWN" ? RED : CYAN;
      ctx.save();
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 20;
      ctx.fillStyle = "#080d1c";
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2.5;
      this.roundRect(ctx, 38, 42, 284, 456, 56);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Side crown + button
      ctx.fillStyle = BLUE;
      this.roundRect(ctx, 322, 198, 12, 54, 5);
      ctx.fill();
      ctx.fillStyle = PURPLE;
      this.roundRect(ctx, 322, 268, 10, 30, 4);
      ctx.fill();

      // Inner display glass
      ctx.fillStyle = "#03060f";
      ctx.strokeStyle = "#13304c";
      ctx.lineWidth = 1.2;
      this.roundRect(ctx, 56, 64, 248, 412, 40);
      ctx.fill();
      ctx.stroke();
    }

    drawNeonButton(ctx, rect, label, fill, textCol, strokeCol) {
      ctx.save();
      ctx.shadowColor = strokeCol;
      ctx.shadowBlur = 14;
      ctx.fillStyle = fill;
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 2;
      this.roundRect(ctx, rect.x1, rect.y1, rect.x2 - rect.x1, rect.y2 - rect.y1, 20);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = textCol;
      ctx.font = "bold 19px Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, (rect.x1 + rect.x2) / 2, (rect.y1 + rect.y2) / 2);
    }

    renderWatch(nowMs) {
      if (!this.ctx) return;
      const ctx = this.ctx;
      this.drawWatchShell(ctx);

      const nowDate = new Date();
      const clockStr = nowDate.toTimeString().slice(0, 8);
      const dateStr = nowDate.toDateString().toUpperCase();
      const pulse = 0.5 + 0.5 * Math.sin(this.tick * 0.12);

      if (this.state === "NORMAL") {
        // Status bar
        ctx.font = "bold 11px Consolas, monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = GREY;
        ctx.fillText("LTE", 84, 92);
        for (let i = 0; i < 4; i++) {
          const h = 4 + i * 3;
          ctx.fillStyle = i < this.netBars ? CYAN : DARK_GREY;
          ctx.fillRect(114 + i * 7, 94 - h, 4, h);
        }
        ctx.textAlign = "right";
        ctx.fillStyle = WHITE;
        ctx.fillText(`${this.battery}%`, 246, 92);
        ctx.strokeStyle = GREY;
        ctx.strokeRect(252, 83, 22, 11);
        ctx.fillStyle = CYAN;
        ctx.fillRect(254, 85, 18 * (this.battery / 100), 7);

        // Digital clock & date
        ctx.textAlign = "center";
        ctx.fillStyle = CYAN;
        ctx.font = "bold 34px Consolas, monospace";
        ctx.fillText(clockStr, this.CX, 134);
        ctx.fillStyle = BLUE;
        ctx.font = "bold 11px Consolas, monospace";
        ctx.fillText(dateStr, this.CX, 158);

        // HUD ticks around SOS button
        for (let i = 0; i < 24; i++) {
          const a = (i * 15 * Math.PI) / 180;
          const inner = i % 6 === 0 ? 74 : 79;
          ctx.strokeStyle = i % 6 === 0 ? PURPLE : DARK_GREY;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(this.CX + inner * Math.cos(a), this.SOS_Y + inner * Math.sin(a));
          ctx.lineTo(this.CX + 85 * Math.cos(a), this.SOS_Y + 85 * Math.sin(a));
          ctx.stroke();
        }

        // Breathing cyan ring
        ctx.strokeStyle = `rgba(0, 240, 255, ${0.3 + 0.55 * pulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.CX, this.SOS_Y, 68, 0, Math.PI * 2);
        ctx.stroke();

        // Hold progress arc
        let holdProgress = 0;
        if (this.holding) {
          holdProgress = Math.min(1, (nowMs - this.holdStartMs) / (this.holdSeconds * 1000));
          ctx.strokeStyle = CYAN;
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.arc(this.CX, this.SOS_Y, 68, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * holdProgress);
          ctx.stroke();
        }

        // Red SOS button core
        ctx.save();
        ctx.shadowColor = RED;
        ctx.shadowBlur = this.holding ? 26 : 12;
        ctx.fillStyle = this.holding ? RED : "#3b0012";
        ctx.strokeStyle = RED;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.CX, this.SOS_Y, this.SOS_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = WHITE;
        ctx.font = "bold 32px Consolas, monospace";
        ctx.fillText("SOS", this.CX, this.SOS_Y - 2);
        ctx.fillStyle = "#ff9fb0";
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillText(`HOLD ${this.holdSeconds} SEC`, this.CX, this.SOS_Y + 24);

        // Hint + first ICE contact
        ctx.fillStyle = CYAN;
        ctx.font = "bold 11px Consolas, monospace";
        ctx.fillText(
          this.holding ? `HOLDING... ${Math.round(holdProgress * 100)}%` : "HOLD TO ACTIVATE SOS",
          this.CX,
          388
        );
        const first = this.contacts[0] || { name: "Contact One", phone: "+910000000001" };
        ctx.fillStyle = WHITE;
        ctx.font = "bold 12px Segoe UI, sans-serif";
        ctx.fillText(`ICE  >  ${first.name}`, this.CX, 414);
        ctx.fillStyle = GREY;
        ctx.font = "11px Consolas, monospace";
        ctx.fillText(first.phone, this.CX, 432);
        ctx.fillStyle = CYAN;
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillText("● SYSTEM READY", this.CX, 456);
      } else if (this.state === "TRIGGERED" || this.state === "COUNTDOWN") {
        ctx.textAlign = "center";
        ctx.fillStyle = RED;
        ctx.font = "bold 20px Consolas, monospace";
        ctx.fillText("SOS TRIGGERED", this.CX, 102);
        ctx.fillStyle = GREY;
        ctx.font = "11px Consolas, monospace";
        ctx.fillText(
          this.state === "TRIGGERED" ? "Preparing countdown..." : `Cancel within ${this.countdownSeconds} seconds`,
          this.CX,
          124
        );

        const rem = this.state === "COUNTDOWN" ? Math.max(0, (this.phaseEndMs - nowMs) / 1000) : this.countdownSeconds;
        const frac = rem / this.countdownSeconds;

        // Ring track
        ctx.strokeStyle = "#3a0a16";
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(this.CX, 224, 66, 0, Math.PI * 2);
        ctx.stroke();

        // Shrinking red arc
        ctx.strokeStyle = RED;
        ctx.lineWidth = 10;
        ctx.beginPath();
        ctx.arc(this.CX, 224, 66, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();

        ctx.fillStyle = WHITE;
        ctx.font = "bold 54px Consolas, monospace";
        ctx.fillText(String(Math.max(1, Math.ceil(rem))), this.CX, 232);
        ctx.fillStyle = GREY;
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillText("SECONDS", this.CX, 260);

        ctx.fillStyle = GREY;
        ctx.font = "11px Consolas, monospace";
        ctx.fillText(`Alert will go to ${this.contacts.length} contacts`, this.CX, 326);

        this.drawNeonButton(ctx, this.cancelRect, "CANCEL", CYAN, BG, CYAN);
        ctx.fillStyle = GREY;
        ctx.font = "10px Consolas, monospace";
        ctx.fillText("Accidental? Tap CANCEL (or Esc)", this.CX, 434);
      } else if (this.state === "CANCELLED") {
        ctx.textAlign = "center";
        ctx.strokeStyle = PURPLE;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(this.CX, 210, 50, 0, Math.PI * 2);
        ctx.stroke();

        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(this.CX - 20, 190); ctx.lineTo(this.CX + 20, 230);
        ctx.moveTo(this.CX + 20, 190); ctx.lineTo(this.CX - 20, 230);
        ctx.stroke();

        ctx.fillStyle = PURPLE;
        ctx.font = "bold 20px Consolas, monospace";
        ctx.fillText("SOS CANCELLED", this.CX, 304);
        ctx.fillStyle = WHITE;
        ctx.font = "13px Segoe UI, sans-serif";
        ctx.fillText("No alert was prepared", this.CX, 332);
        ctx.fillStyle = GREY;
        ctx.font = "11px Consolas, monospace";
        ctx.fillText("Returning to watch face...", this.CX, 356);
      } else if (this.state === "ACTIVE") {
        // Pulsing red banner
        ctx.save();
        ctx.fillStyle = `rgba(255, 42, 77, ${0.72 + 0.28 * pulse})`;
        this.roundRect(ctx, 74, 82, 212, 54, 16);
        ctx.fill();
        ctx.restore();

        ctx.textAlign = "center";
        ctx.fillStyle = WHITE;
        ctx.font = "bold 26px Consolas, monospace";
        ctx.fillText("SOS ACTIVE", this.CX, 117);

        ctx.fillStyle = RED;
        ctx.font = "bold 12px Consolas, monospace";
        ctx.fillText("EMERGENCY MODE ON", this.CX, 158);
        ctx.fillStyle = WHITE;
        ctx.font = "11px Consolas, monospace";
        ctx.fillText(`Activated at ${this.activationTime}`, this.CX, 178);

        const sec = Math.floor((nowMs - this.activeSinceMs) / 1000);
        const mm = String(Math.floor(sec / 60)).padStart(2, "0");
        const ss = String(sec % 60).padStart(2, "0");
        ctx.fillStyle = GREY;
        ctx.fillText(`Active for ${mm}:${ss}`, this.CX, 196);

        ctx.strokeStyle = "#163452";
        ctx.beginPath();
        ctx.moveTo(86, 210); ctx.lineTo(274, 210);
        ctx.stroke();

        ctx.fillStyle = CYAN;
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillText("LOCATION  [SIMULATED]", this.CX, 228);
        ctx.fillStyle = WHITE;
        ctx.font = "12px Consolas, monospace";
        ctx.fillText(this.latText, this.CX, 248);
        ctx.fillText(this.lonText, this.CX, 266);

        ctx.fillStyle = CYAN;
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillText("ALERTS  [DEMO MODE]", this.CX, 294);
        ctx.fillStyle = WHITE;
        ctx.font = "12px Segoe UI, sans-serif";
        this.contacts.slice(0, 3).forEach((c, i) => {
          ctx.fillText(`» ${c.name}`, this.CX, 316 + i * 18);
        });

        ctx.fillStyle = PURPLE;
        ctx.font = "bold 10px Consolas, monospace";
        ctx.fillText("Emergency notifications generated", this.CX, 386);

        this.drawNeonButton(ctx, this.resetRect, "RESET", "#140a26", PURPLE, PURPLE);
      }
    }

    startLoop() {
      const step = (nowMs) => {
        this.tick += 1;
        if (this.state === "NORMAL" && this.holding) {
          if (nowMs - this.holdStartMs >= this.holdSeconds * 1000) {
            this.holding = false;
            this.triggerSos();
          }
        } else if (this.state === "TRIGGERED") {
          if (nowMs >= this.phaseEndMs) this.startCountdown();
        } else if (this.state === "COUNTDOWN") {
          if (nowMs >= this.phaseEndMs) this.activateSos();
        } else if (this.state === "CANCELLED") {
          if (nowMs >= this.phaseEndMs) this.returnToNormal();
        }

        this.renderWatch(nowMs);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  window.SosController = SosController;
})();
