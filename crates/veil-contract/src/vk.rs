//! Groth16 verifying key — PLACEHOLDER.
//!
//! The circuits plane produces `verification_key.json` (snarkjs). A converter
//! will overwrite this module with the real constants. The STRUCT SHAPE and
//! byte layout below are frozen so the real VK drops in cleanly; only the
//! literal bytes change.
//!
//! ## Byte layout (host serialization, INTERFACES §6 / soroban_sdk bn254)
//! * **G1** = 64 bytes = `be(X) || be(Y)`, each coordinate a 32-byte big-endian
//!   base-field element. Point at infinity = 64 zero bytes.
//! * **G2** = 128 bytes = `be(X) || be(Y)`, each coordinate an Fp2 element of 64
//!   bytes. **Fp2 host encoding is `be(c1) || be(c0)`** — imaginary part FIRST.
//!
//! ## ⚠️ G2 coordinate ordering — INTEGRATION TODO (confirm against snarkjs)
//! snarkjs `verification_key.json` lists each G2 coordinate as `[c0, c1]`
//! (real-part-first). The Soroban host expects `[c1, c0]` (imaginary-part-first,
//! per the bn254 module doc-comment). Therefore the snarkjs→`vk.rs` converter
//! MUST SWAP the two 32-byte halves of every G2 Fp2 coordinate, i.e. emit
//! `be(c1) || be(c0)` for each of beta_g2.X, beta_g2.Y, gamma_g2.{X,Y},
//! delta_g2.{X,Y} and the proof's `b`. This placeholder uses all-zero points so
//! it cannot disguise an ordering bug — the real VK must be generated with the
//! swap applied, and the first real proof in `tests/` is the canary.
//!
//! The number of `ic` entries MUST equal `num_public_signals + 1` = 7 + 1 = 8.

/// Number of public signals the circuit exposes (INTERFACES §3). `IC` has
/// `NUM_PUBLIC + 1` points.
pub const NUM_PUBLIC: usize = 7;

/// The verifying key, as raw host-serialized point bytes.
pub struct Vk {
    /// `alpha_g1` — G1 (64 bytes).
    pub alpha_g1: [u8; 64],
    /// `beta_g2` — G2 (128 bytes).
    pub beta_g2: [u8; 128],
    /// `gamma_g2` — G2 (128 bytes).
    pub gamma_g2: [u8; 128],
    /// `delta_g2` — G2 (128 bytes).
    pub delta_g2: [u8; 128],
    /// `IC[0..=NUM_PUBLIC]` — `NUM_PUBLIC + 1` G1 points (64 bytes each).
    pub ic: [[u8; 64]; NUM_PUBLIC + 1],
}

/// The placeholder VK: all points are the point-at-infinity (zero bytes).
///
/// This is deliberately invalid for any real proof — every edge-case test uses
/// the `mock-verifier` path, and the real-pairing test in `verifier.rs` is
/// `#[ignore]`d until the genuine VK + a circuit proof are dropped in.
pub const VK: Vk = Vk {
    alpha_g1: [0u8; 64],
    beta_g2: [0u8; 128],
    gamma_g2: [0u8; 128],
    delta_g2: [0u8; 128],
    ic: [[0u8; 64]; NUM_PUBLIC + 1],
};
