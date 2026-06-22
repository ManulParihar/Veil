//! The ingest loop, abstracted over an [`EventSource`] so it is fully testable
//! without a live network.
//!
//! Indexer invariants:
//! - **Checkpoint/resume**: a restart picks up from `store.checkpoint()`; never
//!   re-walks ledgers it already finalized, never leaves gaps.
//! - **Finality lag**: only ledgers `<= latest - lag` are ingested, so a reorg
//!   shallower than `lag` never records phantom commitments.
//! - **Idempotent**: re-ingesting a ledger is safe (store upserts dedupe), so
//!   even an over-eager re-poll cannot duplicate rows.

use std::sync::Arc;

use crate::store::Store;
use crate::types::{LedgerEvent, PoofEvent};

/// A source of Poof contract events. Implemented by [`MockSource`] (tests) and
/// `StellarRpcSource` (real `getEvents` poller).
pub trait EventSource {
    /// Fetch all events in ledgers `[from_ledger, latest]` (inclusive). The
    /// loop applies the finality filter on top, so a source may return more
    /// than will be ingested this tick. Implementations should return events
    /// in ascending ledger order where possible; the loop does not rely on it
    /// for correctness (it filters and the store dedupes) but it helps ordering.
    fn fetch_events(&self, from_ledger: u64) -> anyhow::Result<Vec<LedgerEvent>>;

    /// The latest ledger the source knows about.
    fn latest_ledger(&self) -> anyhow::Result<u64>;
}

/// Number of confirmations a ledger must be deep before we ingest it.
pub const DEFAULT_FINALITY_LAG: u64 = 5;

/// Run one ingest tick: fetch from the resume point, apply finality lag, write
/// finalized events, advance the checkpoint. Returns the number of events
/// applied this tick. Safe to call repeatedly.
pub fn ingest_once(
    store: &Store,
    source: &dyn EventSource,
    finality_lag: u64,
) -> anyhow::Result<usize> {
    let latest = source.latest_ledger()?;
    // The highest ledger considered final this tick. Saturating so an empty /
    // very young chain doesn't underflow.
    let safe_tip = latest.saturating_sub(finality_lag);

    // Resume point: one past the last fully-ingested ledger (0 if never set).
    let from = match store.checkpoint()? {
        Some(c) => c + 1,
        None => 0,
    };

    // Nothing new is final yet.
    if from > safe_tip {
        return Ok(0);
    }

    let events = source.fetch_events(from)?;

    let mut applied = 0usize;
    for le in &events {
        // Finality filter: drop anything not yet deep enough, and anything below
        // the resume point (defensive — a source may over-return).
        if le.ledger < from || le.ledger > safe_tip {
            continue;
        }
        apply_event(store, le)?;
        applied += 1;
    }

    // Advance the checkpoint to the safe tip even if no events landed in the
    // window — those ledgers are finalized and empty, and we must not re-scan
    // them. This is what makes resume gap-free and dup-free.
    store.set_checkpoint(safe_tip)?;

    Ok(applied)
}

/// Persist a single finalized event.
fn apply_event(store: &Store, le: &LedgerEvent) -> anyhow::Result<()> {
    match &le.event {
        PoofEvent::NewCommitment {
            cm,
            leaf_index,
            ciphertext,
            view_tag,
        } => {
            store.upsert_commitment(&crate::types::CommitmentRow {
                cm: cm.clone(),
                leaf_index: *leaf_index,
                ciphertext: ciphertext.clone(),
                view_tag: *view_tag,
                ledger: le.ledger,
            })?;
        }
        PoofEvent::Nullifier { nf } => {
            store.upsert_nullifier(&crate::types::NullifierRow {
                nf: nf.clone(),
                ledger: le.ledger,
            })?;
        }
        PoofEvent::Transact { root } => {
            store.set_root(root, le.ledger)?;
        }
    }
    Ok(())
}

/// The long-running async ingest loop: tick, sleep, repeat. Cancel by dropping
/// the task. Errors are logged and retried (a transient RPC failure must not
/// kill the indexer).
pub async fn run_loop(
    store: Arc<Store>,
    source: Arc<dyn EventSource + Send + Sync>,
    finality_lag: u64,
    poll_interval: std::time::Duration,
) {
    loop {
        // Run the (blocking, rusqlite) tick off the async reactor.
        let s = store.clone();
        let src = source.clone();
        let res =
            tokio::task::spawn_blocking(move || ingest_once(&s, src.as_ref(), finality_lag)).await;

        match res {
            Ok(Ok(n)) => {
                if n > 0 {
                    tracing::info!(applied = n, "ingested events");
                }
            }
            Ok(Err(e)) => tracing::warn!(error = %e, "ingest tick failed; will retry"),
            Err(e) => tracing::warn!(error = %e, "ingest task panicked; will retry"),
        }

        tokio::time::sleep(poll_interval).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test source: a fixed set of events plus a movable chain tip.
    #[derive(Default)]
    pub struct MockSource {
        pub events: std::sync::Mutex<Vec<LedgerEvent>>,
        pub tip: std::sync::Mutex<u64>,
    }

    impl MockSource {
        fn new(tip: u64) -> Self {
            Self {
                events: std::sync::Mutex::new(Vec::new()),
                tip: std::sync::Mutex::new(tip),
            }
        }
        fn push(&self, ledger: u64, event: PoofEvent) {
            self.events.lock().unwrap().push(LedgerEvent { ledger, event });
        }
        fn set_tip(&self, t: u64) {
            *self.tip.lock().unwrap() = t;
        }
    }

    impl EventSource for MockSource {
        fn fetch_events(&self, from_ledger: u64) -> anyhow::Result<Vec<LedgerEvent>> {
            Ok(self
                .events
                .lock()
                .unwrap()
                .iter()
                .filter(|e| e.ledger >= from_ledger)
                .cloned()
                .collect())
        }
        fn latest_ledger(&self) -> anyhow::Result<u64> {
            Ok(*self.tip.lock().unwrap())
        }
    }

    fn nc(cm: &str, idx: u32) -> PoofEvent {
        PoofEvent::NewCommitment {
            cm: cm.into(),
            leaf_index: idx,
            ciphertext: "ab".into(),
            view_tag: 1,
        }
    }

    #[test]
    fn finality_lag_holds_back_young_ledgers() {
        let store = Store::in_memory().unwrap();
        let src = MockSource::new(8); // tip = 8, lag = 5 → safe_tip = 3
        src.push(2, nc("old", 0)); // final → ingested
        src.push(6, nc("young", 1)); // ledger 6 > safe_tip 3 → held back

        let n = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n, 1, "only the final event should be applied");
        assert_eq!(store.commitment_count().unwrap(), 1);
        assert!(store.get_commitment("old").unwrap().is_some());
        assert!(store.get_commitment("young").unwrap().is_none());
        assert_eq!(store.checkpoint().unwrap(), Some(3));

        // Advance the tip so ledger 6 becomes final, then re-tick.
        src.set_tip(20); // safe_tip = 15
        let n = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n, 1, "the now-final young event lands");
        assert!(store.get_commitment("young").unwrap().is_some());
        assert_eq!(store.checkpoint().unwrap(), Some(15));
    }

    #[test]
    fn checkpoint_resume_has_no_gaps_or_dupes() {
        let src = MockSource::new(30); // safe_tip = 25 with lag 5
        src.push(1, nc("a", 0));
        src.push(2, PoofEvent::Nullifier { nf: "nfa".into() });
        src.push(10, nc("b", 1));
        src.push(20, PoofEvent::Transact { root: "r1".into() });

        // First run on one store handle.
        let store = Arc::new(Store::in_memory().unwrap());
        let n1 = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n1, 4);
        let cp = store.checkpoint().unwrap();
        assert_eq!(cp, Some(25));

        // "Restart": same DB (same Arc here stands in for reopening the file),
        // re-tick. Nothing new is final → no work, no dupes.
        let n2 = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n2, 0, "resume must not re-ingest finalized ledgers");
        assert_eq!(store.commitment_count().unwrap(), 2);
        assert_eq!(store.nullifier_count().unwrap(), 1);
        assert_eq!(store.checkpoint().unwrap(), Some(25));

        // New event arrives in a later ledger; advance tip and tick again.
        src.push(40, nc("c", 2));
        src.set_tip(50); // safe_tip = 45
        let n3 = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n3, 1, "only the brand-new event, resumed from cp 25");
        assert_eq!(store.commitment_count().unwrap(), 3);
        assert_eq!(store.checkpoint().unwrap(), Some(45));
    }

    #[test]
    fn end_to_end_mock_populates_store() {
        let store = Store::in_memory().unwrap();
        let src = MockSource::new(100); // generous tip, everything final
        src.push(1, nc("cm0", 0));
        src.push(1, nc("cm1", 1));
        src.push(1, PoofEvent::Nullifier { nf: "nf0".into() });
        src.push(1, PoofEvent::Transact { root: "root0".into() });

        let n = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n, 4);
        assert_eq!(store.commitment_count().unwrap(), 2);
        assert_eq!(store.nullifier_count().unwrap(), 1);
        assert!(store.is_spent("nf0").unwrap());
        assert_eq!(store.root().unwrap().unwrap().0, "root0");

        let notes = store.notes_since(0).unwrap();
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].cm, "cm0");
        assert_eq!(notes[0].ct, "ab");
    }

    #[test]
    fn empty_final_ledgers_still_advance_checkpoint() {
        // No events at all, but ledgers are final — checkpoint must advance so
        // we don't re-scan them forever.
        let store = Store::in_memory().unwrap();
        let src = MockSource::new(10);
        let n = ingest_once(&store, &src, 5).unwrap();
        assert_eq!(n, 0);
        assert_eq!(store.checkpoint().unwrap(), Some(5));
    }
}
