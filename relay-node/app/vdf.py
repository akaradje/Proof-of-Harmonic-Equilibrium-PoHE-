"""Sequential hash-chain VDF — reference Python implementation.

MUST match the Rust implementation in wasm-core/src/vdf.rs byte-for-byte,
otherwise verification will reject every proof.

    state_0 = SHA256(seed)
    state_i = SHA256(state_{i-1} || big_endian_u64(i))
"""
from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass


def _step(state: bytes, round_index: int) -> bytes:
    h = hashlib.sha256()
    h.update(state)
    h.update(round_index.to_bytes(8, "big"))
    return h.digest()


def run_chain(seed: bytes, rounds: int, checkpoint_every: int) -> tuple[bytes, list[bytes]]:
    """Runs the full chain. Returns (final_state, list_of_checkpoints)."""
    if len(seed) != 32:
        raise ValueError("seed must be 32 bytes")
    if checkpoint_every <= 0:
        raise ValueError("checkpoint_every must be > 0")

    state = hashlib.sha256(seed).digest()
    checkpoints: list[bytes] = [state]
    for i in range(1, rounds + 1):
        state = _step(state, i)
        if i % checkpoint_every == 0:
            checkpoints.append(state)
    return state, checkpoints


def new_seed() -> bytes:
    """32-byte cryptographic seed for a fresh block."""
    return secrets.token_bytes(32)


@dataclass(frozen=True)
class ProofBundle:
    """Matches the payload the miner sends back over WebSocket."""

    seed: bytes
    difficulty: int
    checkpoint_every: int
    final_state: bytes
    checkpoints: list[bytes]  # includes initial state at index 0


def verify(
    proof: ProofBundle,
    *,
    spot_checks: int = 3,
    rng: "secrets.SystemRandom | None" = None,
) -> bool:
    """Verify a proof with random-segment spot-checks.

    Full verification would require re-running all `difficulty` rounds. We
    instead pick `spot_checks` random segments and re-run only those, which
    catches any miner that skipped work with probability ~= 1 - (1 - bad/N)^k.

    Always checks:
      - final_state matches the last checkpoint chain segment
      - first checkpoint is SHA256(seed)
    """
    rng = rng or secrets.SystemRandom()

    if len(proof.seed) != 32 or len(proof.final_state) != 32:
        return False
    if proof.difficulty <= 0 or proof.checkpoint_every <= 0:
        return False

    expected_initial = hashlib.sha256(proof.seed).digest()
    if not proof.checkpoints or proof.checkpoints[0] != expected_initial:
        return False

    # The last checkpoint should land at (n_segments * checkpoint_every),
    # and we replay the tail from there to the final state.
    n_segments = proof.difficulty // proof.checkpoint_every
    if len(proof.checkpoints) != n_segments + 1:
        return False

    # Spot-check random full segments.
    if n_segments == 0:
        return False
    indices = list(range(n_segments))
    rng.shuffle(indices)
    for idx in indices[:spot_checks]:
        start = proof.checkpoints[idx]
        end_expected = proof.checkpoints[idx + 1]
        start_round = idx * proof.checkpoint_every  # rounds already consumed
        state = start
        for i in range(1, proof.checkpoint_every + 1):
            state = _step(state, start_round + i)
        if state != end_expected:
            return False

    # Replay the tail (from last checkpoint to final_state).
    tail_rounds = proof.difficulty - n_segments * proof.checkpoint_every
    state = proof.checkpoints[-1]
    for i in range(1, tail_rounds + 1):
        state = _step(state, n_segments * proof.checkpoint_every + i)
    return state == proof.final_state
