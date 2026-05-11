# Proof of Harmonic Equilibrium (PoHE)

PoHE is a browser-native, anti-ASIC mining protocol where proof-of-work is replaced by a **Sequential Hash Chain** (a pragmatic VDF variant). Users open a web page, a Web Worker runs a single-threaded Wasm module, and when the chain reaches equilibrium the Relay Node validates the proof and triggers an ERC-20 mint on Sepolia.

> The UI theme is **Liquid Information** over Glassmorphism: while the Wasm loop runs, animated fluid flows across the HUD; when a valid proof is found, the fluid crystallizes into a diamond lattice.

## Architecture at a glance

```
 Browser (Client)                 Relay Node                 Sepolia
 +------------------+   WS   +-------------------+   tx   +-------------+
 |  React HUD       | <----> |  FastAPI          | -----> | PoHEToken   |
 |   |              |        |   - Seed issuer   |        |  (ERC-20)   |
 |   v              |        |   - VDF verifier  |        |  MINTER     |
 |  Web Worker      |        |   - Mint oracle   |        +-------------+
 |   |              |        +-------------------+
 |   v              |
 |  Wasm (Rust VDF) |
 +------------------+
```

## Repository layout

| Path | Purpose | Stack |
|---|---|---|
| `contracts/` | ERC-20 token + mint oracle gated by `MINTER_ROLE` | Solidity 0.8.24, Hardhat, OpenZeppelin |
| `relay-node/` | Issues seeds, verifies VDF proofs, calls `mint()` | Python 3.11, FastAPI, web3.py |
| `wasm-core/` | Sequential hash-chain VDF (single-threaded) | Rust, `wasm-bindgen` |
| `client/` | HUD, Canvas reducer, WebSocket miner | React 18, TypeScript, Vite |

## Design decisions

- **VDF = Sequential SHA-256 chain + Merkle checkpoints.** Not a Wesolowski/Pietrzak VDF (yet). Verifier uses random sampling of intermediate states for sub-linear check.
- **Single-threaded Wasm** (no `SharedArrayBuffer`, no wasm threads) to preserve the anti-parallel property. One worker per seed.
- **Replay protection** at the contract level: `mapping(bytes32 => bool) usedSeeds` keyed by `keccak256(seed, miner)`.
- **Relay authority is single-trust for MVP.** `MINTER_ROLE` is held by the relay's hot key; rotate via `AccessControl` without redeploying.

## Development workflow

See [`DEVELOPMENT.md`](./DEVELOPMENT.md) for the phase-by-phase roadmap and the **Claude AI prompt pack** — copy-paste ready prompts for building each module.

## Quick start (per-package)

```bash
# Contracts
cd contracts && npm install && npx hardhat compile

# Relay node
cd relay-node && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
uvicorn app.main:app --reload

# Wasm core
cd wasm-core && wasm-pack build --target web --out-dir ../client/src/wasm/pkg

# Client
cd client && pnpm install && pnpm dev
```

## Network

- Target: **Sepolia only** (testnet). Mainnet is out of scope until VDF is upgraded to Wesolowski.

## License

MIT (placeholder — change if needed).
