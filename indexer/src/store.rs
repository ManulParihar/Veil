//! Persistence over SQLite (`rusqlite`, bundled). Idempotent upserts so
//! re-ingesting a ledger is safe; `:memory:` mode for tests.
//!
//! Wire encoding (INTERFACES.md §1): field elements are 32-byte big-endian.
//! On disk they are stored as 64-char lowercase hex TEXT primary keys, which is
//! human-debuggable and gives us free uniqueness for idempotency.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};

use crate::types::{CommitmentRow, NoteRow, NullifierRow};

/// Embedded schema, also shipped as `migrations/0001_init.sql`.
const SCHEMA: &str = include_str!("../migrations/0001_init.sql");

/// Thread-safe SQLite store. The connection is wrapped in a `Mutex` so the
/// store can be shared (`Arc<Store>`) across the ingest loop and the axum
/// handlers without an async pool — fine at MVP scale.
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Open (or create) a store at `path`, applying the schema.
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let conn = Connection::open(path)?;
        Self::from_conn(conn)
    }

    /// In-memory store for tests.
    pub fn in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory()?;
        Self::from_conn(conn)
    }

    fn from_conn(conn: Connection) -> anyhow::Result<Self> {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A poisoned lock means a prior panic while holding it; we recover the
        // guard because the DB itself is still consistent (writes are atomic).
        self.conn.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ── writes (idempotent) ──────────────────────────────────────────────

    /// Insert a commitment. Idempotent on `cm` (re-ingest is a no-op).
    pub fn upsert_commitment(&self, row: &CommitmentRow) -> anyhow::Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO commitments (cm, leaf_index, ciphertext, view_tag, ledger)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(cm) DO NOTHING",
            params![
                row.cm,
                row.leaf_index,
                row.ciphertext,
                row.view_tag,
                row.ledger,
            ],
        )?;
        Ok(())
    }

    /// Insert a nullifier. Idempotent on `nf`.
    pub fn upsert_nullifier(&self, row: &NullifierRow) -> anyhow::Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO nullifiers (nf, ledger) VALUES (?1, ?2)
             ON CONFLICT(nf) DO NOTHING",
            params![row.nf, row.ledger],
        )?;
        Ok(())
    }

    /// Record the latest observed tree root (Transact event). Idempotent
    /// singleton: always overwrites the single row.
    pub fn set_root(&self, root: &str, ledger: u64) -> anyhow::Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO tree_root (id, root, ledger) VALUES (0, ?1, ?2)
             ON CONFLICT(id) DO UPDATE SET root = excluded.root, ledger = excluded.ledger",
            params![root, ledger],
        )?;
        Ok(())
    }

    // ── checkpoint ───────────────────────────────────────────────────────

    /// The last fully-ingested ledger, or `None` if never set.
    pub fn checkpoint(&self) -> anyhow::Result<Option<u64>> {
        let conn = self.lock();
        let v: Option<i64> = conn
            .query_row(
                "SELECT last_ingested_ledger FROM checkpoint WHERE id = 0",
                [],
                |r| r.get(0),
            )
            .optional()?;
        Ok(v.map(|x| x as u64))
    }

    /// Persist the checkpoint (singleton upsert).
    pub fn set_checkpoint(&self, ledger: u64) -> anyhow::Result<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO checkpoint (id, last_ingested_ledger) VALUES (0, ?1)
             ON CONFLICT(id) DO UPDATE SET last_ingested_ledger = excluded.last_ingested_ledger",
            params![ledger as i64],
        )?;
        Ok(())
    }

    // ── reads (API) ──────────────────────────────────────────────────────

    /// Notes with `leaf_index >= since_index`, ordered ascending — the client
    /// scan feed for `GET /notes`.
    pub fn notes_since(&self, since_index: u32) -> anyhow::Result<Vec<NoteRow>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT cm, leaf_index, ciphertext, view_tag
             FROM commitments WHERE leaf_index >= ?1 ORDER BY leaf_index ASC",
        )?;
        let rows = stmt
            .query_map(params![since_index], |r| {
                Ok(NoteRow {
                    cm: r.get(0)?,
                    idx: r.get::<_, i64>(1)? as u32,
                    ct: r.get(2)?,
                    view_tag: r.get::<_, i64>(3)? as u32,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// Nullifiers seen at `ledger >= since`, for spend-state checks.
    pub fn nullifiers_since(&self, since: u64) -> anyhow::Result<Vec<String>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT nf FROM nullifiers WHERE ledger >= ?1 ORDER BY ledger ASC, nf ASC",
        )?;
        let rows = stmt
            .query_map(params![since as i64], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// True if this nullifier has been observed (note is spent).
    pub fn is_spent(&self, nf: &str) -> anyhow::Result<bool> {
        let conn = self.lock();
        let n: i64 = conn.query_row(
            "SELECT COUNT(1) FROM nullifiers WHERE nf = ?1",
            params![nf],
            |r| r.get(0),
        )?;
        Ok(n > 0)
    }

    /// Latest observed root, if any.
    pub fn root(&self) -> anyhow::Result<Option<(String, u64)>> {
        let conn = self.lock();
        let v = conn
            .query_row("SELECT root, ledger FROM tree_root WHERE id = 0", [], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64))
            })
            .optional()?;
        Ok(v)
    }

    // ── test/diagnostic helpers ──────────────────────────────────────────

    /// Count of commitment rows.
    pub fn commitment_count(&self) -> anyhow::Result<u64> {
        let conn = self.lock();
        let n: i64 = conn.query_row("SELECT COUNT(1) FROM commitments", [], |r| r.get(0))?;
        Ok(n as u64)
    }

    /// Count of nullifier rows.
    pub fn nullifier_count(&self) -> anyhow::Result<u64> {
        let conn = self.lock();
        let n: i64 = conn.query_row("SELECT COUNT(1) FROM nullifiers", [], |r| r.get(0))?;
        Ok(n as u64)
    }

    /// Fetch a single commitment row by `cm` (for tests).
    pub fn get_commitment(&self, cm: &str) -> anyhow::Result<Option<CommitmentRow>> {
        let conn = self.lock();
        let v = conn
            .query_row(
                "SELECT cm, leaf_index, ciphertext, view_tag, ledger
                 FROM commitments WHERE cm = ?1",
                params![cm],
                |r| {
                    Ok(CommitmentRow {
                        cm: r.get(0)?,
                        leaf_index: r.get::<_, i64>(1)? as u32,
                        ciphertext: r.get(2)?,
                        view_tag: r.get::<_, i64>(3)? as u32,
                        ledger: r.get::<_, i64>(4)? as u64,
                    })
                },
            )
            .optional()?;
        Ok(v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cm_row(cm: &str, idx: u32, ledger: u64) -> CommitmentRow {
        CommitmentRow {
            cm: cm.to_string(),
            leaf_index: idx,
            ciphertext: "deadbeef".to_string(),
            view_tag: 7,
            ledger,
        }
    }

    #[test]
    fn upsert_commitment_is_idempotent() {
        let s = Store::in_memory().unwrap();
        let row = cm_row("aa", 0, 10);
        s.upsert_commitment(&row).unwrap();
        // Re-ingesting the same cm (even with different secondary fields) must
        // NOT create a second row.
        s.upsert_commitment(&cm_row("aa", 0, 10)).unwrap();
        s.upsert_commitment(&cm_row("aa", 999, 999)).unwrap();
        assert_eq!(s.commitment_count().unwrap(), 1);

        let got = s.get_commitment("aa").unwrap().unwrap();
        assert_eq!(got.leaf_index, 0); // original kept, second insert ignored
    }

    #[test]
    fn upsert_nullifier_is_idempotent() {
        let s = Store::in_memory().unwrap();
        s.upsert_nullifier(&NullifierRow {
            nf: "bb".into(),
            ledger: 5,
        })
        .unwrap();
        s.upsert_nullifier(&NullifierRow {
            nf: "bb".into(),
            ledger: 5,
        })
        .unwrap();
        assert_eq!(s.nullifier_count().unwrap(), 1);
        assert!(s.is_spent("bb").unwrap());
        assert!(!s.is_spent("cc").unwrap());
    }

    #[test]
    fn checkpoint_roundtrips() {
        let s = Store::in_memory().unwrap();
        assert_eq!(s.checkpoint().unwrap(), None);
        s.set_checkpoint(42).unwrap();
        assert_eq!(s.checkpoint().unwrap(), Some(42));
        s.set_checkpoint(100).unwrap();
        assert_eq!(s.checkpoint().unwrap(), Some(100));
    }

    #[test]
    fn notes_since_filters_and_orders() {
        let s = Store::in_memory().unwrap();
        s.upsert_commitment(&cm_row("c2", 2, 1)).unwrap();
        s.upsert_commitment(&cm_row("c0", 0, 1)).unwrap();
        s.upsert_commitment(&cm_row("c1", 1, 1)).unwrap();

        let all = s.notes_since(0).unwrap();
        assert_eq!(all.iter().map(|n| n.idx).collect::<Vec<_>>(), vec![0, 1, 2]);

        let tail = s.notes_since(1).unwrap();
        assert_eq!(tail.iter().map(|n| n.idx).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn nullifiers_since_filters() {
        let s = Store::in_memory().unwrap();
        s.upsert_nullifier(&NullifierRow {
            nf: "n1".into(),
            ledger: 1,
        })
        .unwrap();
        s.upsert_nullifier(&NullifierRow {
            nf: "n2".into(),
            ledger: 5,
        })
        .unwrap();
        assert_eq!(s.nullifiers_since(0).unwrap().len(), 2);
        assert_eq!(s.nullifiers_since(2).unwrap(), vec!["n2".to_string()]);
    }

    #[test]
    fn root_roundtrips() {
        let s = Store::in_memory().unwrap();
        assert!(s.root().unwrap().is_none());
        s.set_root("rooot", 9).unwrap();
        assert_eq!(s.root().unwrap(), Some(("rooot".to_string(), 9)));
        s.set_root("newroot", 12).unwrap();
        assert_eq!(s.root().unwrap(), Some(("newroot".to_string(), 12)));
    }
}
