//! Sequential hash-chain VDF.
//!
//! state_0 = SHA256(seed)
//! state_i = SHA256(state_{i-1} || i_be_bytes)
//!
//! The round counter is mixed in so that two different seeds cannot
//! collide on a shared subchain, and so that a precomputed rainbow
//! table for one seed has no value against another.

use sha2::{Digest, Sha256};

/// Execute a single VDF iteration: state = SHA256(state || round_be).
/// Mutates `state` in-place.
fn advance_state(state: &mut Vec<u8>, round: u64) {
    let mut hasher = Sha256::new();
    hasher.update(&*state);
    hasher.update(&round.to_be_bytes());
    *state = hasher.finalize().to_vec();
}

/// Run `rounds` iterations of the VDF chain starting from `start_state`
/// (which was produced at round index `start_round`).
///
/// Runs rounds `start_round + 1` through `start_round + rounds` and
/// returns the new state. No checkpoints are emitted.
pub fn run_chain_segment(start_state: &[u8], start_round: u64, rounds: u64) -> Vec<u8> {
    let mut state = start_state.to_vec();
    for i in (start_round + 1)..=(start_round + rounds) {
        advance_state(&mut state, i);
    }
    state
}

/// Runs the chain for `rounds` iterations and returns
/// `(final_state, flattened_checkpoints)`.
///
/// A checkpoint is emitted every `checkpoint_every` rounds (including round 0
/// for the initial state). This lets the verifier spot-check a random slice
/// without re-executing the full chain, giving sub-linear verification cost.
pub fn run_chain(seed: &[u8], rounds: u64, checkpoint_every: u64) -> (Vec<u8>, Vec<u8>) {
    let mut state = Sha256::digest(seed).to_vec();
    let mut checkpoints = Vec::with_capacity(((rounds / checkpoint_every) as usize + 1) * 32);
    checkpoints.extend_from_slice(&state);

    for i in 1..=rounds {
        advance_state(&mut state, i);

        if i % checkpoint_every == 0 {
            checkpoints.extend_from_slice(&state);
        }
    }

    (state, checkpoints)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Sha256;

    #[test]
    fn deterministic() {
        let seed = [0u8; 32];
        let (a, _) = run_chain(&seed, 100, 10);
        let (b, _) = run_chain(&seed, 100, 10);
        assert_eq!(a, b);
    }

    #[test]
    fn different_seeds_diverge() {
        let (a, _) = run_chain(&[0u8; 32], 50, 10);
        let (b, _) = run_chain(&[1u8; 32], 50, 10);
        assert_ne!(a, b);
    }

    #[test]
    fn checkpoints_are_emitted() {
        let (_, cps) = run_chain(&[0u8; 32], 100, 10);
        // initial + 10 intermediates = 11 * 32 = 352 bytes
        assert_eq!(cps.len(), 11 * 32);
    }

    #[test]
    fn chunked_equals_single_run() {
        let seed = [0xABu8; 32];
        let total_rounds: u64 = 100;
        let half = total_rounds / 2;

        // Single continuous run.
        let (expected, _) = run_chain(&seed, total_rounds, total_rounds);

        // Chunked: two sequential segments.
        let state_0 = Sha256::digest(&seed).to_vec();
        let mid = run_chain_segment(&state_0, 0, half);
        let result = run_chain_segment(&mid, half, half);

        assert_eq!(result, expected);
    }

    #[test]
    fn chunked_fidelity_across_many_splits() {
        let seed = [0xCDu8; 32];
        let total: u64 = 97; // prime, so splits don't align evenly
        let (expected, _) = run_chain(&seed, total, total);

        let mut state = Sha256::digest(&seed).to_vec();
        let mut round = 0u64;
        for chunk in &[11, 23, 31, 17, 15] {
            state = run_chain_segment(&state, round, *chunk);
            round += *chunk;
        }
        assert_eq!(state, expected);
        assert_eq!(round, total);
    }
}
