# Core Concepts

## Shielded Pool

What it is:

A shielded pool is a smart contract that holds value while hiding ownership and transfer details.

Why it exists in Veil:

Veil wants private transfers on a public blockchain.

How it is used here:

The contract stores commitments and nullifiers, not account balances.

Why this approach:

It follows the common private-payment pattern used by systems like Zcash and Tornado-style mixers.

## Note

What it is:

A note is a private off-chain object representing spendable value.

In Veil, a note contains:

```text
amount
owner public key
blinding randomness
```

Why it exists:

The note is the private UTXO. Whoever knows the note data and the spend key can spend it.

How it is used here:

The SDK stores notes locally. The contract only sees each note's commitment.

Important point:

If the wallet loses the note secret, the on-chain commitment alone is not enough to spend it.

## Commitment

What it is:

A commitment is a hash that hides data but binds the creator to that data.

In Veil:

```text
commitment = Poseidon(amount, pk, blinding)
```

Why it exists:

The commitment lets the contract record that a note exists without revealing the amount or owner.

How it is used:

Output commitments are inserted into the contract's Merkle tree.

Why blinding matters:

Without randomness, two equal notes to the same owner could produce the same commitment.

Alternatives:

- Pedersen commitments
- SHA-256 commitments
- Keccak commitments
- MiMC commitments

Poseidon is chosen because it is efficient inside ZK circuits.

## Nullifier

What it is:

A nullifier is a public value that marks a private note as spent.

In Veil:

```text
signature = Poseidon(sk, commitment, pathIndex)
nullifier = Poseidon(commitment, pathIndex, signature)
```

Why it exists:

The contract cannot see which note was spent, but it must still prevent double spending.

How it is used:

The contract stores one persistent entry per nullifier. If a nullifier appears again, the transaction is rejected.

Why it is unlinkable:

Observers see the nullifier, but without the private note data and key they should not be able to connect it to the original commitment.

## Merkle Tree

What it is:

A Merkle tree is a hash tree where many leaves are summarized by one root.

Why it exists in Veil:

It lets the circuit prove "my note commitment exists in the pool" without revealing which leaf it is.

How it is used:

- Commitments are leaves.
- The contract stores an incremental Merkle tree.
- The SDK mirrors the tree to build Merkle paths.
- The circuit checks membership against a public root.

Design choice:

The tree depth is 20, so it can hold `2^20` leaves.

## Merkle Root History

What it is:

A rolling list of recent Merkle roots.

Why it exists:

Proof generation takes time. While a user is proving against root `R`, another transaction may advance the tree.

How it is used:

The contract accepts proofs against any root in the recent root history, not just the newest root.

Current setting:

The root history size is 64.

## Dummy Input

What it is:

A zero-value fake input used to fill a fixed-size circuit slot.

Why it exists:

The circuit always expects exactly two inputs. A normal wallet transfer may only need one real input.

How it is used:

If `amount == 0`, the circuit gates off the Merkle membership check.

Important point:

The dummy still has to produce a self-consistent nullifier, and the two nullifiers must be different.

## Public Amount

What it is:

A public field used for deposit and withdrawal edges.

In Veil's equation:

```text
publicAmount + sum(inputs) = sum(outputs)
```

How it is used now:

Phase 1 requires `publicAmount = 0`.

Why it exists already:

It allows the same circuit structure to support future deposits and withdrawals.

## ExtData

What it is:

External transaction data carried alongside the proof.

It includes:

- recipient,
- relayer,
- fee,
- two ciphertexts,
- two view tags.

Why it exists:

Not all transaction metadata belongs inside the circuit, but it must still be protected from tampering.

How it is used:

The SDK computes:

```text
extDataHash = keccak256(encoded ExtData) mod BN254 field
```

The circuit takes this hash as a public signal. The contract recomputes the hash and rejects mismatches.

## What To Google Next

- UTXO model
- Zcash note commitment
- Nullifier private payments
- Merkle membership proof
- Incremental Merkle tree
- Public inputs in zkSNARKs
