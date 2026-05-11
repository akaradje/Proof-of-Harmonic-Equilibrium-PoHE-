import { useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FluidState {
  level: number; // 0..1 target fill fraction
  phase: "idle" | "flowing" | "equilibrium";
  lastDigest: string; // debug label
  equilibriumStart: number; // performance.now() when equilibrium fired
}

interface FluidFields {
  d: Float32Array; // density   [CELLS]
  u: Float32Array; // x-velocity [CELLS]
  v: Float32Array; // y-velocity [CELLS]
  d0: Float32Array; // prev density
  u0: Float32Array; // prev x-velocity
  v0: Float32Array; // prev y-velocity
  cols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CELL_PX = 10; // cell edge length in pixels
const GRAVITY = 0.018;
const DAMPING = 0.992;
const DIFFUSION_A = 0.06;
const DIFFUSION_ITERS = 2;
const DIAMOND_STEP = 26; // spacing for diamond lattice overlay
const EQUILIBRIUM_EASE_MS = 800;

// ---------------------------------------------------------------------------
// Fluid simulation helpers
// ---------------------------------------------------------------------------

function allocateFields(cols: number, rows: number): FluidFields {
  const n = cols * rows;
  return {
    d: new Float32Array(n),
    u: new Float32Array(n),
    v: new Float32Array(n),
    d0: new Float32Array(n),
    u0: new Float32Array(n),
    v0: new Float32Array(n),
    cols,
    rows,
  };
}

/** One step of the fluid sim. Mutates fields in place. */
function stepFluid(f: FluidFields, phase: string, level: number, digest: string, now: number, eqStart: number): void {
  const { cols, rows } = f;
  const n = cols * rows;

  // snapshot previous frame (memcpy via .set — zero alloc)
  f.d0.set(f.d);
  f.u0.set(f.u);
  f.v0.set(f.v);

  // ---- 1. source injection ----
  if (phase === "flowing") {
    // Bottom-row injection — fluid rises from the bottom.
    const bottomRow = (rows - 1) * cols;
    for (let c = 0; c < cols; c++) {
      const i = bottomRow + c;
      f.d[i] = Math.min(1, f.d[i] + level * 0.12);
    }
    // Digest-seeded bursts at random columns.
    if (digest) {
      // Use first 4 chars of digest as a crude RNG seed.
      const seed = parseInt(digest.slice(0, 4), 16) || 1;
      for (let k = 0; k < 3; k++) {
        const c = ((seed * (k + 7) * 2654435761) >>> 0) % cols;
        const r = rows - 2 - (((seed * (k + 13)) >>> 0) % 3);
        const i = r * cols + c;
        f.d[i] = Math.min(1, f.d[i] + 0.35);
        f.v[i] -= 0.3; // upward kick
      }
    }
  }

  // ---- 2. semi-Lagrangian advection (bilinear interpolation) ----
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let sc = c - f.u0[i];
      let sr = r - f.v0[i];
      sc = Math.max(0, Math.min(cols - 1.0001, sc));
      sr = Math.max(0, Math.min(rows - 1.0001, sr));
      const c0 = sc | 0;
      const r0 = sr | 0;
      const c1 = Math.min(c0 + 1, cols - 1);
      const r1 = Math.min(r0 + 1, rows - 1);
      const fc = sc - c0;
      const fr = sr - r0;

      const i00 = r0 * cols + c0;
      const i10 = r0 * cols + c1;
      const i01 = r1 * cols + c0;
      const i11 = r1 * cols + c1;

      const w00 = (1 - fc) * (1 - fr);
      const w10 = fc * (1 - fr);
      const w01 = (1 - fc) * fr;
      const w11 = fc * fr;

      f.d[i] = w00 * f.d0[i00] + w10 * f.d0[i10] + w01 * f.d0[i01] + w11 * f.d0[i11];
      f.u[i] = (w00 * f.u0[i00] + w10 * f.u0[i10] + w01 * f.u0[i01] + w11 * f.u0[i11]) * DAMPING;
      f.v[i] = (w00 * f.v0[i00] + w10 * f.v0[i10] + w01 * f.v0[i01] + w11 * f.v0[i11]) * DAMPING + GRAVITY * f.d[i];
    }
  }

  // ---- 3. Jacobi diffusion (velocity only) ----
  for (let iter = 0; iter < DIFFUSION_ITERS; iter++) {
    const ut = new Float32Array(f.u);
    const vt = new Float32Array(f.v);
    for (let r = 1; r < rows - 1; r++) {
      const base = r * cols;
      for (let c = 1; c < cols - 1; c++) {
        const i = base + c;
        f.u[i] = (ut[i] + DIFFUSION_A * (ut[i - 1] + ut[i + 1] + ut[i - cols] + ut[i + cols])) / (1 + 4 * DIFFUSION_A);
        f.v[i] = (vt[i] + DIFFUSION_A * (vt[i - 1] + vt[i + 1] + vt[i - cols] + vt[i + cols])) / (1 + 4 * DIFFUSION_A);
      }
    }
  }

  // ---- 4. boundary ----
  for (let c = 0; c < cols; c++) {
    f.u[c] = 0; f.v[c] = 0; // top
    const bi = (rows - 1) * cols + c;
    f.u[bi] = 0; f.v[bi] = 0; // bottom
  }
  for (let r = 0; r < rows; r++) {
    f.u[r * cols] = 0; f.v[r * cols] = 0; // left
    f.u[r * cols + cols - 1] = 0; f.v[r * cols + cols - 1] = 0; // right
  }

  // ---- 5. equilibrium velocity clamp ----
  if (phase === "equilibrium") {
    const elapsed = now - eqStart;
    const t = Math.min(1, elapsed / EQUILIBRIUM_EASE_MS);
    const clamp = 1 - easeOutCubic(t);
    for (let i = 0; i < n; i++) {
      f.u[i] *= clamp;
      f.v[i] *= clamp;
    }
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function densityToColor(d: number): [number, number, number, number] {
  if (d <= 0) return [0, 0, 0, 0];
  // Map density → blue-indigo gradient.
  const r = 15 + d * 30;
  const g = 60 + d * 80;
  const b = 160 + d * 95;
  const a = 0.15 + d * 0.85;
  return [r, g, b, a * 255];
}

function renderFluid(
  ctx: CanvasRenderingContext2D,
  f: FluidFields,
  w: number,
  h: number,
  phase: string,
  now: number,
  eqStart: number,
): void {
  const { cols, rows } = f;
  const cellW = w / cols;
  const cellH = h / rows;

  // Build or reuse pixel buffer.
  let img: ImageData;
  try {
    img = ctx.createImageData(w, h);
  } catch {
    return; // canvas zero-size guard
  }
  const pix = img.data;

  for (let r = 0; r < rows; r++) {
    const y0 = Math.round(r * cellH);
    const y1 = Math.round((r + 1) * cellH);
    for (let c = 0; c < cols; c++) {
      const d = f.d[r * cols + c];
      if (d <= 0.002) continue; // skip invisible cells
      const [cr, cg, cb, ca] = densityToColor(d);
      const x0 = Math.round(c * cellW);
      const x1 = Math.round((c + 1) * cellW);

      for (let py = y0; py < y1; py++) {
        const rowOff = py * w * 4;
        for (let px = x0; px < x1; px++) {
          const off = rowOff + px * 4;
          pix[off] = cr;
          pix[off + 1] = cg;
          pix[off + 2] = cb;
          pix[off + 3] = ca;
        }
      }
    }
  }

  ctx.putImageData(img, 0, 0);

  // ---- diamond lattice overlay during equilibrium transition ----
  if (phase === "equilibrium") {
    const elapsed = now - eqStart;
    const t = Math.min(1, elapsed / EQUILIBRIUM_EASE_MS);
    const alpha = easeOutCubic(t);
    if (alpha > 0.005) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.9;
      ctx.strokeStyle = "rgba(220,240,255,0.9)";
      ctx.lineWidth = 1;
      const step = DIAMOND_STEP;
      for (let gx = 0; gx < w + step; gx += step) {
        for (let gy = 0; gy < h + step; gy += step) {
          ctx.beginPath();
          ctx.moveTo(gx + step / 2, gy);
          ctx.lineTo(gx + step, gy + step / 2);
          ctx.lineTo(gx + step / 2, gy + step);
          ctx.lineTo(gx, gy + step / 2);
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // ---- debug hash strip ----
  // Access is via stateRef below; the draw closure captures it.
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCanvasReducer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<FluidState>({
    level: 0,
    phase: "idle",
    lastDigest: "",
    equilibriumStart: 0,
  });
  const fieldsRef = useRef<FluidFields | null>(null);
  const rafRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize backing store to match CSS layout.
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      const cols = Math.max(10, (w / CELL_PX) | 0);
      const rows = Math.max(6, (h / CELL_PX) | 0);
      const cur = fieldsRef.current;
      if (!cur || cur.cols !== cols || cur.rows !== rows) {
        fieldsRef.current = allocateFields(cols, rows);
      }
    }

    const f = fieldsRef.current;
    if (!f) { rafRef.current = requestAnimationFrame(draw); return; }

    const { level, phase, lastDigest, equilibriumStart } = stateRef.current;
    const now = performance.now();

    // Step the sim.
    stepFluid(f, phase, level, lastDigest, now, equilibriumStart);

    // Idle drain: slowly reduce density everywhere.
    if (phase === "idle") {
      for (let i = 0; i < f.cols * f.rows; i++) {
        f.d[i] *= 0.94;
        f.u[i] *= 0.92;
        f.v[i] *= 0.92;
      }
    }

    // Render.
    ctx.clearRect(0, 0, w, h);
    renderFluid(ctx, f, w, h, phase, now, equilibriumStart);

    // Debug strip showing current digest and round count.
    if (lastDigest) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "11px monospace";
      ctx.fillText(lastDigest, 8, 16);
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const attach = useCallback(
    (canvas: HTMLCanvasElement) => {
      canvasRef.current = canvas;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(draw);
      }
    },
    [draw],
  );

  const onTick = useCallback((rounds: number, digestPrefix: string) => {
    const cur = stateRef.current.level;
    stateRef.current = {
      ...stateRef.current,
      level: Math.min(0.95, cur + (1 - cur) * 0.02),
      phase: "flowing",
      lastDigest: `${rounds} · ${digestPrefix}`,
    };
  }, []);

  const onEquilibrium = useCallback(() => {
    stateRef.current = {
      ...stateRef.current,
      level: 1,
      phase: "equilibrium",
      equilibriumStart: performance.now(),
    };
  }, []);

  const onIdle = useCallback(() => {
    stateRef.current = {
      level: 0,
      phase: "idle",
      lastDigest: "",
      equilibriumStart: 0,
    };
  }, []);

  return { attach, onTick, onEquilibrium, onIdle };
}
