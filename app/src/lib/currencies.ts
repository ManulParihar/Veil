// The asset registry the wallet knows about. `id` is the on-chain currency_id
// (the contract's Token(u32) registry index); `sac` is the Stellar Asset
// Contract address the pool settles against for that currency. Decimals/symbol
// are display metadata. Currency 0 is always native XLM (registered at init).
//
// Adding a currency here mirrors the admin's on-chain `register_token`: no
// circuit or contract change is needed, only this list (and the registration).

export interface Currency {
  id: number;
  symbol: string;
  decimals: number;
  /** Stellar Asset Contract address backing this currency. */
  sac: string;
}

export const CURRENCIES: Currency[] = [
  {
    id: 0,
    symbol: "XLM",
    decimals: 7,
    sac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  },
  {
    id: 1,
    symbol: "VUSD",
    decimals: 7,
    sac: "CDR3FXAKYZKDXMF53LZM5LIER7SYRKMA2EXGDBO3KODCCBEBCY5XJS64",
  },
];

export const DEFAULT_CURRENCY_ID = 0;

export function currencyById(id: number): Currency {
  return CURRENCIES.find((c) => c.id === id) ?? CURRENCIES[0];
}

/** Parse a human amount string (e.g. "1.4") into base units for `decimals`. */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const s = (amount || "0").trim();
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const base = 10n ** BigInt(decimals);
  return BigInt(whole || "0") * base + BigInt(fracPadded || "0");
}

/** Format an amount + currency for display, e.g. "1000 VUSD". Defaults to XLM. */
export function formatAmount(amount: bigint, currencyId?: number): string {
  const c = currencyById(currencyId ?? DEFAULT_CURRENCY_ID);
  return `${fromBaseUnits(amount, c.decimals)} ${c.symbol}`;
}

/** Format base units as a human amount string (trailing zeros trimmed). */
export function fromBaseUnits(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const x = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = x / base;
  const frac = (x % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return neg ? `-${out}` : out;
}
