//! Poseidon wrappers (circomlib-compatible, BN254).
//!
//! `new_circom(width)` selects the circomlib parameter set for `width` inputs.
//! We only need widths 1, 2 and 3 for Veil:
//!   * width 1 — public key derivation `pk = Poseidon(sk)`
//!   * width 2 — Merkle parent `compress(l, r)` and key derivation
//!   * width 3 — commitment, signature and nullifier

use ark_bn254::Fr;
use light_poseidon::{Poseidon, PoseidonHasher};

/// Hash an arbitrary-width input vector with the circomlib parameter set for
/// that width. Panics on unsupported widths (1..=12) — callers use 1/2/3.
pub fn hashn(inputs: &[Fr]) -> Fr {
    let mut p = Poseidon::<Fr>::new_circom(inputs.len())
        .expect("unsupported poseidon width");
    p.hash(inputs).expect("poseidon hash failed")
}

/// `Poseidon(a)` — single input (public-key derivation).
pub fn hash1(a: Fr) -> Fr {
    hashn(&[a])
}

/// `Poseidon(a, b)` — two inputs (Merkle parent / key derivation).
pub fn hash2(a: Fr, b: Fr) -> Fr {
    hashn(&[a, b])
}

/// `Poseidon(a, b, c)` — three inputs (commitment / signature / nullifier).
pub fn hash3(a: Fr, b: Fr, c: Fr) -> Fr {
    hashn(&[a, b, c])
}

/// Merkle parent hash. Identical to `hash2`, named for intent at call sites and
/// matching the contract's `poseidon_host::compress`.
pub fn compress(left: Fr, right: Fr) -> Fr {
    hash2(left, right)
}

/// The empty-leaf value `Zero(0)`. Defined as `Poseidon(0)` so it is a fixed,
/// non-trivial field element that real commitments (themselves Poseidon
/// outputs) will never collide with by construction. The contract precomputes
/// `Zero(i+1) = compress(Zero(i), Zero(i))` from this seed; the SDK uses the
/// same value when reconstructing the frontier, so both derive identical roots.
pub fn zero_leaf() -> Fr {
    hash1(Fr::from(0u64))
}
