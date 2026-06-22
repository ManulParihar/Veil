//! Thin Poseidon `compress` wrapper.
//!
//! This is NOT a reimplementation — it delegates to `poof-crypto`, the single
//! source of Poseidon truth (INTERFACES §0). The contract consumes `poof-crypto`
//! with `default-features = false` so the exact same `light-poseidon` code runs
//! here, in the circuit's witness tooling and in the SDK.
//!
//! Wire boundary: the contract speaks `BytesN<32>` (32-byte big-endian field
//! elements); `poof-crypto` speaks `ark_bn254::Fr`. We convert at this seam.

use soroban_sdk::{BytesN, Env};
use poof_crypto::{compress as fr_compress, fr_from_be_bytes, fr_to_be_bytes, zero_leaf};

/// `Poseidon(left, right)` — the Merkle parent hash. Matches `poof-crypto::compress`.
pub fn compress(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
    let l = fr_from_be_bytes(&left.to_array());
    let r = fr_from_be_bytes(&right.to_array());
    let out = fr_compress(l, r);
    BytesN::from_array(env, &fr_to_be_bytes(&out))
}

/// `Zero(0) = Poseidon(0)` — the empty-leaf value (INTERFACES §0).
pub fn zero_leaf_bytes(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &fr_to_be_bytes(&zero_leaf()))
}
