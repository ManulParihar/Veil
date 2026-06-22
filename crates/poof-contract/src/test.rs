//! Contract-level edge-case tests.
//!
//! These run under the `mock-verifier` feature so we can exercise the full
//! `transact` orchestration — validation order, double-spend, stale root,
//! duplicate nullifier, extData binding, tree-full, and the Merkle frontier /
//! root-ring correctness — without a real Groth16 proof from the circuit. The
//! real BN254 pairing path is compiled unconditionally and is checked by the
//! verifier unit test (`tests/verifier.rs`); only the *acceptance* of a proof is
//! mocked here, never the pairing math.
//!
//! Mock convention (see `verifier::mock`): a proof with `a == [0xAA; 64]` is
//! accepted; anything else is `ProofInvalid`.

#![cfg(all(test, feature = "mock-verifier"))]

extern crate std;
use std::vec::Vec as StdVec;

use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env,
};

use crate::{Config, Error, ExtData, Proof, PublicSignals, PoofContract, PoofContractClient};

const LEVELS: u32 = 20;
const ROOT_HISTORY: u32 = 64;

// ── harness ──────────────────────────────────────────────────────────────

struct Harness {
    env: Env,
    client: PoofContractClient<'static>,
    pool: Address,
    token_admin: StellarAssetClient<'static>,
    token: TokenClient<'static>,
}

fn setup() -> Harness {
    let env = Env::default();
    // the depositor authorizes the token.transfer as a NON-root sub-invocation
    // under `transact`, so we must allow non-root auth in tests.
    env.mock_all_auths_allowing_non_root_auth();
    let contract_id = env.register(PoofContract, ());
    let client = PoofContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    // a test Stellar Asset Contract to stand in for native XLM
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = sac.address();
    client.init(
        &admin,
        &Config { levels: LEVELS, root_history_size: ROOT_HISTORY },
        &token_id,
    );
    let token_admin = StellarAssetClient::new(&env, &token_id);
    let token = TokenClient::new(&env, &token_id);
    Harness { env, client, pool: contract_id, token_admin, token }
}

fn bn(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

/// A field element from a small u64 (big-endian, like the SDK encodes amounts).
fn fe(env: &Env, v: u64) -> BytesN<32> {
    let mut a = [0u8; 32];
    a[24..].copy_from_slice(&v.to_be_bytes());
    BytesN::from_array(env, &a)
}

/// The "valid proof" sentinel for the mock verifier.
fn valid_proof(env: &Env) -> Proof {
    Proof {
        a: BytesN::from_array(env, &[0xAA; 64]),
        b: BytesN::from_array(env, &[0u8; 128]),
        c: BytesN::from_array(env, &[0u8; 64]),
    }
}

/// An empty ExtData (default identities, no ciphertexts). The caller fills in
/// the matching `ext_data_hash` on the signals via `with_ext_hash`.
fn empty_ext(env: &Env) -> ExtData {
    ext_with_settlement(env, &Address::generate(env))
}

fn ext_with_settlement(env: &Env, settlement: &Address) -> ExtData {
    ExtData {
        recipient: bn(env, 0),
        relayer: bn(env, 0),
        fee: 0,
        ciphertext0: Bytes::new(env),
        ciphertext1: Bytes::new(env),
        view_tag0: 0,
        view_tag1: 0,
        settlement_address: settlement.clone(),
    }
}

/// extDataHash via the contract's own logic — no replica to drift.
fn ext_data_hash(env: &Env, ext: &ExtData) -> BytesN<32> {
    crate::hash_ext_data(env, ext)
}

/// Build well-formed signals for a transfer against `root`, with the given
/// distinct nullifiers and output commitments, binding `ext`. Uses currency 0
/// (the init token), which every harness registers at `init`.
fn signals(
    env: &Env,
    root: &BytesN<32>,
    ext: &ExtData,
    nf0: u8,
    nf1: u8,
    cm0: u8,
    cm1: u8,
) -> PublicSignals {
    signals_cur(env, root, ext, nf0, nf1, cm0, cm1, 0)
}

/// As [`signals`], but for an explicit `currency_id`.
#[allow(clippy::too_many_arguments)]
fn signals_cur(
    env: &Env,
    root: &BytesN<32>,
    ext: &ExtData,
    nf0: u8,
    nf1: u8,
    cm0: u8,
    cm1: u8,
    currency_id: u32,
) -> PublicSignals {
    PublicSignals {
        root: root.clone(),
        public_amount: bn(env, 0),
        ext_data_hash: ext_data_hash(env, ext),
        nullifier0: bn(env, nf0),
        nullifier1: bn(env, nf1),
        commitment0: fe(env, cm0 as u64 + 1000),
        commitment1: fe(env, cm1 as u64 + 2000),
        currency_id: fe(env, currency_id as u64),
    }
}

// ── tests ──────────────────────────────────────────────────────────────────

/// init seeds a non-zero genesis root, an empty leaf count, and a config.
#[test]
fn init_seeds_genesis_root() {
    let h = setup();
    let root = h.client.current_root();
    assert_ne!(root.to_array(), [0u8; 32], "genesis root must be non-zero");
    assert!(h.client.is_known_root(&root), "genesis root must be known");
    assert_eq!(h.client.next_leaf_index(), 0);
    let cfg = h.client.get_config();
    assert_eq!(cfg.levels, LEVELS);
    assert_eq!(cfg.root_history_size, ROOT_HISTORY);
}

/// Happy path: a valid 2-out transfer inserts two leaves, advances the root,
/// and marks both nullifiers spent.
#[test]
fn happy_path_inserts_and_advances() {
    let h = setup();
    let root0 = h.client.current_root();
    let ext = empty_ext(&h.env);
    let sig = signals(&h.env, &root0, &ext, 1, 2, 3, 4);

    h.client.transact(&valid_proof(&h.env), &sig, &ext);

    assert_eq!(h.client.next_leaf_index(), 2, "two leaves inserted");
    let root1 = h.client.current_root();
    assert_ne!(root1, root0, "root advanced");
    assert!(h.client.is_known_root(&root1), "new root known");
    assert!(h.client.is_known_root(&root0), "old root still in window");
    assert!(h.client.is_spent(&bn(&h.env, 1)));
    assert!(h.client.is_spent(&bn(&h.env, 2)));
}

/// Double-spend: reusing a spent nullifier in a later tx is rejected.
#[test]
fn double_spend_rejected() {
    let h = setup();
    let ext = empty_ext(&h.env);
    let root0 = h.client.current_root();
    let s1 = signals(&h.env, &root0, &ext, 1, 2, 3, 4);
    h.client.transact(&valid_proof(&h.env), &s1, &ext);

    // Reuse nullifier 1 against the new root.
    let root1 = h.client.current_root();
    let s2 = signals(&h.env, &root1, &ext, 1, 9, 5, 6);
    let err = h
        .client
        .try_transact(&valid_proof(&h.env), &s2, &ext)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::NullifierSpent);
    // State unchanged by the rejected tx.
    assert_eq!(h.client.next_leaf_index(), 2);
}

/// Stale / unknown root: a proof against a root never in the window is rejected,
/// with no mutation.
#[test]
fn unknown_root_rejected() {
    let h = setup();
    let ext = empty_ext(&h.env);
    let bogus = bn(&h.env, 0x77);
    let s = signals(&h.env, &bogus, &ext, 1, 2, 3, 4);
    let err = h
        .client
        .try_transact(&valid_proof(&h.env), &s, &ext)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::UnknownRoot);
    assert_eq!(h.client.next_leaf_index(), 0, "no mutation on reject");
}

/// Duplicate nullifier: the same note used as both inputs is rejected.
#[test]
fn duplicate_nullifier_rejected() {
    let h = setup();
    let ext = empty_ext(&h.env);
    let root0 = h.client.current_root();
    let s = signals(&h.env, &root0, &ext, 7, 7, 3, 4);
    let err = h
        .client
        .try_transact(&valid_proof(&h.env), &s, &ext)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::DuplicateNullifier);
}

/// extDataHash mismatch: if the bound ExtData doesn't match the signal's hash
/// (a relayer tampering with recipient/fee/ciphertext), reject.
#[test]
fn ext_data_mismatch_rejected() {
    let h = setup();
    let root0 = h.client.current_root();
    let ext = empty_ext(&h.env);
    // Build signals bound to `ext`, then submit with a *different* ExtData.
    let s = signals(&h.env, &root0, &ext, 1, 2, 3, 4);
    let mut tampered = empty_ext(&h.env);
    tampered.fee = 999; // changes the hash
    let err = h
        .client
        .try_transact(&valid_proof(&h.env), &s, &tampered)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::ExtDataMismatch);
    assert_eq!(h.client.next_leaf_index(), 0);
}

/// Invalid proof: a non-sentinel proof fails the (mock) verifier — and crucially
/// nothing is mutated, proving verify precedes effect.
#[test]
fn invalid_proof_rejected_before_effect() {
    let h = setup();
    let root0 = h.client.current_root();
    let ext = empty_ext(&h.env);
    let s = signals(&h.env, &root0, &ext, 1, 2, 3, 4);
    let bad = Proof {
        a: BytesN::from_array(&h.env, &[0x11; 64]), // not the sentinel
        b: BytesN::from_array(&h.env, &[0u8; 128]),
        c: BytesN::from_array(&h.env, &[0u8; 64]),
    };
    let err = h.client.try_transact(&bad, &s, &ext).err().unwrap().unwrap();
    assert_eq!(err, Error::ProofInvalid);
    // Ordering proof: nullifiers NOT marked, no leaves inserted.
    assert!(!h.client.is_spent(&bn(&h.env, 1)));
    assert!(!h.client.is_spent(&bn(&h.env, 2)));
    assert_eq!(h.client.next_leaf_index(), 0);
}

/// `publicAmount = r - v` encodes a withdraw of `v`.
fn neg_fe(env: &Env, v: u64) -> BytesN<32> {
    let mut vb = [0u8; 32];
    vb[24..].copy_from_slice(&v.to_be_bytes());
    BytesN::from_array(env, &crate::sub_be(&crate::R_BE, &vb))
}

/// DEPOSIT (publicAmount > 0) pulls real tokens from the depositor into the pool.
#[test]
fn deposit_pulls_tokens_into_pool() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    h.token_admin.mint(&depositor, &1000);

    let ext = ext_with_settlement(&h.env, &depositor);
    let mut s = signals(&h.env, &h.client.current_root(), &ext, 1, 2, 3, 4);
    s.public_amount = fe(&h.env, 100); // deposit 100
    h.client.transact(&valid_proof(&h.env), &s, &ext);

    assert_eq!(h.token.balance(&depositor), 900, "100 pulled from depositor");
    assert_eq!(h.token.balance(&h.pool), 100, "pool custodies 100");
    assert_eq!(h.client.next_leaf_index(), 2, "output notes inserted");
}

/// WITHDRAW (publicAmount = r - v) releases real tokens from the pool to the
/// recipient bound in ExtData.
#[test]
fn withdraw_releases_tokens_from_pool() {
    let h = setup();
    let depositor = Address::generate(&h.env);
    h.token_admin.mint(&depositor, &1000);

    // fund the pool: deposit 100
    let ext_d = ext_with_settlement(&h.env, &depositor);
    let mut sd = signals(&h.env, &h.client.current_root(), &ext_d, 1, 2, 3, 4);
    sd.public_amount = fe(&h.env, 100);
    h.client.transact(&valid_proof(&h.env), &sd, &ext_d);
    assert_eq!(h.token.balance(&h.pool), 100);

    // withdraw 40 to a fresh recipient
    let recipient = Address::generate(&h.env);
    let ext_w = ext_with_settlement(&h.env, &recipient);
    let mut sw = signals(&h.env, &h.client.current_root(), &ext_w, 5, 6, 7, 8);
    sw.public_amount = neg_fe(&h.env, 40);
    h.client.transact(&valid_proof(&h.env), &sw, &ext_w);

    assert_eq!(h.token.balance(&recipient), 40, "recipient received 40");
    assert_eq!(h.token.balance(&h.pool), 60, "pool retains 60");
}

/// A withdraw larger than the pool's custody fails (the token transfer reverts
/// the whole transact).
#[test]
#[should_panic]
fn withdraw_beyond_custody_reverts() {
    let h = setup();
    let recipient = Address::generate(&h.env);
    let ext = ext_with_settlement(&h.env, &recipient);
    let mut s = signals(&h.env, &h.client.current_root(), &ext, 1, 2, 3, 4);
    s.public_amount = neg_fe(&h.env, 50); // pool holds 0
    h.client.transact(&valid_proof(&h.env), &s, &ext);
}

/// The Merkle root after a fixed insert sequence is deterministic and
/// reproducible — the SDK must be able to mirror it. We assert that the same
/// inputs from a fresh contract yield the identical root.
#[test]
fn merkle_root_is_deterministic() {
    let run = || {
        let h = setup();
        let ext = empty_ext(&h.env);
        // three transfers, distinct nullifiers each time
        for i in 0..3u8 {
            let root = h.client.current_root();
            let s = signals(
                &h.env,
                &root,
                &ext,
                10 + i * 2,
                11 + i * 2,
                100 + i,
                200 + i,
            );
            h.client.transact(&valid_proof(&h.env), &s, &ext);
        }
        (h.client.current_root().to_array(), h.client.next_leaf_index())
    };
    let (root_a, idx_a) = run();
    let (root_b, idx_b) = run();
    assert_eq!(root_a, root_b, "root must be reproducible across runs");
    assert_eq!(idx_a, 6);
    assert_eq!(idx_b, 6);
}

/// The level-0 hash of the first two leaves equals `poof_crypto::compress(cm0,
/// cm1)` — i.e. the contract's tree uses the SAME Poseidon the SDK uses. We
/// reconstruct the expected depth-20 root off-chain and compare to the contract.
#[test]
fn first_root_matches_offchain_reconstruction() {
    use poof_crypto::{compress, fr_from_be_bytes, fr_to_be_bytes, zero_leaf};

    let h = setup();
    let ext = empty_ext(&h.env);
    let root0 = h.client.current_root();
    let cm0 = fe(&h.env, 1003);
    let cm1 = fe(&h.env, 2004);
    let s = PublicSignals {
        root: root0,
        public_amount: bn(&h.env, 0),
        ext_data_hash: ext_data_hash(&h.env, &ext),
        nullifier0: bn(&h.env, 1),
        nullifier1: bn(&h.env, 2),
        commitment0: cm0.clone(),
        commitment1: cm1.clone(),
        currency_id: fe(&h.env, 0),
    };
    h.client.transact(&valid_proof(&h.env), &s, &ext);
    let on_chain = h.client.current_root().to_array();

    // Off-chain reconstruction of the depth-20 root for leaves [cm0, cm1] at
    // positions 0,1 with all other leaves empty.
    // level-0 parent of the two real leaves:
    let mut node = compress(
        fr_from_be_bytes(&cm0.to_array()),
        fr_from_be_bytes(&cm1.to_array()),
    );
    // empty subtree hashes
    let mut zero = zero_leaf();
    let mut zeros = StdVec::new();
    zeros.push(zero);
    for _ in 1..LEVELS {
        zero = compress(zero, zero);
        zeros.push(zero);
    }
    // node sits at level-1 index 0 (left child all the way up); pair with the
    // empty subtree at each level.
    for z in zeros.iter().take(LEVELS as usize).skip(1) {
        node = compress(node, *z);
    }
    let expected = fr_to_be_bytes(&node);
    assert_eq!(on_chain, expected, "contract root must match SDK reconstruction");
}

/// Old roots age out of the ring after `root_history_size` inserts, but remain
/// valid within the window. We can't cheaply do 64 inserts here for the full
/// eviction (would need 64 distinct valid txs), so we assert the window holds
/// for several inserts and the current root is always known.
#[test]
fn root_history_window_holds() {
    let h = setup();
    let ext = empty_ext(&h.env);
    let mut roots = StdVec::new();
    roots.push(h.client.current_root());
    for i in 0..5u8 {
        let root = h.client.current_root();
        let s = signals(&h.env, &root, &ext, 20 + i * 2, 21 + i * 2, 50 + i, 60 + i);
        h.client.transact(&valid_proof(&h.env), &s, &ext);
        roots.push(h.client.current_root());
    }
    // every recorded root is still within the (64-wide) window
    for r in roots.iter() {
        assert!(h.client.is_known_root(r), "root should still be known");
    }
}

// Multi-currency tests.

/// A second SAC registered after init gets the next currency id, and the only
/// change required is contract state (no new vkey / no upgrade).
#[test]
fn register_token_assigns_next_id() {
    let h = setup();
    assert_eq!(h.client.token_count(), 1, "init registers currency 0");
    let admin2 = Address::generate(&h.env);
    let sac2 = h.env.register_stellar_asset_contract_v2(admin2);
    let id = h.client.register_token(&sac2.address());
    assert_eq!(id, 1, "second token gets id 1");
    assert_eq!(h.client.token_count(), 2);
    assert_eq!(h.client.token(&1), Some(sac2.address()));
}

/// A transaction declaring an unregistered currency is rejected, even for a pure
/// transfer (publicAmount == 0), so no "ghost"-currency notes can be minted.
#[test]
fn unknown_currency_rejected() {
    let h = setup();
    let ext = empty_ext(&h.env);
    // currency 7 is not registered (only 0 exists).
    let s = signals_cur(&h.env, &h.client.current_root(), &ext, 1, 2, 3, 4, 7);
    let err = h
        .client
        .try_transact(&valid_proof(&h.env), &s, &ext)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, Error::UnknownCurrency);
    assert_eq!(h.client.next_leaf_index(), 0, "no mutation on reject");
}

/// Deposit and withdraw settle the SAC of the transaction's currency, and each
/// token's pool balance is independent of the others.
#[test]
fn per_currency_settlement_is_isolated() {
    let h = setup(); // currency 0 = h.token

    // register a second, independent SAC as currency 1
    let admin2 = Address::generate(&h.env);
    let sac2 = h.env.register_stellar_asset_contract_v2(admin2.clone());
    let id1 = h.client.register_token(&sac2.address());
    assert_eq!(id1, 1);
    let token1_admin = StellarAssetClient::new(&h.env, &sac2.address());
    let token1 = TokenClient::new(&h.env, &sac2.address());

    let depositor = Address::generate(&h.env);
    h.token_admin.mint(&depositor, &1000); // currency 0
    token1_admin.mint(&depositor, &1000); // currency 1

    // deposit 100 of currency 0
    let ext0 = ext_with_settlement(&h.env, &depositor);
    let mut s0 = signals_cur(&h.env, &h.client.current_root(), &ext0, 1, 2, 3, 4, 0);
    s0.public_amount = fe(&h.env, 100);
    h.client.transact(&valid_proof(&h.env), &s0, &ext0);

    // deposit 250 of currency 1
    let ext1 = ext_with_settlement(&h.env, &depositor);
    let mut s1 = signals_cur(&h.env, &h.client.current_root(), &ext1, 5, 6, 7, 8, 1);
    s1.public_amount = fe(&h.env, 250);
    h.client.transact(&valid_proof(&h.env), &s1, &ext1);

    assert_eq!(h.token.balance(&h.pool), 100, "pool holds 100 of currency 0");
    assert_eq!(token1.balance(&h.pool), 250, "pool holds 250 of currency 1");

    // withdraw 40 of currency 1 to a fresh recipient; currency 0 untouched
    let recipient = Address::generate(&h.env);
    let ext_w = ext_with_settlement(&h.env, &recipient);
    let mut sw = signals_cur(&h.env, &h.client.current_root(), &ext_w, 9, 10, 11, 12, 1);
    sw.public_amount = neg_fe(&h.env, 40);
    h.client.transact(&valid_proof(&h.env), &sw, &ext_w);

    assert_eq!(token1.balance(&recipient), 40, "recipient got 40 of currency 1");
    assert_eq!(token1.balance(&h.pool), 210, "currency 1 pool now 210");
    assert_eq!(h.token.balance(&h.pool), 100, "currency 0 pool unchanged");
}

/// register_token is admin-gated. With auth mocked the call succeeds; here we
/// assert it fails to authorize when the admin has not approved it.
#[test]
fn register_token_requires_admin_auth() {
    let env = Env::default();
    let contract_id = env.register(PoofContract, ());
    let client = PoofContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    client.init(
        &admin,
        &Config { levels: LEVELS, root_history_size: ROOT_HISTORY },
        &sac.address(),
    );

    // No auth mocked: an admin-gated call must fail to authorize.
    let admin2 = Address::generate(&env);
    let sac2 = env.register_stellar_asset_contract_v2(admin2);
    let res = client.try_register_token(&sac2.address());
    assert!(res.is_err(), "register_token must require admin auth");
    assert_eq!(client.token_count(), 1, "no token added without admin auth");
}

/// A spend can target ANY root in the window, not just the latest (stale-root
/// concurrency). Prove against root0 after the tree has already advanced.
#[test]
fn spend_against_older_root_in_window() {
    let h = setup();
    let ext = empty_ext(&h.env);
    let root0 = h.client.current_root();
    // advance the tree once
    let s1 = signals(&h.env, &root0, &ext, 1, 2, 3, 4);
    h.client.transact(&valid_proof(&h.env), &s1, &ext);
    // now prove against the OLD root0 (still in window) with fresh nullifiers
    let s2 = signals(&h.env, &root0, &ext, 5, 6, 7, 8);
    h.client.transact(&valid_proof(&h.env), &s2, &ext);
    assert_eq!(h.client.next_leaf_index(), 4);
}
