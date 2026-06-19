# Veil Project Overview

## What Veil Is

Veil is a UTXO-style private payment protocol on Stellar/Soroban.

It works like a shielded pool:

- Real value is intended to be held by one Soroban smart contract.
- Private balances are represented by off-chain notes.
- On-chain, each note appears only as a Poseidon commitment in a Merkle tree.
- Spending a note reveals a nullifier and a Groth16 proof, not the note itself.

In plain language: Veil tries to let users transfer value without publicly revealing which note they spent, how much it was worth, or who owns it.

## The Main Problem It Solves

Normal blockchain transfers are easy to trace:

- sender is visible,
- recipient is visible,
- amount is visible,
- transaction history is linkable.

Veil hides the private payment state by replacing visible account balances with hidden notes.

An observer sees:

- commitments being added to a pool,
- nullifiers being published later,
- encrypted ciphertexts for note delivery,
- a proof that the rules were followed.

The observer should not be able to link a spent nullifier to the original note commitment.

## What Is Real In This Repository

The repository implements the important privacy machinery:

- Circom circuit for a 2-input / 2-output transaction.
- Poseidon commitments and nullifiers over BN254.
- Merkle membership checks.
- 64-bit amount range checks.
- Value conservation inside the circuit.
- Groth16 proof generation with `snarkjs`.
- Real Groth16 verification inside the Soroban contract using BN254 host functions.
- Nullifier tracking to prevent double spends.
- Encrypted note events and an indexer to persist them.

The README says a real private transfer has already been deployed and executed on Stellar testnet.

## What Is Simplified Or Deferred

This is research-grade, not production-ready.

Important simplifications:

- The trusted setup is single-contributor, not a real ceremony.
- Phase 1 only supports private transfers with `publicAmount = 0`.
- Deposit and withdrawal token settlement are not wired yet.
- The SDK wallet currently builds transfers using one real input plus one dummy input, even though the circuit supports two real inputs.
- Relayers are not implemented, so the fee-payer can still reveal who submitted the transaction.
- Viewing-key delegation exists in the key hierarchy but is not fully used.

## The Four Main Planes

## 1. Crypto Core

Path: `crates/veil-crypto`

This is the source of truth for:

- BN254 field encoding,
- Poseidon hash,
- note commitments,
- key-derived public keys,
- nullifier derivation.

This crate is intentionally shared by the SDK and contract so they do not accidentally compute different hashes.

## 2. Circuits

Path: `circuits/`

The circuit proves:

- I know the private key for the input note.
- The input note commitment is in a known Merkle root.
- The nullifier was derived correctly.
- Output commitments were derived correctly.
- Amounts are 64-bit values.
- `publicAmount + input amounts = output amounts`.

The circuit produces Groth16 proofs.

## 3. Contract

Path: `crates/veil-contract`

The Soroban contract is the authority.

It:

- stores the Merkle tree root history,
- rejects unknown roots,
- rejects spent nullifiers,
- verifies the Groth16 proof,
- inserts output commitments,
- emits events for note discovery.

## 4. Client SDK And Indexer

Paths:

- `crates/veil-sdk`
- `indexer/`

The SDK handles wallet-side logic:

- key derivation,
- note encryption,
- note scanning,
- Merkle path construction,
- witness JSON construction,
- proof generation through `snarkjs`.

The indexer persists events because Stellar RPC event history is temporary.

## Core Mental Model

Think of Veil as a private UTXO system:

```text
Private note secret
    -> commitment goes into public tree
    -> later, nullifier proves the note is spent
    -> ZK proof proves this was valid
    -> new commitments are inserted
```

The contract never learns the private note details. It only checks that the proof is valid and the nullifiers are unused.

## What To Google Next

- Zcash notes and nullifiers
- Tornado Cash commitments and nullifiers
- Groth16 zkSNARK
- Circom public signals
- Poseidon hash function
- Incremental Merkle tree
- Stellar Soroban smart contracts
