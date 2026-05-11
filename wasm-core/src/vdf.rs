//! Sequential hash-chain VDF.
//!
//! state_0 = SHA256(seed)
//! state_i = SHA256(state_{i-1} || i_be_bytes)
//!
//! The round counter is mixed in so that two different seeds cannot
//! collide on a shared subchain, and so that a precomputed rainbow
//! table for one seed has no value against another.

use sha2::{Digest, Sha256};

/// Runs the chain for `rounds` iterations and returns
/// `(final_state, flattened_checkpoints)`.
///
/// A checkpoint is emitted every `checkpoint_every` rounds (including round 0
/// for the initial state). This lets the verifier spot-check a random slice
/// without re-executing the full chain, giving sub-linear verification cost.
pub fn run_chain(seed: &[u8], rounds: u64, checkpoint_every: u64) -> (Vec<u8>, Vec<u8>) {
    let mut state = Sha256::digest(seed).to_vec();
    let mut checkpoints = Vec::with_capacity(
        ((rounds / checkpoint_every) as usize + 1) * 32,
    );
    checkpoints.extend_from_slice(&state);

    for i in 1..=rounds {
        let mut hasher = Sha256::new();
        hasher.update(&state);
        hasher.update(&i.to_be_bytes());
        state = hasher.finalize().to_vec();

        if i % checkpoint_every == 0 {
            checkpoints.extend_from_slice(&state);
        }
    }

    (state, checkpoints)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
