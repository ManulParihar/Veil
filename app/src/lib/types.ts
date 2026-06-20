// Shared domain types for the Veil wallet — the contract between the data layer
// (lib/, store/) and the presentation layer (pages/, components/).

import type { Note } from "./crypto";
import type { Signer } from "./signer";

export const CONTRACT_ID = "CAJDD2WW3CCD37AO3UTRV56WZOVXOUDVBLB3UVNNVGZYBRHA6MRTVNX4";
/** Ledger the contract was deployed at — the start for a full event scan so the
 *  client Merkle tree includes leaf 0. (RPC retains ~7 days; once the contract is
 *  older than that, the durable indexer is required for full history.) */
export const CONTRACT_START_LEDGER = 3187302;
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
  /** when we first saw/created it (ms) */
  createdAt: number;
}

export type TxStatus = "building" | "proving" | "submitting" | "success" | "error";
export type TxKind = "transfer" | "deposit" | "withdraw" | "receive" | "faucet" | "fund";

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

  // status flags
  busy: boolean; // a transact is in flight
  syncing: boolean; // a chain sync/scan is running
  feeBalance: string | null; // XLM balance of the fee account (display)

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
  withdraw: (currencyId: number, amount: bigint, toStellar: string) => Promise<TransactResult>;
  /** demo helper: create a self-note via a real on-chain transact (Phase-1 mechanics) */
  selfMintDemo: (currencyId: number, amount: bigint) => Promise<TransactResult>;
  /** testnet faucet: drip a custom asset (e.g. VUSD) to the fee account so it can
   *  then be deposited. Establishes the trustline if missing. Returns the tx hash. */
  faucetDrip: (currencyId: number) => Promise<string>;
}
