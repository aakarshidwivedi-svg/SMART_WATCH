/* =========================================================================
   Hologram 3D Projection Module (WebGL + exact holowatch.watch_model meshes)
   Consumes /api/v1/hologram/geometry, /api/v1/hologram/telemetry,
   and /api/v1/hologram/screen.png directly from the existing holowatch code.
   ========================================================================= */

(function () {
  "use strict";

  const INSPECT_VIEWS = [
    { h: 0, p: 0, label: "FRONT VIEW // WATCH DISPLAY" },
    { h: 90, p: 0, label: "LEFT SIDE VIEW // MICROPHONE ARRAY" },
    { h: 180, p: 0, label: "BACK VIEW // HEART-RATE SENSOR" },
    { h: 270, p: 0, label: "RIGHT SIDE VIEW // CROWN & BUTTON" },
    { h: 0, p: 58, label: "TOP EDGE // STRAP LUGS" },
    { h: 0, p: -58, label: "BOTTOM EDGE // BUCKLE" },
    { h: 20, p: 14, label: "INSPECTION COMPLETE" },
  ];

  // Minimal 4x4 column-major matrix math for WebGL
  function mat4Identity() {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }
  function mat4Mul(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }
  function mat4Perspective(fovRad, aspect, near, far) {
    const f = 1.0 / Math.tan(fovRad / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  }
  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1,
    ]);
  }
  function mat4Translate(x, y, z) {
    const m = mat4Identity();
    m[12] = x; m[13] = y; m[14] = z;
    return m;
  }
  function mat4Scale(s) {
    const m = mat4Identity();
    m[0] = s; m[5] = s; m[10] = s;
    return m;
  }
  function mat4RotateX(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
  }
  function mat4RotateY(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }
  function mat4RotateZ(rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  // Convert Panda3D (X right, Y forward/back, Z up) -> WebGL (X right, Y up, Z toward camera)
  // In watch_model.py: glass is at Y = -0.52 (front), Z is vertical (+up).
  // So glX = x, glY = z, glZ = -y puts the watch screen facing +Z (toward camera)!
  function pandaVertsToGL(flat) {
    const out = new Float32Array(flat.length);
    for (let i = 0; i < flat.length; i += 3) {
      out[i] = flat[i];
      out[i + 1] = flat[i + 2];
      out[i + 2] = -flat[i + 1];
    }
    return out;
  }

  class HologramController {
    constructor() {
      this.canvas = document.getElementById("holo-webgl-canvas");
      this.loadingEl = document.getElementById("holo-loading");
      this.captionEl = document.getElementById("holo-caption");
      this.statusChipEl = document.getElementById("holo-status-chip");
      this.meshInfoEl = document.getElementById("holo-mesh-info");
      this.screenPreviewImg = document.getElementById("holo-screen-preview");
      this.ecgCanvas = document.getElementById("holo-ecg-canvas");

      this.state = {
        projection: true,
        wireframe: false,
        particles: true,
        scanning: true,
        xray: false,
        explode: false,
        inspect: false,
        paused: false,
        brightness: 1.05,
        speed: 22.0,
        size: 1.0,
      };

      this.active = false;
      this.ready = false;
      this.gl = null;
      this.geom = null;
      this.glParts = [];
      this.platformRings = [];
      this.particlesBuf = null;
      this.particleCount = 0;
      this.scanRingBuf = null;
      this.scanRingCount = 0;
      this.coneBuf = null;
      this.coneCount = 0;
      this.screenVbo = null;
      this.screenTex = null;

      this.heading = 22.0; // degrees
      this.pitch = 12.0;
      this.velH = 0;
      this.velP = 0;
      this.camDist = 14.5;
      this.camDistTarget = 14.5;
      this.dragging = false;
      this.lastMouse = { x: 0, y: 0 };

      this.projAmt = 1.0;
      this.xrayAmt = 0.0;
      this.explodeAmt = 0.0;
      this.inspectIdx = 0;
      this.inspectTimer = 0;
      this.t = 0;
      this.lastFrame = performance.now();
      this.screenPage = 0;
      this.screenRefreshTimer = 0;
      this.rafId = null;

      this.bindUI();
    }

    async init() {
      if (this.ready) return;
      try {
        const res = await fetch("/api/v1/hologram/geometry");
        const json = await res.json();
        if (!json.ok) throw new Error("Failed to load hologram geometry");
        this.geom = json.data;
        if (this.meshInfoEl) {
          this.meshInfoEl.textContent = `${this.geom.parts.length} PROCEDURAL 3D MESHES`;
        }
        this.initWebGL();
        this.ready = true;
        if (this.loadingEl) this.loadingEl.classList.add("hidden");
        this.refreshScreenTexture();
      } catch (err) {
        console.error("[Hologram] Init error:", err);
        if (this.loadingEl) this.loadingEl.textContent = "Failed to load 3D hologram geometry.";
      }
    }

    initWebGL() {
      const gl = this.canvas.getContext("webgl", { alpha: true, antialias: true });
      if (!gl) {
        console.warn("[Hologram] WebGL unavailable, using 2D fallback.");
        return;
      }
      this.gl = gl;

      const vsColor = `
        attribute vec3 aPos;
        uniform mat4 uMVP;
        uniform float uPointSize;
        void main() {
          gl_Position = uMVP * vec4(aPos, 1.0);
          gl_PointSize = uPointSize;
        }
      `;
      const fsColor = `
        precision mediump float;
        uniform vec4 uColor;
        uniform int uIsPoint;
        void main() {
          if (uIsPoint == 1) {
            float d = length(gl_PointCoord - vec2(0.5));
            if (d > 0.5) discard;
            float glow = smoothstep(0.5, 0.05, d);
            gl_FragColor = vec4(uColor.rgb, uColor.a * glow);
          } else {
            gl_FragColor = uColor;
          }
        }
      `;

      const vsTex = `
        attribute vec3 aPos;
        attribute vec2 aUV;
        uniform mat4 uMVP;
        varying vec2 vUV;
        void main() {
          vUV = aUV;
          gl_Position = uMVP * vec4(aPos, 1.0);
        }
      `;
      const fsTex = `
        precision mediump float;
        varying vec2 vUV;
        uniform sampler2D uTex;
        uniform float uAlpha;
        void main() {
          vec4 c = texture2D(uTex, vUV);
          gl_FragColor = vec4(c.rgb, c.a * uAlpha);
        }
      `;

      this.progColor = this.createProgram(gl, vsColor, fsColor);
      this.progTex = this.createProgram(gl, vsTex, fsTex);

      // Upload all 16 watch parts from holowatch.watch_model
      this.glParts = this.geom.parts.map((part) => {
        const verts = pandaVertsToGL(part.verts);
        const vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

        const triBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(part.tris), gl.STATIC_DRAW);

        const lineBuf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(part.lines), gl.STATIC_DRAW);

        const ex = part.explode;
        return {
          name: part.name,
          kind: part.kind,
          color: part.color,
          explodeGL: [ex[0], ex[2], -ex[1]],
          faceAlpha: part.face_alpha,
          edgeAlpha: part.edge_alpha,
          vbo,
          triBuf,
          triCount: part.tris.length,
          lineBuf,
          lineCount: part.lines.length,
        };
      });

      // Screen quad positioned at SCREEN_Y -> glZ = -SCREEN_Y
      const hw = this.geom.screen.half_w;
      const hh = this.geom.screen.half_h;
      const sz = -this.geom.screen.y + 0.02;
      const quad = new Float32Array([
        -hw, -hh, sz, 0, 1,
         hw, -hh, sz, 1, 1,
         hw,  hh, sz, 1, 0,
        -hw, -hh, sz, 0, 1,
         hw,  hh, sz, 1, 0,
        -hw,  hh, sz, 0, 0,
      ]);
      this.screenVbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.screenVbo);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

      this.screenTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.screenTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 220, 255, 220]));

      // Build holographic projection platform rings & cone
      this.buildPlatformGeometry(gl);
      this.buildParticlesGeometry(gl);
      this.buildScannerGeometry(gl);
    }

    createProgram(gl, vsSrc, fsSrc) {
      const compile = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(prog);
      return prog;
    }

    buildPlatformGeometry(gl) {
      const makeRing = (radius, segs, dash) => {
        const pts = [];
        for (let i = 0; i < segs; i++) {
          if (dash && Math.floor(i / dash) % 2 === 1) continue;
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = ((i + 1) / segs) * Math.PI * 2;
          pts.push(radius * Math.cos(a0), 0, radius * Math.sin(a0));
          pts.push(radius * Math.cos(a1), 0, radius * Math.sin(a1));
        }
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
        return { buf, count: pts.length / 3 };
      };

      this.platformRings = [
        { ...makeRing(5.1, 120, 0), speed: 14, color: [0.0, 0.92, 1.0, 0.55] },
        { ...makeRing(4.2, 96, 3), speed: -24, color: [0.0, 0.85, 1.0, 0.72] },
        { ...makeRing(3.3, 96, 8), speed: 32, color: [0.45, 0.92, 1.0, 0.65] },
        { ...makeRing(2.1, 64, 2), speed: -46, color: [0.18, 0.58, 1.0, 0.75] },
        { ...makeRing(1.4, 48, 0), speed: 0, color: [0.0, 0.95, 1.0, 0.85] },
      ];

      // Vertical projection beams & cone lines
      const conePts = [];
      const segs = 32;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        conePts.push(3.5 * Math.cos(a), 0, 3.5 * Math.sin(a));
        conePts.push(2.1 * Math.cos(a), 6.2, 2.1 * Math.sin(a));
      }
      this.coneBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.coneBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(conePts), gl.STATIC_DRAW);
      this.coneCount = conePts.length / 3;
    }

    buildParticlesGeometry(gl) {
      const pts = [];
      const count = 420;
      for (let i = 0; i < count; i++) {
        const angle = (i * 2.39996) % (Math.PI * 2);
        const r = 1.6 + ((i * 37) % 100) / 100 * 3.6;
        const y = -4.2 + ((i * 53) % 100) / 100 * 8.4;
        pts.push(r * Math.cos(angle), y, r * Math.sin(angle));
      }
      this.particlesBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particlesBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
      this.particleCount = count;
    }

    buildScannerGeometry(gl) {
      const pts = [];
      const segs = 64;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        pts.push(2.65 * Math.cos(a0), 0, 2.65 * Math.sin(a0));
        pts.push(2.65 * Math.cos(a1), 0, 2.65 * Math.sin(a1));
      }
      this.scanRingBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.scanRingBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
      this.scanRingCount = pts.length / 3;
    }

    refreshScreenTexture() {
      const url = `/api/v1/hologram/screen.png?page=${this.screenPage}&ts=${Date.now()}`;
      if (this.screenPreviewImg) {
        this.screenPreviewImg.src = url;
      }
      const img = new Image();
      img.onload = () => {
        if (!this.gl || !this.screenTex) return;
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.screenTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      };
      img.src = url;
    }

    async setPage(pageIdx) {
      this.screenPage = pageIdx;
      document.querySelectorAll("#holo-page-buttons .page-chip").forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.page) === pageIdx);
      });
      await fetch(`/api/v1/hologram/screen/page/${pageIdx}`, { method: "POST" }).catch(() => {});
      this.refreshScreenTexture();
    }

    resizeCanvas() {
      if (!this.canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(300, Math.floor(this.canvas.clientWidth * dpr));
      const h = Math.max(240, Math.floor(this.canvas.clientHeight * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    setActive(flag) {
      this.active = flag;
      if (flag) {
        this.init().then(() => {
          this.resizeCanvas();
          this.lastFrame = performance.now();
          if (!this.rafId) this.loop(performance.now());
        });
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

      this.updatePhysics(dt);
      this.renderFrame();

      this.screenRefreshTimer += dt;
      if (this.screenRefreshTimer > 1.2) {
        this.screenRefreshTimer = 0;
        this.refreshScreenTexture();
      }
    }

    updatePhysics(dt) {
      const approach = (cur, target, step) => cur + Math.max(-step, Math.min(step, target - cur));
      this.projAmt = approach(this.projAmt, this.state.projection ? 1.0 : 0.0, dt * 2.2);
      this.xrayAmt = approach(this.xrayAmt, this.state.xray ? 1.0 : 0.0, dt * 2.8);
      this.explodeAmt = approach(this.explodeAmt, this.state.explode ? 1.0 : 0.0, dt * 2.4);
      this.camDist += (this.camDistTarget - this.camDist) * Math.min(1, dt * 8);

      if (this.state.inspect) {
        const view = INSPECT_VIEWS[this.inspectIdx];
        this.inspectTimer += dt;
        const dh = (((view.h - this.heading) + 540) % 360) - 180;
        this.heading += dh * Math.min(1, dt * 3.5);
        this.pitch += (view.p - this.pitch) * Math.min(1, dt * 3.5);
        if (this.captionEl) this.captionEl.textContent = view.label;
        if (this.inspectTimer > 2.6) {
          this.inspectTimer = 0;
          this.inspectIdx += 1;
          if (this.inspectIdx >= INSPECT_VIEWS.length) {
            this.state.inspect = false;
            this.inspectIdx = 0;
            this.syncToggleUI();
            if (this.captionEl) this.captionEl.textContent = "DRAG TO ROTATE 360° · SCROLL TO ZOOM";
          }
        }
      } else if (!this.dragging) {
        if (!this.state.paused) {
          this.heading = (this.heading + this.state.speed * dt) % 360;
        }
        this.heading = (this.heading + this.velH * dt) % 360;
        this.pitch = Math.max(-75, Math.min(75, this.pitch + this.velP * dt));
        const damp = Math.exp(-4.5 * dt);
        this.velH *= damp;
        this.velP *= damp;
      }
    }

    renderFrame() {
      if (!this.gl || !this.ready) return;
      this.resizeCanvas();
      const gl = this.gl;

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0.008, 0.022, 0.055, 0.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive holographic glow!
      gl.disable(gl.DEPTH_TEST);

      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      const proj = mat4Perspective((46 * Math.PI) / 180, aspect, 0.5, 150.0);
      const view = mat4LookAt([0, 1.3, this.camDist], [0, -0.35, 0], [0, 1, 0]);
      const vp = mat4Mul(proj, view);

      const bright = this.state.brightness * this.projAmt;
      if (bright <= 0.01) return;

      // 1. Draw holographic projection platform below the watch
      const platY = this.geom.platform_z || -4.4;
      const platBase = mat4Mul(vp, mat4Translate(0, platY, 0));
      gl.useProgram(this.progColor);
      const aPos = gl.getAttribLocation(this.progColor, "aPos");
      const uMVP = gl.getUniformLocation(this.progColor, "uMVP");
      const uColor = gl.getUniformLocation(this.progColor, "uColor");
      const uPointSize = gl.getUniformLocation(this.progColor, "uPointSize");
      const uIsPoint = gl.getUniformLocation(this.progColor, "uIsPoint");

      gl.uniform1i(uIsPoint, 0);
      gl.uniform1f(uPointSize, 1.0);
      gl.enableVertexAttribArray(aPos);

      for (const ring of this.platformRings) {
        const mvp = mat4Mul(platBase, mat4RotateY((this.t * ring.speed * Math.PI) / 180));
        gl.uniformMatrix4fv(uMVP, false, mvp);
        gl.uniform4f(uColor, ring.color[0], ring.color[1], ring.color[2], ring.color[3] * bright);
        gl.bindBuffer(gl.ARRAY_BUFFER, ring.buf);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, ring.count);
      }

      // Projection cone beams
      const conePulse = 0.14 + 0.06 * Math.sin(this.t * 4.0);
      gl.uniformMatrix4fv(uMVP, false, mat4Mul(platBase, mat4RotateY(this.t * 0.25)));
      gl.uniform4f(uColor, 0.0, 0.85, 1.0, conePulse * bright);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.coneBuf);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, this.coneCount);

      // 2. Watch root transform (float bob + user orbit + scale)
      const bobY = 0.22 * Math.sin(this.t * 1.9);
      let watchM = mat4Translate(0, bobY, 0);
      watchM = mat4Mul(watchM, mat4RotateX((this.pitch * Math.PI) / 180));
      watchM = mat4Mul(watchM, mat4RotateY((this.heading * Math.PI) / 180));
      watchM = mat4Mul(watchM, mat4Scale(this.state.size));
      const watchMVP = mat4Mul(vp, watchM);

      // Draw all 16 watch parts
      for (const p of this.glParts) {
        let fa, ea;
        if (p.kind === "internal") {
          if (this.xrayAmt < 0.02) continue;
          fa = this.xrayAmt * p.faceAlpha * 1.15;
          ea = this.xrayAmt * p.edgeAlpha;
        } else {
          const shellMul = 1.0 - 0.7 * this.xrayAmt;
          fa = p.faceAlpha * shellMul * (this.state.wireframe ? 0.0 : 1.0);
          ea = p.edgeAlpha * (1.0 - 0.35 * this.xrayAmt) * (this.state.wireframe ? 1.15 : 0.85);
        }

        const partM = mat4Mul(
          watchMVP,
          mat4Translate(
            p.explodeGL[0] * this.explodeAmt,
            p.explodeGL[1] * this.explodeAmt,
            p.explodeGL[2] * this.explodeAmt
          )
        );
        gl.uniformMatrix4fv(uMVP, false, partM);
        gl.bindBuffer(gl.ARRAY_BUFFER, p.vbo);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

        if (fa > 0.01) {
          gl.uniform4f(uColor, p.color[0], p.color[1], p.color[2], Math.min(0.95, fa * bright));
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.triBuf);
          gl.drawElements(gl.TRIANGLES, p.triCount, gl.UNSIGNED_SHORT, 0);
        }
        if (ea > 0.01) {
          gl.uniform4f(uColor, p.color[0], p.color[1], p.color[2], Math.min(1.0, ea * bright));
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.lineBuf);
          gl.drawElements(gl.LINES, p.lineCount, gl.UNSIGNED_SHORT, 0);
        }
      }

      // 3. Scanning Ring
      if (this.state.scanning) {
        const scanY = Math.sin(this.t * 1.65) * 3.1;
        const scanM = mat4Mul(vp, mat4Translate(0, scanY, 0));
        gl.uniformMatrix4fv(uMVP, false, scanM);
        gl.uniform4f(uColor, 0.25, 1.0, 0.95, 0.82 * bright);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.scanRingBuf);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, this.scanRingCount);
      }

      // 4. Holographic Particles
      if (this.state.particles && this.particlesBuf) {
        const pM = mat4Mul(vp, mat4RotateY(this.t * 0.22));
        gl.uniformMatrix4fv(uMVP, false, pM);
        gl.uniform1i(uIsPoint, 1);
        gl.uniform1f(uPointSize, 4.2);
        gl.uniform4f(uColor, 0.25, 0.95, 1.0, 0.65 * bright);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.particlesBuf);
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.POINTS, 0, this.particleCount);
        gl.uniform1i(uIsPoint, 0);
      }

      // 5. Live Watch Screen Texture Quad (standard alpha blend so text is crisp)
      if (!this.state.wireframe && this.xrayAmt < 0.75) {
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.progTex);
        const taPos = gl.getAttribLocation(this.progTex, "aPos");
        const taUV = gl.getAttribLocation(this.progTex, "aUV");
        const tuMVP = gl.getUniformLocation(this.progTex, "uMVP");
        const tuAlpha = gl.getUniformLocation(this.progTex, "uAlpha");

        const scrM = mat4Mul(watchMVP, mat4Translate(0, 0, 0.95 * this.explodeAmt));
        gl.uniformMatrix4fv(tuMVP, false, scrM);
        gl.uniform1f(tuAlpha, Math.min(1.0, (1.0 - this.xrayAmt * 0.8) * bright));
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.screenTex);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.screenVbo);
        gl.enableVertexAttribArray(taPos);
        gl.vertexAttribPointer(taPos, 3, gl.FLOAT, false, 20, 0);
        gl.enableVertexAttribArray(taUV);
        gl.vertexAttribPointer(taUV, 2, gl.FLOAT, false, 20, 12);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    }

    updateTelemetryUI(tel) {
      const set = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
      };
      set("holo-tel-bpm", `${tel.bpm} BPM`);
      set("holo-tel-spo2", `${tel.spo2}%`);
      set("holo-tel-temp", `${tel.temp}°C`);
      set("holo-tel-steps", Number(tel.steps).toLocaleString());
      set("holo-tel-batt", `${tel.battery}%`);

      if (this.ecgCanvas && Array.isArray(tel.ecg)) {
        this.drawEcg(this.ecgCanvas, tel.ecg, "#00ff88");
      }
    }

    drawEcg(canvas, samples, color) {
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(0,240,255,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.62);
      ctx.lineTo(w, h * 0.62);
      ctx.stroke();

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const n = samples.length;
      for (let i = 0; i < n; i++) {
        const x = (i / Math.max(1, n - 1)) * w;
        const y = h * 0.68 - samples[i] * (h * 0.52);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    syncToggleUI() {
      const map = {
        projection: "holo-btn-projection",
        wireframe: "holo-btn-wireframe",
        particles: "holo-btn-particles",
        scanning: "holo-btn-scanning",
        xray: "holo-btn-xray",
        explode: "holo-btn-explode",
        inspect: "holo-btn-inspect",
        paused: "holo-btn-pause",
      };
      for (const [key, id] of Object.entries(map)) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        const on = Boolean(this.state[key]);
        btn.classList.toggle("active", on);
        const b = btn.querySelector("b");
        if (b) b.textContent = on ? "ON" : "OFF";
      }
      if (this.statusChipEl) {
        this.statusChipEl.textContent = this.state.projection ? "PROJECTION ONLINE" : "PROJECTION STANDBY";
      }
    }

    bindUI() {
      const bindToggle = (id, key, onToggle) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.addEventListener("click", () => {
          this.state[key] = !this.state[key];
          if (onToggle) onToggle(this.state[key]);
          this.syncToggleUI();
        });
      };

      bindToggle("holo-btn-projection", "projection");
      bindToggle("holo-btn-wireframe", "wireframe");
      bindToggle("holo-btn-particles", "particles");
      bindToggle("holo-btn-scanning", "scanning");
      bindToggle("holo-btn-xray", "xray");
      bindToggle("holo-btn-explode", "explode");
      bindToggle("holo-btn-inspect", "inspect", (on) => {
        this.inspectIdx = 0;
        this.inspectTimer = 0;
        if (!on && this.captionEl) this.captionEl.textContent = "DRAG TO ROTATE 360° · SCROLL TO ZOOM";
      });
      bindToggle("holo-btn-pause", "paused");

      const bindSlider = (id, valId, key, fmt) => {
        const el = document.getElementById(id);
        const out = document.getElementById(valId);
        if (!el) return;
        el.addEventListener("input", () => {
          this.state[key] = parseFloat(el.value);
          if (out) out.textContent = fmt(this.state[key]);
        });
      };
      bindSlider("holo-slider-brightness", "holo-val-brightness", "brightness", (v) => `${Math.round(v * 100)}%`);
      bindSlider("holo-slider-speed", "holo-val-speed", "speed", (v) => `${Math.round(v)}°/s`);
      bindSlider("holo-slider-size", "holo-val-size", "size", (v) => `${v.toFixed(2)}x`);

      const resetBtn = document.getElementById("holo-btn-reset");
      if (resetBtn) {
        resetBtn.addEventListener("click", () => {
          this.heading = 22;
          this.pitch = 12;
          this.velH = 0;
          this.velP = 0;
          this.camDistTarget = 14.5;
          this.state.projection = true;
          this.state.wireframe = false;
          this.state.xray = false;
          this.state.explode = false;
          this.state.inspect = false;
          this.state.paused = false;
          this.syncToggleUI();
          if (this.captionEl) this.captionEl.textContent = "VIEW RESET · DRAG TO ROTATE 360°";
        });
      }

      document.querySelectorAll("#holo-page-buttons .page-chip").forEach((btn) => {
        btn.addEventListener("click", () => this.setPage(Number(btn.dataset.page)));
      });

      // Mouse drag 360° orbit + wheel zoom
      if (this.canvas) {
        this.canvas.addEventListener("pointerdown", (e) => {
          this.dragging = true;
          this.state.inspect = false;
          this.syncToggleUI();
          this.lastMouse = { x: e.clientX, y: e.clientY };
          this.canvas.setPointerCapture(e.pointerId);
        });
        this.canvas.addEventListener("pointermove", (e) => {
          if (!this.dragging) return;
          const dx = e.clientX - this.lastMouse.x;
          const dy = e.clientY - this.lastMouse.y;
          this.lastMouse = { x: e.clientX, y: e.clientY };
          this.heading = (this.heading + dx * 0.45) % 360;
          this.pitch = Math.max(-75, Math.min(75, this.pitch + dy * 0.38));
          this.velH = dx * 9;
          this.velP = dy * 7;
        });
        const stopDrag = () => { this.dragging = false; };
        this.canvas.addEventListener("pointerup", stopDrag);
        this.canvas.addEventListener("pointercancel", stopDrag);
        this.canvas.addEventListener("wheel", (e) => {
          e.preventDefault();
          const dir = e.deltaY > 0 ? 1 : -1;
          this.camDistTarget = Math.max(8.5, Math.min(26.0, this.camDistTarget * (1 + 0.08 * dir)));
        }, { passive: false });
      }

      this.syncToggleUI();
    }
  }

  window.HologramController = HologramController;
})();
