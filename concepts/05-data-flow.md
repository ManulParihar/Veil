# Data Flow

## Private Transfer Flow

This is the main Phase 1 flow.

## 1. Sender Owns A Note

The wallet has a local note:

```text
amount
pubkey
blinding
leaf_index
```

The chain has only the note commitment in the Merkle tree.

## 2. Sender Chooses Inputs

The current SDK chooses:

- one real note that covers the amount,
- one zero-value dummy input.

The circuit supports two inputs, but the wallet's selection logic is simpler right now.

## 3. Sender Builds Outputs

The wallet creates:

- one recipient note,
- one change note back to the sender.

Example:

```text
input note = 100
send amount = 70
recipient output = 70
change output = 30
```

Each output note has a fresh blinding.

## 4. SDK Computes Commitments And Nullifiers

For the input:

```text
nullifier = Poseidon(commitment, pathIndex, signature)
```

For the outputs:

```text
commitment0 = Poseidon(amount0, pubkey0, blinding0)
commitment1 = Poseidon(amount1, pubkey1, blinding1)
```

## 5. SDK Builds Merkle Path

The SDK mirrors the contract's Merkle tree.

It finds the Merkle path for the input note's leaf index.

The circuit later uses this path to prove:

```text
this commitment is in the tree with root R
```

## 6. SDK Encrypts Output Notes

Each output note is encrypted to its owner.

Encryption flow:

```text
ephemeral X25519 key
ECDH shared secret
view_tag = sha256(shared)[0]
AEAD key = sha256("veil-note-key" || shared)
ciphertext = ChaCha20Poly1305(note plaintext)
```

The ciphertext wire format is:

```text
ephemeral_public_key || aead_ciphertext
```

## 7. SDK Computes `extDataHash`

The SDK hashes:

```text
recipient
relayer
fee
ciphertext0
ciphertext1
viewTag0
viewTag1
```

It uses Keccak and reduces the digest into the BN254 field.

This produces `extDataHash`.

## 8. SDK Builds Witness

The witness contains:

Public values:

- root,
- publicAmount,
- extDataHash,
- input nullifiers,
- output commitments.

Private values:

- input note amounts,
- private keys,
- blindings,
- path indices,
- path elements,
- output note data.

The witness JSON field names match `transaction.circom`.

## 9. Prover Generates Groth16 Proof

The SDK's proving module shells out to:

```text
snarkjs groth16 fullprove
```

It produces:

- `proof.json`,
- `public.json`.

The public signals must be in the frozen order:

```text
[root, publicAmount, extDataHash, nf0, nf1, cm0, cm1]
```

## 10. Contract Verifies Transaction

The contract receives:

- proof,
- public signals,
- `ExtData`.

It checks:

- root known,
- nullifiers unused,
- nullifiers distinct,
- `extDataHash` matches,
- proof valid.

Then it:

- marks nullifiers spent,
- inserts output commitments,
- emits note discovery events.

## 11. Indexer Stores Events

The indexer stores:

- commitments,
- leaf indices,
- ciphertexts,
- view tags,
- nullifiers,
- latest root.

It exposes these through HTTP endpoints such as:

```text
GET /notes
GET /nullifiers
GET /tree/root
```

## 12. Recipient Scans For Notes

The recipient wallet downloads indexed ciphertext records.

For each record:

1. Compute expected view tag from the ephemeral public key.
2. Skip records whose view tag does not match.
3. Try AEAD decrypt on matches.
4. If decrypt succeeds, the note belongs to this wallet.

The view tag is only a filter. The AEAD authentication tag is what confirms ownership.

## End-To-End Summary

```text
Private note
  -> commitment in tree
  -> witness proves valid spend
  -> proof verified on-chain
  -> nullifier prevents reuse
  -> new commitments inserted
  -> ciphertext events let recipients discover notes
```

## What To Google Next

- Joinsplit transaction
- Trial decryption
- View tags in shielded protocols
- AEAD encryption
- X25519 ECDH
- snarkjs fullprove
