//! Transaction assembly: [`ExtData`], `extDataHash`, and the circuit witness JSON.
//!
//! `extDataHash` binds recipient/relayer/fee/ciphertexts into the proof so a
//! relayer cannot redirect funds (INTERFACES §4). The contract recomputes it
//! the same way and rejects on mismatch.
//!
//! The witness JSON field names below MUST match `circuits/src/transaction.circom`
//! exactly — these are what the integration step feeds to snarkjs.

use ark_bn254::Fr;
use ark_ff::PrimeField;
use serde::Serialize;
use tiny_keccak::{Hasher, Keccak};
use veil_crypto::{fr_to_be_bytes, Note};

use crate::merkle_tree::LEVELS;

/// External data carried alongside a transact (not all in the proof, but bound
/// to it via `extDataHash`).
#[derive(Clone, Debug)]
pub struct ExtData {
    /// 32-byte recipient account (MVP: Ed25519 public key bytes).
    pub recipient: [u8; 32],
    /// 32-byte relayer account (zero if no relayer).
    pub relayer: [u8; 32],
    /// Fee paid to the relayer, u128.
    pub fee: u128,
    /// The two output-note ciphertexts (AEAD blobs).
    pub ciphertexts: [Vec<u8>; 2],
    /// The two 1-byte view tags.
    pub view_tags: [u8; 2],
    /// Phase-2 settlement counterparty as a Stellar strkey (e.g. "G..."). Bound
    /// into the hash via its ASCII bytes so a withdraw recipient can't be
    /// redirected. For a pure transfer (publicAmount == 0) it is unused on-chain
    /// but still hashed, so the client must pass a fixed address.
    pub settlement_address: String,
}

impl ExtData {
    /// `extDataHash = keccak256( recipient(32) || relayer(32) || fee_be(16) ||
    ///   len(ct0)_u32be || ct0 || len(ct1)_u32be || ct1 ||
    ///   viewTag0(1) || viewTag1(1) ) mod r`  (INTERFACES §4).
    ///
    /// Ciphertexts are length-prefixed with a u32 big-endian length before their
    /// bytes (they are variable-length).
    pub fn ext_data_hash(&self) -> Fr {
        let mut k = Keccak::v256();
        k.update(&self.recipient);
        k.update(&self.relayer);
        k.update(&self.fee.to_be_bytes()); // u128 → 16 bytes big-endian
        for ct in &self.ciphertexts {
            k.update(&(ct.len() as u32).to_be_bytes());
            k.update(ct);
        }
        k.update(&[self.view_tags[0], self.view_tags[1]]);
        // settlement address strkey: u32-be length || ASCII bytes
        let addr = self.settlement_address.as_bytes();
        k.update(&(addr.len() as u32).to_be_bytes());
        k.update(addr);
        let mut digest = [0u8; 32];
        k.finalize(&mut digest);
        // Reduce the 32-byte keccak digest mod r (big-endian).
        Fr::from_be_bytes_mod_order(&digest)
    }

    /// The `extDataHash` as a decimal string (the public-signal wire form).
    pub fn ext_data_hash_decimal(&self) -> String {
        fr_to_decimal(&self.ext_data_hash())
    }
}

/// A field element as a decimal string (snarkjs / circom input form).
pub fn fr_to_decimal(x: &Fr) -> String {
    x.into_bigint().to_string()
}

/// Decimal string of a u64 (amounts, indices).
fn u64_dec(x: u64) -> String {
    x.to_string()
}

/// One spend input for the witness (a real note + its path, or a dummy).
#[derive(Clone)]
pub struct WitnessInput {
    pub amount: u64,
    pub private_key: Fr,
    pub blinding: Fr,
    pub path_index: u32,
    /// Length must equal `LEVELS`.
    pub path_elements: Vec<Fr>,
    /// The nullifier this input produces (public signal).
    pub nullifier: Fr,
}

impl WitnessInput {
    /// A zero-value dummy input. Its Merkle membership is gated off in-circuit
    /// (amount == 0), so the path can be all-zeros. `private_key`/`blinding`
    /// still need to yield a self-consistent commitment → nullifier so the
    /// circuit's nullifier constraint holds, and the two input nullifiers stay
    /// distinct from the real one.
    pub fn dummy(private_key: Fr, blinding: Fr, path_index: u32) -> Self {
        let note = Note::new(0, veil_crypto::Keypair::from_private(private_key).public_key, blinding);
        let nullifier = note.nullifier(private_key, path_index as u64);
        WitnessInput {
            amount: 0,
            private_key,
            blinding,
            path_index,
            path_elements: vec![Fr::from(0u64); LEVELS],
            nullifier,
        }
    }
}

/// One created output for the witness.
#[derive(Clone)]
pub struct WitnessOutput {
    pub amount: u64,
    pub pubkey: Fr,
    pub blinding: Fr,
    /// The commitment this output produces (public signal).
    pub commitment: Fr,
}

impl WitnessOutput {
    pub fn new(amount: u64, pubkey: Fr, blinding: Fr) -> Self {
        let commitment = Note::new(amount, pubkey, blinding).commitment();
        WitnessOutput {
            amount,
            pubkey,
            blinding,
            commitment,
        }
    }
}

/// All the data needed to build the circuit witness for one transact.
pub struct TransactWitness {
    pub root: Fr,
    pub public_amount: Fr,
    pub ext_data_hash: Fr,
    pub inputs: [WitnessInput; 2],
    pub outputs: [WitnessOutput; 2],
}

/// The witness JSON object. Field names match `transaction.circom` exactly:
/// `root, publicAmount, extDataHash, inputNullifier[2], outputCommitment[2],
/// inAmount[2], inPrivateKey[2], inBlinding[2], inPathIndices[2],
/// inPathElements[2][20], outAmount[2], outPubkey[2], outBlinding[2]`.
/// All field elements are decimal strings.
#[derive(Serialize)]
pub struct WitnessJson {
    pub root: String,
    #[serde(rename = "publicAmount")]
    pub public_amount: String,
    #[serde(rename = "extDataHash")]
    pub ext_data_hash: String,
    #[serde(rename = "inputNullifier")]
    pub input_nullifier: [String; 2],
    #[serde(rename = "outputCommitment")]
    pub output_commitment: [String; 2],
    #[serde(rename = "inAmount")]
    pub in_amount: [String; 2],
    #[serde(rename = "inPrivateKey")]
    pub in_private_key: [String; 2],
    #[serde(rename = "inBlinding")]
    pub in_blinding: [String; 2],
    #[serde(rename = "inPathIndices")]
    pub in_path_indices: [String; 2],
    #[serde(rename = "inPathElements")]
    pub in_path_elements: [Vec<String>; 2],
    #[serde(rename = "outAmount")]
    pub out_amount: [String; 2],
    #[serde(rename = "outPubkey")]
    pub out_pubkey: [String; 2],
    #[serde(rename = "outBlinding")]
    pub out_blinding: [String; 2],
}

impl TransactWitness {
    /// Build the serializable witness JSON object.
    pub fn to_json(&self) -> WitnessJson {
        let path_dec = |inp: &WitnessInput| -> Vec<String> {
            assert_eq!(inp.path_elements.len(), LEVELS, "path must have {LEVELS} elements");
            inp.path_elements.iter().map(fr_to_decimal).collect()
        };
        WitnessJson {
            root: fr_to_decimal(&self.root),
            public_amount: fr_to_decimal(&self.public_amount),
            ext_data_hash: fr_to_decimal(&self.ext_data_hash),
            input_nullifier: [
                fr_to_decimal(&self.inputs[0].nullifier),
                fr_to_decimal(&self.inputs[1].nullifier),
            ],
            output_commitment: [
                fr_to_decimal(&self.outputs[0].commitment),
                fr_to_decimal(&self.outputs[1].commitment),
            ],
            in_amount: [u64_dec(self.inputs[0].amount), u64_dec(self.inputs[1].amount)],
            in_private_key: [
                fr_to_decimal(&self.inputs[0].private_key),
                fr_to_decimal(&self.inputs[1].private_key),
            ],
            in_blinding: [
                fr_to_decimal(&self.inputs[0].blinding),
                fr_to_decimal(&self.inputs[1].blinding),
            ],
            in_path_indices: [
                u64_dec(self.inputs[0].path_index as u64),
                u64_dec(self.inputs[1].path_index as u64),
            ],
            in_path_elements: [path_dec(&self.inputs[0]), path_dec(&self.inputs[1])],
            out_amount: [u64_dec(self.outputs[0].amount), u64_dec(self.outputs[1].amount)],
            out_pubkey: [
                fr_to_decimal(&self.outputs[0].pubkey),
                fr_to_decimal(&self.outputs[1].pubkey),
            ],
            out_blinding: [
                fr_to_decimal(&self.outputs[0].blinding),
                fr_to_decimal(&self.outputs[1].blinding),
            ],
        }
    }

    /// Serialize the witness to a JSON string (snarkjs input form).
    pub fn to_json_string(&self) -> String {
        serde_json::to_string_pretty(&self.to_json()).expect("witness JSON serialization")
    }

    /// The 7 public signals in INTERFACES §3 order, as decimal strings.
    pub fn public_signals(&self) -> [String; 7] {
        [
            fr_to_decimal(&self.root),
            fr_to_decimal(&self.public_amount),
            fr_to_decimal(&self.ext_data_hash),
            fr_to_decimal(&self.inputs[0].nullifier),
            fr_to_decimal(&self.inputs[1].nullifier),
            fr_to_decimal(&self.outputs[0].commitment),
            fr_to_decimal(&self.outputs[1].commitment),
        ]
    }
}

/// Helper to encode a field element to its 32-byte big-endian wire form.
pub fn fr_bytes(x: &Fr) -> [u8; 32] {
    fr_to_be_bytes(x)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::Keys;

    fn ext(recipient: [u8; 32]) -> ExtData {
        ExtData {
            recipient,
            relayer: [0u8; 32],
            fee: 0,
            ciphertexts: [vec![1, 2, 3], vec![4, 5, 6, 7]],
            view_tags: [0xab, 0xcd],
            settlement_address: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM".into(),
        }
    }

    #[test]
    fn ext_data_hash_deterministic() {
        let e = ext([5u8; 32]);
        assert_eq!(e.ext_data_hash(), e.ext_data_hash());
    }

    #[test]
    fn ext_data_hash_sensitive_to_recipient() {
        let a = ext([5u8; 32]);
        let b = ext([6u8; 32]); // different recipient
        assert_ne!(a.ext_data_hash(), b.ext_data_hash());
    }

    #[test]
    fn ext_data_hash_sensitive_to_fee_and_tags() {
        let base = ext([5u8; 32]);
        let mut fee = base.clone();
        fee.fee = 1;
        assert_ne!(base.ext_data_hash(), fee.ext_data_hash());

        let mut tag = base.clone();
        tag.view_tags[0] ^= 1;
        assert_ne!(base.ext_data_hash(), tag.ext_data_hash());

        let mut ct = base.clone();
        ct.ciphertexts[1].push(9);
        assert_ne!(base.ext_data_hash(), ct.ext_data_hash());
    }

    #[test]
    fn witness_json_shape_and_conservation() {
        // 1 real input (amount 100) + 1 dummy (amount 0) → 2 outputs summing 100.
        let sender = Keys::from_seed([30u8; 32]);
        let recipient = Keys::from_seed([31u8; 32]);
        let sk = sender.spend_key();

        // Real input note at leaf 0 with a fabricated path.
        let real = Note::new(100, sender.public_key(), Fr::from(11u64));
        let real_nf = real.nullifier(sk, 0);
        let real_input = WitnessInput {
            amount: 100,
            private_key: sk,
            blinding: Fr::from(11u64),
            path_index: 0,
            path_elements: vec![Fr::from(0u64); LEVELS],
            nullifier: real_nf,
        };
        // Dummy second input with a distinct nullifier.
        let dummy = WitnessInput::dummy(sk, Fr::from(999u64), 1);
        assert_ne!(real_input.nullifier, dummy.nullifier, "input nullifiers must differ");

        // Outputs: 100 to recipient, 0 change → conserves value.
        let out0 = WitnessOutput::new(100, recipient.public_key(), Fr::from(77u64));
        let out1 = WitnessOutput::new(0, sender.public_key(), Fr::from(88u64));
        assert_eq!(
            real_input.amount + dummy.amount,
            out0.amount + out1.amount,
            "value conservation"
        );

        let ed = ext(recipient.public_key_bytes());
        let w = TransactWitness {
            root: Fr::from(424242u64),
            public_amount: Fr::from(0u64),
            ext_data_hash: ed.ext_data_hash(),
            inputs: [real_input, dummy],
            outputs: [out0, out1],
        };

        let json = w.to_json();
        // Shape checks.
        assert_eq!(json.in_path_elements[0].len(), LEVELS);
        assert_eq!(json.in_path_elements[1].len(), LEVELS);
        assert_eq!(json.in_amount, ["100", "0"]);
        assert_eq!(json.out_amount, ["100", "0"]);
        assert_eq!(json.public_amount, "0");

        // Serializes and parses back as an object with the circom field names.
        let s = w.to_json_string();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        for field in [
            "root", "publicAmount", "extDataHash", "inputNullifier",
            "outputCommitment", "inAmount", "inPrivateKey", "inBlinding",
            "inPathIndices", "inPathElements", "outAmount", "outPubkey", "outBlinding",
        ] {
            assert!(v.get(field).is_some(), "witness JSON missing field {field}");
        }

        // Public signals: 7, with extDataHash matching ExtData.
        let ps = w.public_signals();
        assert_eq!(ps.len(), 7);
        assert_eq!(ps[2], ed.ext_data_hash_decimal());
    }
}
