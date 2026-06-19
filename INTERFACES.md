# Veil — Frozen Cross-Plane Interfaces

Every plane (circuit, contract, SDK, indexer) MUST conform to the contracts
below. These are frozen. If you believe one is wrong, STOP and flag it — do not
silently diverge, because divergence here means the system compiles and tests
green in isolation but fails at integration.

## 0. The single source of crypto truth

`crates/veil-crypto` is authoritative for Poseidon and all note math. Do NOT
reimplement Poseidon anywhere. The contract depends on it with
`default-features = false` (no_std); the SDK/indexer with default features.

Locked facts (verified in `crates/veil-crypto/tests/cross_impl.rs`):
- Hash: original **circomlib Poseidon over BN254**, via `light-poseidon` 0.4 in
  Rust and `circomlib/circuits/poseidon.circom` in circom. `new_circom(n)` ↔
  circom `Poseidon(n)`.
- `Poseidon([1,2]) = 7853200120776062878684798364095072458815029376092732009249414926327459813530`
- `Poseidon([1,2,3]) = 6542985608222806190361240322586112750744169038454362455181422643027100751666`

### Note formulas (circuit must reproduce these in-constraint)
```
pk         = Poseidon(sk)                        // width 1
commitment = Poseidon(amount, pk, blinding)      // width 3
signature  = Poseidon(sk, commitment, pathIndex) // width 3
nullifier  = Poseidon(commitment, pathIndex, signature) // width 3
```
Pinned test vector (sk=7, amount=100, blinding=42, pathIndex=3):
```
pk = 7061949393491957813657776856458368574501817871421526214197139795307327923534
cm = 9393485090685125340160626343171654838660902907959359341345939329381592242612
nf = 15859786158883198570120416352149778089550541078065235834061119830959898607558
```
Empty Merkle leaf `Zero(0) = Poseidon(0)` (width 1). `Zero(i+1) = Poseidon(Zero(i), Zero(i))`.

## 1. Field / byte encoding
All field elements on the wire are **32-byte big-endian**, reduced mod the
BN254 scalar field `r`. Contract `BytesN<32>` ↔ SDK `[u8;32]` ↔ snarkjs decimal
string, all via `veil-crypto::field`.

## 2. Tree
- Depth (levels) = **20**. Capacity 2^20 leaves.
- Two leaves inserted per transact (the two output commitments), level-0 hash =
  `Poseidon(cm0, cm1)`.
- Root history ring buffer size = **64**.

## 3. Public signals (circuit output order == contract input order)
Exactly 7, in this order:
```
[0] root
[1] publicAmount      // 0 for Phase-1 transfer; field-encoded signed for Phase-2
[2] extDataHash
[3] inputNullifier[0]
[4] inputNullifier[1]
[5] outputCommitment[0]
[6] outputCommitment[1]
```

## 4. ExtData and extDataHash
`extDataHash` binds recipient/relayer/fee/ciphertexts so a relayer cannot
redirect funds. Definition (SDK computes, contract recomputes & compares):
```
extDataHash = keccak256( recipient(32) || relayer(32) || fee_be(16) ||
                         u32be_len(ct0) || ct0 || u32be_len(ct1) || ct1 ||
                         viewTag[0](1) || viewTag[1](1) ||
                         u32be_len(settlementStrkey) || settlementStrkey(ascii) ) mod r
```
- `settlement_address` (Phase 2): the Stellar strkey ("G…") of the deposit/withdraw
  counterparty, appended as `u32-be length || ASCII bytes`. Binds the withdraw
  recipient so a relayer can't redirect funds. For a pure transfer
  (publicAmount==0) it is unused on-chain but still hashed — pass a fixed address.
  Contract appends `settlement_address.to_string()`; clients append the strkey ASCII.
- `recipient`, `relayer`: 32-byte Stellar address bytes (right-pad/encode
  consistently; for MVP use the 32-byte Ed25519 public key of the account).
- `fee`: u128 big-endian, 16 bytes.
- `ciphertext[i]`: variable-length AEAD blob, length-prefixed with u32-be before
  the bytes when hashing.
- `viewTag[i]`: 1 byte.
`keccak256` = the Soroban host `env.crypto().keccak256`. Reduce the 32-byte
digest mod r with `from_be_bytes_mod_order`.

## 5. Events (contract emits, indexer ingests)
- Topic `("NewCommitment",)`, data tuple `(commitment: BytesN<32>, leaf_index:
  u32, ciphertext: Bytes, view_tag: u32)`.
- Topic `("Nullifier",)`, data `nullifier: BytesN<32>`.
- Topic `("Transact",)`, data `(root: BytesN<32>,)` emitted once per call.

## 6. Groth16 verification (contract) — BN254 native host functions
soroban-sdk 26.1 `soroban_sdk::crypto::bn254::Bn254` provides `pairing_check`,
`g1_add`, `g1_mul`, `g1_msm`. The contract implements standard Groth16 verify:
```
vk_x = IC[0] + Σ pub[i] * IC[i+1]            // g1_msm / g1_mul + g1_add
pairing_check([-A, alpha, vk_x, C], [B, beta, gamma, delta]) == true
```
Negate A (or use the negate-on-one-side convention) consistently.

### VK / proof serialization (circuits → contract handoff)
The circuits plane produces `verification_key.json` (snarkjs). It will be
converted to a Rust module `crates/veil-contract/src/vk.rs` exposing the VK as
BN254 affine point byte arrays (G1 = 64 bytes x||y big-endian uncompressed, G2 =
128 bytes). The contract agent: build `verifier.rs` to consume a `Vk` struct of
this shape and a `Proof { a: G1, b: G2, c: G1 }`; read the actual constants from
`vk.rs`. A placeholder `vk.rs` with zeroed points is fine until integration —
keep the parsing/format exactly as specified so the real VK drops in cleanly.
snarkjs G2 point coordinate ordering is `[c0, c1]` (be careful: arkworks/soroban
may expect `[c1, c0]`); document whichever you choose and flag it for integration.

## 7. Versions
- soroban-sdk = "26.1"
- ark-bn254 / ark-ff / ark-ec / ark-serialize = "0.5" (default-features=false in no_std)
- light-poseidon = "0.4"
- circom 2.x + circomlib + snarkjs (groth16, bn128)
