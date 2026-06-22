-- Poof indexer schema.
-- All field elements (cm, nf) are stored as 64-char lowercase hex of the
-- 32-byte big-endian wire encoding (INTERFACES.md §1), used as TEXT primary keys.
-- ciphertext is stored as hex of the raw AEAD blob.

-- NewCommitment events. One row per inserted leaf.
CREATE TABLE IF NOT EXISTS commitments (
    cm          TEXT    PRIMARY KEY,            -- 32-byte commitment, hex
    leaf_index  INTEGER NOT NULL,               -- u32 position in the Merkle tree
    ciphertext  TEXT    NOT NULL,               -- AEAD blob, hex
    view_tag    INTEGER NOT NULL,               -- u32 (1-byte tag widened on the wire)
    ledger      INTEGER NOT NULL,               -- ledger sequence the event landed in
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Fast scan by leaf_index for GET /notes?since_index=N.
CREATE INDEX IF NOT EXISTS idx_commitments_leaf_index ON commitments (leaf_index);

-- Nullifier events. Existence = spent.
CREATE TABLE IF NOT EXISTS nullifiers (
    nf          TEXT    PRIMARY KEY,            -- 32-byte nullifier, hex
    ledger      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Fast scan by ledger for GET /nullifiers?since=L.
CREATE INDEX IF NOT EXISTS idx_nullifiers_ledger ON nullifiers (ledger);

-- Singleton checkpoint: the last ledger fully ingested. id is pinned to 0.
CREATE TABLE IF NOT EXISTS checkpoint (
    id                   INTEGER PRIMARY KEY CHECK (id = 0),
    last_ingested_ledger INTEGER NOT NULL
);

-- Optional: last observed tree root (from the Transact event), for GET /tree/root.
CREATE TABLE IF NOT EXISTS tree_root (
    id     INTEGER PRIMARY KEY CHECK (id = 0),
    root   TEXT    NOT NULL,                    -- 32-byte root, hex
    ledger INTEGER NOT NULL
);
