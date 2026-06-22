//! Shared row + event types for the indexer.
//!
//! Field elements (commitments, nullifiers, roots) are the 32-byte big-endian
//! wire encoding (INTERFACES.md §1), carried here as 64-char lowercase hex
//! strings — the form they are stored and served in.

use serde::{Deserialize, Serialize};

/// A parsed Poof contract event (INTERFACES.md §5).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PoofEvent {
    /// `("NewCommitment",)` → `(commitment, leaf_index, ciphertext, view_tag)`.
    NewCommitment {
        cm: String,         // 32-byte commitment, hex
        leaf_index: u32,    // tree position
        ciphertext: String, // AEAD blob, hex
        view_tag: u32,      // 1-byte tag widened to u32 on the wire
    },
    /// `("Nullifier",)` → `nullifier`.
    Nullifier { nf: String },
    /// `("Transact",)` → `(root,)`, emitted once per call.
    Transact { root: String },
}

/// A batch of events fetched from a source, tagged with the ledger they came
/// from so the ingest loop can checkpoint and apply finality lag.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerEvent {
    pub ledger: u64,
    pub event: PoofEvent,
}

/// Full commitment row as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitmentRow {
    pub cm: String,
    pub leaf_index: u32,
    pub ciphertext: String,
    pub view_tag: u32,
    pub ledger: u64,
}

/// Full nullifier row as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NullifierRow {
    pub nf: String,
    pub ledger: u64,
}

/// Note record served by `GET /notes` (the client scan feed).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NoteRow {
    pub cm: String,
    pub idx: u32,
    pub ct: String,
    pub view_tag: u32,
}
