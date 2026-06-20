//! THE ultimate end-to-end test: a full `transact` driven by a REAL circuit
//! proof through the REAL BN254 host functions, with NO mock verifier.
//!
//! This exercises the entire authority path in one call against the genuine
//! soroban-env-host (the same code that runs on-chain):
//!   1. `is_known_root` against the genesis root,
//!   2. nullifier distinctness + unspent checks,
//!   3. `extDataHash` recompute (keccak256 → field) and compare — proving the
//!      SDK/circuit/contract all agree on INTERFACES §4,
//!   4. **real Groth16 verification** via `Bn254::pairing_check`,
//!   5. Merkle `insert_two` + root advance,
//!   6. event emission.
//!
//! The fixture is a value-conserving Phase-1 transfer (2 zero-value dummy inputs,
//! 2 zero-value outputs, publicAmount=0) bound to the EMPTY ExtData. Runs only
//! without `mock-verifier`, so the verification is the genuine load-bearing path.

#![cfg(all(test, not(feature = "mock-verifier")))]

extern crate std;

use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, String};

use crate::transact_fixture::{PROOF_A, PROOF_B, PROOF_C, PUBLIC_SIGNALS};
use crate::{Config, ExtData, Proof, PublicSignals, VeilContract, VeilContractClient};

/// The fixed settlement address the fixture's extDataHash binds (a transfer, so
/// no funds move). Mirrored in circuits/scripts/gen_transact_fixture.js.
const SETTLE_G: &str = "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM";

fn empty_ext(env: &Env) -> ExtData {
    ExtData {
        recipient: BytesN::from_array(env, &[0u8; 32]),
        relayer: BytesN::from_array(env, &[0u8; 32]),
        fee: 0,
        ciphertext0: Bytes::new(env),
        ciphertext1: Bytes::new(env),
        view_tag0: 0,
        view_tag1: 0,
        settlement_address: Address::from_string(&String::from_str(env, SETTLE_G)),
    }
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn signals(env: &Env) -> PublicSignals {
    let s = |i: usize| BytesN::from_array(env, &PUBLIC_SIGNALS[i]);
    PublicSignals {
        root: s(0),
        public_amount: s(1),
        ext_data_hash: s(2),
        nullifier0: s(3),
        nullifier1: s(4),
        commitment0: s(5),
        commitment1: s(6),
        currency_id: s(7),
    }
}

#[test]
fn full_transact_with_real_proof_on_host() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(VeilContract, ());
    let client = VeilContractClient::new(&env, &id);
    let token = setup_token(&env, &admin);
    client.init(&admin, &Config { levels: 20, root_history_size: 64 }, &token);

    // The fixture's root MUST equal this contract's freshly-computed genesis root
    // (Zero(20)); if Poseidon or the zero-subtree derivation drifted, is_known_root
    // would reject before we ever reach verification.
    let genesis = client.current_root();
    assert_eq!(
        genesis.to_array(),
        PUBLIC_SIGNALS[0],
        "fixture root must equal the contract genesis root"
    );

    let root_before = client.current_root();
    let ext = empty_ext(&env);
    let sig = signals(&env);

    // The real call: extDataHash recompute + REAL Groth16 verify + insert.
    client.transact(&Proof {
        a: BytesN::from_array(&env, &PROOF_A),
        b: BytesN::from_array(&env, &PROOF_B),
        c: BytesN::from_array(&env, &PROOF_C),
    }, &sig, &ext);

    // Effects: two leaves inserted, root advanced, both nullifiers spent.
    assert_eq!(client.next_leaf_index(), 2, "two output commitments inserted");
    let root_after = client.current_root();
    assert_ne!(root_after, root_before, "root advanced after insert");
    assert!(client.is_known_root(&root_after));
    assert!(client.is_known_root(&root_before), "old root still in window");
    assert!(client.is_spent(&BytesN::from_array(&env, &PUBLIC_SIGNALS[3])));
    assert!(client.is_spent(&BytesN::from_array(&env, &PUBLIC_SIGNALS[4])));

    std::eprintln!("✅ full on-host transact with a real Groth16 proof succeeded");
}

#[test]
fn replay_same_proof_is_rejected_as_double_spend() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(VeilContract, ());
    let client = VeilContractClient::new(&env, &id);
    let token = setup_token(&env, &admin);
    client.init(&admin, &Config { levels: 20, root_history_size: 64 }, &token);
    let ext = empty_ext(&env);
    let proof = Proof {
        a: BytesN::from_array(&env, &PROOF_A),
        b: BytesN::from_array(&env, &PROOF_B),
        c: BytesN::from_array(&env, &PROOF_C),
    };
    client.transact(&proof, &signals(&env), &ext);
    // Replaying the exact same proof reuses spent nullifiers → rejected.
    let err = client
        .try_transact(&proof, &signals(&env), &ext)
        .err()
        .unwrap()
        .unwrap();
    assert_eq!(err, crate::Error::NullifierSpent);
}
