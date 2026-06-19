// Shared domain types for the Veil wallet — the contract between the data layer
// (lib/, store/) and the presentation layer (pages/, components/).

import type { Note } from "./crypto";

export const CONTRACT_ID = "CD6WNAXYDSDNTKE5MX6FENGR6VO6GZY55Q2MNMA664D2NXKCF6HMR5X4";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";
export const FRIENDBOT = "https://friendbot.stellar.org";
export const EXPLORER_TX = "https://stellar.expert/explorer/testnet/tx/";
export const TREE_LEVELS = 20;

/** A note we own, with its on-chain leaf position and spent state. */
export interface StoredNote {
  note: Note;
  leafIndex: number | null;
  spent: boolean;
  /** when we first saw/created it (ms) */
  createdAt: number;
}

export type TxStatus = "building" | "proving" | "submitting" | "success" | "error";
export type TxKind = "transfer" | "deposit" | "withdraw" | "receive";

/** An activity-feed entry. */
export interface TxRecord {
  id: string;
  kind: TxKind;
  status: TxStatus;
  amount: bigint;
  hash?: string; // stellar tx hash
  error?: string;
  createdAt: number;
  /** progress note shown in the UI while building/proving/submitting */
  stage?: string;
}

/** The fee-paying Stellar account (separate from the Veil identity). */
export interface FeeAccount {
  publicKey: string; // G...
  secret: string; // S...
  funded: boolean;
}

/** Public Veil address others send to: pubkey + x25519 enc pubkey. */
export interface VeilAddress {
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
  address: VeilAddress | null;
  feeAccount: FeeAccount | null;

  // data
  notes: StoredNote[];
  balanceShielded: bigint; // sum of unspent note amounts
  currentRoot: string | null; // hex, from chain
  nextLeafIndex: number | null;
  txs: TxRecord[];

  // status flags
  busy: boolean; // a transact is in flight
  syncing: boolean; // a chain sync/scan is running
  feeBalance: string | null; // XLM balance of the fee account (display)

  // lifecycle
  createIdentity: (seedHex?: string) => Promise<void>;
  importIdentity: (seedHex: string) => Promise<void>;
  reset: () => void;

  // accounts
  fundFeeAccount: () => Promise<void>;
  refreshFeeBalance: () => Promise<void>;

  // chain sync + discovery
  syncChain: () => Promise<void>; // read current root / next index
  scanForNotes: () => Promise<number>; // trial-decrypt events; returns # found

  // actions (each pushes a TxRecord and drives it through proving→submit)
  send: (toPubkey: string, toEncPub: string, amount: bigint) => Promise<TransactResult>;
  deposit: (amount: bigint) => Promise<TransactResult>;
  withdraw: (amount: bigint, toStellar: string) => Promise<TransactResult>;
  /** demo helper: create a self-note via a real on-chain transact (Phase-1 mechanics) */
  selfMintDemo: (amount: bigint) => Promise<TransactResult>;
}
