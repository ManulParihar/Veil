# Glossary

## AEAD

Authenticated encryption with associated data. Poof uses ChaCha20Poly1305 so wrong recipients or tampered ciphertexts fail to decrypt.

## BN254

The pairing-friendly curve family used by Poof's Groth16 proofs and field arithmetic.

## Blinding

Randomness inside a note commitment. It prevents equal note data from producing predictable commitments.

## Commitment

A hash that hides note data while binding the creator to it. In Poof: `Poseidon(amount, pk, blinding)`.

## Dummy Input

A zero-value input used to fill one of the fixed circuit input slots. Its Merkle membership check is disabled when amount is zero.

## ExtData

External transaction data: recipient, relayer, fee, ciphertexts, and view tags.

## `extDataHash`

Keccak hash of `ExtData`, reduced into the BN254 field. It binds external data to the proof.

## Field Element

A number modulo a prime. Poof uses BN254 scalar field elements for hashes, roots, nullifiers, and public signals.

## Groth16

A zkSNARK proving system with small proofs and fast verification. It requires a trusted setup.

## Incremental Merkle Tree

A Merkle tree optimized for appending leaves. Poof uses it to add new note commitments.

## Joinsplit

A private transaction that consumes input notes and creates output notes while proving value conservation.

## Merkle Path

The sibling hashes needed to prove a leaf belongs to a Merkle root.

## Merkle Root

The top hash of a Merkle tree. It summarizes all leaves.

## Note

An off-chain private UTXO containing amount, owner public key, and blinding.

## Nullifier

A public value derived from a note and spend key. It marks a note as spent without revealing which commitment it came from.

## Poseidon

A ZK-friendly hash function. Poof uses circomlib Poseidon over BN254.

## Public Signal

A public input/output value of a ZK circuit. Poof has seven public signals in a frozen order.

## Range Check

A circuit check proving a number is within a valid range. Poof checks amounts are 64-bit.

## Relayer

A third party that submits a transaction for a user. Relayers can hide the user's fee-paying account, but they are not implemented yet.

## Shielded Pool

A contract where private notes are represented on-chain by commitments and spent through nullifiers plus ZK proofs.

## Trusted Setup

A setup process that creates proving and verification keys. Groth16 needs one per circuit. Poof's current setup is single-contributor and not production-safe.

## UTXO

Unspent transaction output. In Poof, a note is the private equivalent of a UTXO.

## View Tag

A 1-byte filter attached to encrypted notes. It lets wallets skip most ciphertexts before trying full decryption.

## Witness

The private and public inputs used to generate a ZK proof.

## ZK Proof

A proof that a statement is true without revealing the private data behind it.
