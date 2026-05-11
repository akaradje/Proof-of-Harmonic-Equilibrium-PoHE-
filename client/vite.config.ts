import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// NOTE: we do NOT enable crossOriginIsolated / SharedArrayBuffer.
// Single-threaded Wasm is a design invariant (anti-parallel VDF).
export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // Wasm package is emitted by `wasm-pack build --target web` into
    // src/wasm/pkg. Don't let Vite pre-bundle it.
    exclude: ["pohe-wasm-core"],
  },
});
