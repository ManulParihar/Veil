//! End-to-end SDK→circuit test: the wallet builds a real transfer witness (with
//! genuine Merkle membership of the spent note), the SDK shells out to snarkjs
//! with the REAL circuit artifacts to produce a Groth16 proof, and we verify it
//! against the circuit's verifying key. This proves the SDK's witness format is
//! bit-compatible with `transaction.circom` and that a wallet can actually prove.
//!
//! `#[ignore]`d because it needs the circuit artifacts (run the circuits
//! `setup.sh` first). Run with: `cargo test -p poof-sdk --test e2e_prove -- --ignored`.

use std::path::PathBuf;
use std::process::Command;

use ark_bn254::Fr;
use poof_sdk::prove::{prove, ProverConfig, SnarkjsInvocation};
use poof_sdk::{Keys, Wallet};
use poof_crypto::Note;

fn circuits_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../circuits")
}

#[test]
#[ignore = "requires circuit artifacts (run circuits/scripts/setup.sh)"]
fn wallet_witness_proves_and_verifies() {
    let cd = circuits_dir();
    let wasm = cd.join("build/transaction_js/transaction.wasm");
    let zkey = cd.join("build/transaction.zkey");
    let vkey = cd.join("build/verification_key.json");
    let snarkjs_cli = cd.join("node_modules/.bin/snarkjs");
    assert!(wasm.exists(), "missing {} — run setup.sh", wasm.display());

    // ── build a real transfer witness ──
    let mut sender = Wallet::from_seed([40u8; 32]);
    let recipient = Keys::from_seed([41u8; 32]);
    let cur = 1u32;
    let note = Note::new(100, cur, sender.keys.public_key(), Fr::from(11u64));
    let idx = sender.tree.insert(note.commitment());
    sender.store.add(note, idx);

    let prepared = sender
        .build_transfer(
            cur,
            70,
            recipient.public_key(),
            &recipient.enc_public_bytes(),
            Fr::from(101u64),
            Fr::from(102u64),
            Fr::from(103u64),
        )
        .expect("build_transfer");
    let witness_json = prepared.witness.to_json_string();

    // ── prove via the SDK's real snarkjs path ──
    let cfg = ProverConfig {
        wasm_path: wasm,
        zkey_path: zkey,
        snarkjs: SnarkjsInvocation::NodeScript {
            node: PathBuf::from("node"),
            cli_js: snarkjs_cli.clone(),
        },
    };
    let work = std::env::temp_dir().join("poof-sdk-e2e-prove");
    let out = prove(&witness_json, &cfg, &work).expect("snarkjs proof");

    // ── verify the proof against the vkey ──
    let proof_path = work.join("proof.json");
    let public_path = work.join("public.json");
    let status = Command::new("node")
        .arg(&snarkjs_cli)
        .arg("groth16")
        .arg("verify")
        .arg(&vkey)
        .arg(&public_path)
        .arg(&proof_path)
        .status()
        .expect("run snarkjs verify");
    assert!(status.success(), "SDK-built witness produced a NON-verifying proof");

    // sanity: 8 public signals, value-conserving (public_amount == 0 for transfer)
    let public: Vec<String> = serde_json::from_str(&out.public_json).unwrap();
    assert_eq!(public.len(), 8, "expected 8 public signals");
    assert_eq!(public[1], "0", "publicAmount must be 0 for a private transfer");
    assert_eq!(public[7], cur.to_string(), "currencyId is public signal [7]");
}
