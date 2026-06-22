# Blockchain And Contract Design

## Contract Role

The Soroban contract is the authority for the shielded pool.

It does not know private notes.

It does know:

- recent Merkle roots,
- spent nullifiers,
- output commitments,
- encrypted note event data,
- the Groth16 verification key.

## Initialization

The contract is initialized with:

```text
levels = 20
root_history_size = 64
```

During init it:

- stores config,
- computes empty-tree zero values,
- stores the genesis root,
- sets the next leaf index to 0.

The genesis root represents an empty Merkle tree.

## `transact`

`transact` is the main state-changing function.

Inputs:

- Groth16 proof,
- public signals,
- external data.

Its logic:

```text
1. Check initialized.
2. Check root is known.
3. Check nullifiers are distinct.
4. Check nullifiers are not spent.
5. Recompute extDataHash.
6. Check tree has room.
7. Verify Groth16 proof.
8. Mark nullifiers spent.
9. Insert two output commitments.
10. Accept `publicAmount` as circuit-balanced accounting, but do not settle a real token yet.
11. Emit events.
```

Why this order matters:

The contract avoids changing state until the proof has passed.

## Nullifier Storage

What it is:

The contract stores one persistent entry per nullifier.

Why:

A nullifier must never be forgotten. If it disappeared, a spent note might become spendable again.

Soroban-specific design:

The code uses persistent storage and max TTL extension for nullifiers.

Why not store a growing map:

One key per nullifier is simpler for lookup, storage footprint, and archival handling.

## Merkle Tree Storage

The contract uses an incremental Merkle frontier.

It does not store every node in the full tree.

It stores:

- current root index,
- next leaf index,
- recent roots,
- empty subtree values,
- filled subtree frontier values.

Why:

A full depth-20 tree has over one million leaves. Storing the whole tree on-chain would be wasteful.

## Root History

The contract stores a rolling history of recent roots.

Why:

A user may build a proof using root `R`, but another transaction may update the tree before their transaction lands.

Without root history:

Most concurrent usage would fail unnecessarily.

With root history:

The proof remains valid if `R` is still within the history window.

## Events

The contract emits events so clients and the indexer can track state.

Important events:

- commitment event with ciphertext and view tag,
- nullifier event,
- transact event with the new root.

Why ciphertext is emitted:

The recipient needs a way to discover their note.

Why the indexer exists:

RPC may not retain old events forever.

## Public Amount Rule

The circuit supports `publicAmount`, and the current contract accepts non-zero values as testnet accounting.

Meaning:

- private transfer: allowed with `publicAmount = 0`,
- deposit-style mint: accepted as unbacked shielded test credits,
- withdrawal-style burn: accepted as accounting only,
- real Stellar token transfer: not wired yet.

Why include it now:

The circuit and public signal layout are compatible with public settlement.

## Deployment

The repository includes a testnet deployment script.

The recorded deployment uses:

- Stellar testnet,
- depth 20,
- root history 64,
- real BN254 Groth16 verification,
- optimized contract wasm.

The README and `deploy/addresses.json` record a live testnet contract and first real private transfer transaction.

## Design Risks

## Event Name Inconsistency

The written interface and indexer expect `NewCommitment`.

The current contract emits `NewCommit`.

This should be checked before using the indexer against the deployed contract.

## Single-Contributor Trusted Setup

A malicious or compromised setup could break soundness.

Production needs a real ceremony or a proving system with better setup assumptions.

## Fee-Payer Visibility

Without relayers, the account submitting the transaction is public.

The proof may hide the note, but the submitter can still leak user activity.

## What To Google Next

- Soroban persistent storage TTL
- Soroban events
- BN254 pairing check Soroban
- Incremental Merkle frontier
- Smart contract nullifier set
- Trusted setup toxic waste
