#![no_std]
//! # veil-contract — PLANE 3: the Soroban shielded-pool contract (the authority).
//!
//! Real value is custodied here; private notes exist only as Poseidon
//! commitments in an incremental Merkle tree. Spending publishes nullifiers and
//! a Groth16 proof; the contract verifies, rejects seen nullifiers, inserts the
//! new commitments, and emits encrypted-note events. It trusts nothing it does
//! not verify — the ZK is load-bearing at this boundary.
//!
//! The single state-mutating entry point is [`VeilContract::transact`], which
//! follows strict **validate → verify → effect → emit** ordering (CLAUDE.md
//! Part 5/6): no storage is mutated until the proof has passed, so a later
//! failure can neither grief the user (premature nullifier marking) nor corrupt
//! the tree (premature insert).

extern crate alloc;

mod error;
mod events;
mod merkle;
mod nullifier;
mod poseidon_host;
mod storage;
mod types;
mod verifier;
mod vk;

pub use error::Error;
pub use types::{Config, ExtData, Proof, PublicSignals};

use soroban_sdk::crypto::bn254::Bn254Fr;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

#[contract]
pub struct VeilContract;

#[contractimpl]
impl VeilContract {
    /// One-time setup: record the admin and tree config, precompute the
    /// empty-subtree zeros + frontier, and seed the genesis root so an empty
    /// tree already has a known root. Panics if called twice.
    pub fn init(env: Env, admin: Address, config: Config) {
        if storage::is_initialized(&env) {
            panic!("already initialized");
        }
        storage::set_admin(&env, &admin);
        storage::set_config(&env, &config);
        merkle::init(&env, &config);
        storage::bump_instance(&env);
        storage::bump_tree(&env, &config);
    }

    /// The orchestrator. Strict validate → verify → effect → emit.
    pub fn transact(
        env: Env,
        proof: Proof,
        public_signals: PublicSignals,
        ext_data: ExtData,
    ) -> Result<(), Error> {
        if !storage::is_initialized(&env) {
            return Err(Error::NotInitialized);
        }

        // ── 1. VALIDATE (no mutation) ──
        if !merkle::is_known_root(&env, &public_signals.root) {
            return Err(Error::UnknownRoot);
        }
        // Same note used as both inputs?
        if public_signals.nullifier0 == public_signals.nullifier1 {
            return Err(Error::DuplicateNullifier);
        }
        // Either nullifier already spent?
        if nullifier::is_spent(&env, &public_signals.nullifier0)
            || nullifier::is_spent(&env, &public_signals.nullifier1)
        {
            return Err(Error::NullifierSpent);
        }
        // Front-run binding: recompute extDataHash and compare.
        let computed = hash_ext_data(&env, &ext_data);
        if computed != public_signals.ext_data_hash {
            return Err(Error::ExtDataMismatch);
        }
        // Tree-full pre-check (insert_two re-checks, but fail early & clearly).
        let cfg = storage::config(&env);
        let next = storage::next_leaf_index(&env);
        if next > (1u32 << cfg.levels) - 2 {
            return Err(Error::TreeFull);
        }

        // ── 2. VERIFY (the load-bearing step) ──
        verifier::verify(&env, &proof, &public_signals)?;

        // ── 3. EFFECT (mutate only after the proof passes) ──
        nullifier::mark_spent(&env, &public_signals.nullifier0);
        nullifier::mark_spent(&env, &public_signals.nullifier1);
        let (idx0, idx1) = merkle::insert_two(
            &env,
            &public_signals.commitment0,
            &public_signals.commitment1,
        )?;

        // ── 4. (Phase 2) settle public amount ──
        settle_public_amount(&env, &public_signals.public_amount, &ext_data)?;

        // keep structural state alive
        storage::bump_instance(&env);
        storage::bump_tree(&env, &cfg);

        // ── 5. EMIT (discovery) ──
        let new_root = merkle::current_root(&env);
        events::new_commitment(
            &env,
            &public_signals.commitment0,
            idx0,
            &ext_data.ciphertext0,
            ext_data.view_tag0,
        );
        events::new_commitment(
            &env,
            &public_signals.commitment1,
            idx1,
            &ext_data.ciphertext1,
            ext_data.view_tag1,
        );
        events::nullifier(&env, &public_signals.nullifier0);
        events::nullifier(&env, &public_signals.nullifier1);
        events::transact(&env, &new_root);
        Ok(())
    }

    // ── read-only views (for the SDK to mirror the tree / check spend state) ──

    /// The current (most-recent) Merkle root.
    pub fn current_root(env: Env) -> BytesN<32> {
        merkle::current_root(&env)
    }

    /// Is `root` within the rolling history window?
    pub fn is_known_root(env: Env, root: BytesN<32>) -> bool {
        merkle::is_known_root(&env, &root)
    }

    /// The next leaf index (== number of leaves inserted so far).
    pub fn next_leaf_index(env: Env) -> u32 {
        storage::next_leaf_index(&env)
    }

    /// Has this nullifier been spent?
    pub fn is_spent(env: Env, nullifier: BytesN<32>) -> bool {
        nullifier::is_spent(&env, &nullifier)
    }

    /// The tree config (levels, root_history_size).
    pub fn get_config(env: Env) -> Config {
        storage::config(&env)
    }
}

/// `extDataHash = keccak256( recipient(32) || relayer(32) || fee_be(16) ||
/// len(ct0)_be(4)||ct0 || len(ct1)_be(4)||ct1 || viewTag0(1) || viewTag1(1) )
/// mod r` (INTERFACES §4). Ciphertexts are u32-be length-prefixed; the digest is
/// reduced into the scalar field so it matches the in-circuit public signal.
fn hash_ext_data(env: &Env, ext: &ExtData) -> BytesN<32> {
    let mut buf = Bytes::new(env);
    buf.append(&Bytes::from_array(env, &ext.recipient.to_array()));
    buf.append(&Bytes::from_array(env, &ext.relayer.to_array()));
    buf.append(&Bytes::from_array(env, &ext.fee.to_be_bytes()));
    for ct in [&ext.ciphertext0, &ext.ciphertext1] {
        buf.append(&Bytes::from_array(env, &ct.len().to_be_bytes()));
        buf.append(ct);
    }
    // view tags: 1 byte each (low byte of the u32).
    buf.append(&Bytes::from_array(env, &[ext.view_tag0 as u8]));
    buf.append(&Bytes::from_array(env, &[ext.view_tag1 as u8]));

    let digest = env.crypto().keccak256(&buf);
    // Reduce mod r so it matches the circuit's field-element public input.
    let reduced = Bn254Fr::from_bytes(digest.into());
    reduced.to_bytes()
}

/// Phase-2 marker: settle a signed public amount (deposit pulls tokens in,
/// withdraw releases them to `ExtData.recipient`). Phase 1 always passes
/// `publicAmount = 0`; the conservation equation already enforces that
/// in-circuit.
fn settle_public_amount(
    env: &Env,
    public_amount: &BytesN<32>,
    _ext: &ExtData,
) -> Result<(), Error> {
    let _ = env;
    // Phase 1: must be zero. A non-zero amount is a Phase-2 path that is
    // intentionally not wired yet — reject loudly rather than silently ignore.
    if public_amount.to_array() != [0u8; 32] {
        // Designed-for, not built: token transfer goes here in Phase 2.
        return Err(Error::InsufficientFunds);
    }
    Ok(())
}

#[cfg(test)]
mod sample_proof;
#[cfg(test)]
mod test;
#[cfg(test)]
mod transact_e2e_test;
#[cfg(all(test, not(feature = "mock-verifier")))]
mod transact_fixture;
