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
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env, MuxedAddress};

#[contract]
pub struct VeilContract;

#[contractimpl]
impl VeilContract {
    /// One-time setup: record the admin and tree config, precompute the
    /// empty-subtree zeros + frontier, and seed the genesis root so an empty
    /// tree already has a known root. Panics if called twice.
    pub fn init(env: Env, admin: Address, config: Config, token: Address) {
        if storage::is_initialized(&env) {
            panic!("already initialized");
        }
        storage::set_admin(&env, &admin);
        storage::set_config(&env, &config);
        storage::set_token(&env, &token); // Phase-2 settlement asset (native XLM SAC)
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
    // settlement address (Phase 2), bound via its strkey so a withdraw recipient
    // cannot be redirected: u32-be length || strkey bytes.
    let addr_str = ext.settlement_address.to_string();
    let len = addr_str.len() as usize;
    let mut sbuf = [0u8; 64]; // strkey is ≤ 56 chars
    addr_str.copy_into_slice(&mut sbuf[..len]);
    buf.append(&Bytes::from_array(env, &(len as u32).to_be_bytes()));
    buf.append(&Bytes::from_slice(env, &sbuf[..len]));

    let digest = env.crypto().keccak256(&buf);
    // Reduce mod r so it matches the circuit's field-element public input.
    let reduced = Bn254Fr::from_bytes(digest.into());
    reduced.to_bytes()
}

/// BN254 scalar field modulus `r`, big-endian — used to recover a withdraw's
/// magnitude from a field-negative `publicAmount` (`amount = r - publicAmount`).
pub(crate) const R_BE: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

enum Settlement {
    None,
    Deposit(i128),
    Withdraw(i128),
}

/// `a - b` for 32-byte big-endian integers (caller guarantees `a >= b`).
pub(crate) fn sub_be(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut borrow: i16 = 0;
    for i in (0..32).rev() {
        let mut d = a[i] as i16 - b[i] as i16 - borrow;
        if d < 0 {
            d += 256;
            borrow = 1;
        } else {
            borrow = 0;
        }
        out[i] = d as u8;
    }
    out
}

fn low_u64(b: &[u8; 32]) -> u64 {
    let mut a8 = [0u8; 8];
    a8.copy_from_slice(&b[24..32]);
    u64::from_be_bytes(a8)
}

/// Decode the signed `publicAmount` field element: `0` → transfer; a value below
/// `2^64` → deposit of that magnitude; a value within `2^64` of `r` (i.e.
/// `r - amount`) → withdraw. Anything else is out of the valid amount range.
fn decode_public_amount(pa: &BytesN<32>) -> Result<Settlement, Error> {
    let b = pa.to_array();
    if b == [0u8; 32] {
        return Ok(Settlement::None);
    }
    if b[..24].iter().all(|&x| x == 0) {
        return Ok(Settlement::Deposit(low_u64(&b) as i128));
    }
    let neg = sub_be(&R_BE, &b); // r - publicAmount = withdraw magnitude
    if neg[..24].iter().all(|&x| x == 0) {
        return Ok(Settlement::Withdraw(low_u64(&neg) as i128));
    }
    Err(Error::InsufficientFunds)
}

/// Settle a signed public amount against the configured Stellar Asset Contract.
/// DEPOSIT pulls `amount` from `ExtData.settlement_address` (the SAC enforces the
/// depositor's auth); WITHDRAW releases `amount` from the pool's own custody to
/// `ExtData.settlement_address` (bound into `extDataHash`). Runs LAST so a failed
/// transfer atomically reverts the whole `transact`. Value conservation is
/// already enforced in-circuit, so the moved asset matches the note delta.
fn settle_public_amount(
    env: &Env,
    public_amount: &BytesN<32>,
    ext: &ExtData,
) -> Result<(), Error> {
    match decode_public_amount(public_amount)? {
        Settlement::None => {}
        Settlement::Deposit(amount) => {
            let token = TokenClient::new(env, &storage::token(env));
            let pool = env.current_contract_address();
            token.transfer(&ext.settlement_address, &MuxedAddress::from(&pool), &amount);
        }
        Settlement::Withdraw(amount) => {
            let token = TokenClient::new(env, &storage::token(env));
            let pool = env.current_contract_address();
            token.transfer(&pool, &MuxedAddress::from(&ext.settlement_address), &amount);
        }
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
