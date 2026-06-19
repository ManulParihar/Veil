# Design Decisions

## Use UTXO-Style Notes Instead Of Account Balances

Why:

Account balances are hard to hide on-chain because every update links to the same account.

Notes are easier to make private:

- commitments hide created notes,
- nullifiers mark spent notes,
- Merkle proofs show membership without revealing which note.

Alternative:

An account-based private balance system could use encrypted balances and proofs, but it usually creates more complex state updates and linkability problems.

## Use Poseidon For Commitments And Merkle Hashes

Why:

The circuit must recompute commitments, nullifiers, and Merkle roots.

Poseidon is efficient in arithmetic circuits, so it keeps constraint costs lower than SHA-256 or Keccak.

Specific choice:

The repo uses original circomlib Poseidon over BN254.

Why not Poseidon2 yet:

The MVP prioritizes matching Circom and Rust implementations over using the newest variant.

## Use Groth16

Why:

Groth16 gives small proofs and efficient verification.

Why it fits Soroban here:

Soroban SDK exposes native BN254 pairing functions.

Tradeoff:

Groth16 needs a circuit-specific trusted setup.

Current limitation:

The setup is single-contributor, so this is not production-safe.

## Use A Fixed 2-Input / 2-Output Circuit

Why:

Fixed-size circuits are simpler and have predictable proving and verification behavior.

How it works:

- two input slots,
- two output slots,
- dummy zero-value inputs when fewer real notes are used.

Tradeoff:

The wallet may need more transactions if it has many small notes. A larger circuit could aggregate more notes but would be more expensive.

Alternatives:

- 1-input / 2-output: simpler, less flexible.
- 4-input / 2-output: more flexible, larger circuit.
- Dynamic inputs: harder in this proving setup.

## Use A Rolling Root History

Why:

Proof generation is not instant. The tree can change before a transaction lands.

Design:

The contract accepts recent roots, not only the latest root.

Tradeoff:

More root history means more storage, but better usability under concurrency.

## Use One Persistent Entry Per Nullifier

Why:

Double-spend prevention is critical.

If nullifier storage fails, the money system fails.

Design:

Each nullifier gets its own persistent storage key and max TTL extension.

Alternative:

A single growing map is less clean for archival and footprint behavior.

## Use `extDataHash`

Why:

The proof must bind to external data like recipient, relayer, fee, and ciphertexts.

Without this:

A valid proof might be replayed with modified external data.

Design:

- SDK hashes the external data.
- Circuit includes the hash as a public signal.
- Contract recomputes and compares it.

## Use X25519 And ChaCha20Poly1305 For Note Encryption

Why:

Encryption is off-chain and does not need to happen inside the circuit.

X25519 gives simple ECDH. ChaCha20Poly1305 gives authenticated encryption.

Why separate from BN254:

BN254 is used for ZK arithmetic. X25519 is a standard practical encryption curve.

Tradeoff:

Wallets need both BN254 note keys and X25519 encryption keys.

## Use An Indexer

Why:

Wallets need to scan historical note ciphertexts.

Problem:

Stellar RPC event retention is temporary.

Design:

The indexer persists events in SQLite and exposes a simple HTTP API.

Tradeoff:

The indexer is extra infrastructure. Users may need a trusted or self-hosted indexer unless a decentralized indexing solution is used.

## Reject Non-Zero `publicAmount` In Phase 1

Why:

The circuit is already designed for deposits and withdrawals, but token custody edges are not implemented.

Design:

The contract rejects non-zero `publicAmount` with `InsufficientFunds`.

Benefit:

The public signal layout does not need to change later.

## What To Google Next

- Zcash Sapling design
- Tornado Cash architecture
- Groth16 trusted setup tradeoffs
- Poseidon versus MiMC
- UTXO coin selection
- Relayers for private transactions
