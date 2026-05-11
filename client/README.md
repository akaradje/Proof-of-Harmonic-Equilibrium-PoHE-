# client

React + TypeScript + Vite frontend. Renders the Liquid Information HUD and
spawns a Web Worker per mining seed.

## Prerequisites

Build the Wasm package first — the client imports from `src/wasm/pkg/`:

```bash
cd ../wasm-core
wasm-pack build --target web --out-dir ../client/src/wasm/pkg
```

## Run

```bash
pnpm install
pnpm dev
```

Set `VITE_RELAY_WS_URL` in the root `.env` to point at your relay node.

## Key files

- `src/App.tsx` — shell with header + HUD.
- `src/components/HUD.tsx` — WebSocket client + worker lifecycle.
- `src/hooks/useCanvasReducer.ts` — imperative canvas animation (no per-frame React re-render).
- `src/wasm/miner.worker.ts` — Web Worker that runs the Rust VDF.
- `src/components/TemplateSelector.tsx` — layout template picker.

## Why single-threaded Wasm

Using `SharedArrayBuffer` / wasm threads would let a miner parallelise the
sequential chain, breaking the anti-ASIC guarantee. The worker loads the
stock `--target web` output and runs in a single thread.
