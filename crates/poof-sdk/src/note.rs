//! Local note management: a [`StoredNote`] (a `poof_crypto::Note` plus its tree
//! position and spent flag) and an in-memory [`NoteStore`].
//!
//! The store is the wallet's view of which notes it owns and can spend. It is
//! deliberately simple (a `Vec`). The contract is always the final arbiter of
//! spent-ness; this store is an optimistic local cache.

use ark_bn254::Fr;
use poof_crypto::Note;

/// A note the wallet owns, with the metadata needed to spend it.
#[derive(Clone, Debug)]
pub struct StoredNote {
    /// The note secret (amount, owner pubkey, blinding).
    pub note: Note,
    /// The leaf index this note's commitment occupies in the tree. `None` for a
    /// note not yet known to be inserted on-chain.
    pub leaf_index: Option<u32>,
    /// Optimistic local spent flag. The contract's nullifier set is authoritative.
    pub spent: bool,
}

impl StoredNote {
    pub fn new(note: Note, leaf_index: u32) -> Self {
        StoredNote {
            note,
            leaf_index: Some(leaf_index),
            spent: false,
        }
    }

    /// The Poseidon commitment for this note.
    pub fn commitment(&self) -> Fr {
        self.note.commitment()
    }

    /// The asset (registry index) this note is denominated in.
    pub fn currency_id(&self) -> u32 {
        self.note.currency_id
    }

    /// The nullifier for spending this note with the given spend key.
    /// Requires a known `leaf_index` (the nullifier binds tree position).
    pub fn nullifier(&self, private_key: Fr) -> Option<Fr> {
        self.leaf_index
            .map(|idx| self.note.nullifier(private_key, idx as u64))
    }
}

/// An in-memory collection of the wallet's notes.
#[derive(Default, Clone)]
pub struct NoteStore {
    notes: Vec<StoredNote>,
}

impl NoteStore {
    pub fn new() -> Self {
        NoteStore { notes: Vec::new() }
    }

    /// Add a note at a known leaf index.
    pub fn add(&mut self, note: Note, leaf_index: u32) {
        self.notes.push(StoredNote::new(note, leaf_index));
    }

    /// Add an already-constructed [`StoredNote`].
    pub fn add_stored(&mut self, note: StoredNote) {
        self.notes.push(note);
    }

    /// Mark the note at `leaf_index` spent. Returns `true` if found.
    pub fn mark_spent(&mut self, leaf_index: u32) -> bool {
        for n in &mut self.notes {
            if n.leaf_index == Some(leaf_index) {
                n.spent = true;
                return true;
            }
        }
        false
    }

    /// Mark any note whose nullifier (under `private_key`) is in `spent_nullifiers`
    /// as spent. Lets a wallet reconcile against chain state.
    pub fn reconcile_spent(&mut self, private_key: Fr, spent_nullifiers: &[Fr]) {
        for n in &mut self.notes {
            if let Some(nf) = n.nullifier(private_key) {
                if spent_nullifiers.contains(&nf) {
                    n.spent = true;
                }
            }
        }
    }

    /// All unspent notes (the spendable set).
    pub fn list_unspent(&self) -> Vec<&StoredNote> {
        self.notes.iter().filter(|n| !n.spent).collect()
    }

    /// All notes (spent and unspent).
    pub fn list_all(&self) -> &[StoredNote] {
        &self.notes
    }

    /// Total spendable balance (sum of unspent note amounts).
    pub fn total_balance(&self) -> u128 {
        self.notes
            .iter()
            .filter(|n| !n.spent)
            .map(|n| n.note.amount as u128)
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::Keys;

    fn note_for(keys: &Keys, amount: u64, blind: u64) -> Note {
        Note::new(amount, 0, keys.public_key(), Fr::from(blind))
    }

    #[test]
    fn balance_and_spend() {
        let keys = Keys::from_seed([3u8; 32]);
        let mut store = NoteStore::new();
        store.add(note_for(&keys, 100, 1), 0);
        store.add(note_for(&keys, 50, 2), 1);
        assert_eq!(store.total_balance(), 150);
        assert_eq!(store.list_unspent().len(), 2);

        assert!(store.mark_spent(0));
        assert_eq!(store.total_balance(), 50);
        assert_eq!(store.list_unspent().len(), 1);
    }

    #[test]
    fn reconcile_against_chain() {
        let keys = Keys::from_seed([4u8; 32]);
        let sk = keys.spend_key();
        let mut store = NoteStore::new();
        store.add(note_for(&keys, 10, 1), 5);
        let nf = store.list_all()[0].nullifier(sk).unwrap();

        store.reconcile_spent(sk, &[nf]);
        assert!(store.list_all()[0].spent);
        assert_eq!(store.total_balance(), 0);
    }
}
