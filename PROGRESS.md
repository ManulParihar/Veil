# Veil Build — Progress Tracker

Resume point for the autonomous build of the Veil shielded pool (see CLAUDE.md
for the full architecture, INTERFACES.md for the frozen cross-plane contracts).

## Status legend
✅ done & verified · 🟡 in progress · ⏳ queued · ❌ blocked

## Milestones

| # | Plane / task | Status | Notes |
|---|---|---|---|
| 0 | Toolchain check | ✅ | rust 1.93, circom 2.2, node 22, snarkjs(local), wasm32 targets. No `stellar`/`psql` yet. npm via `node $NVM/lib/node_modules/npm/bin/npm-cli.js`. No `timeout` cmd. |
| 1 | Architecture decision: Groth16 path | ✅ | soroban-sdk 26.1 has native `Bn254::pairing_check` → Poseidon-BN254 + on-chain BN254 Groth16. Honors CLAUDE.md + fits budget. No conflict. |
| 2 | **GATE**: veil-crypto Poseidon cross-impl | ✅ | `crates/veil-crypto`. light-poseidon 0.4 + ark 0.5. Poseidon(1,2) == circom witness. 4/4 tests pass. Builds no_std wasm32. Committed `4cc01d8`. |
| 3 | INTERFACES.md frozen spec | ✅ | public-signal order, extDataHash def, events, VK format, versions. |
| 4 | circuits (PLANE 2) | ✅ | Committed `932a6df`. 26.8k constraints, 7 pub signals. Setup done (zkey+vkey). 4/4 circom tests pass (incl in-circuit pk/cm/nf == pinned vectors). Real proof generates+verifies. Sample proof: build/proof.json, build/public.json. |
| 5 | veil-contract (PLANE 3) | ✅ | Native BN254 Groth16 verifier (real host fns). Fixed footprint blowup (zeros→instance, no frontier seed, bump live root) + no_std Poseidon + soroban-sdk `alloc`. Builds 74KB wasm32v1-none. 15/15 mock edge-case + 3/3 REAL-proof tests. |
| 6 | veil-sdk (PLANE 4a) | ✅ | keys/note/encrypt/scan/merkle_tree/tx/prove + Wallet facade. 28 tests pass (1 `#[ignore]` = real snarkjs proof, needs circuit artifacts); clippy clean. X25519 enc key via HKDF-SHA256(seed,"veil-enc"); ChaCha20Poly1305 AEAD; view_tag=sha256(shared)[0]; on-wire ct blob = ephemeral_pub(32)\|\|aead_ct. extDataHash per INTERFACES §4. Witness JSON field names match transaction.circom. |
| 7 | indexer (PLANE 4b) | ✅ | `indexer/`. SQLite (rusqlite bundled) store w/ idempotent upserts; ingest loop over `EventSource` trait (MockSource + StellarRpcSource) w/ checkpoint/resume + finality lag (default 5); axum read API (/notes,/nullifiers,/tree/root,/health). 19/19 tests green, clippy clean. Parses INTERFACES §5 events; Transact→latest root for /tree/root. |
| 8 | Integration e2e | ✅ | Real `vk.rs` + `sample_proof.rs` generated from snarkjs (G2 c1‖c0 swap). **Real circuit proof verifies through Soroban's real BN254 host pairing**; tampered signal→ProofInvalid. ZK proven load-bearing end-to-end natively. Also confirmed via arkworks. |
| 9 | Testnet validation | ✅ | **REAL on-chain private transfer succeeded** — contract `CD6WNAX…`, transact tx `84f7ee36…`: genuine Groth16 proof verified on-chain by native BN254 host fns, 2 commitments inserted, 2 nullifiers spent, root advanced to `2df43aa2…`, leaf_index 0→2. Native budget: 27.96M instr (<100M). |
| 10 | Review + README + commit | ✅ | High-effort review: no correctness bugs; 2 findings (extDataHash agreement + tree-mirror usage) closed by the on-chain transact. Honest README written. |

## Key locked facts (do not re-derive)
- Poseidon = circomlib original, BN254. `new_circom(n)` ↔ circom `Poseidon(n)`.
- Pinned vectors: Poseidon(1,2)=7853200120776062878684798364095072458815029376092732009249414926327459813530;
  note (sk=7,amt=100,blind=42,idx=3): pk=70619493...23534, cm=93934850...42612, nf=158597861...07558 (full values in veil-crypto/tests/cross_impl.rs & INTERFACES.md).
- Tree depth 20, root history 64. Wire encoding: 32-byte big-endian mod r.
- Public signals: [root, publicAmount, extDataHash, nf0, nf1, cm0, cm1].

## How to resume
1. `cargo test -p veil-crypto` must stay green (the gate).
2. Check agent deliverables: `cargo test -p veil-contract`, `cargo test -p veil-sdk`, `cargo test -p veil-indexer`.
3. Circuit: `cd circuits && bash scripts/setup.sh` then run test/transaction.test.js.
4. Integration test lives in (planned) crates/veil-contract/tests or a top-level e2e.
5. Update this table as things land.

---

# UI / dApp Build (PLANE 5) — Production-grade Veil Wallet

GOAL: a production-grade web wallet for Veil with REAL integration — in-browser
Groth16 proving, real note crypto bit-identical to the circuit, and real on-chain
`transact` submission to the deployed contract — validated end-to-end in a real
browser (Playwright: clicks, typing, screenshots).

## Architecture (decided)
- `app/` — Vite + React + TypeScript + Tailwind. State via zustand. Router.
- Crypto in TS (no wasm-bindgen): `circomlibjs` Poseidon (== circomlib == veil-crypto),
  `@noble/curves` x25519, `@noble/ciphers` chacha20poly1305, `js-sha3` keccak.
  GATE: a vitest asserts TS poseidon/commitment/nullifier == pinned veil-crypto vectors.
- Proving: `snarkjs` groth16 fullprove in a Web Worker, using circuits/build
  transaction.wasm + transaction.zkey served as static assets.
- Chain: `@stellar/stellar-sdk` → contract `CD6WNAX…` on testnet. In-app fee-payer
  Stellar account (generate + friendbot fund). Note discovery via RPC getEvents +
  trial-decrypt with view tags.

## Interface contract (frozen for UI build)
- veil identity = 32-byte seed (hex). Keys derived via crypto.ts (mirrors veil-crypto Seed).
- Note = {amount:bigint, pubkey, blinding}. commitment/nullifier per INTERFACES §0.
- Witness JSON field names == transaction.circom (see veil-sdk tx.rs report).
- extDataHash per INTERFACES §4 (keccak of recipient||relayer||fee||len-prefixed cts||tags, mod r).
- Public signals order per INTERFACES §3. Proof a/b/c → contract BytesN with G2 c1‖c0 swap.

## Pieces (parallelized)
| # | Piece | Owner | Status |
|---|---|---|---|
| U0 | Scaffold + crypto GATE (TS poseidon==pinned, extDataHash==on-chain) | me | ✅ |
| U1 | Design system + pages (built by me; agents hit session limit) | me | ✅ |
| U2 | Integration lib (witness/prover-worker/proof/chain/scan/store) | me | ✅ |
| U3 | Browser E2E PASSES: create→fund→deposit(100)→**private send(40)** — real in-browser proofs + on-chain | me | ✅ |
| U4 | Real on-chain deposit from the browser: tx cd221ebe… · stellar-sdk 16 (proto-23 meta) | me | ✅ |

---

# /goal — Phase 2: real-XLM settlement (deposit/withdraw backed by native XLM)

GOAL: make the shielded pool hold REAL value. `deposit` pulls native XLM from the
user into the contract (custody); `withdraw` releases XLM to any Stellar address.
Value conservation is already enforced in-circuit (`publicAmount + Σin = Σout`);
this wires the asset-custody edge that `settle_public_amount` currently no-ops.
Done when a user deposits real testnet XLM, transfers privately, and withdraws
real XLM to a different account — validated in-browser + on-chain, with the
contract's XLM custody balance reconciling.

## Independent pieces

### P2-A · Contract settlement ✅ DONE
- `init` takes `token: Address` (testnet native-XLM SAC); store it.
- `settle_public_amount`: decode sign of `publicAmount` —
  `0` → no-op; `0<pa<2^64` → DEPOSIT `token.transfer(from=depositor,to=contract,pa)`;
  `pa>r-2^64` → WITHDRAW amount=`r-pa`, `token.transfer(from=contract,to=recipient,amount)`.
- Ordering stays validate→verify→effect→**settle**→emit (transfer last = atomic revert on failure).
- Deposit requires `depositor.require_auth()`; withdraw releases from the contract's own balance.
- **Deliverable/verify:** native tests with the soroban test token — deposit moves
  funds in, withdraw moves them out, balances reconcile, auth enforced, insufficient
  balance reverts. `cargo test -p veil-contract` green; builds wasm32v1-none.

### P2-B · ExtData + extDataHash re-freeze ✅ DONE
- Add `settlement_address` (Stellar address) to `ExtData`, bound into `extDataHash`
  (so a relayer can't redirect a withdraw). Update INTERFACES §4, re-pin the
  empty-ExtData vector, and mirror in BOTH `crates/veil-sdk/src/tx.rs` AND
  `app/src/lib/crypto.ts` (the gate test must still pass on both sides).
- **Deliverable/verify:** veil-crypto/SDK tests + `app` `crypto.test.ts` green with
  the new hash; a contract test asserts SDK-hash == contract-hash for a sample.

### P2-C · Wallet integration ✅ DONE
- Deposit: publicAmount=stroots(amount); submitTransact must carry the XLM-transfer
  sub-invocation auth (stellar-sdk `prepareTransaction` collects it; fee-payer signs).
- New Withdraw page: amount + destination G-address → `buildWithdraw` (publicAmount=r-amount),
  `settlement_address`=dest; contract releases XLM.
- Decimal/stroop scaling: note `amount` = stroops (1 XLM = 1e7); UI shows XLM.
- **Deliverable/verify:** typecheck + build; integration smoke test for the
  withdraw witness proves+verifies.

### P2-D · Redeploy + browser e2e (the real proof)
- Redeploy contract with the SAC token; update CONTRACT_ID + addresses.json.
- Playwright e2e: fund fee acct → **deposit 1 XLM** (assert contract XLM balance +1,
  fee acct −1) → private transfer → **withdraw 0.4 XLM to a 2nd account** (assert that
  account received 0.4 on Horizon; shielded balance 0.6). Screenshots.
- **Completion standard:** real XLM in → private movement → real XLM out, all with
  real proofs, browser-validated, custody balance reconciles.

## Key risks / decisions
- ExtData change is breaking → must update SDK+TS+vectors+INTERFACES together (P2-B is the gate).
- Soroban cross-contract auth for `token.transfer` (deposit) — verify sub-invocation
  auth threads through simulate/prepare; this is the highest-risk integration point.
- Pick the canonical testnet native-XLM SAC address; confirm 7-decimal stroop math.
- Order: P2-A + P2-B first (can parallelize), then P2-C, then P2-D. ~1 focused session.
