// Spawn the proving worker and await a Groth16 proof. Keeps the UI responsive.
import type { SnarkProof } from "./proof";

export interface ProveResult {
  proof: SnarkProof;
  publicSignals: string[];
}

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: ProveResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/prover.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent) => {
      const { id, ok, proof, publicSignals, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve({ proof, publicSignals });
      else p.reject(new Error(error));
    };
    worker.onerror = (e) => {
      for (const [, p] of pending) p.reject(new Error(e.message || "prover worker error"));
      pending.clear();
    };
  }
  return worker;
}

/** Generate a Groth16 proof for a circom input (runs in a Web Worker). */
export function prove(input: Record<string, unknown>): Promise<ProveResult> {
  const id = ++seq;
  return new Promise<ProveResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, input });
  });
}
