"""Runtime configuration, loaded from the monorepo root .env."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Load the monorepo-level .env (one directory up from relay-node/).
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


@dataclass(frozen=True)
class Settings:
    port: int
    difficulty: int
    checkpoint_every: int
    sepolia_rpc_url: str
    relay_private_key: str
    pohe_token_address: str
    reward_amount_wei: int  # per accepted proof

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            port=int(os.getenv("RELAY_PORT", "8080")),
            difficulty=int(os.getenv("RELAY_DIFFICULTY", "1000000")),
            checkpoint_every=int(os.getenv("RELAY_CHECKPOINT_EVERY", "10000")),
            sepolia_rpc_url=os.getenv("SEPOLIA_RPC_URL", ""),
            relay_private_key=os.getenv("RELAY_PRIVATE_KEY", ""),
            pohe_token_address=os.getenv("POHE_TOKEN_ADDRESS", ""),
            # 1 PoHE per block by default.
            reward_amount_wei=int(os.getenv("RELAY_REWARD_WEI", str(10**18))),
        )


settings = Settings.from_env()
