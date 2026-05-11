//! PoHE Wasm core — public bindings exposed to JS.
//!
//! The anti-parallel guarantee lives in [`vdf::run_chain`], which runs a
//! sequential SHA-256 hash chain. Each iteration depends on the previous
//! digest, so the chain cannot be parallelised even across cores.

mod vdf;

use wasm_bindgen::prelude::*;

/// Result of a mining run, serialisable to JS.
#[wasm_bindgen]
pub struct ProofBundle {
    final_state: Vec<u8>,
    checkpoints: Vec<u8>, // flattened: N * 32 bytes
    iterations: u64,
}

#[wasm_bindgen]
impl ProofBundle {
    #[wasm_bindgen(getter)]
    pub fn final_state(&self) -> Vec<u8> {
        self.final_state.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn checkpoints(&self) -> Vec<u8> {
        self.checkpoints.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn iterations(&self) -> u64 {
        self.iterations
    }
}

/// Run the sequential hash chain.
///
/// * `seed` — 32-byte block seed issued by the relay.
/// * `difficulty` — number of iterations.
/// * `checkpoint_every` — emit an intermediate state every N rounds.
#[wasm_bindgen]
pub fn mine(seed: &[u8], difficulty: u64, checkpoint_every: u64) -> Result<ProofBundle, JsError> {
    if seed.len() != 32 {
        return Err(JsError::new("seed must be 32 bytes"));
    }
    if checkpoint_every == 0 {
        return Err(JsError::new("checkpoint_every must be > 0"));
    }

    let (final_state, checkpoints) = vdf::run_chain(seed, difficulty, checkpoint_every);

    Ok(ProofBundle {
        final_state,
        checkpoints,
        iterations: difficulty,
    })
}

/// Run a chunk of the VDF chain starting from a pre-computed state.
///
/// * `start_state` — 32-byte state to resume from (produced at round `start_round`).
/// * `start_round` — the round index that produced `start_state`.
/// * `rounds` — number of additional iterations to run.
///
/// Returns the new state after `rounds` iterations.
///
/// This allows the caller to split a long VDF computation across multiple
/// frames or worker messages without blocking the main thread.
#[wasm_bindgen]
pub fn mine_chunk(start_state: &[u8], start_round: u64, rounds: u64) -> Result<Vec<u8>, JsError> {
    if start_state.len() != 32 {
        return Err(JsError::new("start_state must be 32 bytes"));
    }
    Ok(vdf::run_chain_segment(start_state, start_round, rounds))
}

/// Verify a proof by re-running the chain between two checkpoints.
/// Returns true if the final state matches.
///
/// The relay uses this for spot-checks; a full verifier also lives in Python.
#[wasm_bindgen]
pub fn verify_segment(start_state: &[u8], expected_end: &[u8], rounds: u64) -> bool {
    if start_state.len() != 32 || expected_end.len() != 32 {
        return false;
    }
    let (end, _) = vdf::run_chain(start_state, rounds, rounds.max(1));
    end == expected_end
}
