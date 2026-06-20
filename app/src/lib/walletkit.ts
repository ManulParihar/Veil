// Stellar Wallets Kit integration — the singleton through which external wallets
// (Freighter, xBull, Albedo, etc.) connect and sign. This is the *only* place the
// kit is constructed; everything else talks to it through `signer.ts`'s Signer.
//
// The kit's WalletNetwork.TESTNET passphrase is byte-identical to the app's
// NETWORK_PASSPHRASE, so signatures it produces verify against our network.
import {
  StellarWalletsKit, WalletNetwork, allowAllModules,
  FREIGHTER_ID, XBULL_ID,
} from "@creit.tech/stellar-wallets-kit";
import { NETWORK_PASSPHRASE } from "./types";

// Sanity: the kit's testnet passphrase must equal ours, else auth entries the
// wallet signs won't verify on our network.
if (WalletNetwork.TESTNET !== NETWORK_PASSPHRASE) {
  // eslint-disable-next-line no-console
  console.warn("walletkit: TESTNET passphrase mismatch", WalletNetwork.TESTNET, NETWORK_PASSPHRASE);
}

let _kit: StellarWalletsKit | null = null;

/** The lazily-constructed kit singleton. Default-selects Freighter (overridden
 *  the moment a user picks a wallet). `allowAllModules()` enables every wallet
 *  the kit supports — requirement (2). */
export function kit(): StellarWalletsKit {
  if (!_kit) {
    _kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
  }
  return _kit;
}

export interface Connection {
  walletId: string;
  address: string;
}

/** Open the wallet-selection modal, then read the chosen wallet's address.
 *  Resolves on a successful selection; rejects if the user closes the modal. */
export function connect(): Promise<Connection> {
  return new Promise((resolve, reject) => {
    kit().openModal({
      onWalletSelected: async (option) => {
        try {
          kit().setWallet(option.id);
          const { address } = await kit().getAddress();
          resolve({ walletId: option.id, address });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      },
      onClosed: (err) => reject(err ?? new Error("wallet selection cancelled")),
    });
  });
}

/** Re-select a previously-connected wallet on load (no modal). The wallet's
 *  own session decides whether a fresh user approval is needed. */
export function restore(walletId: string): void {
  kit().setWallet(walletId);
}

/** Read the active address from the connected wallet (it may have changed which
 *  account is selected since connect). */
export async function currentAddress(): Promise<string> {
  const { address } = await kit().getAddress();
  return address;
}

// Soroban require_auth (deposit) needs `signAuthEntry`. Not every wallet
// implements it reliably; allowlist the ones known to. Others can still do
// transfer/withdraw/faucet (which only need signTransaction).
const AUTH_ENTRY_CAPABLE = new Set<string>([FREIGHTER_ID, XBULL_ID]);

export function canSignAuthEntry(walletId: string | null | undefined): boolean {
  return !!walletId && AUTH_ENTRY_CAPABLE.has(walletId);
}
