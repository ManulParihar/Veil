//! THE gate test (CLAUDE.md Day-2 make-or-break).
//!
//! Asserts that veil-crypto's Poseidon is bit-identical to circomlib's, and
//! pins the note/commitment/nullifier vectors that the circom circuit must
//! reproduce. If any of these change, the whole system silently breaks, so they
//! are frozen here as decimal strings (the format snarkjs emits for public
//! signals) and mirrored in `circuits/test/transaction.test.js`.

use ark_bn254::Fr;
use ark_ff::PrimeField;
use veil_crypto::{fr_from_u64, hash2, hash3, hash4, Keypair, Note};

fn dec(x: Fr) -> String {
    x.into_bigint().to_string()
}

/// Canonical circomlib vector: `Poseidon([1,2])`. Produced identically by
/// circom's `Poseidon(2)` template (verified against the witness during build).
#[test]
fn poseidon_1_2_matches_circomlib() {
    let got = hash2(fr_from_u64(1), fr_from_u64(2));
    assert_eq!(
        dec(got),
        "7853200120776062878684798364095072458815029376092732009249414926327459813530",
        "Poseidon(1,2) diverged from circomlib — the cross-impl gate is broken"
    );
}

/// `Poseidon([1,2,3])` width-3 vector (circomlib canonical).
#[test]
fn poseidon_1_2_3_matches_circomlib() {
    let got = hash3(fr_from_u64(1), fr_from_u64(2), fr_from_u64(3));
    assert_eq!(
        dec(got),
        "6542985608222806190361240322586112750744169038454362455181422643027100751666",
        "Poseidon(1,2,3) diverged from circomlib"
    );
}

/// `Poseidon([1,2,3,4])` width-4 vector (circomlib canonical). This is the
/// hash the multi-currency commitment is built on, so the circom `Poseidon(4)`
/// and the TS `circomlibjs` mirror must reproduce it exactly.
#[test]
fn poseidon_1_2_3_4_matches_circomlib() {
    let got = hash4(fr_from_u64(1), fr_from_u64(2), fr_from_u64(3), fr_from_u64(4));
    assert_eq!(
        dec(got),
        "18821383157269793795438455681495246036402687001665670618754263018637548127333",
        "Poseidon(1,2,3,4) diverged from circomlib - the width-4 gate is broken"
    );
}

/// Pin the note pipeline end to end with fixed, simple inputs so the circuit
/// can assert the same decimals. amount=100, currency_id=1, sk=7, blinding=42,
/// pathIndex=3.
#[test]
fn note_commitment_and_nullifier_vectors() {
    let kp = Keypair::from_private(fr_from_u64(7));
    let note = Note::new(100, 1, kp.public_key, fr_from_u64(42));
    let cm = note.commitment();
    let nf = note.nullifier(kp.private_key, 3);
    println!("VEC pk={}", dec(kp.public_key));
    println!("VEC cm={}", dec(cm));
    println!("VEC nf={}", dec(nf));
    // pk = Poseidon(7)
    assert_eq!(
        dec(kp.public_key),
        "7061949393491957813657776856458368574501817871421526214197139795307327923534"
    );

    // These two are the values a 1-input spend publishes; the circuit's
    // `outputCommitment` / `inputNullifier` must equal them for the same inputs.
    assert_eq!(
        dec(cm),
        "1368167316025322220717257820021635503343550471517006236415294408329041011825",
        "commitment vector drifted"
    );
    assert_eq!(
        dec(nf),
        "5670915370410439998081535105208692180002396374147198233286504856651004576590",
        "nullifier vector drifted"
    );
}

/// Cross-check our hand-rolled no_std permutation against the audited
/// `light-poseidon` (circomlib-compatible) reference, across widths 1/2/3.
#[test]
fn matches_light_poseidon_reference() {
    use light_poseidon::{Poseidon, PoseidonHasher};
    for inputs in [
        vec![fr_from_u64(1)],
        vec![fr_from_u64(1), fr_from_u64(2)],
        vec![fr_from_u64(7), fr_from_u64(13), fr_from_u64(99)],
        vec![fr_from_u64(100), fr_from_u64(1), fr_from_u64(7), fr_from_u64(42)],
    ] {
        let ours = veil_crypto::hashn(&inputs);
        let mut reference = Poseidon::<Fr>::new_circom(inputs.len()).unwrap();
        let theirs = reference.hash(&inputs).unwrap();
        assert_eq!(ours, theirs, "diverged from light-poseidon at width {}", inputs.len());
    }
}

/// Determinism: same inputs → same outputs, every run, every platform.
#[test]
fn derivations_are_deterministic() {
    let a = Note::new(5, 2, fr_from_u64(11), fr_from_u64(99)).commitment();
    let b = Note::new(5, 2, fr_from_u64(11), fr_from_u64(99)).commitment();
    assert_eq!(a, b);
}
