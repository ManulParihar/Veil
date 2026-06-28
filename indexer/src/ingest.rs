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

    /// The oldest ledger still retained by the source (its retention floor):
    /// `getEvents`/`fetch_events` below this point fail permanently. The default
    /// returns `0` — "no floor, everything is retained" — so a source without
    /// retention info (e.g. `MockSource`) never trips the aged-cursor self-heal.
    fn oldest_ledger(&self) -> anyhow::Result<u64> {
        Ok(0)
    }
}

/// Number of confirmations a ledger must be deep before we ingest it.
pub const DEFAULT_FINALITY_LAG: u64 = 5;

/// What boot-time should do given where the resume cursor sits relative to the
/// source's retention floor. Decided by [`retention_action`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionAction {
    /// The resume point is still retained — proceed normally.
    Ok,
    /// The cursor aged below the floor but the deploy/seed ledger is still
    /// retained — wipe and reseed from `start_ledger` for a clean rebuild.
    Reseed,
    /// Even the deploy/seed ledger aged out — history is permanently lost from
    /// the source and a full rebuild is impossible without an archival backfill.
    Unrecoverable,
}

/// Pure decision for the boot-time aged-cursor self-heal (see `main.rs`).
///
/// `resume` is the ledger the next tick would query (`checkpoint + 1`, or
/// `start_ledger` on a fresh DB); `oldest` is the source's retention floor.
/// - `resume >= oldest` → [`RetentionAction::Ok`] (the cursor is fine).
/// - cursor below the floor, but `start_ledger >= oldest` →
///   [`RetentionAction::Reseed`] (rebuild from the still-retained deploy ledger).
/// - cursor below the floor and `start_ledger < oldest` →
///   [`RetentionAction::Unrecoverable`].
pub fn retention_action(resume: u64, start_ledger: u64, oldest: u64) -> RetentionAction {
    if resume >= oldest {
        RetentionAction::Ok
    } else if start_ledger >= oldest {
        RetentionAction::Reseed
    } else {
        RetentionAction::Unrecoverable
    }
}

/// Run one ingest tick: fetch from the resume point, apply finality lag, write
/// finalized events, advance the checkpoint. Returns the number of events
/// applied this tick. Safe to call repeatedly.
///
/// `start_ledger` seeds a fresh DB (no checkpoint): we begin the scan there
/// rather than at ledger 0, which Soroban RPC rejects ("startLedger must be
/// positive" / out of retention). It's the contract's deploy ledger, so the
/// scan still captures leaf 0.
pub fn ingest_once(
    store: &Store,
    source: &dyn EventSource,
    finality_lag: u64,
    start_ledger: u64,
) -> anyhow::Result<usize> {
    let latest = source.latest_ledger()?;
    // The highest ledger considered final this tick. Saturating so an empty /
    // very young chain doesn't underflow.
    let safe_tip = latest.saturating_sub(finality_lag);

    // Resume point: one past the last fully-ingested ledger, or the seed start
    // ledger on a fresh DB.
    let from = match store.checkpoint()? {
        Some(c) => c + 1,
        None => start_ledger,
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
    start_ledger: u64,
    poll_interval: std::time::Duration,
) {
    loop {
        // Run the (blocking, rusqlite) tick off the async reactor.
        let s = store.clone();
        let src = source.clone();
        let res = tokio::task::spawn_blocking(move || {
            ingest_once(&s, src.as_ref(), finality_lag, start_ledger)
        })
        .await;

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

        let n = ingest_once(&store, &src, 5, 0).unwrap();
        assert_eq!(n, 1, "only the final event should be applied");
        assert_eq!(store.commitment_count().unwrap(), 1);
        assert!(store.get_commitment("old").unwrap().is_some());
        assert!(store.get_commitment("young").unwrap().is_none());
        assert_eq!(store.checkpoint().unwrap(), Some(3));

        // Advance the tip so ledger 6 becomes final, then re-tick.
        src.set_tip(20); // safe_tip = 15
        let n = ingest_once(&store, &src, 5, 0).unwrap();
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
        let n1 = ingest_once(&store, &src, 5, 0).unwrap();
        assert_eq!(n1, 4);
        let cp = store.checkpoint().unwrap();
        assert_eq!(cp, Some(25));

        // "Restart": same DB (same Arc here stands in for reopening the file),
        // re-tick. Nothing new is final → no work, no dupes.
        let n2 = ingest_once(&store, &src, 5, 0).unwrap();
        assert_eq!(n2, 0, "resume must not re-ingest finalized ledgers");
        assert_eq!(store.commitment_count().unwrap(), 2);
        assert_eq!(store.nullifier_count().unwrap(), 1);
        assert_eq!(store.checkpoint().unwrap(), Some(25));

        // New event arrives in a later ledger; advance tip and tick again.
        src.push(40, nc("c", 2));
        src.set_tip(50); // safe_tip = 45
        let n3 = ingest_once(&store, &src, 5, 0).unwrap();
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

        let n = ingest_once(&store, &src, 5, 0).unwrap();
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
        let n = ingest_once(&store, &src, 5, 0).unwrap();
        assert_eq!(n, 0);
        assert_eq!(store.checkpoint().unwrap(), Some(5));
    }

    #[test]
    fn fresh_db_seeds_from_start_ledger() {
        // A fresh DB must begin the scan at `start_ledger`, not 0 — events in
        // earlier ledgers are skipped (they predate the contract / are out of
        // RPC retention), and the seed value still captures the deploy ledger.
        let store = Store::in_memory().unwrap();
        let src = MockSource::new(1000); // generous tip → all final
        src.push(50, nc("pre", 0)); // before the seed → must be skipped
        src.push(150, nc("post", 1)); // at/after the seed → ingested

        let n = ingest_once(&store, &src, 5, 100).unwrap();
        assert_eq!(n, 1, "only events at/after the start ledger are ingested");
        assert!(store.get_commitment("pre").unwrap().is_none());
        assert!(store.get_commitment("post").unwrap().is_some());
    }

    #[test]
    fn retention_action_in_window_is_ok() {
        // Resume point still at/above the floor → nothing to heal.
        assert_eq!(retention_action(3_300_000, 3_297_796, 3_202_025), RetentionAction::Ok);
        // Exactly on the floor counts as retained.
        assert_eq!(retention_action(3_202_025, 3_297_796, 3_202_025), RetentionAction::Ok);
    }

    #[test]
    fn retention_action_aged_cursor_reseeds() {
        // Cursor below the floor, but the deploy ledger is still retained →
        // wipe and rebuild from start_ledger.
        assert_eq!(retention_action(3_100_000, 3_297_796, 3_202_025), RetentionAction::Reseed);
    }

    #[test]
    fn retention_action_deploy_ledger_aged_out_is_unrecoverable() {
        // Both the cursor and the deploy ledger have aged below the floor →
        // the full history can no longer be rebuilt from this source.
        assert_eq!(
            retention_action(3_100_000, 3_150_000, 3_202_025),
            RetentionAction::Unrecoverable
        );
    }
}
