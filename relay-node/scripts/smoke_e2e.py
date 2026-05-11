"""End-to-end smoke test: WebSocket round-trip through the relay.

  1. Starts the FastAPI app in-process via TestClient.
  2. Opens a WebSocket to /ws, receives the first seed message.
  3. Runs app.vdf.run_chain locally with the received seed+difficulty.
  4. Sends the resulting proof back as a ProofMessage.
  5. Asserts the relay replies with accepted=true.
  6. Prints "SMOKE OK" on success, exits non-zero on failure.

No external network calls. LoggingMintOracle is used (no Sepolia env vars).
"""

from __future__ import annotations

import os
import sys

# Force LoggingMintOracle: pre-seed env vars with empty strings so
# load_dotenv (which does not override existing keys) leaves them
# empty, causing _build_oracle() to take the dev-mode fallback.
for _key in ("SEPOLIA_RPC_URL", "RELAY_PRIVATE_KEY", "POHE_TOKEN_ADDRESS"):
    os.environ[_key] = ""

from fastapi.testclient import TestClient

from app.main import app
from app.vdf import run_chain

DUMMY_ADDRESS: str = "0x000000000000000000000000000000000000dEaD"


def main() -> None:
    # TestClient as a context manager triggers the ASGI lifespan
    # (startup sets app.state.difficulty + app.state.oracle).
    with TestClient(app) as client, client.websocket_connect("/ws") as ws:
        # 1. Receive the seed message the relay issues on connect.
        seed_msg = ws.receive_json()
        if seed_msg.get("type") != "seed":
            print(f"SMOKE FAIL: expected seed message, got {seed_msg}", file=sys.stderr)
            sys.exit(1)

        seed_hex: str = seed_msg["seed_hex"]
        difficulty: int = seed_msg["difficulty"]
        checkpoint_every: int = seed_msg["checkpoint_every"]

        print(f"  seed={seed_hex[:16]}...  difficulty={difficulty}  cp_every={checkpoint_every}")

        # 2. Run the VDF locally — must match the Wasm miner byte-for-byte.
        seed_bytes = bytes.fromhex(seed_hex)
        final_state, checkpoints = run_chain(seed_bytes, difficulty, checkpoint_every)
        print(f"  chain complete  final_state={final_state.hex()[:16]}...  checkpoints={len(checkpoints)}")

        # 3. Send the proof back to the relay.
        proof = {
            "type": "proof",
            "seed_hex": seed_hex,
            "difficulty": difficulty,
            "checkpoint_every": checkpoint_every,
            "final_state_hex": final_state.hex(),
            "checkpoints_hex": [cp.hex() for cp in checkpoints],
            "miner_address": DUMMY_ADDRESS,
        }
        ws.send_json(proof)

        # 4. Assert the relay accepts the proof.
        ack = ws.receive_json()
        if ack.get("type") != "ack":
            print(f"SMOKE FAIL: expected ack, got {ack}", file=sys.stderr)
            sys.exit(1)

        if ack.get("accepted") is not True:
            reason = ack.get("reason", "unknown")
            print(f"SMOKE FAIL: proof rejected — {reason}", file=sys.stderr)
            sys.exit(1)

    print("SMOKE OK")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"SMOKE FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
