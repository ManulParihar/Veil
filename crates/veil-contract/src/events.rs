//! Event emission (INTERFACES §5). The indexer ingests these to build the
//! permanent off-chain view (RPC retention is ≤7 days, so the indexer is the
//! durable record).
//!
//! We use the explicit `events().publish(topics, data)` API rather than the
//! newer `#[contractevent]` macro because INTERFACES §5 freezes the exact topic
//! symbols and data-tuple shapes; `publish` emits precisely that wire format.

#![allow(deprecated)]

use soroban_sdk::{symbol_short, Address, Bytes, BytesN, Env};

/// `NewCommitment(commitment, leaf_index, ciphertext, view_tag)`.
/// One per inserted output commitment; carries the AEAD ciphertext + view tag
/// so recipients can discover the note by trial-decryption.
pub fn new_commitment(
    env: &Env,
    commitment: &BytesN<32>,
    leaf_index: u32,
    ciphertext: &Bytes,
    view_tag: u32,
) {
    let topics = (symbol_short!("NewCommit"),);
    env.events().publish(
        topics,
        (commitment.clone(), leaf_index, ciphertext.clone(), view_tag),
    );
}

/// `Nullifier(nullifier)` — emitted per spent input so the indexer can track
/// spend state.
pub fn nullifier(env: &Env, nf: &BytesN<32>) {
    let topics = (symbol_short!("Nullifier"),);
    env.events().publish(topics, nf.clone());
}

/// `Transact(root)` — emitted once per call with the new tree root.
pub fn transact(env: &Env, root: &BytesN<32>) {
    let topics = (symbol_short!("Transact"),);
    env.events().publish(topics, (root.clone(),));
}

/// `TokenReg(currency_id, token)` — emitted when the admin registers a new asset.
pub fn token_registered(env: &Env, currency_id: u32, token: &Address) {
    let topics = (symbol_short!("TokenReg"),);
    env.events().publish(topics, (currency_id, token.clone()));
}
