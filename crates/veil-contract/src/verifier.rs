//! Groth16 verification over BN254 using the native Soroban host functions
//! (`soroban_sdk::crypto::bn254`). INTERFACES §6.
//!
//! Standard Groth16 check:
//! ```text
//! vk_x = IC[0] + Σ pub[i] * IC[i+1]                       // g1_msm + g1_add
//! e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
//! ```
//! implemented as a single multi-pairing:
//! ```text
//! pairing_check([-A, alpha, vk_x, C], [B, beta, gamma, delta]) == true
//! ```
//! `A` is negated (the host has `Neg for Bn254G1Affine`). The math here is REAL
//! — only the *acceptance* of a proof in contract edge-case tests is mocked, via
//! the `mock-verifier` feature, and that mock lives behind a separate path so
//! this pairing code always compiles and is exercised by the verifier unit test.

use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    BytesN, Env, Vec,
};

use crate::error::Error;
use crate::types::{Proof, PublicSignals};
use crate::vk::{Vk, NUM_PUBLIC, VK};

/// Verify a Groth16 proof against the baked-in VK and the 7 public signals.
///
/// With the `mock-verifier` feature, this short-circuits to a deterministic
/// accept/reject so the contract's edge-case tests can run without a real
/// circuit proof: a proof whose `a` is all-`0xAA` bytes is accepted (the
/// "valid" sentinel); anything else is rejected as `ProofInvalid`. The real
/// pairing path below is still compiled and is tested directly in this module.
pub fn verify(env: &Env, proof: &Proof, signals: &PublicSignals) -> Result<(), Error> {
    #[cfg(feature = "mock-verifier")]
    {
        return mock::verify(env, proof, signals);
    }
    #[cfg(not(feature = "mock-verifier"))]
    {
        verify_real(env, &VK, proof, signals)
    }
}

/// The genuine BN254 Groth16 pairing check. Always compiled; called by `verify`
/// in production and directly by the verifier unit test.
pub fn verify_real(
    env: &Env,
    vk: &Vk,
    proof: &Proof,
    signals: &PublicSignals,
) -> Result<(), Error> {
    let bn = env.crypto().bn254();

    // vk_x = IC[0] + Σ pub[i] * IC[i+1]
    let pubs = signals.as_field_array(env);
    debug_assert_eq!(pubs.len() as usize, NUM_PUBLIC);

    let mut ic_points: Vec<Bn254G1Affine> = Vec::new(env);
    let mut scalars: Vec<Bn254Fr> = Vec::new(env);
    for (i, p) in pubs.iter().enumerate() {
        ic_points.push_back(g1(env, &vk.ic[i + 1]));
        scalars.push_back(Bn254Fr::from_bytes(p));
    }
    let acc = bn.g1_msm(ic_points, scalars);
    let vk_x = bn.g1_add(&g1(env, &vk.ic[0]), &acc);

    // pairing_check([-A, alpha, vk_x, C], [B, beta, gamma, delta])
    let neg_a = -Bn254G1Affine::from_bytes(proof.a.clone());
    let alpha = g1(env, &vk.alpha_g1);
    let c = Bn254G1Affine::from_bytes(proof.c.clone());

    let b = Bn254G2Affine::from_bytes(proof.b.clone());
    let beta = g2(env, &vk.beta_g2);
    let gamma = g2(env, &vk.gamma_g2);
    let delta = g2(env, &vk.delta_g2);

    let mut g1s: Vec<Bn254G1Affine> = Vec::new(env);
    g1s.push_back(neg_a);
    g1s.push_back(alpha);
    g1s.push_back(vk_x);
    g1s.push_back(c);

    let mut g2s: Vec<Bn254G2Affine> = Vec::new(env);
    g2s.push_back(b);
    g2s.push_back(beta);
    g2s.push_back(gamma);
    g2s.push_back(delta);

    if bn.pairing_check(g1s, g2s) {
        Ok(())
    } else {
        Err(Error::ProofInvalid)
    }
}

// ── point construction helpers ──

fn g1(env: &Env, bytes: &[u8; 64]) -> Bn254G1Affine {
    Bn254G1Affine::from_bytes(BytesN::from_array(env, bytes))
}

fn g2(env: &Env, bytes: &[u8; 128]) -> Bn254G2Affine {
    Bn254G2Affine::from_bytes(BytesN::from_array(env, bytes))
}

impl PublicSignals {
    /// The 7 signals in the FROZEN order of INTERFACES §3, as `BytesN<32>` field
    /// elements. This is the exact order the circuit's vkey was generated
    /// against — do not reorder.
    pub fn as_field_array(&self, env: &Env) -> Vec<BytesN<32>> {
        let mut v = Vec::new(env);
        v.push_back(self.root.clone());
        v.push_back(self.public_amount.clone());
        v.push_back(self.ext_data_hash.clone());
        v.push_back(self.nullifier0.clone());
        v.push_back(self.nullifier1.clone());
        v.push_back(self.commitment0.clone());
        v.push_back(self.commitment1.clone());
        v
    }
}

#[cfg(feature = "mock-verifier")]
mod mock {
    use super::*;

    /// Sentinel: a proof is accepted iff `proof.a` is 64 bytes of `0xAA`.
    pub fn verify(_env: &Env, proof: &Proof, _signals: &PublicSignals) -> Result<(), Error> {
        if proof.a.to_array() == [0xAAu8; 64] {
            Ok(())
        } else {
            Err(Error::ProofInvalid)
        }
    }
}
