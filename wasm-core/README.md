# wasm-core

Rust crate that compiles to WebAssembly and provides PoHE's sequential VDF.

## Build

```bash
# Requires: rustup, wasm-pack (cargo install wasm-pack)
wasm-pack build --target web --out-dir ../client/src/wasm/pkg
```

Output is imported by `client/src/wasm/miner.worker.ts`.

## Test

```bash
cargo test
```

## Design notes

- **Single-threaded.** No `rayon`, no wasm threads, no `SharedArrayBuffer`.
  The sequential dependency is the anti-ASIC / anti-parallel guarantee.
- **Checkpoints.** `mine()` returns intermediate states every `checkpoint_every`
  rounds so the relay can verify a random slice rather than replaying the full
  chain.
- **Round index mixed in.** Each `SHA256` call includes the big-endian round
  number, preventing cross-seed rainbow reuse.
