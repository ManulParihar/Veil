# Veil Circuits (PLANE 2)

The 2-input / 2-output Groth16 joinsplit over BN254.

## Files
- `src/transaction.circom` — the joinsplit (`Transaction(20)`), depth 20.
- `src/keypair.circom` — `pk = Poseidon(sk)`, `signature = Poseidon(sk, cm, idx)`.
- `src/merkleproof.circom` — binary Merkle membership (`parent = Poseidon(l, r)`).
- `test/transaction.test.js` — node test runner (no mocha needed).
- `scripts/setup.sh` — trusted setup (⚠️ single contributor, NOT production).
- `scripts/prove.sh` — generate + verify a proof for an input.json.
- `scripts/gen_sample_input.js` — emit a valid sample witness.

## Numbers
- Non-linear constraints: 12,692 · linear: 14,098 · wires: 26,799.
- Public inputs: 8 (FROZEN order, see `INTERFACES.md` §3):
  `[root, publicAmount, extDataHash, inputNullifier[2], outputCommitment[2], currencyId]`.
- ptau power: **15** (2^15 = 32768 ≥ constraint count).

## Constraints enforced (CLAUDE.md Part 7)
ownership (`pk = Poseidon(sk)`), commitment well-formedness, signature +
nullifier derivation, Merkle membership **gated on `amount > 0`** (dummy inputs
skip), 64-bit range checks on every input/output amount, `nf[0] != nf[1]`,
value conservation `publicAmount + Σin = Σout`, and `extDataHash` bound as a
public input (kept via `extDataHash²`). Note commitments are
`Poseidon(amount, currencyId, pk, blinding)`, so `currencyId` binds every
input/output note in a joinsplit to one asset.

## Cross-impl gate
`test/transaction.test.js` asserts the in-circuit `pk/cm/nf` equal the pinned
`veil-crypto` vectors (`INTERFACES.md` §0). This proves the circuit's Poseidon is
bit-identical to the Rust single source of truth — the make-or-break seam.

## Reproduce
```bash
cd circuits
npm install                             # circomlib, snarkjs, circom_tester
circom src/transaction.circom --r1cs --wasm --sym \
    -l "$(pwd)/node_modules/circomlib/circuits" -l "$(pwd)/src" -o build
bash scripts/setup.sh                 # → build/transaction.zkey + verification_key.json
node test/transaction.test.js         # 4/4 green
node scripts/gen_sample_input.js
bash scripts/prove.sh build/sample_input.json   # real proof, verifies OK
```

## Handoff to the contract
`build/verification_key.json` (snarkjs, groth16/bn128, nPublic 8, IC len 9) is
converted to `crates/veil-contract/src/vk.rs` at integration. snarkjs encodes G1
as `[x, y, 1]` and G2 as `[[x_c0, x_c1], [y_c0, y_c1], [1,0]]` (decimal strings);
the contract must map coordinate ordering to what `soroban_sdk::crypto::bn254`
expects — confirmed during integration.
