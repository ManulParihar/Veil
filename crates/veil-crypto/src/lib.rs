//! # veil-crypto — PLANE 1: the single source of Poseidon truth
//!
//! The one thing that MUST be bit-identical across the circuit (`circuits/`),
//! the contract (`veil-contract`) and the client (`veil-sdk`): the Poseidon
//! hash and the note/nullifier derivations built on top of it. If this logic
//! lived in three places you would have three subtly different hashes and a
//! system that silently does not work.
//!
//! ## Hash choice (locked, verified)
//!
//! Original **Poseidon over BN254**, circomlib-compatible, via the audited
//! [`light_poseidon`] crate. `light_poseidon::Poseidon::new_circom(n)` is
//! bit-identical to circom's `Poseidon(n)` template from `circomlib`. This is
//! the make-or-break integration seam and it is asserted in `tests/cross_impl.rs`
//! against the canonical vector `Poseidon([1,2]) =
//! 7853200120776062878684798364095072458815029376092732009249414926327459813530`.
//!
//! CLAUDE.md's stated preference was Poseidon2-BN254. We deliberately ship the
//! original circomlib Poseidon for the MVP because it is the lowest-risk way to
//! guarantee the cross-impl gate passes (battle-tested circom template + audited
//! Rust impl), per CLAUDE.md's own scope-discipline rule: "cut features before
//! cutting the integration test." Poseidon2 is a drop-in optimisation later.
//!
//! Everything here is `no_std`-compatible so the Soroban contract consumes the
//! exact same code (depend with `default-features = false`).

#![cfg_attr(not(feature = "std"), no_std)]

pub mod field;
pub mod note;
pub mod poseidon;
mod poseidon_constants;

pub use ark_bn254::Fr;
pub use field::{fr_from_be_bytes, fr_from_u64, fr_to_be_bytes};
pub use note::{Keypair, Note, Seed};
pub use poseidon::{compress, hash1, hash2, hash3, hash4, hashn, zero_leaf};
