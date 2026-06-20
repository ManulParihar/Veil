// Testnet faucet config for custom assets. Native XLM is funded via friendbot;
// custom Stellar assets (e.g. VUSD) need a trustline plus a balance before they
// can be deposited, so we drip them from a dedicated distributor account.
//
// The distributor is NOT the contract admin and NOT the asset issuer: it just
// holds a pre-funded VUSD balance, so the only secret the app needs is this
// low-stakes faucet key. It is read from an env var (VITE_VUSD_FAUCET_SECRET)
// and never committed. Worst case if it leaks: someone drains the faucet's
// testnet VUSD. Set it in app/.env.local (see .env.example).

export interface FaucetConfig {
  currencyId: number;
  assetCode: string;
  /** Classic asset issuer (G-address). */
  issuer: string;
  /** Distributor account holding the faucet's balance (G-address, public). */
  distributor: string;
  /** Amount dripped per click, in display units. */
  dripAmount: string;
}

export const FAUCETS: FaucetConfig[] = [
  {
    currencyId: 1,
    assetCode: "VUSD",
    issuer: "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM",
    distributor: "GBBGQTNRGZ7BGNCUGNVBRSYUNBY2XCJ7UAAVYWA2OPMCWTQSGR3PPXGP",
    dripAmount: "1000",
  },
];

export function faucetFor(currencyId: number): FaucetConfig | undefined {
  return FAUCETS.find((f) => f.currencyId === currencyId);
}

/** The distributor secret, supplied via env (gitignored). Undefined if unset. */
export function faucetSecret(): string | undefined {
  const s = import.meta.env.VITE_VUSD_FAUCET_SECRET as string | undefined;
  return s && s.length > 0 ? s : undefined;
}

export const faucetConfigured = (currencyId: number): boolean =>
  !!faucetFor(currencyId) && !!faucetSecret();
