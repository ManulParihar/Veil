// Relayer configuration, entirely from env vars (12-factor; matches the indexer's
// deploy story). The only secret is the relayer's own Stellar key, which pays the
// network fee and receives the in-proof relayer fee — a low-stakes testnet hot
// wallet, never an admin/issuer key.
import { Keypair } from "@stellar/stellar-sdk";

export interface Config {
  port: number;
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
  relayerSecret: string;
  relayerPublicKey: string;
  /** minimum acceptable in-proof fee, in base units (stroops for XLM). */
  minFee: bigint;
  /** Stellar transaction fee the relayer is willing to pay (stroops). */
  baseFee: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env ${name}`);
  return v;
}

export function loadConfig(): Config {
  const relayerSecret = required("POOF_RELAYER_SECRET");
  const kp = Keypair.fromSecret(relayerSecret); // throws early on a bad key
  return {
    port: Number(process.env.PORT ?? process.env.POOF_PORT ?? 8787),
    rpcUrl: process.env.POOF_RPC_URL ?? "https://soroban-testnet.stellar.org",
    networkPassphrase: process.env.POOF_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015",
    contractId: required("POOF_CONTRACT_ID"),
    relayerSecret,
    relayerPublicKey: kp.publicKey(),
    minFee: BigInt(process.env.POOF_MIN_FEE ?? "1000000"), // 0.1 XLM default
    baseFee: process.env.POOF_BASE_FEE ?? "1000000",
  };
}
