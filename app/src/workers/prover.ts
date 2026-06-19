// Web Worker: run Groth16 proving off the UI thread via snarkjs.
import * as snarkjs from "snarkjs";

const WASM_URL = "/circuit/transaction.wasm";
const ZKEY_URL = "/circuit/transaction.zkey";

self.onmessage = async (e: MessageEvent) => {
  const { id, input } = e.data;
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_URL, ZKEY_URL);
    (self as unknown as Worker).postMessage({ id, ok: true, proof, publicSignals });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
