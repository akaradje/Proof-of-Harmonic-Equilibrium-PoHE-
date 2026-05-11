# PoHE Development Guide

This document is the **operating manual** for building PoHE. It has two parts:

1. [Phase roadmap](#phase-roadmap) — the ordered list of work items.
2. [Claude AI prompt pack](#claude-ai-prompt-pack) — copy-paste-ready prompts for each phase. Paste these into Claude (or any capable coding assistant) one at a time; each prompt assumes the repository is already checked out and the previous prompts have been completed.

---

## Design invariants (do not violate)

Before any phase, every prompt below silently assumes these rules:

1. **Single-threaded Wasm.** No `SharedArrayBuffer`, no wasm threads, no `rayon`. The sequential dependency of the VDF is the anti-parallel guarantee.
2. **VDF = SHA-256 hash chain with round-index mixing.** `state_i = SHA256(state_{i-1} || u64_be(i))`. The Rust (`wasm-core/src/vdf.rs`) and Python (`relay-node/app/vdf.py`) implementations must stay byte-for-byte identical.
3. **Mint is relay-authorised only.** Contract holds `MINTER_ROLE` for the relay. Replay is blocked on-chain via `usedProofs[keccak256(seed, miner)]`.
4. **Sepolia only.** Mainnet is out of scope until a real VDF (Wesolowski) replaces the hash chain.
5. **No mining UI that blocks the main thread.** Progress goes through `postMessage`; canvas uses `requestAnimationFrame`, not React re-renders.

---

## Phase roadmap

### Phase 1 — Core Engine (Week 1)
Goal: Miner can solve a seed locally and the relay can verify the proof, end-to-end, without any blockchain.

- [ ] 1.1 Finish `wasm-core` (currently scaffolded). Add chunked mining so the worker can emit real progress ticks.
- [ ] 1.2 Wire `miner.worker.ts` to run the chunked loop and post 30 progress frames across the run.
- [ ] 1.3 Run `relay-node` locally with `LoggingMintOracle` and confirm an honest proof is accepted.
- [ ] 1.4 Add a negative-path test: miner tampers the final state → relay rejects.

### Phase 2 — Smart Contract & Oracle (Week 2)
Goal: Relay actually mints on Sepolia when a proof lands.

- [ ] 2.1 Compile and test `contracts/` (`npx hardhat test`).
- [ ] 2.2 Deploy `PoHEToken` to Sepolia via `scripts/deploy.ts`. Record address in `.env`.
- [ ] 2.3 Fund the relay's hot wallet with Sepolia ETH.
- [ ] 2.4 Switch relay from `LoggingMintOracle` to `Web3MintOracle` by populating the three env vars. Full round-trip: miner solves → relay verifies → tx hash returned to HUD.
- [ ] 2.5 Add on-chain event indexing so the UI can display mint history.

### Phase 3 — Frontend Polish & Integration (Week 3)
Goal: The HUD feels like Liquid Information, not a loading spinner.

- [ ] 3.1 Replace the placeholder canvas renderer in `useCanvasReducer.ts` with a real fluid simulation (SPH or 2D Navier-Stokes grid). Budget: < 2ms/frame.
- [ ] 3.2 On `equilibrium`, animate the fluid crystallising into the diamond lattice (ease over 800ms).
- [ ] 3.3 Implement the `split` and `mosaic` templates in `TemplateSelector`.
- [ ] 3.4 Connect a wallet (wagmi + viem) to read the miner address instead of the text input.
- [ ] 3.5 Lighthouse perf pass: total blocking time < 200ms on a mid-range laptop.

### Phase 4 — Hardening (Optional)
- [ ] 4.1 Move VDF to Wesolowski (class group or RSA). `mintReward` becomes on-chain verification.
- [ ] 4.2 Remove `MINTER_ROLE` from hot keys. Oracle becomes stateless.
- [ ] 4.3 Multi-node relay with gossip.

---

## Claude AI prompt pack

Each prompt block is self-contained. Paste the block into Claude, wait for the result, commit, then move on.

> **Global system prompt** (paste this as the first message when you start a fresh Claude session):
>
> ```
> You are helping me build the Proof of Harmonic Equilibrium (PoHE) project. The repo is a monorepo with four packages: `wasm-core/` (Rust→Wasm VDF), `contracts/` (Solidity + Hardhat), `relay-node/` (Python + FastAPI), `client/` (React + Vite + TS). Design invariants:
>
> 1. Single-threaded Wasm. No SharedArrayBuffer, no wasm threads.
> 2. VDF is a sequential SHA-256 chain: state_i = SHA256(state_{i-1} || u64_be(i)). Rust and Python impls must match byte-for-byte.
> 3. Relay has MINTER_ROLE. Contract stores usedProofs[keccak256(seed, miner)] to block replays.
> 4. Sepolia only.
> 5. UI must not block the main thread. Canvas uses rAF + imperative draws.
>
> When I ask you to implement something, produce full file contents, not diffs. Always include tests. Call out any invariant you would need to relax.
> ```

---

### Prompt 1.1 — Chunked mining in `wasm-core`

```
In `wasm-core/src/lib.rs`, add a new exported function:

    pub fn mine_chunk(start_state: &[u8], start_round: u64, rounds: u64) -> Vec<u8>

that runs exactly `rounds` iterations of the chain starting from `start_state` at round index `start_round + 1` and returns the new state. Reuse `vdf::run_chain` internally; do not duplicate logic.

Also add a Rust unit test that composes two `mine_chunk` calls and asserts the result equals a single `run_chain(seed, N, N)` call (same seed, same rounds). Put the test in `wasm-core/src/vdf.rs` under `#[cfg(test)]`.

Do not change `mine()` or `verify_segment()`. Output full file contents for both files.
```

### Prompt 1.2 — Chunked progress in the worker

```
In `client/src/wasm/miner.worker.ts`, replace the single `mine()` call with a loop that:

  - splits `difficulty` into ~30 chunks of equal size (last chunk may be larger).
  - calls the new `mine_chunk(state, start_round, chunk_size)` for each chunk.
  - after each chunk, postMessage `{ type: "progress", rounds: totalSoFar, digest_prefix: first16HexOfState }`.
  - keeps its own checkpoint list at intervals of `checkpoint_every`, so the final payload matches what the Python verifier expects.
  - yields to the event loop between chunks with `await new Promise(r => setTimeout(r, 0))` so messages actually flush.

At the end, post `{ type: "done", ... }` with the same fields as before. The final_state and checkpoints list must pass `app.vdf.verify()` without changes to the relay.

Output the full updated worker file.
```

### Prompt 1.3 — Local end-to-end smoke

```
Write a Python script `relay-node/scripts/smoke_e2e.py` that:

  1. Starts the FastAPI app in-process via `TestClient` (or `uvicorn` in a background thread; pick whichever is simpler).
  2. Opens a WebSocket to /ws, receives the first seed message.
  3. Runs `app.vdf.run_chain` locally with the received seed+difficulty.
  4. Sends the resulting ProofMessage (shape matches `relay-node/app/main.py::ProofMessage`) back to the relay.
  5. Asserts the relay's reply is `{"type":"ack","accepted":true}`.
  6. Prints "SMOKE OK" on success, exits non-zero on failure.

No external network calls. `LoggingMintOracle` is fine. Output the full script file.
```

### Prompt 2.1 — Hardhat test expansion

```
Add two tests to `contracts/test/PoHEToken.test.ts`:

  (a) admin can revoke MINTER_ROLE from the relay and the relay can no longer mint.
  (b) admin can grant MINTER_ROLE to a new address, and the new address can mint successfully.

Keep the existing four tests. Use OpenZeppelin v5 `AccessControl` API (`grantRole` / `revokeRole`). Output the full updated test file.
```

### Prompt 2.2 — Sepolia deployment script hardening

```
Update `contracts/scripts/deploy.ts` to:

  - Require SEPOLIA_RPC_URL, RELAY_PRIVATE_KEY, RELAY_ADDRESS to be set when --network sepolia; throw a clear error if not.
  - After deploy, print a ready-to-paste block for the root `.env` file containing POHE_TOKEN_ADDRESS.
  - Save a deployment record at `contracts/deployments/sepolia.json` with { address, deployer, relay, maxMintPerBlock, blockNumber, txHash, timestamp }.
  - Add a matching `.gitignore` entry only if you want the record untracked (I want it tracked — so DO NOT add an entry).

Output the full updated deploy script.
```

### Prompt 2.3 — Mint event indexer

```
In `client/src/hooks/useMintEvents.ts`, implement a hook that subscribes to `ProofAccepted(address indexed miner, bytes32 indexed seed, uint256 amount, bytes32 proofId)` via a public Sepolia RPC (read-only; no wallet needed). Use `viem`'s `createPublicClient` + `watchContractEvent`. Expose:

    { events: MintEvent[]; clear(): void }

  MintEvent = { txHash, miner, seed, amount: bigint, proofId, blockNumber }

Keep the last 50 events in state. Do not call `window.ethereum`. Add `viem` to `client/package.json`. Output the hook file and the updated package.json.
```

### Prompt 3.1 — Real fluid simulation

```
Replace the canvas body of `client/src/hooks/useCanvasReducer.ts` with a lightweight 2D fluid simulation. Constraints:

  - Must run in < 2ms per frame on a 900x380 canvas.
  - Pure CPU, no WebGL (MVP). Use a simple grid advection + gravity integrator.
  - Expose the same public API (`attach`, `onTick`, `onEquilibrium`, `onIdle`) — do not change call sites.
  - When `onEquilibrium` fires, ease a diamond-lattice mask in over 800ms, clamping the fluid motion to near-zero.

Keep the file self-contained. Do not add new deps. Output the full file.
```

### Prompt 3.2 — Wallet-connected miner address

```
In `client/`, add wagmi + viem wallet connection:

  - New file `src/wallet/config.ts` exporting a wagmi `Config` targeting Sepolia only.
  - Wrap `<App />` in `<WagmiProvider>` + `<QueryClientProvider>`.
  - In `HUD.tsx`, replace the text input with a `<ConnectKitButton>` (or equivalent minimal connect button) and bind `minerAddressRef.current` to the connected address. Disable "Start mining" until connected.
  - Update `client/package.json`.

Do NOT use the wallet to send transactions; the relay still mints. The wallet is only used to prove the recipient address. Output all changed/added files in full.
```

---

## Operational checklists

### Running the full stack locally

```bash
# 1. Build Wasm
cd wasm-core && wasm-pack build --target web --out-dir ../client/src/wasm/pkg

# 2. Compile + test contracts (optional for local-only run)
cd contracts && npm install && npx hardhat test

# 3. Start relay (dev mode — no chain)
cd relay-node && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080

# 4. Start client
cd client && pnpm install && pnpm dev
# Open http://localhost:5173
```

### Going live on Sepolia

1. Fund the relay wallet with ~0.2 Sepolia ETH (faucet: https://sepoliafaucet.com).
2. `cd contracts && npm run deploy:sepolia`
3. Paste the printed env block into root `.env`.
4. Restart the relay. The log should say `using Web3 oracle on chainId=11155111`.
5. Connect a wallet on the HUD, click **Start mining**, wait for the first `ack` with a real `tx_hash`.

### Debugging common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `verification failed` on every proof | Rust and Python VDF drifted | Check both `vdf.rs` and `vdf.py` use `u64::to_be_bytes` for round index |
| `ProofAlreadyUsed` on fresh mining | Seed wasn't rotated after mint | Confirm relay calls `new_seed()` after each `ack` |
| Main thread jank | Worker is not ES module | `vite.config.ts` must have `worker: { format: "es" }` |
| Wasm import fails | `pkg/` not built | Re-run `wasm-pack build --target web --out-dir ../client/src/wasm/pkg` |
