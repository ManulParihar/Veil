// The Signer abstraction — the one seam that lets every signing path in chain.ts
// work with EITHER a local seed-derived Keypair OR a connected external wallet
// (via Stellar Wallets Kit). `chain.ts` never sees a secret or the kit; it only
// asks a Signer to sign a Transaction or authorize a Soroban auth entry.
import {
  Keypair, Transaction, TransactionBuilder, Account, Operation,
  authorizeEntry, xdr,
} from "@stellar/stellar-sdk";
import { sha256 } from "@noble/hashes/sha256";
import { NETWORK_PASSPHRASE } from "./types";
import * as walletkit from "./walletkit";

export interface Signer {
  /** The G-address this signer signs as (fee-payer / settlement / depositor). */
  readonly publicKey: string;
  /** Whether this signer can produce Soroban auth-entry signatures (deposit). */
  readonly canSignAuthEntry: boolean;
  /** Sign a classic or Soroban transaction envelope; returns the signed tx. */
  signTransaction(tx: Transaction): Promise<Transaction>;
  /** Authorize a Soroban auth entry, returning the signed copy. */
  authorizeEntry(
    entry: xdr.SorobanAuthorizationEntry,
    validUntilLedgerSeq: number
  ): Promise<xdr.SorobanAuthorizationEntry>;
}

/** Local in-browser signer backed by a seed-derived Keypair (the original path). */
export class LocalSigner implements Signer {
  readonly canSignAuthEntry = true;
  constructor(private readonly kp: Keypair) {}

  get publicKey(): string {
    return this.kp.publicKey();
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.kp);
    return tx;
  }

  authorizeEntry(
    entry: xdr.SorobanAuthorizationEntry,
    validUntilLedgerSeq: number
  ): Promise<xdr.SorobanAuthorizationEntry> {
    return authorizeEntry(entry, this.kp, validUntilLedgerSeq, NETWORK_PASSPHRASE);
  }
}

/** External-wallet signer backed by Stellar Wallets Kit. */
export class WalletKitSigner implements Signer {
  constructor(
    readonly publicKey: string,
    readonly canSignAuthEntry: boolean
  ) {}

  async signTransaction(tx: Transaction): Promise<Transaction> {
    const { signedTxXdr } = await walletkit.kit().signTransaction(tx.toXDR(), {
      address: this.publicKey,
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    return TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE) as Transaction;
  }

  authorizeEntry(
    entry: xdr.SorobanAuthorizationEntry,
    validUntilLedgerSeq: number
  ): Promise<xdr.SorobanAuthorizationEntry> {
    // Bridge stellar-sdk's SigningCallback (gets an xdr.HashIdPreimage) to the
    // kit's signAuthEntry (wants base64 of that same preimage). Both speak the
    // HashIdPreimageSorobanAuthorization XDR, so the base64 round-trips cleanly.
    return authorizeEntry(
      entry,
      async (preimage: xdr.HashIdPreimage) => {
        const { signedAuthEntry } = await walletkit.kit().signAuthEntry(
          preimage.toXDR("base64"),
          { address: this.publicKey, networkPassphrase: NETWORK_PASSPHRASE }
        );
        if (!signedAuthEntry) throw new Error("wallet returned no auth-entry signature");
        return {
          signature: Buffer.from(signedAuthEntry, "base64"),
          publicKey: this.publicKey,
        };
      },
      validUntilLedgerSeq,
      NETWORK_PASSPHRASE
    );
  }
}

/**
 * Derive a deterministic 32-byte Veil seed from a wallet's signature over a
 * fixed canonical payload. Stellar ed25519 signatures are deterministic, so the
 * same wallet account always yields the same seed — reconnecting (even on a new
 * device) restores the same shielded notes. No recovery-seed UI is needed.
 *
 * The canonical payload is a no-op transaction (manageData) sourced by the
 * wallet's own address with an infinite timebound and sequence 0, so it never
 * varies. We hash the raw ed25519 signature bytes the wallet returns.
 */
export async function walletSeedFromSignature(signer: Signer): Promise<Uint8Array> {
  const source = new Account(signer.publicKey, "0");
  const canonical = new TransactionBuilder(source, {
    fee: "100",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.manageData({
        name: "veil-identity",
        value: "veil-shielded-identity-v1",
      })
    )
    .setTimeout(0) // TimeoutInfinite — deterministic, no wall-clock in the payload
    .build();

  const signed = await signer.signTransaction(canonical);
  const sig = signed.signatures[0]?.signature();
  if (!sig || sig.length === 0) throw new Error("wallet produced no signature for identity derivation");
  return sha256(Uint8Array.from(sig));
}
