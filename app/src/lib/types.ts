// Shared domain types for the Poof wallet — the contract between the data layer
// (lib/, store/) and the presentation layer (pages/, components/).

import type { Note } from "./crypto";
import type { Signer } from "./signer";
import type { DecoyRoundInfo } from "./decoy";
import type { ActivityEntry } from "./activity";
import type { SpendInput } from "./witness";
import type { ConsolidationPlan } from "./spendSelection";

/** Per-step progress of an immediate consolidation (balanced-tree merge). */
export interface MergeProgress {
  /** 1-based current round / total rounds. */
  round: number;
  totalRounds: number;
  /** 1-based merge step completed / total merge steps across all rounds. */
  step: number;
  totalSteps: number;
}

/** Live state of an in-flight immediate consolidation, lifted into the store so it
 *  survives navigation away from the Send/Withdraw page. */
export interface MergeRunInfo extends MergeProgress {
  currencyId: number;
}

export const CONTRACT_ID = "CDLDIXFXQHMGQI2P7F4A6JBKFLYCJND7UUSHCZ3TZ5UTZAGOM3WGDMXP";
/** Ledger the contract was deployed at — the start for a full event scan so the
 *  client Merkle tree includes leaf 0. (RPC retains ~7 days; once the contract is
 *  older than that, the durable indexer is required for full history.) */
export const CONTRACT_START_LEDGER = 3297796;
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const FRIENDBOT = "https://friendbot.stellar.org";
export const EXPLORER_TX = "https://stellar.expert/explorer/testnet/tx/";
export const EXPLORER_ACCOUNT = "https://stellar.expert/explorer/testnet/account/";
export const TREE_LEVELS = 20;

/** Note amounts are denominated in stroops (1 XLM = 10^7 stroops). */
export const STROOPS_PER_XLM = 10_000_000n;

/** Parse a human XLM string (e.g. "1.4") into stroops. */
export function toStroops(xlm: string): bigint {
  const s = (xlm || "0").trim();
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS_PER_XLM + BigInt(fracPadded || "0");
}

/** Format stroops as a human XLM string (trailing zeros trimmed). */
export function fromStroops(stroops: bigint): string {
  const neg = stroops < 0n;
  const v = neg ? -stroops : stroops;
  const whole = v / STROOPS_PER_XLM;
  const frac = (v % STROOPS_PER_XLM).toString().padStart(7, "0").replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${out}` : out;
}

/** A note we own, with its on-chain leaf position and spent state. */
export interface StoredNote {
  note: Note;
  leafIndex: number | null;
  spent: boolean;
  /** Present when a decrypted/persisted note is visible but not spendable. */
  invalidReason?: string;
  /** Encrypted private memo attached by the sender. */
  memo?: string;
  /** when we first saw/created it (ms) */
  createdAt: number;
}

export type TxStatus = "building" | "proving" | "submitting" | "success" | "error";
export type TxKind = "transfer" | "self" | "deposit" | "withdraw" | "receive" | "faucet" | "fund";
/** Where a self-transfer originated, when this device performed it. On-chain a
 *  self-send / decoy / scheduled-self are indistinguishable; this is a best-effort,
 *  local-only sub-label that degrades to plain "self" on other devices. */
export type TxSource = "self" | "decoy" | "scheduled" | "merge";

/** An activity-feed entry. */
export interface TxRecord {
  id: string;
  kind: TxKind;
  status: TxStatus;
  amount: bigint;
  /** Asset the amount is denominated in (registry index). Defaults to 0 (XLM). */
  currencyId?: number;
  hash?: string; // stellar tx hash
  error?: string;
  createdAt: number;
  /** progress note shown in the UI while building/proving/submitting */
  stage?: string;
  /** For self-transfers (kind === "self"): how it originated on this device. */
  source?: TxSource;
}

/** The fee-paying Stellar account (separate from the Poof identity). */
export interface FeeAccount {
  publicKey: string; // G...
  secret: string; // S...
  funded: boolean;
}

/** Public Poof address others send to: pubkey + x25519 enc pubkey. */
export interface PoofAddress {
  pubkey: string; // decimal field element
  encPub: string; // hex 32 bytes
}

/** Result of submitting a transact: the on-chain effects. */
export interface TransactResult {
  hash: string;
  newRoot: string; // hex
  leafIndices: [number, number];
}

/**
 * The wallet store's public shape — the FROZEN contract between U2 (implements
 * this as a zustand store in store/wallet.ts) and U1 (consumes it in the UI).
 * U1 may rely on every field/method here; U2 must provide them.
 */
export interface WalletState {
  // identity / accounts
  initialised: boolean;
  seedHex: string | null;
  address: PoofAddress | null;
  feeAccount: FeeAccount | null;

  // signer: "local" = seed-derived in-browser Keypair; "wallet" = connected
  // external wallet via Stellar Wallets Kit.
  signerKind: "local" | "wallet";
  connectedWalletId: string | null; // kit wallet id when signerKind === "wallet"
  connectedAddress: string | null;  // connected G-address when signerKind === "wallet"

  // data
  notes: StoredNote[];
  balanceShielded: bigint; // sum of unspent note amounts (all currencies, base units)
  /** Per-currency unspent balance, keyed by currency_id. */
  balancesByCurrency: Record<number, bigint>;
  currentRoot: string | null; // hex, from chain
  nextLeafIndex: number | null;
  txs: TxRecord[];
  /** Per-identity activity archive (keyed by seedHex) so disconnecting and
   *  reconnecting the same identity restores its local history. */
  txArchive: Record<string, TxRecord[]>;
  /** Typed activity derived from chain events on each scan (deposit / receive /
   *  transfer / withdraw) — the durable, correctly-classified feed. In-flight
   *  actions are overlaid from `txs` until a scan picks them up here. */
  activity: ActivityEntry[];
  /** Per-identity derived-activity cache (keyed by seedHex) for instant display
   *  before the first scan after reconnecting. */
  activityArchive: Record<string, ActivityEntry[]>;

  // status flags
  busy: boolean; // a transact is in flight
  syncing: boolean; // a chain sync/scan is running
  feeBalance: string | null; // XLM balance of the fee account (display)
  /** Runtime-only (never persisted): set by a caller right before a self-send so
   *  the pushed TxRecord can be tagged "decoy"/"scheduled". Read-and-cleared by the
   *  flow that creates the record, under the send mutex. */
  pendingTxSource?: TxSource;

  // lifecycle
  createIdentity: (seedHex?: string) => Promise<void>;
  importIdentity: (seedHex: string) => Promise<void>;
  /** Connect an external Stellar wallet (Freighter, xBull, …) as the signer and
   *  derive a deterministic shielded identity from a wallet signature. */
  connectWallet: () => Promise<void>;
  /** Sign out of the active identity but keep its activity archive, so
   *  reconnecting the same identity restores history. */
  disconnect: () => void;
  reset: () => void;

  // signer accessors
  /** The active Signer (local Keypair or connected wallet). */
  getSigner: () => Signer;
  /** The G-address that pays fees / settles / receives faucet drips. */
  payerPublicKey: () => string | null;

  // delegated ("sign once") signing
  /** Epoch ms the active delegation expires, or null if none active. While
   *  active, fired transfers sign silently with a throwaway session key instead
   *  of prompting the connected external wallet. In-memory only (never persisted)
   *  and capped by a TTL. */
  delegateExpiresAt: number | null;
  /** True iff a delegation is set and not yet expired. */
  delegationActive: () => boolean;
  /** Spin up a throwaway session fee-account (funded via friendbot) that signs
   *  fired transfers silently for `ttlMs`. No-op in local-identity mode. */
  startDelegation: (ttlMs: number) => Promise<void>;
  /** Tear down the active delegation; subsequent transfers prompt the wallet again. */
  revokeDelegation: () => void;

  // decoy booster run (lifted into the store so an in-progress run keeps going and
  // stays visible across navigation; runtime only — never persisted).
  /** True while a decoy run is executing. */
  decoyRunning: boolean;
  /** Latest per-round progress of the active/last decoy run (null before any run). */
  decoyProgress: DecoyRoundInfo | null;
  /** Start a decoy run (randomized self-transfers). Optionally brings up/extends
   *  the shared session key (reuse-and-extend; not revoked when the run ends).
   *  Resolves with the number of rounds that completed. */
  startDecoy: (opts: { rounds: number; currencyId: number; minDelaySec: number; maxDelaySec: number; delegate: boolean }) => Promise<number>;
  /** Abort the active decoy run (after the current round/await settles). */
  stopDecoy: () => void;

  // immediate consolidation run (lifted into the store like the decoy run, so the
  // x-of-k progress stays visible if the user navigates away mid-merge; runtime
  // only — never persisted).
  /** True while an immediate `consolidateNow` is executing. */
  mergeRunning: boolean;
  /** Latest per-step progress of the active/last immediate merge (null when idle). */
  mergeProgress: MergeRunInfo | null;

  // accounts
  fundFeeAccount: () => Promise<void>;
  refreshFeeBalance: () => Promise<void>;

  // chain sync + discovery
  syncChain: () => Promise<void>; // read current root / next index
  scanForNotes: () => Promise<number>; // trial-decrypt events; returns # found

  // actions (each pushes a TxRecord and drives it through proving→submit).
  // `currencyId` selects the asset; amounts are in that currency's base units.
  send: (currencyId: number, toPubkey: string, toEncPub: string, amount: bigint) => Promise<TransactResult>;
  deposit: (currencyId: number, amount: bigint) => Promise<TransactResult>;
  /** Merge two specific notes of one asset into one (a self-transfer collapsing
   *  2 notes → 1). Bypasses auto spend-selection so a consolidation driver can
   *  combine exact pairs; builds against the current in-memory tree (no re-sync),
   *  so same-round merges share one known root. */
  mergeNotes: (currencyId: number, inputs: SpendInput[]) => Promise<TransactResult>;
  /** Sync the chain, then report whether spending `amount` needs a multi-note
   *  merge first (null = balance can't cover it; caller spends normally to surface
   *  the right error). Used by Send/Withdraw to branch the UX before transacting. */
  previewConsolidation: (currencyId: number, amount: bigint) => Promise<ConsolidationPlan | null>;
  /** Immediately consolidate this identity's notes (balanced-tree merge with
   *  settle-waits between rounds) until `amount` is spendable in ≤2 notes. Drives
   *  `onProgress` per merge step; throws on failure. */
  consolidateNow: (
    currencyId: number,
    amount: bigint,
    opts?: { onProgress?: (p: MergeProgress) => void; signal?: AbortSignal }
  ) => Promise<void>;
  /** Perform ONE balanced-tree ROUND toward making `amount` spendable in ≤2
   *  notes: syncs, pairs up the covering notes, and merges every pair against the
   *  same root (no settle between pairs), then settles. Returns "done" when no
   *  merge is needed (already ≤2 notes or balance can't cover it) or "merged"
   *  when a round ran. `onMerge` fires once per completed pair-merge so callers
   *  can surface live progress. Each pair retries a few times on a transient
   *  failure before throwing. Drives the timed "Merge privately" poller, which
   *  paces these rounds at randomized intervals. */
  mergeStep: (currencyId: number, amount: bigint, onMerge?: () => void, shouldContinue?: () => boolean) => Promise<"merged" | "done" | "paused">;
  withdraw: (currencyId: number, amount: bigint, toStellar: string) => Promise<TransactResult>;
  /** Gasless withdraw: prove in-browser, then a relayer submits + pays the Stellar
   *  network fee, compensated by `fee`. Recipient nets `amount - fee`. Requires a
   *  fee-settling contract + a configured relayer (VITE_RELAYER_URL). */
  withdrawViaRelayer: (currencyId: number, amount: bigint, toStellar: string, relayerAddress: string, fee: bigint) => Promise<TransactResult>;
  /** Demo helper: create a self-note via a real on-chain private transfer. */
  selfMintDemo: (currencyId: number, amount: bigint) => Promise<TransactResult>;
  /** testnet faucet: drip a custom asset (e.g. VUSD) to the fee account so it can
   *  then be deposited. Establishes the trustline if missing. Returns the tx hash. */
  faucetDrip: (currencyId: number) => Promise<string>;
}
