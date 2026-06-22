//! Poof indexer.
//!
//! Stellar RPC forgets contract events in ≤7 days. This service permanently
//! ingests the Poof pool's `NewCommitment` (so recipients can scan for incoming
//! notes), `Nullifier` (spend-state checks), and `Transact` (latest root)
//! events into SQLite, and serves them over HTTP for client scanning.
//!
//! Design: checkpoint/resume,
//! idempotent upserts, finality lag to survive reorgs. The ingest loop is
//! abstracted over an [`ingest::EventSource`] so the whole pipeline is testable
//! against a mock without a live network.

pub mod api;
pub mod ingest;
pub mod rpc;
pub mod store;
pub mod types;

pub use ingest::{EventSource, DEFAULT_FINALITY_LAG};
pub use store::Store;
