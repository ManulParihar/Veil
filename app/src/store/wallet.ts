// The wallet store — orchestrates crypto + proving + chain into the WalletState
// the UI consumes. Identity/notes/txs persist to localStorage; the Merkle tree
// and derived keys are rebuilt from chain + seed on load.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  initCrypto, deriveKeys, fieldToBytes, fromHex, toHex, nullifier, commitment, type Keys, type Note,
} from "../lib/crypto";
import { ClientMerkleTree } from "../lib/merkleTree";
import { buildDeposit, buildTransfer, buildWithdraw, type SpendInput, type WitnessBundle } from "../lib/witness";
import { prove } from "../lib/prover";
import { proofToBytes, publicSignalsToBytes } from "../lib/proof";
import * as chain from "../lib/chain";
import { Keypair } from "@stellar/stellar-sdk";
import { LocalSigner, WalletKitSigner, walletSeedFromSignature, type Signer } from "../lib/signer";
import * as walletkit from "../lib/walletkit";
import { scanEvents } from "../lib/scan";
import { deriveActivity, type ActivityEntry } from "../lib/activity";
import { relayWithdraw } from "../lib/relayer";
import { faucetFor, faucetSecret } from "../lib/faucet";
import { currencyById, toBaseUnits } from "../lib/currencies";
import { noteKey, planConsolidation, selectSpendInputs, spendSelectionError } from "../lib/spendSelection";
import { validateStoredNotes } from "../lib/noteValidation";
import { runDecoyRounds } from "../lib/decoy";
import {
  type WalletState, type StoredNote, type TxRecord, type FeeAccount, type TransactResult,
  type MergeProgress, type MergeRunInfo,
  CONTRACT_ID,
} from "../lib/types";

// derived, non-persisted runtime state. The tree is created lazily (it computes
// Poseidon zeros in its constructor, which must run AFTER initCrypto()).
let KEYS: Keys | null = null;
let TREE: ClientMerkleTree | null = null;
const T = (): ClientMerkleTree => (TREE ??= new ClientMerkleTree());

// Abort handle for an in-flight Decoy Booster run. Lives at module scope (sibling
// to KEYS/TREE) so the run survives the DecoyBooster component unmounting on
// navigation — the store owns the run, the component just reflects it.
let decoyAbort: AbortController | null = null;

// Serialize every transacting pipeline (syncChain → prove → submit). Two flows
// running at once would rebuild the shared TREE under each other and contend for
// the prover, so a decoy fired while a scheduled payment is in flight must wait
// its turn rather than fail. The poller's `busy` skip stays as a cheap fast-path.
let txChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = txChain.then(fn, fn);
  // keep the chain alive (and unrejected) regardless of this run's outcome
  txChain = run.then(() => {}, () => {});
  return run;
}

function ensureKeys(seedHex: string): Keys {
  if (!KEYS) KEYS = deriveKeys(fromHex(seedHex));
  return KEYS;
}

const uid = () => Math.random().toString(36).slice(2);
const now = () => Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Immediate consolidation retries a transiently-failing merge before giving up,
// re-syncing between attempts (linear backoff: 2s, 4s, …). The failed tx left
// its inputs unspent, so re-merging the same pair is safe.
const MERGE_MAX_ATTEMPTS = 3;
const MERGE_RETRY_BASE_MS = 2000;

// localStorage JSON with bigint support
const storage = createJSONStorage(() => localStorage, {
  replacer: (_k, v) => (typeof v === "bigint" ? { __bn: v.toString() } : v),
  reviver: (_k, v: any) => (v && typeof v === "object" && "__bn" in v ? BigInt(v.__bn) : v),
});

function totalUnspent(notes: StoredNote[]): bigint {
  return notes.filter((n) => !n.spent && !n.invalidReason).reduce((s, n) => s + n.note.amount, 0n);
}

/** Per-currency unspent totals, keyed by currency_id. */
function balancesByCurrency(notes: StoredNote[]): Record<number, bigint> {
  const out: Record<number, bigint> = {};
  for (const n of notes) {
    if (n.spent) continue;
    if (n.invalidReason) continue;
    const c = n.note.currencyId;
    out[c] = (out[c] ?? 0n) + n.note.amount;
  }
  return out;
}

function localRootHex(): string {
  return toHex(fieldToBytes(T().root()));
}

/** Reconcile local spent flags against the contract's authoritative nullifier
 *  set. Any note still flagged unspent whose nullifier is already published is
 *  marked spent. Without this, a stale `spent: false` flag — e.g. after a
 *  seed-phrase import rediscovers notes that were already spent (the commitment
 *  stays on the tree; only a nullifier is published) — lets spend selection pick
 *  an already-spent note, which the contract rejects with NullifierSpent (#2).
 *  `payer` is any account to simulate the read against; with none we cannot
 *  query, so notes are returned unchanged. */
async function reconcileSpentOnChain(
  notes: StoredNote[], keys: Keys, payer: string | null
): Promise<StoredNote[]> {
  if (!payer) return notes;
  return Promise.all(
    notes.map(async (n) => {
      if (n.spent || n.invalidReason || n.leafIndex == null) return n;
      try {
        const nf = nullifier(n.note, keys.spendKey, BigInt(n.leafIndex));
        const spent = await chain.isSpent(payer, fieldToBytes(nf));
        return spent ? { ...n, spent: true } : n;
      } catch {
        return n;
      }
    })
  );
}

function treeOutOfSyncError(): Error {
  return new Error(
    "local Merkle tree is incomplete or out of sync with the contract; scan/sync again before spending"
  );
}

interface Internal extends WalletState {
  _feeSecret: string | null;
  // throwaway session key for delegated ("sign once") signing. In-memory only —
  // deliberately excluded from `partialize` so it never touches localStorage.
  _delegate: { secret: string; publicKey: string; expiresAt: number } | null;
}

export const useWallet = create<Internal>()(
  persist(
    (set, get) => {
      // push/update a tx record helper. Both mirror the active identity's feed into
      // txArchive[seedHex] so re-establishing the identity (reload / reconnect / seed
      // re-import) restores the up-to-date history — not just a disconnect-time snapshot.
      const withArchive = (s: Internal, txs: TxRecord[]): Partial<Internal> =>
        s.seedHex ? { txs, txArchive: { ...s.txArchive, [s.seedHex]: txs } } : { txs };
      // Mirror the freshly-derived activity into activityArchive[seedHex] too, so a
      // reconnect of the same identity shows its last-derived feed instantly (before
      // the first scan re-derives it from chain).
      const withActivityArchive = (s: Internal, activity: ActivityEntry[]): Partial<Internal> =>
        s.seedHex ? { activity, activityArchive: { ...s.activityArchive, [s.seedHex]: activity } } : { activity };
      const pushTx = (rec: Omit<TxRecord, "id" | "createdAt">): string => {
        const id = uid();
        set((s) => withArchive(s, [{ id, createdAt: now(), ...rec }, ...s.txs]));
        return id;
      };
      const updateTx = (id: string, patch: Partial<TxRecord>) =>
        set((s) => withArchive(s, s.txs.map((t) => (t.id === id ? { ...t, ...patch } : t))));

      // run a witness → prove → submit pipeline, driving a TxRecord
      const runFlow = async (
        kind: TxRecord["kind"],
        currencyId: number,
        amount: bigint,
        bundle: WitnessBundle,
        onSuccess: (res: chain.SubmitResult) => void
      ): Promise<TransactResult> => {
        const { seedHex } = get();
        if (!seedHex) throw new Error("wallet not ready");
        const signer = get().getSigner();
        // Consume any source tag a caller staged for this self-transfer, then clear
        // it so it can't leak onto an unrelated later record. Safe under the send
        // mutex (runExclusive serializes transacts).
        const source = get().pendingTxSource;
        if (source) set({ pendingTxSource: undefined });
        const txId = pushTx({ kind, currencyId, amount, source, status: "building", stage: "Assembling witness" });
        try {
          updateTx(txId, { status: "proving", stage: "Generating zero-knowledge proof" });
          const { proof, publicSignals } = await prove(bundle.input);
          updateTx(txId, { status: "submitting", stage: "Submitting to Stellar" });
          const res = await chain.submitTransact(
            signer,
            proofToBytes(proof),
            publicSignalsToBytes(publicSignals),
            {
              recipient: bundle.extData.recipient,
              relayer: bundle.extData.relayer,
              fee: bundle.extData.fee,
              ciphertext0: bundle.extData.ciphertexts[0],
              ciphertext1: bundle.extData.ciphertexts[1],
              viewTag0: bundle.extData.viewTags[0],
              viewTag1: bundle.extData.viewTags[1],
              settlementAddress: bundle.extData.settlementAddress,
              relayerAddress: bundle.extData.relayerAddress,
            }
          );
          onSuccess(res);
          updateTx(txId, { status: "success", hash: res.hash, stage: undefined });
          set((s) => ({
            balanceShielded: totalUnspent(s.notes),
            balancesByCurrency: balancesByCurrency(s.notes),
            currentRoot: res.newRoot,
            busy: false,
          }));
          return { hash: res.hash, newRoot: res.newRoot, leafIndices: res.leafIndices };
        } catch (e: any) {
          updateTx(txId, { status: "error", error: String(e?.message ?? e), stage: undefined });
          set({ busy: false });
          throw e;
        }
      };

      // Resolve spend inputs, tolerating RPC indexing lag. A note that was just
      // deposited/received (or a change note from a rapid prior spend) may not be
      // indexed yet when we first sync — the tree root then mismatches or the
      // selection comes up empty even though the funds exist. So re-sync a few
      // times (bounded) before giving up, the same lag tolerance decoy runs use.
      // Returns a non-null selection or throws the most informative error.
      const syncAndSelect = async (keys: Keys, currencyId: number, amount: bigint) => {
        const maxAttempts = 5;
        const backoffMs = 1500;
        let lastTotal = 0n;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await get().syncChain();
          const root = get().currentRoot;
          if (!root || root === localRootHex()) {
            const { selected, totalSpendable } = selectSpendInputs(get().notes, T(), keys.publicKey, currencyId, amount);
            if (selected) return selected;
            lastTotal = totalSpendable;
          }
          if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, backoffMs));
        }
        // Exhausted: surface why we couldn't spend (tree still lagging vs. genuinely
        // insufficient spendable balance).
        const root = get().currentRoot;
        if (root && root !== localRootHex()) throw treeOutOfSyncError();
        throw spendSelectionError(lastTotal, amount);
      };

      return {
        initialised: false,
        seedHex: null,
        address: null,
        feeAccount: null,
        signerKind: "local",
        connectedWalletId: null,
        connectedAddress: null,
        notes: [],
        balanceShielded: 0n,
        balancesByCurrency: {},
        currentRoot: null,
        nextLeafIndex: null,
        txs: [],
        txArchive: {},
        activity: [],
        activityArchive: {},
        busy: false,
        syncing: false,
        feeBalance: null,
        pendingTxSource: undefined,
        _feeSecret: null,
        _delegate: null,

        // Decoy Booster run state (runtime only — never persisted). Lifted into
        // the store so an in-progress run keeps going and stays visible when the
        // user navigates away from and back to the Privacy page.
        decoyRunning: false,
        decoyProgress: null,

        // Immediate consolidation run state (runtime only — never persisted).
        // Lifted into the store so the x-of-k progress survives navigating away
        // from Send/Withdraw mid-merge.
        mergeRunning: false,
        mergeProgress: null,

        // ── signer accessors ──
        getSigner: (): Signer => {
          const { signerKind, connectedAddress, connectedWalletId, _feeSecret, _delegate } = get();
          // While a delegation is live, sign silently with the session key — this
          // is the whole point: fired transfers don't prompt the connected wallet.
          if (_delegate && now() < _delegate.expiresAt) {
            return new LocalSigner(Keypair.fromSecret(_delegate.secret));
          }
          if (signerKind === "wallet") {
            if (!connectedAddress || !connectedWalletId) throw new Error("wallet not connected");
            return new WalletKitSigner(connectedAddress, connectedWalletId, walletkit.canSignAuthEntry(connectedWalletId));
          }
          if (!_feeSecret) throw new Error("wallet not ready");
          return new LocalSigner(Keypair.fromSecret(_feeSecret));
        },

        payerPublicKey: (): string | null => {
          const { signerKind, connectedAddress, feeAccount, _delegate } = get();
          // Keep the proof's bound settlementAddress consistent with the source
          // account submitTransact actually uses (the session key) while delegated.
          if (_delegate && now() < _delegate.expiresAt) return _delegate.publicKey;
          return signerKind === "wallet" ? connectedAddress : (feeAccount?.publicKey ?? null);
        },

        delegateExpiresAt: null,

        delegationActive: (): boolean => {
          const { _delegate } = get();
          return !!_delegate && now() < _delegate.expiresAt;
        },

        startDelegation: async (ttlMs: number) => {
          // Local-identity mode already signs silently — nothing to delegate.
          if (get().signerKind !== "wallet") return;
          // Reuse-and-extend: the session key is shared across Schedule and Decoy.
          // If a delegation is already live, keep the SAME keypair and only push
          // the expiry out — never mint a second key (that would orphan whatever
          // feature minted the first, e.g. running a decoy would silently revoke
          // the Schedule page's active delegation).
          const existing = get()._delegate;
          if (existing && now() < existing.expiresAt) {
            const expiresAt = Math.max(existing.expiresAt, now() + ttlMs);
            set({ _delegate: { ...existing, expiresAt }, delegateExpiresAt: expiresAt });
            return;
          }
          const kp = Keypair.random();
          // Fund the throwaway account so it can pay Stellar network fees. On
          // testnet friendbot does this for free, with no user signature.
          await chain.friendbotFund(kp.publicKey());
          const expiresAt = now() + ttlMs;
          set({ _delegate: { secret: kp.secret(), publicKey: kp.publicKey(), expiresAt }, delegateExpiresAt: expiresAt });
        },

        revokeDelegation: () => {
          set({ _delegate: null, delegateExpiresAt: null });
        },

        startDecoy: async ({ rounds, currencyId, minDelaySec, maxDelaySec, delegate }) => {
          const st = get();
          if (st.decoyRunning) return 0;
          const address = st.address;
          if (!address) return 0;
          if ((st.balancesByCurrency[currencyId] ?? 0n) <= 0n) {
            throw new Error("no spendable balance");
          }
          // Optionally bring up / extend the SHARED session key. Reuse-and-extend
          // (see startDelegation); deliberately NOT revoked when the run ends —
          // it is session-scoped and torn down only from the Schedule page, on
          // TTL expiry, or on disconnect/reset.
          if (delegate && st.signerKind === "wallet") {
            const ttlMs = rounds * (maxDelaySec + 30) * 1000 + 15_000;
            await get().startDelegation(ttlMs);
          }
          const ac = new AbortController();
          decoyAbort = ac;
          set({ decoyRunning: true, decoyProgress: null });
          try {
            return await runDecoyRounds({
              rounds, currencyId, minDelaySec, maxDelaySec,
              // tag each round's record as a decoy (best-effort, this device only)
              send: (c, p, e, a) => { set({ pendingTxSource: "decoy" }); return get().send(c, p, e, a); },
              address: { pubkey: address.pubkey, encPub: address.encPub },
              balanceOf: () => get().balancesByCurrency[currencyId] ?? 0n,
              onRound: (info) => set({ decoyProgress: info }),
              signal: ac.signal,
              // Between rounds, settle the previous transfer before the next spend:
              // rapid rounds otherwise pick a change note the RPC hasn't indexed
              // yet, throwing pre-flight. Use scanForNotes (not syncChain): a decoy
              // sends to SELF, and only a trial-decrypting scan recovers those
              // self-sent outputs — syncChain just validates existing notes, so the
              // displayed balance would sag mid-run until a manual scan. scanForNotes
              // also rebuilds the tree + advances nextLeafIndex, so settlement
              // detection still works. Route through the same mutex as sends so it
              // never rebuilds TREE under an in-flight transfer.
              settleWait: () => runExclusive(() => get().scanForNotes()),
              nextLeafIndex: () => get().nextLeafIndex,
            });
          } finally {
            set({ decoyRunning: false });
            decoyAbort = null;
          }
        },

        stopDecoy: () => { decoyAbort?.abort(); },

        createIdentity: async (seedHex?: string) => {
          await initCrypto();
          const seed = seedHex ? fromHex(seedHex) : crypto.getRandomValues(new Uint8Array(32));
          const hex = toHex(seed);
          KEYS = deriveKeys(seed);
          // Fee account is derived from the seed (deterministic), so importing the
          // same seed restores the same Stellar account.
          const kp = chain.feeKeypairFromSeed(seed);
          set({
            initialised: true,
            signerKind: "local",
            connectedWalletId: null,
            connectedAddress: null,
            seedHex: hex,
            address: { pubkey: KEYS.publicKey.toString(), encPub: toHex(KEYS.encPublic) },
            feeAccount: { publicKey: kp.publicKey(), secret: kp.secret(), funded: false },
            _feeSecret: kp.secret(),
            notes: [],
            // restore this identity's archived activity (empty for a brand-new seed)
            txs: get().txArchive[hex] ?? [],
            activity: get().activityArchive[hex] ?? [],
            balanceShielded: 0n,
            balancesByCurrency: {},
          });
        },

        importIdentity: async (seedHex: string) => {
          await get().createIdentity(seedHex);
          // The recovered fee account may already be funded on-chain; reflect that
          // so the user is not asked to re-fund a working account.
          await get().refreshFeeBalance().catch(() => {});
        },

        connectWallet: async () => {
          await initCrypto();
          const { walletId, address } = await walletkit.connect();
          const signer = new WalletKitSigner(address, walletId, walletkit.canSignAuthEntry(walletId));
          // Derive the shielded identity deterministically from a wallet signature
          // (ed25519 is deterministic), so reconnecting the same wallet — even on a
          // new device — restores the same notes. No recovery-seed UI is shown.
          const seed = await walletSeedFromSignature(signer);
          const hex = toHex(seed);
          KEYS = deriveKeys(seed);
          const funded = parseFloat(await chain.getXlmBalance(address).catch(() => "0")) > 0;
          set({
            initialised: true,
            signerKind: "wallet",
            connectedWalletId: walletId,
            connectedAddress: address,
            seedHex: hex,
            address: { pubkey: KEYS.publicKey.toString(), encPub: toHex(KEYS.encPublic) },
            // The connected wallet IS the fee-payer/settlement account. No secret
            // is held in the browser for it.
            feeAccount: { publicKey: address, secret: "", funded },
            _feeSecret: null,
            notes: [],
            // restore this wallet's archived activity (deterministic seed → stable key)
            txs: get().txArchive[hex] ?? [],
            activity: get().activityArchive[hex] ?? [],
            balanceShielded: 0n,
            balancesByCurrency: {},
          });
          // Rediscover this identity's notes from the chain (deterministic seed →
          // same notes on reconnect).
          await get().scanForNotes().catch(() => {});
        },

        disconnect: () => {
          // Snapshot the active identity's activity so reconnecting restores it.
          const { seedHex, txs, txArchive, activity, activityArchive } = get();
          const archive = seedHex ? { ...txArchive, [seedHex]: txs } : txArchive;
          const actArchive = seedHex ? { ...activityArchive, [seedHex]: activity } : activityArchive;
          KEYS = null;
          TREE = null;
          decoyAbort?.abort();
          decoyAbort = null;
          set({
            initialised: false, seedHex: null, address: null, feeAccount: null,
            signerKind: "local", connectedWalletId: null, connectedAddress: null,
            _feeSecret: null, _delegate: null, delegateExpiresAt: null,
            decoyRunning: false, decoyProgress: null,
            mergeRunning: false, mergeProgress: null,
            notes: [], balanceShielded: 0n, balancesByCurrency: {},
            currentRoot: null, nextLeafIndex: null, txs: [], feeBalance: null,
            txArchive: archive, activity: [], activityArchive: actArchive,
          });
        },

        reset: () => {
          KEYS = null;
          TREE = null;
          decoyAbort?.abort();
          decoyAbort = null;
          set({
            initialised: false, seedHex: null, address: null, feeAccount: null,
            signerKind: "local", connectedWalletId: null, connectedAddress: null,
            _feeSecret: null, _delegate: null, delegateExpiresAt: null,
            decoyRunning: false, decoyProgress: null,
            mergeRunning: false, mergeProgress: null,
            notes: [], balanceShielded: 0n, balancesByCurrency: {},
            currentRoot: null, nextLeafIndex: null, txs: [], feeBalance: null,
            txArchive: {}, activity: [], activityArchive: {},
          });
        },

        fundFeeAccount: async () => {
          const fa = get().feeAccount;
          if (!fa) throw new Error("no fee account");
          const before = parseFloat(await chain.getXlmBalance(fa.publicKey).catch(() => "0"));
          await chain.friendbotFund(fa.publicKey);
          set((s) => ({ feeAccount: s.feeAccount ? { ...s.feeAccount, funded: true } : null }));
          await get().refreshFeeBalance();
          // Record the friendbot grant in the activity feed (XLM = currency 0).
          const after = parseFloat(await chain.getXlmBalance(fa.publicKey).catch(() => "0"));
          const granted = after - before;
          if (granted > 0) {
            pushTx({
              kind: "fund",
              currencyId: 0,
              amount: BigInt(Math.round(granted * 1e7)),
              status: "success",
            });
          }
        },

        refreshFeeBalance: async () => {
          const fa = get().feeAccount;
          if (!fa) return;
          const bal = await chain.getXlmBalance(fa.publicKey);
          // `funded` is sticky: once friendbot succeeds it stays true even if
          // Horizon hasn't indexed the balance yet (read lag must not lock the UI).
          set((s) => ({
            feeBalance: bal,
            feeAccount: s.feeAccount ? { ...s.feeAccount, funded: s.feeAccount.funded || parseFloat(bal) > 0 } : null,
          }));
        },

        syncChain: async () => {
          const { feeAccount: fa, seedHex } = get();
          set({ syncing: true });
          try {
            const { commitments: events, nullifiers } = await chain.getCommitmentsAndNullifiers();
            TREE = new ClientMerkleTree();
            T().insertMany(events.map((e) => chain.toHex(e.commitment)).map((h) => BigInt("0x" + h)));
            const root = fa ? await chain.getCurrentRoot(fa.publicKey).catch(() => localRootHex()) : localRootHex();
            let notes = seedHex ? validateStoredNotes(get().notes, events, ensureKeys(seedHex).publicKey) : get().notes;
            // Authoritative spent-state reconcile before any spend selection relies
            // on these flags — prevents re-spending an already-spent note (#2).
            if (seedHex) notes = await reconcileSpentOnChain(notes, ensureKeys(seedHex), get().payerPublicKey());
            // Refresh the typed Activity feed too, so a spend's deposit/transfer/
            // withdraw lands durably without needing a separate manual scan.
            const activity = seedHex ? deriveActivity(ensureKeys(seedHex), events, nullifiers) : get().activity;
            set((s) => ({
              currentRoot: root,
              nextLeafIndex: T().length,
              notes,
              balanceShielded: totalUnspent(notes),
              balancesByCurrency: balancesByCurrency(notes),
              ...(seedHex ? withActivityArchive(s, activity) : {}),
            }));
          } finally {
            set({ syncing: false });
          }
        },

        scanForNotes: async () => {
          const { seedHex, feeAccount } = get();
          if (!seedHex) return 0;
          const keys = ensureKeys(seedHex);
          set({ syncing: true });
          try {
            const { commitments: events, nullifiers } = await chain.getCommitmentsAndNullifiers();
            // rebuild tree so leaf indices align
            TREE = new ClientMerkleTree();
            T().insertMany(events.map((e) => BigInt("0x" + chain.toHex(e.commitment))));
            const root = feeAccount ? await chain.getCurrentRoot(feeAccount.publicKey).catch(() => localRootHex()) : localRootHex();
            const found = scanEvents(keys, events);
            const existing = new Set(get().notes.map((n) => `${n.leafIndex}:${noteKey(n.note)}`));
            const fresh = found
              .filter((f) => !existing.has(`${f.leafIndex}:${noteKey(f.note)}`))
              .map<StoredNote>((f) => ({ note: f.note, leafIndex: f.leafIndex, spent: false, createdAt: now() }));

            // Reconcile spend state on-chain: a recovered (or stale) note whose
            // nullifier is already published must be marked spent, else the
            // balance double-counts and a spend would fail with NullifierSpent.
            let notes = validateStoredNotes([...get().notes, ...fresh], events, keys.publicKey);
            notes = await reconcileSpentOnChain(notes, keys, get().payerPublicKey());
            // Reconstruct the typed Activity feed from chain events (deposit /
            // receive / transfer / withdraw), correctly classified and stamped with
            // the real ledger close time. This replaces the old per-note `receive`
            // log, which mislabelled every re-discovered note (deposits, change,
            // decoy self-sends) as "Receive".
            const activity = deriveActivity(keys, events, nullifiers);
            set((s) => ({
              notes,
              balanceShielded: totalUnspent(notes),
              balancesByCurrency: balancesByCurrency(notes),
              currentRoot: root,
              nextLeafIndex: T().length,
              ...withActivityArchive(s, activity),
            }));
            return fresh.length;
          } finally {
            set({ syncing: false });
          }
        },

        deposit: async (currencyId: number, amount: bigint) => runExclusive(async () => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          set({ busy: true });
          await get().syncChain();
          const keys = ensureKeys(seedHex);
          // the depositor (whose tokens are pulled) is the active payer account —
          // the connected wallet, or the local fee account.
          const depositor = get().payerPublicKey()!;
          // Deposit inputs are dummies (Merkle membership is skipped), so the
          // witness root only has to be a KNOWN on-chain root — use the chain's
          // current root directly. This avoids UnknownRoot when the client mirror
          // tree is incomplete (e.g. RPC event window missed early commitments).
          const rootHex = await chain.getCurrentRoot(depositor);
          const bundle = buildDeposit({
            root: BigInt("0x" + rootHex), sk: keys.spendKey, selfPub: keys.publicKey,
            selfEncPub: keys.encPublic, amount, currencyId, settlementAddress: depositor,
          });
          return runFlow("deposit", currencyId, amount, bundle, (res) => {
            // output 0 = the funded note at leafIndices[0]
            const note: Note = { amount, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding };
            set((s) => ({
              notes: [...s.notes, { note, leafIndex: res.leafIndices[0], spent: false, createdAt: now() }],
            }));
          });
        }),

        // Delegates to deposit() (already serialized via runExclusive) — do NOT
        // wrap again or the nested acquisition would deadlock on the outer run.
        selfMintDemo: async (currencyId: number, amount: bigint) => get().deposit(currencyId, amount),

        faucetDrip: async (currencyId: number) => {
          const { feeAccount } = get();
          if (!feeAccount) throw new Error("wallet not ready");
          const signer = get().getSigner();
          const cfg = faucetFor(currencyId);
          if (!cfg) throw new Error("no faucet for this asset");
          const secret = faucetSecret();
          if (!secret) throw new Error("faucet not configured (set VITE_VUSD_FAUCET_SECRET in app/.env.local)");
          if (!feeAccount.funded) throw new Error("fund your fee account first (it pays the trustline reserve)");
          const amount = toBaseUnits(cfg.dripAmount, currencyById(currencyId).decimals);
          const txId = pushTx({ kind: "faucet", currencyId, amount, status: "submitting", stage: "Dripping tokens" });
          try {
            const hash = await chain.faucetDrip({
              recipient: signer,
              faucetSecret: secret,
              assetCode: cfg.assetCode,
              issuer: cfg.issuer,
              amount: cfg.dripAmount,
            });
            updateTx(txId, { status: "success", hash, stage: undefined });
            return hash;
          } catch (e: any) {
            updateTx(txId, { status: "error", error: String(e?.message ?? e), stage: undefined });
            throw e;
          }
        },

        send: async (currencyId: number, toPubkey: string, toEncPub: string, amount: bigint) => runExclusive(async () => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          set({ busy: true });
          const keys = ensureKeys(seedHex);
          // A send to our own pubkey is a self-transfer (manual self-send, decoy
          // round, or scheduled-self) — on-chain identical to an outbound transfer,
          // but it doesn't change our balance, so we label it distinctly. Default
          // the source tag to "self" unless a caller (decoy/scheduler) already
          // marked it more specifically.
          const isSelf = BigInt(toPubkey) === keys.publicKey;
          if (isSelf && !get().pendingTxSource) set({ pendingTxSource: "self" });
          let selected: Awaited<ReturnType<typeof syncAndSelect>>;
          try {
            selected = await syncAndSelect(keys, currencyId, amount);
          } catch (e) {
            set({ busy: false });
            throw e;
          }
          const bundle = buildTransfer({
            tree: T(), sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
            inputs: selected.inputs,
            amount, recipientPub: BigInt(toPubkey), recipientEncPub: fromHex(toEncPub),
            // transfer: publicAmount==0, settlement unused on-chain; bind the payer
            settlementAddress: get().payerPublicKey()!,
          });
          const spentKeys = new Set(selected.notes.map((n) => noteKey(n.note)));
          const change = selected.change;
          return runFlow(isSelf ? "self" : "transfer", currencyId, amount, bundle, (res) => {
            set((s) => {
              const notes = s.notes.map((n) => (spentKeys.has(noteKey(n.note)) ? { ...n, spent: true } : n));
              // On a self-send the recipient (output 0) is also us, so record it —
              // otherwise merging the whole balance to self leaves nothing tracked
              // locally and the shielded balance reads zero until a rescan recovers
              // it. (Mirrors mergeNotes, which pushes its self output.)
              if (isSelf) {
                notes.push({
                  note: { amount, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding },
                  leafIndex: res.leafIndices[0], spent: false, createdAt: now(),
                });
              }
              if (change > 0n) {
                notes.push({
                  note: { amount: change, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[1].note.blinding },
                  leafIndex: res.leafIndices[1], spent: false, createdAt: now(),
                });
              }
              return { notes };
            });
          });
        }),

        // Merge two SPECIFIC notes into one (self-transfer, amount = their sum,
        // change = 0). Unlike send() this takes explicit inputs and does NOT
        // re-sync the tree, so a consolidation driver can fire several merges in
        // one round against a single known root. Pushes the merged note so the
        // next round can chain on it after a settle.
        mergeNotes: async (currencyId: number, inputs: SpendInput[]) => runExclusive(async () => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          if (inputs.length !== 2) throw new Error("a merge takes exactly 2 notes");
          set({ busy: true, pendingTxSource: "merge" });
          const keys = ensureKeys(seedHex);
          const sumIn = inputs[0].note.amount + inputs[1].note.amount;
          let bundle: WitnessBundle;
          try {
            bundle = buildTransfer({
              tree: T(), sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
              inputs, amount: sumIn, recipientPub: keys.publicKey, recipientEncPub: keys.encPublic,
              settlementAddress: get().payerPublicKey()!,
            });
          } catch (e) {
            set({ busy: false });
            throw e;
          }
          const spentKeys = new Set(inputs.map((i) => noteKey(i.note)));
          return runFlow("self", currencyId, sumIn, bundle, (res) => {
            set((s) => {
              const notes = s.notes.map((n) => (spentKeys.has(noteKey(n.note)) ? { ...n, spent: true } : n));
              // the merged note (output 0, the self-recipient) lands at leafIndices[0]
              notes.push({
                note: { amount: sumIn, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding },
                leafIndex: res.leafIndices[0], spent: false, createdAt: now(),
              });
              return { notes };
            });
          });
        }),

        previewConsolidation: async (currencyId: number, amount: bigint) => {
          const { seedHex } = get();
          if (!seedHex) return null;
          const keys = ensureKeys(seedHex);
          await get().syncChain();
          const { plan } = planConsolidation(get().notes, T(), keys.publicKey, currencyId, amount);
          return plan;
        },

        consolidateNow: async (
          currencyId: number, amount: bigint,
          opts?: { onProgress?: (p: MergeProgress) => void; signal?: AbortSignal }
        ) => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          const keys = ensureKeys(seedHex);
          const signal = opts?.signal;
          // Fresh tree + notes (recovers self-notes, advances leaf count) so the
          // covering notes resolve to current leaf indices.
          await runExclusive(() => get().scanForNotes());
          const { plan } = planConsolidation(get().notes, T(), keys.publicKey, currencyId, amount);
          if (!plan || plan.rounds === 0) return; // already spendable in ≤2 notes
          const totalRounds = plan.rounds;
          const totalSteps = plan.totalMerges;
          let step = 0;
          // Mirror progress into the store (survives navigation) AND the optional
          // caller callback.
          const report = (round: number) => {
            const info: MergeRunInfo = { round, totalRounds, step, totalSteps, currencyId };
            set({ mergeProgress: info });
            opts?.onProgress?.(info);
          };
          // A single merge can fail transiently (an on-chain "FAILED" from root
          // contention/sequence races, or brief RPC/tree lag). Rather than abort
          // the whole consolidation, retry a few times with backoff, re-syncing
          // first so we resolve fresh leaf indices and build against the live root.
          // The failed tx left the inputs UNSPENT, so a re-merge of the same pair
          // is safe; if a prior attempt had actually landed, the note resolves as
          // already merged and we skip it.
          const mergeOnePair = async (a: Note, b: Note): Promise<number> => {
            let lastErr: unknown;
            for (let attempt = 1; attempt <= MERGE_MAX_ATTEMPTS; attempt++) {
              if (signal?.aborted) throw new Error("merge cancelled");
              const ai = T().indexOf(commitment(a));
              const bi = T().indexOf(commitment(b));
              if (ai < 0 || bi < 0) throw treeOutOfSyncError();
              try {
                const res = await get().mergeNotes(currencyId, [
                  { note: a, leafIndex: ai },
                  { note: b, leafIndex: bi },
                ]);
                return res.leafIndices[0];
              } catch (e) {
                lastErr = e;
                if (attempt >= MERGE_MAX_ATTEMPTS) break;
                if (signal?.aborted) throw new Error("merge cancelled");
                await sleep(MERGE_RETRY_BASE_MS * attempt);
                await runExclusive(() => get().scanForNotes()); // refresh before retry
              }
            }
            throw lastErr;
          };
          set({ mergeRunning: true });
          report(1);
          try {
            // Round 0 frontier = the covering notes; later rounds chain on the
            // merged outputs. Leaf indices are re-resolved per merge (append-only,
            // so a note's index is stable, but the tree is rebuilt between rounds).
            let frontier: Note[] = plan.coveringNotes.map((s) => s.note);
            for (let round = 1; frontier.length > 2; round++) {
              if (signal?.aborted) throw new Error("merge cancelled");
              const producedLeaves: number[] = [];
              let carried: Note | null = null;
              for (let i = 0; i < frontier.length; i += 2) {
                if (i + 1 >= frontier.length) { carried = frontier[i]; break; }
                if (signal?.aborted) throw new Error("merge cancelled");
                producedLeaves.push(await mergeOnePair(frontier[i], frontier[i + 1]));
                step++;
                report(round);
              }
              // Settle so the merged commitments land and the tree/notes pick them
              // up before the next round resolves their paths.
              await runExclusive(() => get().scanForNotes());
              const settled = get().notes;
              const atLeaf = (li: number): Note => {
                const found = settled.find((n) => n.leafIndex === li && !n.spent);
                if (!found) throw treeOutOfSyncError();
                return found.note;
              };
              frontier = [...producedLeaves.map(atLeaf), ...(carried ? [carried] : [])];
            }
          } finally {
            set({ mergeRunning: false, mergeProgress: null });
          }
        },

        mergeStep: async (currencyId: number, amount: bigint, onMerge?: () => void, shouldContinue?: () => boolean) => {
          const { seedHex } = get();
          if (!seedHex) return "done";
          const keys = ensureKeys(seedHex);
          // Fresh view so the covering set + leaf indices are current (reload-safe:
          // the frontier is recomputed every time from on-chain state).
          await runExclusive(() => get().scanForNotes());
          const { plan } = planConsolidation(get().notes, T(), keys.publicKey, currencyId, amount);
          if (!plan || plan.rounds === 0) return "done";
          // Merge one pair, retrying a few times on a transient on-chain "FAILED"
          // or RPC/tree lag. A failed tx leaves its inputs UNSPENT, so re-merging
          // the same pair is safe; we re-resolve leaf indices against the live tree
          // each attempt (and re-sync between attempts).
          const mergeOnePair = async (a: Note, b: Note) => {
            let lastErr: unknown;
            for (let attempt = 1; attempt <= MERGE_MAX_ATTEMPTS; attempt++) {
              const ai = T().indexOf(commitment(a));
              const bi = T().indexOf(commitment(b));
              if (ai < 0 || bi < 0) throw treeOutOfSyncError();
              try {
                await get().mergeNotes(currencyId, [
                  { note: a, leafIndex: ai },
                  { note: b, leafIndex: bi },
                ]);
                return;
              } catch (e) {
                lastErr = e;
                if (attempt >= MERGE_MAX_ATTEMPTS) break;
                await sleep(MERGE_RETRY_BASE_MS * attempt);
                await runExclusive(() => get().scanForNotes());
              }
            }
            throw lastErr;
          };
          // Execute one balanced-tree round: pair up all covering notes and merge
          // each pair. All pairs build proofs against the same root so they don't
          // need an intermediate settle-wait between them, only after the round.
          const frontier = plan.coveringNotes.map((s) => s.note);
          for (let i = 0; i + 1 < frontier.length; i += 2) {
            // Re-check before each pair that we can still sign silently. A
            // delegation can lapse mid-round; without this, getSigner() silently
            // falls back to the external wallet and prompts in the background
            // (the surprise "user rejected" popups). Stop instead and report
            // "paused" so the caller can surface re-authorization — partial
            // progress is kept (the round re-plans from on-chain state).
            if (shouldContinue && !shouldContinue()) return "paused";
            await mergeOnePair(frontier[i], frontier[i + 1]);
            onMerge?.();
          }
          // Settle so the merged outputs land in the tree before the next round.
          await runExclusive(() => get().scanForNotes());
          return "merged";
        },

        withdraw: async (currencyId: number, amount: bigint, toStellar: string) => runExclusive(async () => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          set({ busy: true });
          const keys = ensureKeys(seedHex);
          let selected: Awaited<ReturnType<typeof syncAndSelect>>;
          try {
            selected = await syncAndSelect(keys, currencyId, amount);
          } catch (e) {
            set({ busy: false });
            throw e;
          }
          const bundle = buildWithdraw({
            tree: T(), sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
            inputs: selected.inputs, amount,
            settlementAddress: toStellar, // XLM is released here
          });
          const spentKeys = new Set(selected.notes.map((n) => noteKey(n.note)));
          const change = selected.change;
          return runFlow("withdraw", currencyId, amount, bundle, (res) => {
            set((s) => {
              const notes = s.notes.map((n) => (spentKeys.has(noteKey(n.note)) ? { ...n, spent: true } : n));
              if (change > 0n) {
                notes.push({
                  note: { amount: change, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding },
                  leafIndex: res.leafIndices[0], spent: false, createdAt: now(),
                });
              }
              return { notes };
            });
          });
        }),

        withdrawViaRelayer: async (currencyId: number, amount: bigint, toStellar: string, relayerAddress: string, fee: bigint) => runExclusive(async () => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          if (fee <= 0n) throw new Error("relayer fee must be positive");
          if (fee >= amount) throw new Error("relayer fee must be smaller than the amount");
          set({ busy: true });
          const keys = ensureKeys(seedHex);
          let selected: Awaited<ReturnType<typeof syncAndSelect>>;
          try {
            selected = await syncAndSelect(keys, currencyId, amount);
          } catch (e) {
            set({ busy: false });
            throw e;
          }
          // The recipient nets `amount - fee`; the relayer is paid `fee`. The
          // relayer payout address is bound into the proof's extDataHash.
          const bundle = buildWithdraw({
            tree: T(), sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
            inputs: selected.inputs, amount,
            settlementAddress: toStellar, relayerAddress, fee,
          });
          const spentKeys = new Set(selected.notes.map((n) => noteKey(n.note)));
          const change = selected.change;
          // leaf positions the two outputs will land at (relayer doesn't echo them)
          const payer = get().payerPublicKey();
          const nextBefore = payer ? await chain.getNextLeafIndex(payer).catch(() => null) : null;

          const txId = pushTx({ kind: "withdraw", currencyId, amount, status: "building", stage: "Assembling witness" });
          try {
            updateTx(txId, { status: "proving", stage: "Generating zero-knowledge proof" });
            const { proof, publicSignals } = await prove(bundle.input);
            updateTx(txId, { status: "submitting", stage: "Relaying (gasless) to Stellar" });
            const hash = await relayWithdraw(
              proofToBytes(proof),
              publicSignalsToBytes(publicSignals),
              {
                recipient: bundle.extData.recipient,
                relayer: bundle.extData.relayer,
                fee: bundle.extData.fee,
                ciphertext0: bundle.extData.ciphertexts[0],
                ciphertext1: bundle.extData.ciphertexts[1],
                viewTag0: bundle.extData.viewTags[0],
                viewTag1: bundle.extData.viewTags[1],
                settlementAddress: bundle.extData.settlementAddress,
                relayerAddress: bundle.extData.relayerAddress,
              }
            );
            updateTx(txId, { status: "success", hash, stage: undefined });
            const newRoot = payer ? await chain.getCurrentRoot(payer).catch(() => get().currentRoot ?? "") : (get().currentRoot ?? "");
            set((s) => {
              const notes = s.notes.map((n) => (spentKeys.has(noteKey(n.note)) ? { ...n, spent: true } : n));
              if (change > 0n && nextBefore != null) {
                notes.push({
                  note: { amount: change, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding },
                  leafIndex: nextBefore, spent: false, createdAt: now(),
                });
              }
              return {
                notes,
                balanceShielded: totalUnspent(notes),
                balancesByCurrency: balancesByCurrency(notes),
                currentRoot: newRoot,
                busy: false,
              };
            });
            return { hash, newRoot, leafIndices: [nextBefore ?? 0, (nextBefore ?? 0) + 1] as [number, number] };
          } catch (e: any) {
            updateTx(txId, { status: "error", error: String(e?.message ?? e), stage: undefined });
            set({ busy: false });
            throw e;
          }
        }),
      };
    },
    {
      name: "poof-wallet",
      storage,
      partialize: (s) => ({
        initialised: s.initialised, seedHex: s.seedHex, address: s.address,
        feeAccount: s.feeAccount, _feeSecret: s._feeSecret, notes: s.notes,
        txs: s.txs, txArchive: s.txArchive,
        activity: s.activity, activityArchive: s.activityArchive,
        balanceShielded: s.balanceShielded,
        balancesByCurrency: s.balancesByCurrency,
        signerKind: s.signerKind, connectedWalletId: s.connectedWalletId,
        connectedAddress: s.connectedAddress,
      }) as any,
      onRehydrateStorage: () => async (state) => {
        if (state?.seedHex) {
          await initCrypto();
          KEYS = deriveKeys(fromHex(state.seedHex));
        }
        // Re-select the previously connected external wallet so signing works
        // after a reload (no modal; the wallet's own session governs approval).
        if (state?.signerKind === "wallet" && state.connectedWalletId) {
          try { walletkit.restore(state.connectedWalletId); } catch { /* wallet ext not present */ }
        }
      },
    }
  )
);

export { CONTRACT_ID };
