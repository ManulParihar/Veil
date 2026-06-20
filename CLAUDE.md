# Veil: A UTXO-Style Private Payment Protocol on Stellar/Soroban — Full Architecture & Build Plan

## Executive Summary

Veil is a shielded pool on Stellar/Soroban: real value custodied in a single contract, private "notes" committed in an incremental Merkle tree, and spending via zero-knowledge proofs that conserve value and prevent double-spends. Phase 1 is pure private transfer with value assumed already in the pool; Phase 2 adds public deposit/withdraw. The system is architected to be production-ready (nothing needs ripping out to scale), while being honest about what's real (ZK, nullifiers, Merkle), what's mocked (single-contributor trusted setup), and known leaks (fee-payer deanonymization).

**Phase 3 (multi-currency, shipped):** one pool holds many assets. Each note binds a `currency_id` into its commitment (`commitment = Poseidon(amount, currency_id, pk, blinding)`, a 4-input Poseidon / t=5), and `currencyId` is public signal [7], fed into all four commitments so a transaction is single-asset by construction. The contract keeps a `Token(u32) -> Address` registry with a `TokenCount`; the admin adds assets via `register_token` (a state write, gated by `admin.require_auth()`), which needs no contract upgrade and no new verifying key because the circuit treats `currency_id` as an opaque field element. `transact` rejects unregistered currencies, and deposit/withdraw settle the SAC for the transaction's currency, keeping per-token custody isolated. The frozen wire details live in INTERFACES.md (§3 signals, §5b registry).

---

# Part 1: Architecture Overview

## The System in One Paragraph

Veil is a shielded pool. Real value is custodied in a single Soroban contract; private "notes" exist only as Poseidon commitments in an on-chain incremental Merkle tree. Spending a note means publishing a nullifier (unlinkable to its commitment) and a Groth16 proof that says *"I own a note in this tree, I derived this nullifier correctly, and my inputs and outputs conserve value"* — without revealing which note, its value, or its owner. The contract verifies the proof, rejects seen nullifiers, inserts the new output commitments, and emits encrypted note ciphertexts as events so recipients can discover incoming notes by trial-decryption. Phase 1 is pure private transfer (value assumed already in the pool); Phase 2 adds the public deposit/withdraw edges.

## The Four Planes

The whole system decomposes into four planes with deliberately thin interfaces between them. This is the boundary structure that keeps it maintainable:

**1. The cryptographic core (`veil-crypto`)** — a `no_std`-compatible Rust crate holding the one thing that must be bit-identical everywhere: Poseidon. The same crate is consumed by the circuit's witness tooling, the Soroban contract (via host functions, but the *parameters* live here), and the client SDK. If Poseidon lives in three places, you have three subtly different hashes and a system that silently doesn't work. It lives in one place.

**2. The circuit (`veil-circuits`)** — the Circom 2-in/2-out joinsplit, its trusted-setup artifacts, and the witness/proof tooling. This plane's only output to the rest of the system is a verification key (baked into the contract) and a proof+public-signals blob (produced by clients).

**3. The contract (`veil-contract`)** — the Soroban smart contract: Merkle tree with rolling root history, nullifier set, Groth16 verification call, and event emission. This is the only authority. It trusts nothing it doesn't verify.

**4. The client + indexer (`veil-sdk`, `veil-indexer`)** — off-chain note management: key derivation, note encryption/decryption, trial-decryption with view tags, proof generation (browser WASM), and the indexer that permanently stores ciphertext events (because Stellar RPC forgets them in ≤7 days).

The critical invariant across all four: **the ZK is load-bearing at the contract boundary.** The contract never sees a value, an owner, or a note. It sees commitments, nullifiers, a root, and a proof. If you can remove the proof and the system still "works," it's decorative — and in this design, removing the proof means anyone can spend anyone's notes and mint value from nothing. That's the test, and we pass it.

---

# Part 2: Requirements Analysis

## Functional Requirements

**Phase 1 (MVP core — must be real):**
- Users hold a keypair and a set of notes (off-chain secrets).
- A user can spend up to 2 input notes and create exactly 2 output notes (one to a recipient, one change back to self), with value strictly conserved.
- The contract verifies a Groth16 proof before mutating any state.
- Double-spends are impossible: each note yields exactly one nullifier; seen nullifiers are permanently rejected.
- Output commitments are inserted into the Merkle tree; the root advances; recent roots remain valid for in-flight proofs.
- Recipients discover incoming notes by scanning emitted ciphertexts, accelerated by a 1-byte view tag.

**Phase 2 (edges — staged, designed-for now):**
- `deposit(amount)`: public transaction mints a note of `amount` into the pool.
- `withdraw(amount, recipient)`: burns note(s), releases public funds.
- Both flow through the *same* value-conservation circuit via a signed `publicAmount`.

**Designed-for-but-deferred (markers in code, not built):**
- Encrypted on-chain note delivery with view tags (Phase 1 uses out-of-band delivery; the ciphertext event is emitted from day one so the wire format is fixed, but the SDK's auto-scan is Phase 2).
- Relayers (fee-payer deanonymization is a known, documented leak in MVP).
- Full ivk/ovk viewing-key separation (keys exist in the structure; trivial derivation in MVP).
- Decentralized trusted-setup ceremony (single-contributor `.zkey` in MVP, flagged loudly).

## Non-Functional Requirements

- **Proof verification must fit Soroban's 100M-instruction budget.** Groth16 pairing is ~40M; a depth-20 insert with native Poseidon adds maybe ~20 host hashes; nullifier writes are cheap. We have headroom but must verify with `simulateTransaction` early.
- **Nullifiers must never be lost** to storage archival — a forgotten nullifier is a double-spend.
- **Poseidon must be bit-identical** between circuit, contract, and SDK.
- **The indexer must be permanent** — RPC retention is ≤7 days.

## The Hard Security Invariants (the ones that, if violated, break the money)

1. **Value conservation** — `publicAmount + Σ inputs = Σ outputs`, enforced *in-circuit*, mod the field.
2. **Range checks** — every value `∈ [0, 2^64)`. Without this, field wraparound mints money. Non-negotiable, in-circuit.
3. **Nullifier correctness + uniqueness** — derived from `(commitment, pathIndex, signature)` so the same note can't produce two nullifiers and two notes can't collide.
4. **Merkle membership** — inputs must be real leaves under a known root.
5. **Ownership** — spender must know the private key behind each input note's public key.
6. **No fake roots** — only the contract advances the root; users never submit one.
7. **Replay/front-run binding** — recipient/relayer/fee bound into the proof via `extDataHash`.

---

# Part 3: Edge Cases & Failure Modes

This is where MVPs become demos if you skip it. I'm enumerating the ones that actually bite, grouped by plane.

## Circuit-Level

- **Dummy inputs.** A 2-in circuit must handle spends with fewer than 2 real notes (e.g. first-ever spend, or 1-input transfer). Solution: zero-value dummy notes whose Merkle check is *gated* on `amount > 0` (Tornado's `ForceEqualIfEnabled`). A dummy note with amount 0 skips membership but still contributes 0 to conservation.
- **Duplicate input nullifiers in one tx.** Someone passes the same note twice as both inputs. Solution: in-circuit `inputNullifier[0] != inputNullifier[1]` constraint.
- **Value overflow via field wraparound.** Covered by range checks, but worth restating: outputs summing past the field modulus must be rejected *before* the modular reduction makes them look valid.
- **Equal-valued, equal-owner notes producing identical commitments.** Two notes `(5, pk, rho)` with the same `rho` collide. Solution: `rho` must be sampled with real randomness; the nullifier binds `pathIndex` so even commitment-colliding notes at different positions get distinct nullifiers.
- **Change note to self with value 0.** Legal — a full-balance transfer leaves 0 change. Must not be special-cased into failure.

## Contract-Level

- **Stale root.** User proves against root `R`; a deposit lands first; `R` is no longer current. Solution: rolling buffer of last N roots (N≥30), `is_known_root` accepts any. *This is mandatory, not optional* — without it the system is unusable under any concurrency.
- **Nullifier archived by TTL.** Covered above: persistent storage, max TTL, footprint inclusion so CAP-0066 auto-restores. The failure mode is silent and catastrophic (archived nullifier read as "unspent" → double-spend), so it gets defensive handling and a test.
- **Partial failure ordering.** If proof verification passes but a later step fails, you must not have already marked nullifiers spent (griefs the user) or inserted commitments (corrupts the tree). Solution: strict ordering — validate everything (root known, nullifiers unseen, extDataHash matches) → verify proof → *then* mutate (mark nullifiers, insert leaves, emit events). Soroban rolls back on panic, but ordering still matters for clarity and for the gas you waste before failing.
- **Tree full.** At 2^depth leaves the tree is full. Solution: explicit `nextIndex < 2^levels` check with a clear error; depth 20 = ~1M notes is plenty for MVP, but it must fail cleanly, not wrap.
- **Reentrancy.** Soroban's model largely prevents classic reentrancy, but the token transfer in deposit/withdraw (Phase 2) is an external call. Validate-then-effect-then-interact ordering, and don't trust balances across the call.
- **Insufficient instruction budget mid-tx.** If a depth-26 tree pushes the combined verify+insert over 100M, the tx dies. Solution: benchmark early; if tight, drop tree depth or split the work. Verify on testnet with realistic depth before committing.

## Client/Indexer-Level

- **Indexer gap.** If the indexer is down when ciphertext events expire from RPC (≤7 days), those notes are lost to discovery forever. Solution: indexer persists to a real DB with checkpoint/resume; for MVP, also support out-of-band note delivery so discovery doesn't *depend* on the indexer.
- **Wrong-recipient trial decryption.** View tag is 1 byte → 1/256 false-positive rate. The full AEAD decrypt must still fail closed on those. Never trust the tag alone.
- **Chain reorg.** A commitment's leaf index shifts if the chain reorgs after the indexer recorded it. Soroban/Stellar finality is fast, but the indexer should track confirmed ledgers and handle the (rare) rollback by re-syncing from the last finalized checkpoint.
- **Proof generated against a note already spent.** User's local state thinks a note is unspent; it was spent on another device. Solution: SDK checks nullifier non-membership against current chain state before submitting; contract is the final arbiter and rejects.
- **Clock/nonce on key derivation.** Deterministic key derivation must be reproducible across devices from the seed alone. No device-local randomness in key paths.

---

# Part 4: Folder Structure

```
veil/
├── Cargo.toml                      # workspace
├── README.md                       # the honest one: what's real, what's mocked, the known leaks
├── justfile                        # task runner: build, test, deploy, prove, e2e
│
├── crates/
│   ├── veil-crypto/                # PLANE 1: the single source of Poseidon truth
│   │   ├── src/
│   │   │   ├── lib.rs
│   │   │   ├── poseidon.rs          # params (t, d, RF, RP), MDS, round constants
│   │   │   ├── constants_t2.rs      # iden3/circomlib constants, verbatim
│   │   │   ├── constants_t3.rs
│   │   │   ├── field.rs             # BN254 Fr helpers
│   │   │   └── note.rs              # Note, KeyPair structs + commitment/nullifier (host-fn-free reference impl)
│   │   └── tests/
│   │       └── cross_impl.rs        # THE test: hash(1,2) == circomlib == on-chain vector
│   │
│   ├── veil-contract/              # PLANE 3: the Soroban contract
│   │   ├── src/
│   │   │   ├── lib.rs               # contract entry, the transact() orchestrator
│   │   │   ├── merkle.rs            # incremental tree + rolling root history
│   │   │   ├── nullifier.rs         # persistent set, TTL management
│   │   │   ├── verifier.rs          # Groth16 verify call (wraps SDF verifier)
│   │   │   ├── poseidon_host.rs     # thin wrapper over poseidon2_permutation host fn
│   │   │   ├── events.rs            # NewCommitment, Nullifier, Transact events
│   │   │   ├── storage.rs           # DataKey enum, typed getters/setters, TTL helpers
│   │   │   ├── types.rs             # Proof, ExtData, public-signal layout
│   │   │   └── error.rs             # contract error enum
│   │   └── tests/
│   │       ├── transfer.rs          # happy path + every contract edge case above
│   │       ├── double_spend.rs
│   │       └── stale_root.rs
│   │
│   └── veil-sdk/                   # PLANE 4a: client library (also compiles to WASM)
│       ├── src/
│       │   ├── lib.rs
│       │   ├── keys.rs              # seed → key hierarchy
│       │   ├── note.rs              # note lifecycle, local store interface
│       │   ├── encrypt.rs           # X25519 ECDH + AEAD + view tag (client-side)
│       │   ├── scan.rs              # trial-decrypt with view-tag fast path
│       │   ├── prove.rs             # witness build + snarkjs/wasm proof gen
│       │   └── tx.rs                # assemble ExtData, public signals, submit
│       └── tests/
│
├── circuits/                       # PLANE 2
│   ├── src/
│   │   ├── transaction.circom       # the 2-in-2-out joinsplit
│   │   ├── keypair.circom
│   │   ├── merkleproof.circom
│   │   └── poseidon2/               # Poseidon2 templates matching veil-crypto
│   ├── scripts/
│   │   ├── setup.sh                 # ptau + groth16 setup → .zkey + vkey
│   │   ├── gen_vkey_rust.sh         # circom2soroban → contract constants
│   │   └── prove.sh
│   ├── build/                       # .r1cs, .wasm, .zkey (gitignored except vkey)
│   └── test/
│       └── transaction.test.js      # circuit unit tests (circom_tester)
│
├── indexer/                        # PLANE 4b
│   ├── src/
│   │   ├── main.rs                  # ingest loop
│   │   ├── ingest.rs                # getEvents poller, checkpoint/resume
│   │   ├── store.rs                 # DB writes
│   │   └── api.rs                   # serve ciphertexts to clients for scanning
│   ├── migrations/
│   └── Cargo.toml
│
├── app/                            # optional frontend (Phase 2+ / if time)
│   └── ...                          # wallet UI: balance, send, receive
│
└── deploy/
    ├── deploy_testnet.sh
    └── addresses.json               # deployed contract IDs per network
```

The structure encodes the boundaries. `veil-crypto` has no dependency on the contract or SDK — they depend on *it*. The circuit constants are generated *from* `veil-crypto`'s constants. There's exactly one place to change a Poseidon parameter.

---

# Part 5: Data Flow

## Private Transfer (Phase 1) — The Core Flow, End to End

```
                    OFF-CHAIN (client)                          ON-CHAIN (contract)
                    ──────────────────                          ───────────────────
 1. User picks 2 input notes from local store
    (or 1 real + 1 dummy)
        │
 2. Build output notes:
    - recipient note (value, recipient_pk, rho_r)
    - change note    (value, self_pk,      rho_c)
        │
 3. Compute in SDK (veil-crypto):
    - input nullifiers  nf_i = Poseidon(cm_i, pathIdx_i, sig_i)
    - output commitments cm_o = Poseidon(val_o, pk_o, rho_o)
    - Merkle paths for inputs against a recent root
        │
 4. Encrypt each output note to its recipient:
    - X25519 ECDH → shared secret
    - view_tag = H(shared)[0]
    - ct = AEAD(shared, note_plaintext)
        │
 5. Assemble ExtData {recipient, relayer, fee, ct[2], viewTag[2]}
    extDataHash = keccak(XDR(ExtData)) mod r
        │
 6. Generate Groth16 proof (browser WASM):
    public:  root, publicAmount=0, extDataHash,
             nf[0], nf[1], cm[0], cm[1]
    private: input notes, keys, paths, output notes
        │
 7. Submit transact(proof, public_signals, ExtData) ──────────►  8. VALIDATE (no state change):
                                                                     - is_known_root(root)?            else ERR
                                                                     - nf[0], nf[1] not in set?        else ERR
                                                                     - nf[0] != nf[1]?                 else ERR
                                                                     - recompute extDataHash == input? else ERR
                                                                  9. VERIFY proof (Groth16, ~40M instr) else ERR
                                                                 10. EFFECT (mutate):
                                                                     - mark nf[0], nf[1] spent (max TTL)
                                                                     - insert cm[0], cm[1] → tree
                                                                     - advance root, push to history ring
                                                                 11. EMIT events:
                                                                     - NewCommitment(cm[0], idx, ct[0], tag[0])
                                                                     - NewCommitment(cm[1], idx+1, ct[1], tag[1])
                                                                     - Nullifier(nf[0]), Nullifier(nf[1])
        │                                                              │
 12. Indexer ingests NewCommitment events ◄────────────────────────────┘
     stores {cm, idx, ct, tag} permanently
        │
 13. Recipient scans (periodically):
     - pull recent ct+tag from indexer
     - fast-path: ct where tag matches H([ivk]·epk)[0]   (~1/256 survive)
     - AEAD-decrypt survivors; successful decrypt = "this note is mine"
     - add note to local store, ready to spend
```

The privacy guarantee lives in the gap between step 11's `NewCommitment` (a hash) and any future spend's `Nullifier` (an unlinkable hash). An observer sees commitments go in and unrelated-looking nullifiers come out and cannot connect them.

## Deposit/Withdraw (Phase 2) — Same Circuit, Signed PublicAmount

```
DEPOSIT:  publicAmount = +amount, 0 real inputs (2 dummies), 2 output notes summing to amount
          contract pulls `amount` tokens from user, then runs the transact flow
WITHDRAW: publicAmount = -amount, real inputs, outputs = change only
          contract runs transact flow, then releases `amount` tokens to ExtData.recipient
```

One circuit. The sign of `publicAmount` and the presence of a token transfer are the only differences. This is why we design the value-conservation equation as `publicAmount + Σinputs = Σoutputs` from the start, even though Phase 1 always sets `publicAmount = 0`.

---

# Part 6: Contract Design (The Authority)

## State Schema (Soroban Storage)

```rust
#[contracttype]
pub enum DataKey {
    // ── instance storage (small, global, shares contract TTL) ──
    Admin,                       // Address (setup/upgrade authority; renounce-able)
    VerifyingKey,                // Groth16 VK bytes (or compiled into wasm)
    Config,                      // { levels: u32, root_history_size: u32 }
    CurrentRootIndex,            // u32, ring buffer cursor
    NextLeafIndex,               // u32, next insertion position

    // ── persistent storage (unbounded, rent-managed, archival-safe) ──
    FilledSubtree(u32),          // frontier node per level  [0..levels]
    Zero(u32),                   // precomputed empty-subtree hash per level
    Root(u32),                   // rolling root history       [0..root_history_size]
    Nullifier(BytesN<32>),       // existence = spent. ONE ENTRY PER NULLIFIER.
}
```

Design decisions baked in here, each from the research:
- **One persistent entry per nullifier**, never a growing `Map`. The reference repo used a single `Map` — that balloons cost and eventually DoSes. We don't copy that mistake.
- **Frontier (`FilledSubtree`), not the full tree.** Storing 2^20 nodes is impossible and unnecessary; the incremental-tree frontier is `levels` entries.
- **Root history ring buffer** sized ≥30 (I'll default to 64 — wider window than Tornado's 30, cheaper than Nethermind's 90, comfortable for demo concurrency).
- **Instance vs persistent split by mutation frequency and archival risk.** Config-ish small state in instance; anything that must survive archival (nullifiers especially) in persistent with explicit TTL bumps.

## The Orchestrator (`transact`)

The single state-mutating entry point. Strict validate → verify → effect → emit ordering:

```rust
pub fn transact(
    env: Env,
    proof: Proof,                 // Groth16 A/B/C
    public_signals: PublicSignals,// root, publicAmount, extDataHash, nf[2], cm[2]
    ext_data: ExtData,            // recipient, relayer, fee, ct[2], view_tag[2]
) -> Result<(), Error> {
    // ── 1. VALIDATE (no mutation) ──
    require_known_root(&env, &public_signals.root)?;          // stale-root window
    require_unspent(&env, &public_signals.nullifiers)?;       // double-spend guard
    require_distinct(&public_signals.nullifiers)?;            // same-note-twice guard
    let computed = hash_ext_data(&env, &ext_data);            // front-run binding
    require(computed == public_signals.ext_data_hash, Error::ExtDataMismatch)?;
    require_tree_not_full(&env)?;

    // ── 2. VERIFY (the load-bearing step) ──
    verifier::verify(&env, &proof, &public_signals)?;         // ~40M instr; fail closed

    // ── 3. EFFECT (mutate only after proof passes) ──
    for nf in &public_signals.nullifiers {
        nullifier::mark_spent(&env, nf);                      // persistent, max TTL
    }
    let (idx0, _) = merkle::insert_two(
        &env, &public_signals.commitments[0], &public_signals.commitments[1],
    )?;                                                        // advances + pushes root

    // ── 4. (Phase 2) settle public amount ──
    settle_public_amount(&env, &public_signals.public_amount, &ext_data)?;

    // ── 5. EMIT (discovery) ──
    events::new_commitment(&env, &public_signals.commitments[0], idx0,
                           &ext_data.ciphertexts[0], ext_data.view_tags[0]);
    events::new_commitment(&env, &public_signals.commitments[1], idx0 + 1,
                           &ext_data.ciphertexts[1], ext_data.view_tags[1]);
    events::nullifiers(&env, &public_signals.nullifiers);
    Ok(())
}
```

## Merkle Module — The Insert That Everyone Gets Subtly Wrong

```rust
pub fn insert_two(env: &Env, leaf0: &U256, leaf1: &U256) -> Result<(u32, u32), Error> {
    let cfg = storage::config(env);
    let mut next = storage::next_leaf_index(env);
    require(next + 1 < (1u32 << cfg.levels), Error::TreeFull)?;

    // first level: compress the two new leaves together
    let mut cur = poseidon_host::compress(env, leaf0, leaf1);
    let mut idx = next >> 1;

    for level in 1..cfg.levels {
        let (left, right) = if idx & 1 == 0 {
            // we're a left child: our sibling is the empty subtree; record frontier
            storage::set_filled_subtree(env, level, &cur);
            (cur.clone(), storage::zero(env, level))
        } else {
            // right child: sibling is the stored frontier
            (storage::filled_subtree(env, level), cur.clone())
        };
        cur = poseidon_host::compress(env, &left, &right);
        idx >>= 1;
    }

    // push new root into the ring buffer
    let new_root_idx = (storage::current_root_index(env) + 1) % cfg.root_history_size;
    storage::set_root(env, new_root_idx, &cur);
    storage::set_current_root_index(env, new_root_idx);
    storage::set_next_leaf_index(env, next + 2);
    Ok((next, next + 1))
}
```

Note the two-leaf insert (every transfer creates exactly 2 outputs, so we never insert one at a time — matches the circuit's output arity and halves the level-0 work). The `Zero(level)` values are precomputed at init: `Zero(0) = Poseidon("VEIL")`, `Zero(i+1) = compress(Zero(i), Zero(i))`.

## Nullifier Module — Archival-Safe

```rust
pub fn is_spent(env: &Env, nf: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::Nullifier(nf.clone()))
}

pub fn mark_spent(env: &Env, nf: &BytesN<32>) {
    let key = DataKey::Nullifier(nf.clone());
    env.storage().persistent().set(&key, &());
    // never let a nullifier be archived-and-forgotten → never re-enable a double-spend
    let max = env.storage().max_ttl();
    env.storage().persistent().extend_ttl(&key, max, max);
}
```

The defensive rule the reference repo missed: **max TTL on every nullifier write**, and the client must include candidate nullifier keys in the transaction footprint so CAP-0066 auto-restores any archived entry into the read set (so `has()` can't falsely return `false`).

## Contract Errors

```rust
#[contracterror]
pub enum Error {
    UnknownRoot = 1,        // proof against a root outside the history window
    NullifierSpent = 2,     // double-spend attempt
    DuplicateNullifier = 3, // same note used as both inputs
    ExtDataMismatch = 4,    // recipient/relayer/fee tampered → front-run attempt
    ProofInvalid = 5,       // Groth16 verification failed
    TreeFull = 6,           // 2^levels leaves reached
    InsufficientFunds = 7,  // Phase 2: deposit/withdraw settlement
    NotInitialized = 8,
}
```

---

# Part 7: Circuit Design (The Load-Bearing Logic)

The 2-in/2-out joinsplit. Public signals in fixed order (order must match the verifier exactly):

```
signal input root;                    // public
signal input publicAmount;            // public  (0 for transfer, ±amount for deposit/withdraw)
signal input extDataHash;             // public  (binds recipient/relayer/fee/ciphertexts)
signal input inputNullifier[2];       // public
signal input outputCommitment[2];     // public

signal input inAmount[2];             // private
signal input inPubKey[2];             // private (= Poseidon(inPrivKey))
signal input inBlinding[2];           // private
signal input inPrivKey[2];            // private
signal input inPathIndices[2];        // private
signal input inPathElements[2][levels]; // private

signal input outAmount[2];            // private
signal input outPubKey[2];            // private
signal input outBlinding[2];          // private
```

Constraint logic, in order:

```
for i in 0..2:
    // ownership: spender knows the key behind the note
    inPubKey[i] === Poseidon(inPrivKey[i])
    // commitment well-formedness
    cm_i = Poseidon(inAmount[i], inPubKey[i], inBlinding[i])
    // signature + nullifier derivation (binds path so position is unique)
    sig_i = Poseidon(inPrivKey[i], cm_i, inPathIndices[i])
    inputNullifier[i] === Poseidon(cm_i, inPathIndices[i], sig_i)
    // merkle membership, GATED on amount>0 (dummy inputs skip)
    computedRoot = MerkleProof(cm_i, inPathElements[i], inPathIndices[i])
    ForceEqualIfEnabled(inAmount[i] > 0, computedRoot, root)
    // RANGE CHECK — the constraint everyone forgets; prevents field-wrap minting
    inAmount[i] ∈ [0, 2^64)

inputNullifier[0] !== inputNullifier[1]    // no same-note-twice

for i in 0..2:
    outputCommitment[i] === Poseidon(outAmount[i], outPubKey[i], outBlinding[i])
    outAmount[i] ∈ [0, 2^64)               // RANGE CHECK on outputs too

// VALUE CONSERVATION (the heart)
publicAmount + inAmount[0] + inAmount[1] === outAmount[0] + outAmount[1]

// bind external data so a relayer can't redirect funds (proof becomes invalid if they try)
signal extDataSquare = extDataHash * extDataHash;   // constrain it into the system
```

The `extDataHash` is included as a public input even though no constraint *needs* its value — making it public means a relayer who edits the recipient produces a different `extDataHash`, which doesn't match the one the proof was generated against, and the contract's recompute-and-compare rejects it. (The squaring trick forces the compiler to keep the signal; some setups bind it via a dummy constraint.)

---

# Part 8: Key Hierarchy

Designed with the full structure, MVP-collapsed derivation (so Phase 2 doesn't re-architect):

```
seed (32 bytes, the one thing the user backs up)
 │
 ├─ spendKey   sk  = Poseidon(seed, 0)      // authorizes spends; in-circuit as inPrivKey
 ├─ nullifierKey nk = Poseidon(seed, 1)     // MVP: nullifier uses sk directly via signature;
 │                                          //      nk reserved for Phase-2 nk/ak split
 ├─ incomingVK ivk = Poseidon(seed, 2)      // for trial-decryption / note discovery
 ├─ outgoingVK ovk = Poseidon(seed, 3)      // for recovering sent-note metadata
 └─ encKey (X25519) = HKDF(seed, "veil-enc")// SEPARATE curve; client-side note encryption only

publicKey pk = Poseidon(sk)                 // the note's owner field
```

The MVP uses `sk` for the nullifier signature directly (matching Tornado Nova's flat scheme), but `nk`, `ivk`, `ovk` already exist as distinct derived values so adding viewing-key delegation later is additive, not structural. The X25519 `encKey` is deliberately a separate keypair on a separate curve — note encryption is client-side ECDH+AEAD (Soroban has no ECDH host function), entirely independent of the BN254 commitment keys.

---

# Part 9: Indexer Design

```
Stellar RPC (getEvents, ≤7-day retention)
        │  poll from last checkpoint ledger
        ▼
   ingest loop ──► parse NewCommitment{cm, idx, ct, view_tag}
        │          parse Nullifier{nf}
        ▼
   Postgres (permanent)
     commitments(cm PK, leaf_index, ciphertext, view_tag, ledger, created_at)
     nullifiers(nf PK, ledger, created_at)
     checkpoint(singleton: last_ingested_ledger)
        │
        ▼
   read API:  GET /notes?since_index=N  → {cm, idx, ct, view_tag}[]   (for client scan)
              GET /nullifiers?since=L   → {nf}[]                      (for spend-state check)
              GET /tree/root            → current root + history      (for proof building)
```

The indexer is a **boring, reliable** service — checkpoint/resume so a restart doesn't lose its place, idempotent upserts so re-ingesting a ledger is safe, and a finality lag (ingest only ledgers N confirmations deep) so reorgs don't record phantom commitments. For MVP it's single-instance; the schema and checkpoint design mean horizontal scaling later is additive.

---

# Part 10: Performance Notes

- **Verification budget.** Groth16 pairing ≈ 40M instructions (~40% of the 100M cap, measured on the SDF Privacy Pools prototype). A depth-20 insert is ~20 native Poseidon2 compressions; with host functions the per-hash cost is dominated by field ops (the ~17.6M-instruction figure was *pre*-host-function guest code — native is far cheaper). Nullifier writes are 2 cheap persistent sets. **Expected total well under budget at depth 20**, but this is the single most important thing to measure with `simulateTransaction` on day one of contract work. If depth 26 pushes it tight, drop to depth 20.
- **Proof generation.** Seconds in the browser via WASM witness + snarkjs (rapidsnark if you need faster). A depth-20 Merkle proof × 2 inputs is the dominant circuit cost; the joinsplit is well within practical proving time.
- **Tree depth tradeoff.** Depth 20 = ~1M notes, ~20 hashes/insert. Depth 26 = ~67M notes, ~26 hashes/insert and a bigger circuit. MVP: depth 20. The anonymity set is bounded by *actual notes in the pool*, not tree capacity, so depth is about headroom, not privacy.
- **Storage cost.** Each nullifier is one persistent entry at max TTL — predictable rent. Frontier is `levels` entries. Root history is `root_history_size` entries. All bounded and cheap.
- **Indexer throughput.** Trivial at MVP scale; the only real concern is never falling >7 days behind RPC, which checkpoint/resume + monitoring handles.

---

# Part 11: The Honest README (What Ships Real vs. Deferred)

**Real and load-bearing in MVP:**
- Groth16 proof verification on-chain (the ZK is the authority — remove it and anyone can steal/mint).
- Range checks + value conservation in-circuit (no money created from nothing).
- Nullifier double-spend prevention with archival-safe storage.
- Incremental Merkle tree with rolling root history.
- 2-in/2-out private transfer with real Poseidon commitments.

**Mocked/simplified in MVP (with code markers):**
- Note delivery: out-of-band in Phase 1; ciphertext events emitted (wire format fixed) but auto-scan is Phase 2.
- Single-contributor trusted setup `.zkey` (no ceremony) — flagged loudly; not production-safe.
- Viewing-key delegation: keys derived but not exercised.

**Known leaks, documented not hidden:**
- **Fee-payer deanonymization** — whoever submits the tx is visible on-chain and links to the action. Real fix is relayers (Phase 2+).
- **Small anonymity set** — a demo pool with few notes offers little privacy; stated plainly.
- **No audit, no ceremony** — research-grade, not deployable to mainnet with real funds.

---

# Part 12: Build Plan (Day-by-Day, ~11 Days, 2 People)

Split by person — one drives the **circuit + crypto core** (the riskiest path), one drives the **contract + indexer**. They converge on the Poseidon test vector early, which is the make-or-break integration point.

## Days 1–2 — De-risk the integration seam first.

- *Both:* Stand up the `veil-crypto` crate. Lock Poseidon variant (recommend **Poseidon2-BN254**, the Nethermind-proven path) and constants. Write the cross-impl test: `hash(1,2)` must equal across the Circom witness and the Soroban host call. **Nothing else proceeds until this passes** — it's the failure mode that kills these projects.
- *Person A:* Clone and build the SDF `groth16_verifier` + study `stellar-private-payments`. Get a trivial proof verifying on testnet end-to-end (any circuit) to flush out the proof-serialization handoff (`circom2soroban`, endianness, point format). This is the second-biggest risk; hit it now.
- *Person B:* Scaffold the contract: storage schema, init, the `transact` skeleton with validation order (no real verify/insert yet), error enum.

## Days 3–5 — Build the two halves in parallel.

- *Person A:* Write `transaction.circom` (2-in/2-out): ownership, commitment, nullifier, Merkle membership gated on amount, range checks, value conservation, extDataHash binding. Unit-test with `circom_tester`. Run trusted setup → `.zkey` + vkey → contract constants.
- *Person B:* Implement `merkle.rs` (insert_two + root history), `nullifier.rs` (archival-safe), wire the real Groth16 verify into `transact`. Contract unit tests for every edge case: double-spend, stale root, duplicate nullifier, tree-full, extData mismatch.

## Days 6–7 — Integrate.

- *Both:* First real end-to-end private transfer on testnet — SDK builds witness, generates proof, submits `transact`, contract verifies and inserts. This is where the seam either holds or doesn't. Budget buffer here; integration always bites.
- *Person B:* Stand up the indexer (ingest `NewCommitment`, persist, checkpoint/resume).
- *Person A:* SDK note management: key derivation, local note store, the prove/submit path.

## Days 8–9 — Make it a system, not a script.

- SDK encryption + view-tag scan (client-side X25519+AEAD). Recipient can discover an incoming note via the indexer.
- Harden: nullifier TTL/footprint handling verified, `simulateTransaction` confirms instruction budget at real depth, error paths return clean contract errors.
- Multi-note, multi-transfer test: A→B→C, change handling, dummy inputs.

## Day 10 — Phase 2 if (and only if) Phase 1 is rock-solid.

- Add `deposit`/`withdraw` via signed `publicAmount` and token settlement. *Only start this if the private-transfer core is demo-ready.* If Phase 1 is shaky, this day goes to hardening instead — a flawless transfer-only demo beats a buggy full-edge demo.

## Day 11 — Polish, README, video.

- The honest README (the real/mocked/leaks breakdown above).
- 2–3 min demo: deposit (or pre-seeded note) → private transfer → recipient discovers it → withdraw, narrated to show the contract never sees values.
- Final testnet deploy, `addresses.json`, clean repo.

## Scope Discipline Rules

- The Poseidon test vector passing (Day 2) is the gate. If it slips, cut tree depth and circuit features before cutting the integration test.
- Phase 2 is a stretch, not MVP. Transfer-only with flawless ZK wins over full-edges-but-buggy.
- The frontend (`app/`) is Day-11-if-time, never on the critical path. Your demo can be CLI + contract logs and still prove the ZK is load-bearing.
- Relayers, ceremony, viewing-key delegation, on-chain auto-scan: all post-deadline. Designed-for, not built.

---

# Part 13: Two Key Decisions Before Launch

**First: Poseidon variant.** Poseidon2-BN254 

**Second: the Day 1–2 gate.** Yes
