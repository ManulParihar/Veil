// The wallet store — orchestrates crypto + proving + chain into the WalletState
// the UI consumes. Identity/notes/txs persist to localStorage; the Merkle tree
// and derived keys are rebuilt from chain + seed on load.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  initCrypto, deriveKeys, fieldToBytes, fromHex, toHex, commitment, nullifier, type Keys, type Note,
} from "../lib/crypto";
import { ClientMerkleTree } from "../lib/merkleTree";
import { buildDeposit, buildTransfer, buildWithdraw, type WitnessBundle } from "../lib/witness";
import { prove } from "../lib/prover";
import { proofToBytes, publicSignalsToBytes } from "../lib/proof";
import * as chain from "../lib/chain";
import { scanEvents } from "../lib/scan";
import { faucetFor, faucetSecret } from "../lib/faucet";
import { currencyById, toBaseUnits } from "../lib/currencies";
import {
  type WalletState, type StoredNote, type TxRecord, type FeeAccount, type TransactResult,
  CONTRACT_ID,
} from "../lib/types";

// derived, non-persisted runtime state. The tree is created lazily (it computes
// Poseidon zeros in its constructor, which must run AFTER initCrypto()).
let KEYS: Keys | null = null;
let TREE: ClientMerkleTree | null = null;
const T = (): ClientMerkleTree => (TREE ??= new ClientMerkleTree());

function ensureKeys(seedHex: string): Keys {
  if (!KEYS) KEYS = deriveKeys(fromHex(seedHex));
  return KEYS;
}

const uid = () => Math.random().toString(36).slice(2);
const now = () => Date.now();

// localStorage JSON with bigint support
const storage = createJSONStorage(() => localStorage, {
  replacer: (_k, v) => (typeof v === "bigint" ? { __bn: v.toString() } : v),
  reviver: (_k, v: any) => (v && typeof v === "object" && "__bn" in v ? BigInt(v.__bn) : v),
});

function totalUnspent(notes: StoredNote[]): bigint {
  return notes.filter((n) => !n.spent).reduce((s, n) => s + n.note.amount, 0n);
}

/** Per-currency unspent totals, keyed by currency_id. */
function balancesByCurrency(notes: StoredNote[]): Record<number, bigint> {
  const out: Record<number, bigint> = {};
  for (const n of notes) {
    if (n.spent) continue;
    const c = n.note.currencyId;
    out[c] = (out[c] ?? 0n) + n.note.amount;
  }
  return out;
}

interface Internal extends WalletState {
  _feeSecret: string | null;
}

export const useWallet = create<Internal>()(
  persist(
    (set, get) => {
      // push/update a tx record helper
      const pushTx = (rec: Omit<TxRecord, "id" | "createdAt">): string => {
        const id = uid();
        set((s) => ({ txs: [{ id, createdAt: now(), ...rec }, ...s.txs] }));
        return id;
      };
      const updateTx = (id: string, patch: Partial<TxRecord>) =>
        set((s) => ({ txs: s.txs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));

      // run a witness → prove → submit pipeline, driving a TxRecord
      const runFlow = async (
        kind: TxRecord["kind"],
        currencyId: number,
        amount: bigint,
        bundle: WitnessBundle,
        onSuccess: (res: chain.SubmitResult) => void
      ): Promise<TransactResult> => {
        const { seedHex, _feeSecret } = get();
        if (!seedHex || !_feeSecret) throw new Error("wallet not ready");
        const txId = pushTx({ kind, currencyId, amount, status: "building", stage: "Assembling witness" });
        try {
          updateTx(txId, { status: "proving", stage: "Generating zero-knowledge proof" });
          const { proof, publicSignals } = await prove(bundle.input);
          updateTx(txId, { status: "submitting", stage: "Submitting to Stellar" });
          const res = await chain.submitTransact(
            _feeSecret,
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

      return {
        initialised: false,
        seedHex: null,
        address: null,
        feeAccount: null,
        notes: [],
        balanceShielded: 0n,
        balancesByCurrency: {},
        currentRoot: null,
        nextLeafIndex: null,
        txs: [],
        busy: false,
        syncing: false,
        feeBalance: null,
        _feeSecret: null,

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
            seedHex: hex,
            address: { pubkey: KEYS.publicKey.toString(), encPub: toHex(KEYS.encPublic) },
            feeAccount: { publicKey: kp.publicKey(), secret: kp.secret(), funded: false },
            _feeSecret: kp.secret(),
            notes: [],
            txs: [],
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

        reset: () => {
          KEYS = null;
          TREE = null;
          set({
            initialised: false, seedHex: null, address: null, feeAccount: null,
            _feeSecret: null, notes: [], balanceShielded: 0n, balancesByCurrency: {},
            currentRoot: null, nextLeafIndex: null, txs: [], feeBalance: null,
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
          const fa = get().feeAccount;
          set({ syncing: true });
          try {
            const events = await chain.getNewCommitments();
            TREE = new ClientMerkleTree();
            T().insertMany(events.map((e) => chain.toHex(e.commitment)).map((h) => BigInt("0x" + h)));
            const root = fa ? await chain.getCurrentRoot(fa.publicKey).catch(() => toHex(fieldToBytes(T().root()))) : toHex(fieldToBytes(T().root()));
            set({ currentRoot: root, nextLeafIndex: T().length });
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
            const events = await chain.getNewCommitments();
            // rebuild tree so leaf indices align
            TREE = new ClientMerkleTree();
            T().insertMany(events.map((e) => BigInt("0x" + chain.toHex(e.commitment))));
            const found = scanEvents(keys, events);
            const existing = new Set(get().notes.map((n) => n.leafIndex));
            const fresh = found
              .filter((f) => !existing.has(f.leafIndex))
              .map<StoredNote>((f) => ({ note: f.note, leafIndex: f.leafIndex, spent: false, createdAt: now() }));

            // Reconcile spend state on-chain: a recovered (or stale) note whose
            // nullifier is already published must be marked spent, else the
            // balance double-counts and a spend would fail with NullifierSpent.
            let notes = [...get().notes, ...fresh];
            if (feeAccount) {
              notes = await Promise.all(
                notes.map(async (n) => {
                  if (n.spent || n.leafIndex == null) return n;
                  try {
                    const nf = nullifier(n.note, keys.spendKey, BigInt(n.leafIndex));
                    const spent = await chain.isSpent(feeAccount.publicKey, fieldToBytes(nf));
                    return spent ? { ...n, spent: true } : n;
                  } catch {
                    return n;
                  }
                })
              );
            }
            set({
              notes,
              balanceShielded: totalUnspent(notes),
              balancesByCurrency: balancesByCurrency(notes),
              nextLeafIndex: T().length,
            });
            return fresh.length;
          } finally {
            set({ syncing: false });
          }
        },

        deposit: async (currencyId: number, amount: bigint) => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          set({ busy: true });
          await get().syncChain();
          const keys = ensureKeys(seedHex);
          // the depositor (whose tokens are pulled) is the fee-payer account
          const depositor = get().feeAccount!.publicKey;
          const bundle = buildDeposit({
            root: T().root(), sk: keys.spendKey, selfPub: keys.publicKey,
            selfEncPub: keys.encPublic, amount, currencyId, settlementAddress: depositor,
          });
          return runFlow("deposit", currencyId, amount, bundle, (res) => {
            // output 0 = the funded note at leafIndices[0]
            const note: Note = { amount, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding };
            set((s) => ({
              notes: [...s.notes, { note, leafIndex: res.leafIndices[0], spent: false, createdAt: now() }],
            }));
          });
        },

        selfMintDemo: async (currencyId: number, amount: bigint) => get().deposit(currencyId, amount),

        faucetDrip: async (currencyId: number) => {
          const { _feeSecret, feeAccount } = get();
          if (!_feeSecret || !feeAccount) throw new Error("wallet not ready");
          const cfg = faucetFor(currencyId);
          if (!cfg) throw new Error("no faucet for this asset");
          const secret = faucetSecret();
          if (!secret) throw new Error("faucet not configured (set VITE_VUSD_FAUCET_SECRET in app/.env.local)");
          if (!feeAccount.funded) throw new Error("fund your fee account first (it pays the trustline reserve)");
          const amount = toBaseUnits(cfg.dripAmount, currencyById(currencyId).decimals);
          const txId = pushTx({ kind: "faucet", currencyId, amount, status: "submitting", stage: "Dripping tokens" });
          try {
            const hash = await chain.faucetDrip({
              feeSecret: _feeSecret,
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

        send: async (currencyId: number, toPubkey: string, toEncPub: string, amount: bigint) => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          set({ busy: true });
          await get().syncChain();
          const keys = ensureKeys(seedHex);
          const input = get().notes.find(
            (n) => !n.spent && n.note.currencyId === currencyId && n.note.amount >= amount && n.leafIndex != null
          );
          if (!input || input.leafIndex == null) { set({ busy: false }); throw new Error("no note covers that amount"); }
          // authoritative leaf index from the freshly-synced tree (the stored one
          // can be stale if other transacts landed in between).
          const idx = T().indexOf(commitment(input.note));
          if (idx < 0) { set({ busy: false }); throw new Error("note not found on-chain — sync/scan first"); }
          const bundle = buildTransfer({
            tree: T(), sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
            inputNote: input.note, inputLeafIndex: idx,
            amount, recipientPub: BigInt(toPubkey), recipientEncPub: fromHex(toEncPub),
            // transfer: publicAmount==0, settlement unused on-chain; bind the fee account
            settlementAddress: get().feeAccount!.publicKey,
          });
          const change = input.note.amount - amount;
          return runFlow("transfer", currencyId, amount, bundle, (res) => {
            set((s) => {
              const notes = s.notes.map((n) => (n.leafIndex === input.leafIndex ? { ...n, spent: true } : n));
              if (change > 0n) {
                notes.push({
                  note: { amount: change, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[1].note.blinding },
                  leafIndex: res.leafIndices[1], spent: false, createdAt: now(),
                });
              }
              return { notes };
            });
          });
        },

        withdraw: async (currencyId: number, amount: bigint, toStellar: string) => {
          const { seedHex } = get();
          if (!seedHex) throw new Error("no identity");
          set({ busy: true });
          await get().syncChain();
          const keys = ensureKeys(seedHex);
          const input = get().notes.find(
            (n) => !n.spent && n.note.currencyId === currencyId && n.note.amount >= amount && n.leafIndex != null
          );
          if (!input || input.leafIndex == null) { set({ busy: false }); throw new Error("no note covers that amount"); }
          const idx = T().indexOf(commitment(input.note));
          if (idx < 0) { set({ busy: false }); throw new Error("note not found on-chain — sync/scan first"); }
          const bundle = buildWithdraw({
            tree: T(), sk: keys.spendKey, selfPub: keys.publicKey, selfEncPub: keys.encPublic,
            inputNote: input.note, inputLeafIndex: idx, amount,
            settlementAddress: toStellar, // XLM is released here
          });
          const change = input.note.amount - amount;
          return runFlow("withdraw", currencyId, amount, bundle, (res) => {
            set((s) => {
              const notes = s.notes.map((n) => (n.leafIndex === input.leafIndex ? { ...n, spent: true } : n));
              if (change > 0n) {
                notes.push({
                  note: { amount: change, currencyId, pubkey: keys.publicKey, blinding: bundle.outputs[0].note.blinding },
                  leafIndex: res.leafIndices[0], spent: false, createdAt: now(),
                });
              }
              return { notes };
            });
          });
        },
      };
    },
    {
      name: "veil-wallet",
      storage,
      partialize: (s) => ({
        initialised: s.initialised, seedHex: s.seedHex, address: s.address,
        feeAccount: s.feeAccount, _feeSecret: s._feeSecret, notes: s.notes,
        txs: s.txs, balanceShielded: s.balanceShielded,
        balancesByCurrency: s.balancesByCurrency,
      }) as any,
      onRehydrateStorage: () => async (state) => {
        if (state?.seedHex) {
          await initCrypto();
          KEYS = deriveKeys(fromHex(state.seedHex));
        }
      },
    }
  )
);

export { CONTRACT_ID };
