import { useCallback, useRef } from "react";

/**
 * Lightweight imperative renderer. We deliberately avoid React re-renders
 * per frame — instead, we keep a reducer state in a ref and draw directly.
 * This keeps the main thread free while Wasm streams progress.
 *
 * Visual model (MVP):
 *   - `level` rises as rounds tick up: fluid fills the canvas.
 *   - On equilibrium: fluid crystallises into a diamond lattice.
 *   - On idle: slow drain back to empty.
 */
interface State {
  level: number;      // 0..1
  phase: "idle" | "flowing" | "equilibrium";
  lastDigest: string;
}

export function useCanvasReducer() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<State>({ level: 0, phase: "idle", lastDigest: "" });
  const rafRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Fit canvas to its CSS size once per frame.
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const { level, phase, lastDigest } = stateRef.current;

    ctx.clearRect(0, 0, w, h);

    // Fluid band
    const y = h * (1 - level);
    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, "rgba(120, 200, 255, 0.35)");
    grad.addColorStop(1, "rgba(120, 200, 255, 0.10)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, y, w, h - y);

    // Subtle wave on the surface
    ctx.strokeStyle = "rgba(180, 230, 255, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const t = performance.now() / 400;
    for (let x = 0; x <= w; x += 4) {
      const wave = Math.sin(x / 40 + t) * (phase === "equilibrium" ? 0 : 4);
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();

    // Diamond lattice overlay when solved
    if (phase === "equilibrium") {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 1;
      const step = 24;
      for (let gx = 0; gx < w; gx += step) {
        for (let gy = 0; gy < h; gy += step) {
          ctx.beginPath();
          ctx.moveTo(gx + step / 2, gy);
          ctx.lineTo(gx + step, gy + step / 2);
          ctx.lineTo(gx + step / 2, gy + step);
          ctx.lineTo(gx, gy + step / 2);
          ctx.closePath();
          ctx.stroke();
        }
      }
    }

    // Debug hash strip
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
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(draw);
    },
    [draw]
  );

  const onTick = useCallback((rounds: number, digestPrefix: string) => {
    // Level rises asymptotically toward 1 as work accumulates.
    const cur = stateRef.current.level;
    stateRef.current = {
      level: Math.min(0.95, cur + (1 - cur) * 0.02),
      phase: "flowing",
      lastDigest: `${rounds} · ${digestPrefix}`,
    };
  }, []);

  const onEquilibrium = useCallback(() => {
    stateRef.current = { ...stateRef.current, level: 1, phase: "equilibrium" };
  }, []);

  const onIdle = useCallback(() => {
    stateRef.current = { level: 0, phase: "idle", lastDigest: "" };
  }, []);

  return { attach, onTick, onEquilibrium, onIdle };
}
