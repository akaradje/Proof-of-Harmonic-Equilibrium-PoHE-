"""Round-trip: run the chain, then verify the bundle. Ensures the verifier
accepts honest proofs and rejects tampered ones."""
from __future__ import annotations

from app.vdf import ProofBundle, run_chain, verify


def _honest_proof(seed: bytes, difficulty: int, cp_every: int) -> ProofBundle:
    final, checkpoints = run_chain(seed, difficulty, cp_every)
    return ProofBundle(
        seed=seed,
        difficulty=difficulty,
        checkpoint_every=cp_every,
        final_state=final,
        checkpoints=checkpoints,
    )


def test_accepts_honest_proof() -> None:
    proof = _honest_proof(b"\x00" * 32, 1000, 100)
    assert verify(proof) is True


def test_rejects_wrong_final_state() -> None:
    proof = _honest_proof(b"\x00" * 32, 1000, 100)
    tampered = ProofBundle(
        seed=proof.seed,
        difficulty=proof.difficulty,
        checkpoint_every=proof.checkpoint_every,
        final_state=b"\xff" * 32,
        checkpoints=proof.checkpoints,
    )
    assert verify(tampered) is False


def test_rejects_tampered_checkpoint() -> None:
    proof = _honest_proof(b"\x01" * 32, 1000, 100)
    bad_cps = list(proof.checkpoints)
    bad_cps[5] = b"\xaa" * 32
    tampered = ProofBundle(
        seed=proof.seed,
        difficulty=proof.difficulty,
        checkpoint_every=proof.checkpoint_every,
        final_state=proof.final_state,
        checkpoints=bad_cps,
    )
    # spot_checks=10 to ensure we hit the tampered segment deterministically
    assert verify(tampered, spot_checks=10) is False
