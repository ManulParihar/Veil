//! Incremental Merkle frontier tree + rolling root-history ring buffer.
//!
//! We store only the **frontier** (`levels` nodes), never the full 2^levels
//! tree — that's both impossible and unnecessary for an append-only tree. Two
//! leaves are inserted per `transact` (the two output commitments), so the
//! level-0 hash is always `Poseidon(cm0, cm1)` and `next_leaf_index` advances
//! by 2 and is always even.
//!
//! Frontier invariant (Tornado/MACI style): `FilledSubtree(level)` holds the
//! hash of the most-recent fully-filled left subtree at `level`. When we insert
//! and our node at `level` is a *left* child, we cache it there and pair with
//! the empty-subtree `Zero(level)`; when it's a *right* child, we pair the
//! stored frontier (left sibling) with our node.

use soroban_sdk::{BytesN, Env, Vec};

use crate::error::Error;
use crate::poseidon_host::{compress, zero_leaf_bytes};
use crate::storage;
use crate::types::Config;

/// Precompute the empty-subtree hashes `Zero(0..levels)` and seed the frontier
/// + the genesis root. Called once from `init`.
///
/// `Zero(0) = Poseidon(0)`, `Zero(i+1) = compress(Zero(i), Zero(i))`. The
/// genesis root is `Zero(levels)` (an all-empty tree) and is pushed at ring
/// index 0 so an empty tree already has a known root.
pub fn init(env: &Env, cfg: &Config) {
    // Precompute the empty-subtree hashes once and store them as a single
    // instance entry. The frontier (`FilledSubtree`) is NOT seeded: it is only
    // ever read after being written by a prior insert (a node at a level is only
    // a right child once a left child has been cached there), so seeding it
    // would waste `levels` ledger entries at init.
    let mut zero = zero_leaf_bytes(env);
    let mut zeros = Vec::new(env);
    zeros.push_back(zero.clone());
    for _level in 1..cfg.levels {
        zero = compress(env, &zero, &zero);
        zeros.push_back(zero.clone());
    }
    storage::set_zeros(env, &zeros);

    // Genesis root = Zero(levels): compress the top zero with itself once more.
    let genesis_root = compress(env, &zero, &zero);
    storage::set_root(env, 0, &genesis_root);
    storage::set_current_root_index(env, 0);
    storage::set_next_leaf_index(env, 0);
}

/// Insert two leaves, advance the root, push it into the ring buffer.
/// Returns the leaf indices `(idx0, idx1)` of the inserted commitments.
pub fn insert_two(
    env: &Env,
    leaf0: &BytesN<32>,
    leaf1: &BytesN<32>,
) -> Result<(u32, u32), Error> {
    let cfg = storage::config(env);
    let capacity = 1u32 << cfg.levels;
    let next = storage::next_leaf_index(env);
    // We consume two leaves; need both to fit.
    if next > capacity - 2 {
        return Err(Error::TreeFull);
    }

    // Level 0: combine the two fresh leaves. `pair_index` is this node's index
    // at level 1 (the level holding level-0 parents), so it walks up from there.
    let mut cur = compress(env, leaf0, leaf1);
    let mut pair_index = next >> 1;

    // Propagate up through levels 1..levels. At each level our node is either a
    // left child (cache it, pair with the empty subtree) or a right child (pair
    // the cached frontier on our left with us).
    for level in 1..cfg.levels {
        let (left, right) = if pair_index & 1 == 0 {
            storage::set_filled_subtree(env, level, &cur);
            (cur.clone(), storage::zero(env, level))
        } else {
            (storage::filled_subtree(env, level), cur.clone())
        };
        cur = compress(env, &left, &right);
        pair_index >>= 1;
    }

    // `cur` is now the new root. Push into the ring buffer.
    let new_root_idx = (storage::current_root_index(env) + 1) % cfg.root_history_size;
    storage::set_root(env, new_root_idx, &cur);
    storage::set_current_root_index(env, new_root_idx);
    storage::set_next_leaf_index(env, next + 2);

    Ok((next, next + 1))
}

/// Is `root` any of the last `root_history_size` roots? (Stale-root window —
/// mandatory for concurrency; an in-flight proof against a slightly-old root
/// must still verify.)
pub fn is_known_root(env: &Env, root: &BytesN<32>) -> bool {
    let cfg = storage::config(env);
    // Zero is never a valid root (genesis is Zero(levels), non-zero).
    if root.to_array() == [0u8; 32] {
        return false;
    }
    let current = storage::current_root_index(env);
    let mut i = current;
    // Walk the ring backwards from the current root for up to `size` slots.
    for _ in 0..cfg.root_history_size {
        if let Some(r) = storage::root(env, i) {
            if &r == root {
                return true;
            }
        }
        i = if i == 0 {
            cfg.root_history_size - 1
        } else {
            i - 1
        };
    }
    false
}

/// The current (most-recent) root. Exposed so the SDK can mirror the tree.
pub fn current_root(env: &Env) -> BytesN<32> {
    let idx = storage::current_root_index(env);
    storage::root(env, idx).unwrap()
}
