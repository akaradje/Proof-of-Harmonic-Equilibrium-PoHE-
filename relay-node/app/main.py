"""FastAPI entrypoint: issues seeds over WebSocket, verifies proofs, mints."""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator

from .chain import LoggingMintOracle, MintOracle, Web3MintOracle
from .config import settings
from .difficulty import DifficultyController
from .vdf import ProofBundle, new_seed, verify

log = logging.getLogger("pohe.relay")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


# ----- wire types -----
class SeedMessage(BaseModel):
    type: str = "seed"
    seed_hex: str
    difficulty: int
    checkpoint_every: int


class ProofMessage(BaseModel):
    type: str = Field(default="proof")
    seed_hex: str
    difficulty: int
    checkpoint_every: int
    final_state_hex: str
    checkpoints_hex: list[str]
    miner_address: str

    @field_validator("miner_address")
    @classmethod
    def _check_addr(cls, v: str) -> str:
        if not (v.startswith("0x") and len(v) == 42):
            raise ValueError("miner_address must be a 0x-prefixed 20-byte hex")
        return v


class AckMessage(BaseModel):
    type: str = "ack"
    accepted: bool
    reason: str | None = None
    tx_hash: str | None = None


# ----- app -----
def _build_oracle() -> MintOracle:
    if settings.sepolia_rpc_url and settings.relay_private_key and settings.pohe_token_address:
        log.info("using Web3 oracle on chainId=11155111")
        return Web3MintOracle(
            rpc_url=settings.sepolia_rpc_url,
            private_key=settings.relay_private_key,
            token_address=settings.pohe_token_address,
        )
    log.warning("Web3 env not set; falling back to LoggingMintOracle (dev mode)")
    return LoggingMintOracle()


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.difficulty = DifficultyController(current=settings.difficulty)
    app.state.oracle = _build_oracle()
    yield


app = FastAPI(title="PoHE Relay Node", lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    await websocket.accept()
    difficulty_ctl: DifficultyController = websocket.app.state.difficulty
    oracle: MintOracle = websocket.app.state.oracle

    seed = new_seed()
    current_difficulty = difficulty_ctl.current
    await websocket.send_json(
        SeedMessage(
            seed_hex=seed.hex(),
            difficulty=current_difficulty,
            checkpoint_every=settings.checkpoint_every,
        ).model_dump()
    )
    issued_at = time.monotonic()

    try:
        while True:
            raw = await websocket.receive_json()
            try:
                msg = ProofMessage.model_validate(raw)
            except Exception as e:  # noqa: BLE001
                await websocket.send_json(
                    AckMessage(accepted=False, reason=f"bad payload: {e}").model_dump()
                )
                continue

            proof = ProofBundle(
                seed=bytes.fromhex(msg.seed_hex),
                difficulty=msg.difficulty,
                checkpoint_every=msg.checkpoint_every,
                final_state=bytes.fromhex(msg.final_state_hex),
                checkpoints=[bytes.fromhex(cp) for cp in msg.checkpoints_hex],
            )

            # Bind proof to the seed we actually issued.
            if proof.seed != seed or proof.difficulty != current_difficulty:
                await websocket.send_json(
                    AckMessage(accepted=False, reason="seed/difficulty mismatch").model_dump()
                )
                continue

            if not await asyncio.get_running_loop().run_in_executor(None, verify, proof):
                await websocket.send_json(
                    AckMessage(accepted=False, reason="verification failed").model_dump()
                )
                continue

            elapsed_ms = int((time.monotonic() - issued_at) * 1000)
            difficulty_ctl.record(elapsed_ms)

            tx_hash = await asyncio.get_running_loop().run_in_executor(
                None,
                oracle.mint,
                msg.miner_address,
                settings.reward_amount_wei,
                seed,
            )
            await websocket.send_json(
                AckMessage(accepted=True, tx_hash=tx_hash).model_dump()
            )

            # Issue next seed.
            seed = new_seed()
            current_difficulty = difficulty_ctl.next_difficulty()
            await websocket.send_json(
                SeedMessage(
                    seed_hex=seed.hex(),
                    difficulty=current_difficulty,
                    checkpoint_every=settings.checkpoint_every,
                ).model_dump()
            )
            issued_at = time.monotonic()
    except WebSocketDisconnect:
        log.info("miner disconnected")
