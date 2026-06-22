# System Architecture

## Big Picture

Poof is split into separate components so each part has a clear job.

```text
SDK / Wallet
  builds notes, paths, ciphertexts, witness, proof

Circom Circuit
  proves ownership, membership, nullifier correctness, and conservation

Soroban Contract
  verifies proof, prevents double spends, updates tree, emits events

Indexer
  stores emitted events permanently for wallet scanning
```

The most important architectural rule is that Poseidon and note math must match everywhere.

If the SDK, circuit, and contract disagree about even one hash input order, the system breaks.

## Crypto: `poof-crypto`

This crate defines the shared cryptographic formulas.

Important formulas:

```text
pk         = Poseidon(sk)
commitment = Poseidon(amount, pk, blinding)
signature  = Poseidon(sk, commitment, pathIndex)
nullifier  = Poseidon(commitment, pathIndex, signature)
```

Why it exists:

- The SDK needs these formulas to build witnesses.
- The circuit enforces these formulas.
- The contract stores and checks their public outputs.

Why this approach was chosen:

- Keeping the Rust implementation in one crate reduces the risk of hash mismatches.
- The circuit still uses Circom's Poseidon template, so tests pin cross-implementation vectors.

## Circuits

The circuit is a 2-input / 2-output joinsplit.

It checks:

- each input note is well-formed,
- each real input belongs to the Merkle tree,
- the spender knows the private key,
- nullifiers are computed correctly,
- the two input nullifiers differ,
- output commitments are computed correctly,
- amounts are range checked,
- value is conserved.

The public signals are frozen in this order:

```text
[root, publicAmount, extDataHash, nf0, nf1, cm0, cm1]
```

Why this matters:

- The verification key is generated for exactly this public input order.
- The contract must pass the same order into Groth16 verification.

## Soroban Contract

The contract has one main mutating call: `transact`.

Its order is:

```text
validate -> verify proof -> mutate state -> emit events
```

It validates:

- contract is initialized,
- root is known,
- nullifiers are distinct,
- nullifiers are unspent,
- `extDataHash` matches the supplied external data,
- tree has room.

Then it verifies the Groth16 proof.

Only after proof verification does it:

- mark nullifiers spent,
- insert two output commitments,
- accept `publicAmount` as circuit-balanced testnet accounting, but without real token settlement yet,
- emit events.

Why this design matters:

- Invalid proofs cannot mutate state.
- Failed transactions do not burn nullifiers.
- Double spends are blocked by persistent nullifier entries.

## SDK

The SDK is the wallet-side library.

It:

- derives spend and encryption keys from a seed,
- stores owned notes locally,
- mirrors the Merkle tree,
- builds Merkle paths,
- encrypts output notes,
- computes `extDataHash`,
- builds circuit witness JSON,
- shells out to `snarkjs` for proof generation.

The current wallet transfer builder uses:

- one real input note,
- one zero-value dummy input,
- recipient output,
- change output.

The circuit can handle two real inputs, but this wallet selection logic is simpler for the MVP.

## Indexer

The indexer watches contract events and stores them in SQLite.

It stores:

- commitments and ciphertexts,
- nullifiers,
- latest observed root,
- ingestion checkpoint.

Why it exists:

- RPC event history can expire.
- Wallets need old ciphertext events to discover notes.
- Wallets also need nullifier events to reconcile local spend state.

## Important Interfaces

## Field Encoding

All field elements use 32-byte big-endian encoding on the wire.

This includes:

- roots,
- commitments,
- nullifiers,
- public signals,
- field-derived keys.

## Events

The intended event schema in `INTERFACES.md` says:

```text
NewCommitment(commitment, leaf_index, ciphertext, view_tag)
Nullifier(nullifier)
Transact(root)
```

One implementation detail to notice:

- `INTERFACES.md` and the indexer expect `NewCommitment`.
- The current contract code emits the short Soroban symbol `NewCommit`.

That appears to be an integration inconsistency in the repository and should be checked before relying on the live indexer.

## What To Google Next

- Layered protocol architecture
- zkSNARK public inputs
- Smart contract event indexing
- UTXO wallet architecture
- Soroban event format
