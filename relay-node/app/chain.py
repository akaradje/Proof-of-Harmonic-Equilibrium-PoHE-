"""Thin wrapper around web3.py that calls PoHEToken.mintReward()."""
from __future__ import annotations

import logging
from typing import Protocol

from eth_account import Account
from web3 import Web3

log = logging.getLogger(__name__)

# Minimal ABI — only what the relay needs.
POHE_TOKEN_ABI = [
    {
        "inputs": [
            {"internalType": "address", "name": "miner", "type": "address"},
            {"internalType": "uint256", "name": "amount", "type": "uint256"},
            {"internalType": "bytes32", "name": "seed", "type": "bytes32"},
        ],
        "name": "mintReward",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    }
]


class MintOracle(Protocol):
    def mint(self, miner: str, amount: int, seed: bytes) -> str | None: ...


class Web3MintOracle:
    def __init__(
        self,
        rpc_url: str,
        private_key: str,
        token_address: str,
        *,
        chain_id: int = 11155111,
    ) -> None:
        if not (rpc_url and private_key and token_address):
            raise RuntimeError("rpc_url, private_key, and token_address are required")
        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        # Inject PoA middleware — the API changed in web3 v7.
        try:
            from web3.middleware import ExtraDataToPOAMiddleware  # web3 >= 7
            self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
        except ImportError:
            from web3.middleware import geth_poa_middleware  # web3 6.x
            self.w3.middleware_onion.inject(geth_poa_middleware, layer=0)
        self.account = Account.from_key(private_key)
        self.chain_id = chain_id
        self.contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(token_address),
            abi=POHE_TOKEN_ABI,
        )

    def mint(self, miner: str, amount: int, seed: bytes) -> str | None:
        if len(seed) != 32:
            raise ValueError("seed must be 32 bytes")

        nonce = self.w3.eth.get_transaction_count(self.account.address)
        tx = self.contract.functions.mintReward(
            Web3.to_checksum_address(miner), amount, seed
        ).build_transaction(
            {
                "from": self.account.address,
                "nonce": nonce,
                "chainId": self.chain_id,
                # Leave gas params to provider defaults for MVP.
            }
        )
        signed = self.account.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        tx_hash = self.w3.eth.send_raw_transaction(raw)
        log.info("minted reward tx=%s miner=%s amount=%d", tx_hash.hex(), miner, amount)
        return tx_hash.hex()


class LoggingMintOracle:
    """Dev-mode oracle: logs instead of hitting Sepolia."""

    def mint(self, miner: str, amount: int, seed: bytes) -> str | None:
        log.info("DEV MINT miner=%s amount=%d seed=%s", miner, amount, seed.hex())
        return None
