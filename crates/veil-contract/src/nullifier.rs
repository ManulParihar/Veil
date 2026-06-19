//! Nullifier set — archival-safe (CLAUDE.md Part 6).
//!
//! Existence of a `DataKey::Nullifier(nf)` persistent entry means "spent". The
//! defensive rule the reference repo missed: **max TTL on every write**, so a
//! nullifier can never be archived-and-forgotten and thereby re-enable a
//! double-spend (a silent, catastrophic failure). The client is expected to
//! include candidate nullifier keys in the transaction footprint so CAP-0066
//! auto-restores any archived entry into the read set — meaning `is_spent`
//! can't falsely return `false` on an archived-but-real nullifier.

use soroban_sdk::{BytesN, Env};

use crate::storage::DataKey;

/// `true` iff this nullifier has been spent.
pub fn is_spent(env: &Env, nf: &BytesN<32>) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::Nullifier(nf.clone()))
}

/// Mark a nullifier spent. Persistent, max TTL.
pub fn mark_spent(env: &Env, nf: &BytesN<32>) {
    let key = DataKey::Nullifier(nf.clone());
    env.storage().persistent().set(&key, &());
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(&key, max, max);
}
