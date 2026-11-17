/* =========================================================================
   Self-Transforming Modular Smartwatch Studio
   Features:
     - Modular watch preview
     - Detachable screen module
     - Circular magnetic wristband & cradle
     - Exploded assembly view (6 modular layers)
     - Smooth animated component movement & reassembly animation
     - Start, Pause, Next, Previous, and Reset controls + manual explode scrub
   ========================================================================= */

(function () {
  "use strict";

  // Target animated parameters per stage (0..4)
  // lift: detachable screen separation (0..1)
  // explode: full 6-layer exploded assembly (0..1)
  // tilt: screen module tilt when detached (0..1)
  // lockGlow: green magnetic lock pulse (0..1)
  const STAGE_POSES = [
    { lift: 0.0, explode: 0.0, tilt: 0.0, lockGlow: 1.0 },  // 0: Assembled Wearable
    { lift: 0.42, explode: 0.08, tilt: 0.15, lockGlow: 0.0 }, // 1: Magnetic Unlock & Lift
    { lift: 1.0, explode: 0.22, tilt: 0.85, lockGlow: 0.0 },  // 2: Detachable Screen Module
    { lift: 1.0, explode: 1.0, tilt: 0.25, lockGlow: 0.0 },   // 3: Exploded Assembly View
    { lift: 0.0, explode: 0.0, tilt: 0.0, lockGlow: 1.0 },    // 4: Auto-Reassembly & Lock
  ];

  class TransformController {
    constructor(onStageChange) {
      this.onStageChange = onStageChange || (() => {});
      this.canvas = document.getElementById("tf-canvas");
      this.ctx = this.canvas ? this.canvas.getContext("2d") : null;

      this.components = [];
      this.stages = [];
      this.stageIndex = 0;
      this.selectedModId = null;

      // Smooth animated pose state
      this.cur = { lift: 0, explode: 0, tilt: 0, lockGlow: 1 };
      this.target = { ...STAGE_POSES[0] };

      // Playback state
      this.playing = false;
      this.paused = false;
      this.stageHoldTimer = 0;
      this.reassembleFlash = 0;

      // Orbit drag
      this.yaw = -0.32;
      this.pitch = 0.28;
      this.dragging = false;
      this.lastPtr = { x: 0, y: 0 };

      this.t = 0;
      this.lastFrame = performance.now();
      this.active = false;
      this.rafId = null;

      this.bindUI();
      this.loadMetadata();
    }

    async loadMetadata() {
      try {
        const res = await fetch("/api/v1/transform/modules");
        const json = await res.json();
        if (!json.ok) return;
        this.components = json.data.components || [];
        this.stages = json.data.stages || [];
        this.renderModuleList();
        this.updateStageUI();
      } catch (err) {
        console.error("[Transform] Metadata error:", err);
      }
    }

    renderModuleList() {
      const list = document.getElementById("tf-module-list");
      if (!list) return;
      list.innerHTML = this.components.map((m) => `
        <div class="module-item ${this.selectedModId === m.id ? "selected" : ""}" data-mod-id="${m.id}">
          <div class="mod-head">
            <span class="mod-code">${m.code}</span>
            <span class="mod-mass">${m.mass_g} g</span>
          </div>
          <div class="mod-name">${m.name}</div>
          <div class="mod-role">${m.role}</div>
        </div>
      `).join("");

      list.querySelectorAll(".module-item").forEach((el) => {
        el.addEventListener("click", () => {
          const id = el.dataset.modId;
          this.selectedModId = this.selectedModId === id ? null : id;
          this.renderModuleList();
          if (this.selectedModId && this.cur.explode < 0.45 && this.stageIndex < 3) {
            this.goToStage(3, false);
          }
        });
      });
    }

    goToStage(index, fromAuto = false) {
      const clamped = Math.max(0, Math.min(STAGE_POSES.length - 1, index));
      const prev = this.stageIndex;
      this.stageIndex = clamped;
      this.target = { ...STAGE_POSES[clamped] };
      this.stageHoldTimer = 0;

      if (clamped === 4 && prev !== 4) {
        this.reassembleFlash = 1.0;
      }
      if (!fromAuto) {
        // Keep manual navigation crisp
        const slider = document.getElementById("tf-slider-explode");
        if (slider) slider.value = String(Math.round(this.target.explode * 100));
      }
      this.updateStageUI();
    }

    startPlayback() {
      this.playing = true;
      this.paused = false;
      this.stageHoldTimer = 0;
      if (this.stageIndex === 0 || this.stageIndex === 4) {
        this.goToStage(1, true);
      }
      this.syncPlaybackButtons();
    }

    togglePause() {
      if (!this.playing) {
        this.startPlayback();
        return;
      }
      this.paused = !this.paused;
      this.syncPlaybackButtons();
    }

    nextStage() {
      this.playing = false;
      this.paused = false;
      this.goToStage((this.stageIndex + 1) % STAGE_POSES.length, false);
      this.syncPlaybackButtons();
    }

    prevStage() {
      this.playing = false;
      this.paused = false;
      this.goToStage((this.stageIndex - 1 + STAGE_POSES.length) % STAGE_POSES.length, false);
      this.syncPlaybackButtons();
    }

    resetAll() {
      this.playing = false;
      this.paused = false;
      this.selectedModId = null;
      this.yaw = -0.32;
      this.pitch = 0.28;
      this.goToStage(0, false);
      this.renderModuleList();
      this.syncPlaybackButtons();
    }

    syncPlaybackButtons() {
      const startBtn = document.getElementById("tf-btn-start");
      const pauseBtn = document.getElementById("tf-btn-pause");
      if (startBtn) {
        startBtn.textContent = this.playing && !this.paused ? "▶ Playing..." : "▶ Start";
      }
      if (pauseBtn) {
        pauseBtn.textContent = this.paused ? "▶ Resume" : "⏸ Pause";
      }
    }

    updateStageUI() {
      const st = this.stages[this.stageIndex] || {
        title: "Assembled Wearable Mode",
        subtitle: "Modular smartwatch locked into circular wristband.",
        status: "MAGNETIC LOCK ENGAGED",
        detail: "All 6 hardware modules docked.",
      };
      const set = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
      };
      set("tf-stage-chip", `STAGE ${this.stageIndex + 1} / 5 · ${st.id ? st.id.toUpperCase() : "ASSEMBLED"}`);
      set("tf-hud-status", `${st.status} · DRAG TO ORBIT VIEW`);
      set("tf-stage-title", st.title);
      set("tf-stage-sub", st.subtitle);
      set("tf-stage-detail", st.detail);

      document.querySelectorAll("#tf-stepper .step-pill").forEach((pill) => {
        pill.classList.toggle("active", Number(pill.dataset.stage) === this.stageIndex);
      });

      const locked = this.stageIndex === 0 || this.stageIndex === 4;
      const banner = document.getElementById("tf-lock-banner");
      const lockText = document.getElementById("tf-lock-text");
      if (banner) banner.classList.toggle("unlocked", !locked);
      if (lockText) {
        lockText.textContent = locked
          ? "CIRCULAR WRISTBAND DOCK: MAGNETIC LOCK ENGAGED"
          : this.stageIndex === 2
          ? "SCREEN MODULE DETACHED · STANDALONE ACTIVE"
          : "EXPLODED MODULAR INSPECTION · LATCH RELEASED";
      }

      this.onStageChange({
        stageIndex: this.stageIndex,
        stageLabel: st.title,
        locked,
      });
    }

    setActive(flag) {
      this.active = flag;
      if (flag) {
        this.resizeCanvas();
        this.lastFrame = performance.now();
        if (!this.rafId) this.loop(performance.now());
      }
    }

    resizeCanvas() {
      if (!this.canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(480, Math.floor(this.canvas.clientWidth * dpr));
      const h = Math.max(320, Math.floor(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    loop(now) {
      if (!this.active) {
        this.rafId = null;
        return;
      }
      this.rafId = requestAnimationFrame((ts) => this.loop(ts));
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.lastFrame = now;
      this.t += dt;

      // Smooth damped interpolation
      const speed = 4.2;
      const k = 1 - Math.exp(-speed * dt);
      this.cur.lift += (this.target.lift - this.cur.lift) * k;
      this.cur.explode += (this.target.explode - this.cur.explode) * k;
      this.cur.tilt += (this.target.tilt - this.cur.tilt) * k;
      this.cur.lockGlow += (this.target.lockGlow - this.cur.lockGlow) * k;
      this.reassembleFlash = Math.max(0, this.reassembleFlash - dt * 0.9);

      if (!this.dragging && !this.paused) {
        // Gentle breathing sway
        this.yaw += Math.sin(this.t * 0.6) * 0.0008;
      }

      // Auto-advance sequence when playing
      if (this.playing && !this.paused) {
        this.stageHoldTimer += dt;
        const duration = this.stageIndex === 3 ? 3.2 : 2.3;
        if (this.stageHoldTimer >= duration) {
          this.stageHoldTimer = 0;
          if (this.stageIndex < 4) {
            this.goToStage(this.stageIndex + 1, true);
          } else {
            this.playing = false;
            this.syncPlaybackButtons();
          }
        }
      }

      const sepPct = Math.round(Math.max(this.cur.explode, this.cur.lift * 0.45) * 100);
      const readout = document.getElementById("tf-explode-readout");
      if (readout) readout.textContent = `SEPARATION: ${sepPct}%`;
      if (this.playing && !this.paused) {
        const slider = document.getElementById("tf-slider-explode");
        if (slider) slider.value = String(Math.round(this.cur.explode * 100));
      }

      this.render();
    }

    // ---- 3D-to-2D Isometric Perspective Projection ----
    project(x, y, z, cx, cy, scale) {
      const cosY = Math.cos(this.yaw), sinY = Math.sin(this.yaw);
      const cosP = Math.cos(this.pitch), sinP = Math.sin(this.pitch);

      // Rotate around Y (yaw)
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;
      // Rotate around X (pitch)
      const ry = y * cosP - rz * sinP;
      const rz2 = y * sinP + rz * cosP;

      const persp = 680 / (680 + rz2 * 80);
      return {
        x: cx + rx * scale * persp,
        y: cy - ry * scale * persp,
        s: persp,
        depth: rz2,
      };
    }

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

    drawSlab(ctx, cx, cy, rx, ry, thickness, fillTop, fillSide, strokeCol, glowCol, highlight) {
      ctx.save();
      if (glowCol) {
        ctx.shadowColor = glowCol;
        ctx.shadowBlur = highlight ? 28 : 14;
      }

      // Bottom/side extrusion
      ctx.fillStyle = fillSide;
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = highlight ? 2.4 : 1.4;
      this.roundRect(ctx, cx - rx, cy - ry + thickness, rx * 2, ry * 2, Math.min(rx, ry) * 0.42);
      ctx.fill();
      ctx.stroke();

      // Top face
      ctx.fillStyle = fillTop;
      this.roundRect(ctx, cx - rx, cy - ry, rx * 2, ry * 2, Math.min(rx, ry) * 0.42);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    drawCallout(ctx, anchorX, anchorY, side, code, label, accent, isSelected) {
      const dir = side === "right" ? 1 : -1;
      const elbowX = anchorX + dir * 72;
      const endX = anchorX + dir * 185;
      const alpha = isSelected ? 1.0 : 0.86;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = isSelected ? "#00ff88" : accent;
      ctx.lineWidth = isSelected ? 2 : 1.3;
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(elbowX, anchorY - 10);
      ctx.lineTo(endX, anchorY - 10);
      ctx.stroke();

      ctx.fillStyle = isSelected ? "#00ff88" : accent;
      ctx.beginPath();
      ctx.arc(anchorX, anchorY, isSelected ? 4.5 : 3.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.textAlign = side === "right" ? "left" : "right";
      ctx.font = "bold 10px Consolas, monospace";
      ctx.fillStyle = isSelected ? "#00ff88" : "#00f0ff";
      ctx.fillText(code, endX + dir * 6, anchorY - 13);

      ctx.font = "bold 11.5px Segoe UI, sans-serif";
      ctx.fillStyle = "#edf6ff";
      ctx.fillText(label, endX + dir * 6, anchorY + 1);
      ctx.restore();
    }

    render() {
      if (!this.ctx) return;
      this.resizeCanvas();
      const ctx = this.ctx;
      const W = this.canvas.width;
      const H = this.canvas.height;
      const dpr = W / Math.max(1, this.canvas.clientWidth);

      ctx.save();
      ctx.clearRect(0, 0, W, H);
      ctx.scale(dpr, dpr);
      const vw = W / dpr;
      const vh = H / dpr;
      const cx = vw * 0.5;
      const baseCy = vh * 0.62;
      const scale = Math.min(vw / 10.5, vh / 6.8);

      // Subtle holographic studio floor ellipse
      const floorGrad = ctx.createRadialGradient(cx, baseCy + 82, 12, cx, baseCy + 82, 230);
      floorGrad.addColorStop(0, "rgba(0, 240, 255, 0.22)");
      floorGrad.addColorStop(0.55, "rgba(47, 123, 255, 0.08)");
      floorGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = floorGrad;
      ctx.beginPath();
      ctx.ellipse(cx, baseCy + 82, 230, 58, 0, 0, Math.PI * 2);
      ctx.fill();

      // Rotating studio tech rings on floor
      ctx.save();
      ctx.strokeStyle = "rgba(0, 240, 255, 0.22)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.ellipse(cx, baseCy + 82, 185, 44, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      const lift = this.cur.lift;
      const exp = this.cur.explode;
      const tilt = this.cur.tilt;
      const floatBob = Math.sin(this.t * 2.2) * 3.5;

      // Vertical positions (in screen pixels relative to baseCy) of all 6 hardware modules
      const bandY = baseCy + 34 + exp * 46;
      const battY = baseCy + 8 + exp * 16 - lift * 6;
      const coreY = baseCy - 4 - lift * 20 - exp * 22;
      const lockY = baseCy - 14 - lift * 44 - exp * 58;
      const screenY = baseCy - 24 - lift * 96 - exp * 92 + floatBob * (lift > 0.1 ? 1 : 0.25);
      const lensY = screenY - 10 - exp * 42;

      const xShift = Math.sin(this.yaw) * 28;
      const showGuides = lift > 0.08 || exp > 0.08;

      // ---- Alignment laser guide rails between modules when separating ----
      if (showGuides) {
        ctx.save();
        ctx.strokeStyle = "rgba(0, 240, 255, 0.35)";
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 5]);
        for (const ox of [-52, 52]) {
          ctx.beginPath();
          ctx.moveTo(cx + ox, bandY - 12);
          ctx.lineTo(cx + ox + xShift * 0.45, lensY);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
      }

      // ================================================================
      // MODULE 06: CIRCULAR MAGNETIC WRISTBAND & INTEGRATED CRADLE DOCK
      // ================================================================
      const hlBand = this.selectedModId === "wristband";
      ctx.save();
      const bandRx = 148;
      const bandRy = 52;
      // Back half of circular wristband
      ctx.lineWidth = 22;
      ctx.strokeStyle = hlBand ? "#00ff88" : "#152344";
      ctx.beginPath();
      ctx.ellipse(cx, bandY + 12, bandRx, bandRy, 0, Math.PI, Math.PI * 2);
      ctx.stroke();

      // Inner metallic sheen on circular band
      ctx.lineWidth = 2;
      ctx.strokeStyle = hlBand ? "#00ff88" : "rgba(0, 240, 255, 0.5)";
      ctx.beginPath();
      ctx.ellipse(cx, bandY + 12, bandRx - 10, bandRy - 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, bandY + 12, bandRx + 11, bandRy + 5, 0, 0, Math.PI * 2);
      ctx.stroke();

      // Integrated top cradle dock on the circular wristband
      const cradleGrad = ctx.createLinearGradient(cx - 72, bandY - 46, cx + 72, bandY - 18);
      cradleGrad.addColorStop(0, "#1c2e54");
      cradleGrad.addColorStop(0.5, "#0d172e");
      cradleGrad.addColorStop(1, "#1c2e54");
      this.drawSlab(
        ctx,
        cx,
        bandY - 30,
        74,
        24,
        10,
        cradleGrad,
        "#0a1226",
        hlBand ? "#00ff88" : "rgba(0, 240, 255, 0.65)",
        hlBand ? "#00ff88" : "rgba(0, 240, 255, 0.3)",
        hlBand
      );

      // Visible gold magnetic pogo contact pads inside cradle dock
      for (let i = -2; i <= 2; i++) {
        ctx.fillStyle = "#ffd166";
        ctx.beginPath();
        ctx.arc(cx + i * 16, bandY - 30, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Front arc of circular wristband (creates true 3D wearable ring feel)
      const frontGrad = ctx.createLinearGradient(cx - bandRx, bandY, cx + bandRx, bandY + 60);
      frontGrad.addColorStop(0, "#121f3d");
      frontGrad.addColorStop(0.5, "#243b6b");
      frontGrad.addColorStop(1, "#0f1a33");
      ctx.lineWidth = 24;
      ctx.strokeStyle = frontGrad;
      ctx.beginPath();
      ctx.ellipse(cx, bandY + 12, bandRx, bandRy, 0, 0.08, Math.PI - 0.08);
      ctx.stroke();

      // Glowing cyan trim on front wristband rim
      ctx.lineWidth = 2;
      ctx.strokeStyle = hlBand ? "#00ff88" : "rgba(47, 123, 255, 0.75)";
      ctx.beginPath();
      ctx.ellipse(cx, bandY + 22, bandRx, bandRy, 0, 0.14, Math.PI - 0.14);
      ctx.stroke();
      ctx.restore();

      // ================================================================
      // MODULE 05: MODULAR SOLID-STATE BATTERY PACK (visible when exploded/lifted)
      // ================================================================
      if (exp > 0.04 || lift > 0.2) {
        const hlBatt = this.selectedModId === "battery";
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(exp * 2.2, (lift - 0.2) * 1.5));
        this.drawSlab(
          ctx,
          cx + xShift * 0.1,
          battY - 26,
          60,
          19,
          9,
          "rgba(255, 176, 32, 0.24)",
          "rgba(120, 74, 12, 0.72)",
          hlBatt ? "#00ff88" : "#ffb020",
          "#ffb020",
          hlBatt
        );
        ctx.fillStyle = "#ffe099";
        ctx.font = "bold 9px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("420 mAh SOLID-STATE CELL", cx + xShift * 0.1, battY - 23);
        ctx.restore();
      }

      // ================================================================
      // MODULE 04: CORE SoC, NFC & SOS SENSOR CHASSIS
      // ================================================================
      if (exp > 0.04 || lift > 0.12) {
        const hlCore = this.selectedModId === "core";
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(exp * 2.5, lift * 1.5));
        this.drawSlab(
          ctx,
          cx + xShift * 0.2,
          coreY - 26,
          68,
          22,
          8,
          "rgba(0, 255, 136, 0.18)",
          "rgba(8, 52, 36, 0.78)",
          hlCore ? "#00ff88" : "#00e68a",
          "#00ff88",
          hlCore
        );
        // Micro-SoC chip & NFC coil detail
        ctx.strokeStyle = "rgba(0, 240, 255, 0.8)";
        ctx.lineWidth = 1.4;
        ctx.strokeRect(cx + xShift * 0.2 - 16, coreY - 34, 32, 16);
        ctx.fillStyle = "#00f0ff";
        ctx.font = "bold 8px Consolas, monospace";
        ctx.textAlign = "center";
        ctx.fillText("DORA SoC", cx + xShift * 0.2, coreY - 23);
        ctx.restore();
      }

      // ================================================================
      // MODULE 03: MAGNETIC MICRO-LOCK & POGO RING
      // ================================================================
      if (exp > 0.03 || lift > 0.05) {
        const hlLock = this.selectedModId === "maglock";
        ctx.save();
        ctx.globalAlpha = Math.min(1, Math.max(exp * 3, lift * 2));
        ctx.strokeStyle = hlLock ? "#00ff88" : "#00f0ff";
        ctx.lineWidth = hlLock ? 3.5 : 2.5;
        ctx.shadowColor = "#00f0ff";
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(cx + xShift * 0.3, lockY - 24, 66, 20, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Magnetic lock pins pulsing cyan
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + this.t * 0.6;
          const px = cx + xShift * 0.3 + Math.cos(a) * 66;
          const py = lockY - 24 + Math.sin(a) * 20;
          ctx.fillStyle = i % 2 === 0 ? "#00f0ff" : "#00ff88";
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // ================================================================
      // MODULE 02: DETACHABLE AMOLED SCREEN MODULE
      // ================================================================
      const hlScreen = this.selectedModId === "screen";
      const scrCx = cx + xShift * 0.42;
      const scrW = 84;
      const scrH = 38 + tilt * 34; // Opens vertically toward viewer when detached!
      const scrTopGrad = ctx.createLinearGradient(scrCx - scrW, screenY - scrH, scrCx + scrW, screenY + scrH);
      scrTopGrad.addColorStop(0, "#10284c");
      scrTopGrad.addColorStop(0.5, "#050d20");
      scrTopGrad.addColorStop(1, "#0d2244");

      this.drawSlab(
        ctx,
        scrCx,
        screenY - 26,
        scrW,
        scrH,
        11,
        scrTopGrad,
        "#121e38",
        hlScreen ? "#00ff88" : "#00f0ff",
        hlScreen ? "#00ff88" : "rgba(0, 240, 255, 0.55)",
        hlScreen
      );

      // Active OLED watch UI rendered directly on the detachable screen module
      ctx.save();
      this.roundRect(ctx, scrCx - scrW + 9, screenY - 26 - scrH + 7, (scrW - 9) * 2, (scrH - 7) * 2, 16);
      ctx.fillStyle = "#030a18";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 240, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const nowClock = new Date().toTimeString().slice(0, 5);
      ctx.textAlign = "center";
      ctx.fillStyle = "#00f0ff";
      ctx.font = `bold ${Math.round(16 + tilt * 10)}px Consolas, monospace`;
      ctx.fillText(nowClock, scrCx, screenY - 24);

      ctx.fillStyle = lift > 0.5 ? "#00ff88" : "#8ea2c2";
      ctx.font = "bold 9.5px Consolas, monospace";
      ctx.fillText(
        lift > 0.5 ? "DETACHED MODULE // LIVE" : "SMARTWATCH X // LOCKED",
        scrCx,
        screenY - 8 + tilt * 10
      );
      ctx.restore();

      // ================================================================
      // MODULE 01: SAPPHIRE HOLOGRAPHIC CURVED LENS
      // ================================================================
      const hlLens = this.selectedModId === "lens";
      ctx.save();
      const lensAlpha = exp > 0.04 ? 0.92 : 0.45;
      ctx.globalAlpha = lensAlpha;
      const lensGrad = ctx.createLinearGradient(scrCx - 80, lensY - 40, scrCx + 80, lensY + 10);
      lensGrad.addColorStop(0, "rgba(0, 240, 255, 0.32)");
      lensGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.14)");
      lensGrad.addColorStop(1, "rgba(47, 123, 255, 0.25)");
      this.drawSlab(
        ctx,
        scrCx,
        lensY - 26,
        scrW - 2,
        scrH - 4,
        4,
        lensGrad,
        "rgba(0, 240, 255, 0.14)",
        hlLens ? "#00ff88" : "rgba(180, 248, 255, 0.75)",
        hlLens ? "#00ff88" : "rgba(0, 240, 255, 0.35)",
        hlLens
      );
      ctx.restore();

      // ================================================================
      // MAGNETIC LOCK GREEN CONFIRMATION PULSE ON REASSEMBLY
      // ================================================================
      if (this.reassembleFlash > 0.02) {
        ctx.save();
        const rPulse = 90 + (1 - this.reassembleFlash) * 115;
        ctx.strokeStyle = `rgba(0, 255, 136, ${this.reassembleFlash})`;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.ellipse(cx, bandY - 28, rPulse, rPulse * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ================================================================
      // INTERACTIVE ENGINEERING CALLOUT LABELS
      // ================================================================
      if (exp > 0.35 || this.selectedModId) {
        this.drawCallout(ctx, scrCx + scrW - 6, lensY - 28, "right", "MOD-01", "Sapphire Lens", "#00f0ff", hlLens);
        this.drawCallout(ctx, scrCx - scrW + 6, screenY - 26, "left", "MOD-02", "Detachable Screen", "#00f0ff", hlScreen);
        this.drawCallout(ctx, cx + xShift * 0.3 + 64, lockY - 24, "right", "MOD-03", "Magnetic Micro-Lock", "#2f7bff", this.selectedModId === "maglock");
        this.drawCallout(ctx, cx + xShift * 0.2 - 64, coreY - 26, "left", "MOD-04", "Core SoC & Sensors", "#00ff88", this.selectedModId === "core");
        this.drawCallout(ctx, cx + xShift * 0.1 + 58, battY - 26, "right", "MOD-05", "Modular Battery", "#ffb020", this.selectedModId === "battery");
        this.drawCallout(ctx, cx - bandRx + 16, bandY + 14, "left", "MOD-06", "Circular Wristband", "#2f7bff", hlBand);
      } else if (lift > 0.35) {
        this.drawCallout(ctx, scrCx + scrW - 6, screenY - 26, "right", "DETACHABLE", "AMOLED Screen Module", "#00f0ff", hlScreen);
        this.drawCallout(ctx, cx - bandRx + 18, bandY + 6, "left", "CIRCULAR DOCK", "Magnetic Wristband", "#2f7bff", hlBand);
      }

      ctx.restore();
    }

    bindUI() {
      document.getElementById("tf-btn-start")?.addEventListener("click", () => this.startPlayback());
      document.getElementById("tf-btn-pause")?.addEventListener("click", () => this.togglePause());
      document.getElementById("tf-btn-prev")?.addEventListener("click", () => this.prevStage());
      document.getElementById("tf-btn-next")?.addEventListener("click", () => this.nextStage());
      document.getElementById("tf-btn-reset")?.addEventListener("click", () => this.resetAll());

      document.querySelectorAll("#tf-stepper .step-pill").forEach((pill) => {
        pill.addEventListener("click", () => {
          this.playing = false;
          this.paused = false;
          this.goToStage(Number(pill.dataset.stage), false);
          this.syncPlaybackButtons();
        });
      });

      const slider = document.getElementById("tf-slider-explode");
      if (slider) {
        slider.addEventListener("input", () => {
          this.playing = false;
          this.paused = false;
          this.syncPlaybackButtons();
          const v = Number(slider.value) / 100;
          this.target = {
            lift: Math.min(1, v * 1.45),
            explode: v,
            tilt: v > 0.15 && v < 0.75 ? 0.65 : 0.25 * v,
            lockGlow: v < 0.05 ? 1 : 0,
          };
          const inferredStage = v < 0.08 ? 0 : v < 0.3 ? 1 : v < 0.65 ? 2 : 3;
          if (inferredStage !== this.stageIndex) {
            this.stageIndex = inferredStage;
            this.updateStageUI();
          }
        });
      }

      if (this.canvas) {
        this.canvas.addEventListener("pointerdown", (e) => {
          this.dragging = true;
          this.lastPtr = { x: e.clientX, y: e.clientY };
          this.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener("pointermove", (e) => {
          if (!this.dragging) return;
          const dx = e.clientX - this.lastPtr.x;
          const dy = e.clientY - this.lastPtr.y;
          this.lastPtr = { x: e.clientX, y: e.clientY };
          this.yaw = Math.max(-1.1, Math.min(1.1, this.yaw + dx * 0.008));
          this.pitch = Math.max(-0.4, Math.min(0.85, this.pitch + dy * 0.006));
        });
        const stop = () => { this.dragging = false; };
        this.canvas.addEventListener("pointerup", stop);
        this.canvas.addEventListener("pointercancel", stop);
      }
    }
  }

  window.TransformController = TransformController;
})();
