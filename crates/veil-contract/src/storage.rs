//! Storage schema + typed accessors + TTL helpers (CLAUDE.md Part 6).
//!
//! Split by mutation frequency and archival risk:
//!  * **instance** storage — small global config-ish state, shares the contract
//!    TTL, bumped together.
//!  * **persistent** storage — anything unbounded or that must survive archival.
//!    Critically, **one entry per nullifier** (never a growing `Map`), and the
//!    frontier / zeros / root-ring as individual keyed entries.

use soroban_sdk::{contracttype, Address, BytesN, Env, Vec};

use crate::types::Config;

/// How long (in ledgers) before an instance entry would expire, and the target
/// we bump it back up to. Soroban requires `extend_to >= threshold`.
const INSTANCE_BUMP_THRESHOLD: u32 = 518_400; // ~30 days at 5s ledgers
const INSTANCE_BUMP_AMOUNT: u32 = 1_036_800; // ~60 days

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    // ── instance storage (small, global) ──
    Admin,
    Config,
    /// Multi-currency registry: the Stellar Asset Contract (SAC) backing the
    /// currency with this `u32` id. Index 0 is the init token (native XLM).
    Token(u32),
    /// Number of registered currencies; also the next id `register_token` assigns.
    TokenCount,
    CurrentRootIndex,
    NextLeafIndex,
    /// Precomputed empty-subtree hashes per level `[0..levels]`, held as a
    /// single instance entry. Constant for the contract's life, so storing them
    /// as one shared entry (instead of `levels` persistent entries) keeps the
    /// per-transaction footprint well under Soroban's 100-ledger-entry limit.
    Zeros,

    // ── persistent storage (rent-managed, archival-safe) ──
    /// Frontier node per level `[0..levels]` (the incremental-tree "filled
    /// subtree" cache). Written lazily as the tree fills; only ever read after
    /// being written, so it is never seeded at init.
    FilledSubtree(u32),
    /// Rolling root history `[0..root_history_size]`.
    Root(u32),
    /// Existence == spent. ONE ENTRY PER NULLIFIER (no growing map).
    Nullifier(BytesN<32>),
}

/// Bump the instance entry TTL so config/cursors don't get archived under the
/// contract. Called from every state-mutating entry point.
pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

// ── init / admin ──

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

// ── config ──

pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
}

pub fn config(env: &Env) -> Config {
    env.storage().instance().get(&DataKey::Config).unwrap()
}

// ── token registry (multi-currency) ──

pub fn set_token(env: &Env, id: u32, token: &Address) {
    env.storage().instance().set(&DataKey::Token(id), token);
}

/// The SAC address registered for currency `id`, or `None` if unregistered.
pub fn token(env: &Env, id: u32) -> Option<Address> {
    env.storage().instance().get(&DataKey::Token(id))
}

pub fn set_token_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::TokenCount, &count);
}

pub fn token_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::TokenCount)
        .unwrap_or(0)
}

// ── cursors ──

pub fn set_current_root_index(env: &Env, idx: u32) {
    env.storage()
        .instance()
        .set(&DataKey::CurrentRootIndex, &idx);
}

pub fn current_root_index(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::CurrentRootIndex)
        .unwrap_or(0)
}

pub fn set_next_leaf_index(env: &Env, idx: u32) {
    env.storage().instance().set(&DataKey::NextLeafIndex, &idx);
}

pub fn next_leaf_index(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::NextLeafIndex)
        .unwrap_or(0)
}

// ── frontier / zeros / roots (persistent) ──

pub fn set_filled_subtree(env: &Env, level: u32, node: &BytesN<32>) {
    env.storage()
        .persistent()
        .set(&DataKey::FilledSubtree(level), node);
}

pub fn filled_subtree(env: &Env, level: u32) -> BytesN<32> {
    env.storage()
        .persistent()
        .get(&DataKey::FilledSubtree(level))
        .unwrap()
}

pub fn set_zeros(env: &Env, zeros: &Vec<BytesN<32>>) {
    env.storage().instance().set(&DataKey::Zeros, zeros);
}

pub fn zeros(env: &Env) -> Vec<BytesN<32>> {
    env.storage().instance().get(&DataKey::Zeros).unwrap()
}

pub fn zero(env: &Env, level: u32) -> BytesN<32> {
    zeros(env).get(level).unwrap()
}

pub fn set_root(env: &Env, ring_idx: u32, root: &BytesN<32>) {
    env.storage().persistent().set(&DataKey::Root(ring_idx), root);
}

pub fn root(env: &Env, ring_idx: u32) -> Option<BytesN<32>> {
    env.storage().persistent().get(&DataKey::Root(ring_idx))
}

/// Bump the persistent tree entries that exist so structural state can't be
/// archived out from under the contract. Zeros live in instance storage (bumped
/// by `bump_instance`). The frontier is bumped only at the levels actually
/// written so far; roots get a max-TTL bump while they are the live root, which
/// (since max_ttl ≫ the time a root stays in the `root_history_size` ring) keeps
/// every in-window root alive without scanning the whole ring each call. This
/// keeps the per-transaction footprint small. Nullifiers get their own max-TTL
/// bump in `nullifier::mark_spent`.
pub fn bump_tree(env: &Env, cfg: &Config) {
    let max = env.storage().max_ttl();
    let p = env.storage().persistent();
    for level in 0..cfg.levels {
        if p.has(&DataKey::FilledSubtree(level)) {
            p.extend_ttl(&DataKey::FilledSubtree(level), max, max);
        }
    }
    let cur = current_root_index(env);
    if p.has(&DataKey::Root(cur)) {
        p.extend_ttl(&DataKey::Root(cur), max, max);
    }
}
