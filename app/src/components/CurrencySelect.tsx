import { CURRENCIES } from "../lib/currencies";

/** A simple asset picker over the known currency registry. When only one
 *  currency is registered it still renders, so the selected asset is explicit. */
export default function CurrencySelect({
  value,
  onChange,
  testid,
}: {
  value: number;
  onChange: (id: number) => void;
  testid?: string;
}) {
  return (
    <select
      data-testid={testid}
      className="input w-full"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {CURRENCIES.map((c) => (
        <option key={c.id} value={c.id}>
          {c.symbol}
        </option>
      ))}
    </select>
  );
}
