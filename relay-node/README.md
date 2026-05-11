# relay-node

FastAPI service that:

1. Issues a 32-byte block seed over WebSocket (`/ws`).
2. Receives a proof bundle from the miner, verifies it with random spot-checks.
3. Calls `PoHEToken.mintReward(miner, amount, seed)` on Sepolia via `web3.py`.
4. Adjusts difficulty with an EMA controller and issues the next seed.

## Run

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

If `SEPOLIA_RPC_URL`, `RELAY_PRIVATE_KEY`, and `POHE_TOKEN_ADDRESS` are set in
the root `.env`, the relay uses `Web3MintOracle`. Otherwise it falls back to
`LoggingMintOracle` (dev mode — no tx sent, only logged).

## Test

```bash
pytest -q
```

## VDF verifier

`app/vdf.py` is the **reference implementation**. It must match
`wasm-core/src/vdf.rs` byte-for-byte, otherwise every proof will fail. There
is an end-to-end test that exercises this round-trip via the Rust-generated
bundle (wired in the client).
