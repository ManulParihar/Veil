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
    /// The 8 signals in the FROZEN order of INTERFACES §3, as `BytesN<32>` field
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
        v.push_back(self.currency_id.clone());
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

/// THE end-to-end ZK test: a REAL Groth16 proof from the circuit, verified
/// through the REAL BN254 pairing via Soroban's host functions against the REAL
/// baked-in VK. This runs without `mock-verifier`, so it exercises the genuine
/// load-bearing path. A passing assertion here proves: (a) the snarkjs↔host
/// serialization (incl. the G2 c1‖c0 swap) is correct, and (b) the ZK is
/// load-bearing at the contract boundary — flip one public signal and it fails.
#[cfg(test)]
mod real_proof_test {
    extern crate std;
    use super::*;
    use crate::sample_proof::{PROOF_A, PROOF_B, PROOF_C, PUBLIC_SIGNALS};
    use crate::vk::VK;
    use soroban_sdk::{BytesN, Env};

    fn fixture(env: &Env) -> (Proof, PublicSignals) {
        let proof = Proof {
            a: BytesN::from_array(env, &PROOF_A),
            b: BytesN::from_array(env, &PROOF_B),
            c: BytesN::from_array(env, &PROOF_C),
        };
        let s = PublicSignals {
            root: BytesN::from_array(env, &PUBLIC_SIGNALS[0]),
            public_amount: BytesN::from_array(env, &PUBLIC_SIGNALS[1]),
            ext_data_hash: BytesN::from_array(env, &PUBLIC_SIGNALS[2]),
            nullifier0: BytesN::from_array(env, &PUBLIC_SIGNALS[3]),
            nullifier1: BytesN::from_array(env, &PUBLIC_SIGNALS[4]),
            commitment0: BytesN::from_array(env, &PUBLIC_SIGNALS[5]),
            commitment1: BytesN::from_array(env, &PUBLIC_SIGNALS[6]),
            currency_id: BytesN::from_array(env, &PUBLIC_SIGNALS[7]),
        };
        (proof, s)
    }

    #[test]
    fn real_proof_verifies() {
        let env = Env::default();
        let (proof, signals) = fixture(&env);
        assert_eq!(
            verify_real(&env, &VK, &proof, &signals),
            Ok(()),
            "a genuine circuit proof must verify through the real BN254 host path"
        );
    }

    /// The NFR (CLAUDE.md Part 10): on-chain Groth16 verify must fit Soroban's
    /// 100M-instruction budget. Measure the real BN254 host-function verify cost
    /// and assert headroom. Printed with `--nocapture`.
    #[test]
    fn real_verify_fits_instruction_budget() {
        let env = Env::default();
        let (proof, signals) = fixture(&env);
        let before = env.cost_estimate().budget().cpu_instruction_cost();
        let _ = verify_real(&env, &VK, &proof, &signals);
        let used = env.cost_estimate().budget().cpu_instruction_cost() - before;
        std::eprintln!("REAL BN254 Groth16 verify CPU instructions: {used}");
        assert!(
            used < 100_000_000,
            "verify cost {used} exceeds Soroban's 100M instruction budget"
        );
    }

    #[test]
    fn tampered_public_signal_rejected() {
        let env = Env::default();
        let (proof, mut signals) = fixture(&env);
        // Flip a nullifier — the proof no longer attests to these public inputs.
        signals.nullifier0 = BytesN::from_array(&env, &[0x12u8; 32]);
        assert_eq!(
            verify_real(&env, &VK, &proof, &signals),
            Err(Error::ProofInvalid),
            "tampering a public signal MUST fail verification (ZK is load-bearing)"
        );
    }

    /// A corrupted proof whose `A` is no longer a valid curve point is rejected
    /// by a host trap (the `pairing_check` host function validates points are
    /// on-curve / in-subgroup and errors otherwise). In production this rolls
    /// the whole `transact` back — still a rejection, via trap rather than a
    /// clean `ProofInvalid`. We assert the trap to document that path.
    #[test]
    #[should_panic]
    fn corrupted_proof_point_traps() {
        let env = Env::default();
        let (mut proof, signals) = fixture(&env);
        let mut a = PROOF_A;
        a[0] ^= 0x01; // almost certainly off-curve now
        proof.a = BytesN::from_array(&env, &a);
        let _ = verify_real(&env, &VK, &proof, &signals);
    }
}
