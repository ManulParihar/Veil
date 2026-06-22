# Cryptography And ZK

## BN254 Field

What it is:

BN254 is an elliptic-curve pairing family commonly used by Groth16 proving systems.

Poof uses the BN254 scalar field for:

- Poseidon inputs and outputs,
- commitments,
- nullifiers,
- roots,
- public signals.

Why it exists here:

Groth16 over BN254 is supported by `snarkjs`, Circom, and Soroban's native BN254 host functions.

Important encoding rule:

All field elements are represented as 32-byte big-endian bytes at Rust/Soroban boundaries.

## Poseidon Hash

What it is:

Poseidon is a hash function designed to be efficient inside arithmetic circuits.

Why this matters:

ZK circuits are expensive when they must prove SHA-256 or Keccak computations. Poseidon uses field arithmetic, which circuits handle more cheaply.

How Poof uses it:

- `pk = Poseidon(sk)`
- note commitments,
- signatures used in nullifier derivation,
- nullifiers,
- Merkle parent hashes,
- empty tree leaves.

Why this approach was likely chosen:

The circuit must recompute these hashes. Poseidon keeps the circuit smaller than SHA-256 or Keccak would.

Specific repository choice:

Poof uses original circomlib Poseidon over BN254, not Poseidon2.

Why:

- Circomlib Poseidon is already available.
- `light-poseidon` can match it in Rust.
- Cross-implementation equality is more important for this MVP than a newer hash variant.

Alternatives:

- Keccak: common on EVM-like chains, but expensive inside circuits.
- SHA-256: standard, but expensive inside circuits.
- Pedersen: common in older ZK systems, but curve-dependent.
- MiMC: ZK-friendly, but less favored than Poseidon in many newer designs.
- Poseidon2: likely faster/newer, but would need careful cross-implementation validation.

## Commitments In Poof

A commitment hides note data.

In Poof:

```text
commitment = Poseidon(amount, pk, blinding)
```

What it proves later:

The spender can prove in ZK that:

- they know the hidden amount,
- they know the hidden blinding,
- the hidden owner key matches their spend key,
- the commitment is in the tree.

The contract does not learn those hidden values.

## Nullifiers In Poof

A nullifier prevents double spending without revealing which note was spent.

Poof computes:

```text
signature = Poseidon(sk, commitment, pathIndex)
nullifier = Poseidon(commitment, pathIndex, signature)
```

Why include `pathIndex`:

The nullifier is tied to the note's tree position. This helps make the spent-note identity unique even if commitment collisions or duplicate-like cases are considered.

What the circuit checks:

The circuit recomputes the nullifier and forces it to equal the public nullifier.

What the contract checks:

The contract checks the nullifier has not appeared before.

## Groth16

What it is:

Groth16 is a zkSNARK proving system.

It creates short proofs and has fast verification, but it requires a trusted setup for each circuit.

Why Poof uses it:

- Circom and `snarkjs` support it well.
- Proofs are small.
- Soroban has native BN254 pairing functions, so on-chain verification is practical.

How it is used:

- The circuit is compiled.
- A proving key and verification key are generated.
- The SDK creates a witness and proof.
- The contract verifies the proof against the baked-in verification key.

Important warning:

The current trusted setup is single-contributor. That is acceptable for research, not for production money.

Alternatives:

- PLONK: more flexible setup properties depending on variant.
- Halo2: no trusted setup in the same way, but heavier integration.
- STARKs: transparent setup, larger proofs, different verification costs.
- Nova-style folding: useful for recursion/incremental computation, not the simplest MVP path.

## The Circuit's Main Claims

The circuit proves all of this at once:

1. The spender knows private keys for the inputs.
2. The input commitments are computed correctly.
3. Real input commitments belong to the Merkle root.
4. The nullifiers are computed correctly.
5. The two nullifiers are not equal.
6. Output commitments are computed correctly.
7. All amounts are less than `2^64`.
8. Value is conserved.
9. `extDataHash` is bound as a public signal.

## Range Checks

What they are:

Range checks prove a number is within a limited size.

Why they matter:

BN254 field arithmetic wraps around modulo the field prime.

Without range checks, someone could exploit modular arithmetic to make invalid value equations appear valid.

How Poof uses them:

Every input and output amount is checked as a 64-bit value using `Num2Bits(64)`.

## `extDataHash` Binding

What it is:

A Keccak hash of recipient, relayer, fee, ciphertexts, and view tags, reduced into the BN254 field.

Why it matters:

It prevents someone from taking a valid proof and changing external data around it.

Important nuance:

The circuit does not check the contents of `ExtData`. It only includes `extDataHash` as a public input. The contract recomputes the hash from the supplied `ExtData` and compares it.

## Privacy Limits

Poof hides note links and amounts inside the shielded pool, but it does not hide everything.

Known leaks:

- The transaction submitter is visible.
- A small pool gives weak anonymity.
- Timing and amount patterns may leak information once deposits/withdrawals exist.
- Encrypted note events are public, even though only the recipient should decrypt them.

## What To Google Next

- Groth16 explained
- Trusted setup ceremony
- BN254 pairing
- Poseidon hash ZK
- Circom Num2Bits range checks
- Zcash nullifier
