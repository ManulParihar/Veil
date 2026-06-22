//! # poof-sdk — the client library
//!
//! Off-chain note management for the Poof shielded pool: key derivation, a local
//! note store, client-side note encryption + view-tag scanning, a mirror of the
//! contract's Merkle tree (for proving paths), `extData`/witness assembly, and a
//! snarkjs proving shim. It depends on `poof-crypto` for all Poseidon/note math —
//! the single source of truth — and never reimplements any of it.
//!
//! The [`Wallet`] facade ties the modules together: derive keys from a seed,
//! maintain notes, and build a value-conserving 2-out transfer (one real input +
//! one dummy) with encrypted outputs, the correct `extDataHash`, and a
//! circuit-ready witness.

pub mod encrypt;
pub mod keys;
pub mod merkle_tree;
pub mod note;
pub mod prove;
pub mod scan;
pub mod tx;

pub use encrypt::{decrypt_note, encrypt_note, EncryptedNote};
pub use keys::Keys;
pub use merkle_tree::{ClientMerkleTree, LEVELS};
pub use note::{NoteStore, StoredNote};
pub use scan::{scan, scan_to_stored, ScanRecord, ScanResult};
pub use tx::{ExtData, TransactWitness, WitnessInput, WitnessJson, WitnessOutput};

use ark_bn254::Fr;
use poof_crypto::Note;

/// Errors building a transfer.
#[derive(Debug, PartialEq, Eq)]
pub enum WalletError {
    /// No single unspent note covers the requested transfer amount (single-input
    /// MVP: the joinsplit allows 2 inputs but the wallet's selection here uses 1
    /// real + 1 dummy).
    InsufficientFunds,
    /// A chosen input note has no known leaf index (can't build its path).
    NoLeafIndex,
    /// The input note is not present in the client Merkle mirror.
    NotInTree,
}

/// The assembled, ready-to-prove transfer: the witness (with public signals) and
/// the `ExtData` whose hash it binds, plus the change/recipient notes so the
/// wallet can update its local store after submission.
pub struct PreparedTransfer {
    pub witness: TransactWitness,
    pub ext_data: ExtData,
    /// The note sent to the recipient (encrypted in `ext_data.ciphertexts[0]`).
    pub recipient_note: Note,
    /// The change note kept by the sender (encrypted in `ext_data.ciphertexts[1]`).
    pub change_note: Note,
    /// The leaf index of the input note being spent (for local store update).
    pub spent_leaf_index: u32,
}

/// A wallet: keys + local note store + a Merkle mirror.
pub struct Wallet {
    pub keys: Keys,
    pub store: NoteStore,
    pub tree: ClientMerkleTree,
}

impl Wallet {
    /// Create a wallet from a 32-byte seed with an empty store and tree.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Wallet {
            keys: Keys::from_seed(seed),
            store: NoteStore::new(),
            tree: ClientMerkleTree::default(),
        }
    }

    /// Spendable balance.
    pub fn balance(&self) -> u128 {
        self.store.total_balance()
    }

    /// Build a value-conserving transfer of `amount` to `recipient`, using a
    /// single real input note (chosen to cover the amount) plus a zero-value
    /// dummy second input. Produces a recipient output and a change output back
    /// to self. Pure transfers use `publicAmount = 0`, `fee = 0`, no relayer.
    ///
    /// `recipient_pubkey` is the recipient's BN254 note-owner key; `recipient_enc`
    /// is their X25519 encryption public key. The three blindings (recipient-out,
    /// change-out, dummy-input) are supplied by the caller — output blindings
    /// MUST be sampled with real entropy so equal-value notes don't collide.
    #[allow(clippy::too_many_arguments)]
    pub fn build_transfer(
        &self,
        currency_id: u32,
        amount: u64,
        recipient_pubkey: Fr,
        recipient_enc: &[u8; 32],
        recipient_blinding: Fr,
        change_blinding: Fr,
        dummy_blinding: Fr,
    ) -> Result<PreparedTransfer, WalletError> {
        let sk = self.keys.spend_key();

        // Pick the smallest unspent note of THIS currency that covers `amount`.
        // A transfer is single-currency, so we never mix assets in one tx.
        let chosen = self
            .store
            .list_unspent()
            .into_iter()
            .filter(|n| n.note.currency_id == currency_id && n.note.amount >= amount)
            .min_by_key(|n| n.note.amount)
            .ok_or(WalletError::InsufficientFunds)?;
        let leaf_index = chosen.leaf_index.ok_or(WalletError::NoLeafIndex)?;
        let input_note = chosen.note;

        // Merkle path for the real input against the current tree root.
        let (path_elements, path_index) =
            self.tree.path(leaf_index).ok_or(WalletError::NotInTree)?;
        let root = self.tree.root();
        let real_nf = input_note.nullifier(sk, path_index as u64);

        let real_input = WitnessInput {
            amount: input_note.amount,
            private_key: sk,
            blinding: input_note.blinding,
            path_index,
            path_elements,
            nullifier: real_nf,
        };

        // Dummy second input: zero value, membership gated off in-circuit. Use a
        // path index distinct from the real one so the two nullifiers differ.
        let dummy_index = path_index.wrapping_add(1);
        let dummy_input = WitnessInput::dummy(currency_id, sk, dummy_blinding, dummy_index);

        // Outputs: recipient gets `amount`, change is the remainder back to self.
        // Both inherit the input's currency.
        let change_amount = input_note.amount - amount; // input >= amount guaranteed
        let recipient_note = Note::new(amount, currency_id, recipient_pubkey, recipient_blinding);
        let change_note =
            Note::new(change_amount, currency_id, self.keys.public_key(), change_blinding);

        let out_recipient =
            WitnessOutput::new(currency_id, amount, recipient_pubkey, recipient_blinding);
        let out_change =
            WitnessOutput::new(currency_id, change_amount, self.keys.public_key(), change_blinding);

        // Encrypt each output to its owner; the wire blob carries the ephemeral
        // pubkey so the recipient's scanner is self-contained.
        let enc_recipient = encrypt_note(recipient_enc, &recipient_note);
        let enc_change = encrypt_note(&self.keys.enc_public_bytes(), &change_note);

        let ext_data = ExtData {
            recipient: fr_be(&recipient_pubkey),
            relayer: [0u8; 32],
            fee: 0,
            ciphertexts: [enc_recipient.wire(), enc_change.wire()],
            view_tags: [enc_recipient.view_tag, enc_change.view_tag],
            // pure transfer (publicAmount == 0): settlement unused on-chain but
            // still bound; a fixed placeholder strkey keeps the hash deterministic.
            settlement_address: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM".into(),
        };

        let witness = TransactWitness {
            root,
            public_amount: Fr::from(0u64),
            ext_data_hash: ext_data.ext_data_hash(),
            currency_id,
            inputs: [real_input, dummy_input],
            outputs: [out_recipient, out_change],
        };

        Ok(PreparedTransfer {
            witness,
            ext_data,
            recipient_note,
            change_note,
            spent_leaf_index: leaf_index,
        })
    }
}

/// 32-byte big-endian encoding of a field element.
fn fr_be(x: &Fr) -> [u8; 32] {
    poof_crypto::fr_to_be_bytes(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn end_to_end_build_transfer() {
        let mut sender = Wallet::from_seed([40u8; 32]);
        let recipient = Keys::from_seed([41u8; 32]);

        // Seed the sender with a note actually inserted into its tree mirror.
        let cur = 2u32;
        let note = Note::new(100, cur, sender.keys.public_key(), Fr::from(11u64));
        let idx = sender.tree.insert(note.commitment());
        sender.store.add(note, idx);
        assert_eq!(sender.balance(), 100);

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
            .unwrap();

        // Value conservation: in = out.
        let w = &prepared.witness;
        let sum_in: u64 = w.inputs.iter().map(|i| i.amount).sum();
        let sum_out: u64 = w.outputs.iter().map(|o| o.amount).sum();
        assert_eq!(sum_in, sum_out);
        assert_eq!(prepared.recipient_note.amount, 70);
        assert_eq!(prepared.change_note.amount, 30);
        assert_eq!(prepared.spent_leaf_index, 0);

        // Input nullifiers are distinct (real vs dummy).
        assert_ne!(w.inputs[0].nullifier, w.inputs[1].nullifier);

        // extDataHash in the witness matches the ExtData it binds.
        assert_eq!(w.ext_data_hash, prepared.ext_data.ext_data_hash());

        // The recipient can discover their output by scanning the ExtData
        // ciphertext (reconstructed from the wire blob + view tag).
        let enc = EncryptedNote::from_wire(
            &prepared.ext_data.ciphertexts[0],
            prepared.ext_data.view_tags[0],
        )
        .unwrap();
        let found = scan(&recipient.enc_secret, &[ScanRecord::new(5, enc)]);
        assert_eq!(found.found.len(), 1, "recipient must discover their note");
        assert_eq!(found.found[0].note.amount, 70);
        assert_eq!(found.found[0].note, prepared.recipient_note);

        // The sender can discover the change note the same way.
        let enc_c = EncryptedNote::from_wire(
            &prepared.ext_data.ciphertexts[1],
            prepared.ext_data.view_tags[1],
        )
        .unwrap();
        let change_found = scan(&sender.keys.enc_secret, &[ScanRecord::new(6, enc_c)]);
        assert_eq!(change_found.found.len(), 1);
        assert_eq!(change_found.found[0].note.amount, 30);

        // Witness serializes to circom-named JSON; 8 public signals, currency at [7].
        let json = w.to_json_string();
        assert!(json.contains("inPathElements"));
        assert!(json.contains("currencyId"));
        assert_eq!(w.public_signals().len(), 8);
        assert_eq!(w.public_signals()[7], cur.to_string());
        assert_eq!(prepared.recipient_note.currency_id, cur);
        assert_eq!(prepared.change_note.currency_id, cur);
    }

    #[test]
    fn insufficient_funds() {
        let mut w = Wallet::from_seed([42u8; 32]);
        let note = Note::new(10, 0, w.keys.public_key(), Fr::from(1u64));
        let idx = w.tree.insert(note.commitment());
        w.store.add(note, idx);
        let r = w.build_transfer(
            0,
            50,
            Fr::from(5u64),
            &[0u8; 32],
            Fr::from(1u64),
            Fr::from(2u64),
            Fr::from(3u64),
        );
        assert!(matches!(r, Err(WalletError::InsufficientFunds)));
    }

    #[test]
    fn wrong_currency_not_selected() {
        // A note in currency 1 cannot fund a transfer requested in currency 0.
        let mut w = Wallet::from_seed([43u8; 32]);
        let note = Note::new(100, 1, w.keys.public_key(), Fr::from(1u64));
        let idx = w.tree.insert(note.commitment());
        w.store.add(note, idx);
        let r = w.build_transfer(
            0, // requesting currency 0; only a currency-1 note exists
            50,
            Fr::from(5u64),
            &[0u8; 32],
            Fr::from(1u64),
            Fr::from(2u64),
            Fr::from(3u64),
        );
        assert!(matches!(r, Err(WalletError::InsufficientFunds)));
    }
}
