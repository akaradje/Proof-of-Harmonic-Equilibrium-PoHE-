# Proof of Harmonic Equilibrium (PoHE) — CLAUDE.md

## Project overview

Monorepo with four packages:

| Package | Stack | Purpose |
|----------|-------|---------|
| `wasm-core/` | Rust → Wasm (wasm-pack) | VDF engine — sequential SHA-256 chain |
| `contracts/` | Solidity + Hardhat + TypeScript | PoHEToken (ERC-20 with mint-by-proof) |
| `relay-node/` | Python + FastAPI | Off-chain relay — verifies Wasm proofs, calls `mint()` |
| `client/` | React + Vite + TypeScript | Canvas-based miner UI with Web Worker |

Package manager: `pnpm`. Workspace root: `package.json` → `pnpm-workspace.yaml`.

## Design invariants

1. **Single-threaded Wasm.** No SharedArrayBuffer, no `--features wasm-bindgen-rayon`, no wasm threads.
2. **VDF is a sequential SHA-256 chain:** `state_i = SHA256(state_{i-1} || u64_be(i))`. Rust (`wasm-core/src/vdf.rs`) and Python (`relay-node/app/vdf.py`) must match byte-for-byte.
3. **Relay has MINTER_ROLE.** Contract stores `usedProofs[keccak256(seed, miner)]` to block replays. Relay checks this before submitting `mint()`.
4. **Sepolia only.** All hardhat configs target Sepolia. No mainnet, no localhost in production config.
5. **UI must not block the main thread.** VDF mining runs in a Web Worker (`client/src/wasm/miner.worker.ts`). Canvas draws use `requestAnimationFrame` + imperative draws via `useCanvasReducer`.

## Common tasks

### Build Wasm
```sh
cd wasm-core && wasm-pack build --target web --out-dir ../client/src/wasm/pkg
```

### Run relay locally
```sh
cd relay-node && uvicorn app.main:app --reload
```

### Run client dev server
```sh
cd client && pnpm dev
```

### Run contract tests
```sh
cd contracts && npx hardhat test
```

## Key files

- `wasm-core/src/vdf.rs` — VDF chain logic (single-threaded, SHA-256)
- `wasm-core/src/lib.rs` — wasm-bindgen exports
- `contracts/contracts/PoHEToken.sol` — ERC-20 token with `mint(bytes32 seed, address miner, bytes32[] proof, bytes32 result)`
- `relay-node/app/vdf.py` — Python VDF verify (must match Rust byte-for-byte)
- `relay-node/app/main.py` — FastAPI endpoints (`/submit-proof`, etc.)
- `client/src/hooks/useCanvasReducer.ts` — rAF + imperative canvas reducer
- `client/src/wasm/miner.worker.ts` — Web Worker that loads Wasm and runs VDF
