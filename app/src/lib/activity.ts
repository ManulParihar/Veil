// Derive a typed, durable Activity feed from on-chain events.
//
// The wallet's old feed was a local action log: it only knew a tx was a
// "deposit"/"transfer"/"withdraw" if YOU performed it in that browser session,
// and every freshly-scanned commitment was logged as a "receive". So a
// re-import (or a fresh device) re-discovered every note your key can decrypt —
// deposit outputs, change notes, decoy self-sends — and labelled them all
// "Receive". This module instead reconstructs the feed from the chain, so it is
// reproducible on any device and correctly typed.
//
// Classification needs no extra RPC: it groups a transact's events by tx hash,
// then reads two local facts — which of the two outputs we can decrypt, and
// whether we spent any input (our nullifier was published):
//
//   spent? | our outputs | kind
//   -------+-------------+----------------------------------------------
//    no    |     2       | deposit   (our value note + our zero pad)
//    no    |     1       | receive   (the other output is the sender's change)
//    yes   |    ≤1       | transfer  (sent out; our 1 output is the change)
//    yes   |     2       | withdraw  if funds left (Σout < Σin), else
//          |             | self       (self-send/decoy; funds preserved)
//
// The zero-value pad outputs of deposit/withdraw are real leaves encrypted to
// us, so counting decryptable outputs (not just amount>0 ones) is what separates
// a deposit (2 ours) from a receive (1 ours), and a withdraw from a transfer.
import {
  commitment as noteCommitment, computeViewTag, decryptNote, encFromWire,
  fieldToBytes, toHex, nullifier as noteNullifier, type Keys, type Note,
} from "./crypto";
import type { CommitmentEvent, NullifierEvent } from "./chain";

export type ActivityKind = "deposit" | "receive" | "transfer" | "self" | "withdraw";

export interface ActivityEntry {
  /** Stable id: the tx hash, or `leaf:<n>` when grouping is unavailable (aged
   *  indexer rows that carry no tx hash). Used to dedupe against in-flight records. */
  id: string;
  txHash?: string;
  kind: ActivityKind;
  amount: bigint;
  currencyId: number;
  /** Real ledger close time (epoch ms); 0 when unknown. */
  time: number;
  /** Representative leaf index for this transact (min of its commitments). */
  leafIndex: number;
}

/** Trial-decrypt an output we own, WITHOUT the amount>0 filter `scanEvents`
 *  applies — the zero-value pad outputs must count for classification. */
function decryptMine(keys: Keys, ev: CommitmentEvent): Note | null {
  if (ev.ciphertext.length < 32) return null;
  const enc = encFromWire(ev.ciphertext, ev.viewTag);
  if (!enc) return null;
  if (computeViewTag(keys.encSecret, enc.ephemeralPub) !== ev.viewTag) return null;
  const note = decryptNote(keys.encSecret, enc);
  if (!note) return null;
  if (note.pubkey !== keys.publicKey) return null;
  if (toHex(fieldToBytes(noteCommitment(note))) !== toHex(ev.commitment)) return null;
  return note;
}

interface Out { note: Note; leafIndex: number; }
interface TxMeta { time: number; leafIndex: number; }

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
};

/**
 * Reconstruct the Activity feed for `keys` from the full commitment + nullifier
 * event history. Only transactions that touch us (an output we own, or a note we
 * spent) produce an entry. Returned newest-first.
 */
export function deriveActivity(
  keys: Keys,
  commitments: CommitmentEvent[],
  nullifiers: NullifierEvent[],
): ActivityEntry[] {
  const keyOf = (txHash: string | undefined, leafIndex: number) => txHash ?? `leaf:${leafIndex}`;

  // 1. Decrypt every output we own (incl. zero pads); index by tx, and collect
  //    our real (amount>0) notes so we can recognise our own spends.
  const myOutsByTx = new Map<string, Out[]>();
  const txMeta = new Map<string, TxMeta>();
  const myNotes: Out[] = [];
  for (const ev of commitments) {
    const k = keyOf(ev.txHash, ev.leafIndex);
    const prev = txMeta.get(k);
    txMeta.set(k, {
      time: Math.max(prev?.time ?? 0, ev.ledgerCloseTime ?? 0),
      leafIndex: Math.min(prev?.leafIndex ?? ev.leafIndex, ev.leafIndex),
    });
    const note = decryptMine(keys, ev);
    if (!note) continue;
    push(myOutsByTx, k, { note, leafIndex: ev.leafIndex });
    if (note.amount > 0n) myNotes.push({ note, leafIndex: ev.leafIndex });
  }

  // 2. Map each of our notes' nullifiers → its amount, to detect our spends.
  const myNfAmount = new Map<string, bigint>();
  for (const o of myNotes) {
    const nf = toHex(fieldToBytes(noteNullifier(o.note, keys.spendKey, BigInt(o.leafIndex))));
    myNfAmount.set(nf, o.note.amount);
  }

  // 3. Group OUR spends by tx (a nullifier we can attribute to one of our notes).
  const mySpentByTx = new Map<string, bigint[]>();
  for (const nv of nullifiers) {
    if (!nv.txHash) continue; // can't attribute to a transact without grouping
    const amt = myNfAmount.get(toHex(nv.nf));
    if (amt === undefined) continue;
    push(mySpentByTx, nv.txHash, amt);
    const prev = txMeta.get(nv.txHash);
    if (prev) prev.time = Math.max(prev.time, nv.ledgerCloseTime ?? 0);
  }

  // 4. Classify every tx that touches us.
  const entries: ActivityEntry[] = [];
  const keysTouchingUs = new Set<string>([...myOutsByTx.keys(), ...mySpentByTx.keys()]);
  for (const k of keysTouchingUs) {
    const outs = myOutsByTx.get(k) ?? [];
    const spent = mySpentByTx.get(k) ?? [];
    const meta = txMeta.get(k);
    const time = meta?.time ?? 0;
    const leafIndex = meta?.leafIndex ?? outs[0]?.leafIndex ?? 0;
    const currencyId = outs.find((o) => o.note.amount > 0n)?.note.currencyId
      ?? outs[0]?.note.currencyId ?? 0;

    let kind: ActivityKind;
    let amount: bigint;
    if (spent.length === 0) {
      if (outs.length === 0) continue; // foreign tx; not ours
      if (outs.length >= 2) {
        // our value note + our zero pad ⇒ a deposit we funded
        kind = "deposit";
        amount = outs.reduce((s, o) => s + o.note.amount, 0n);
      } else {
        // single output to us, no spend of ours ⇒ an incoming payment
        kind = "receive";
        amount = outs[0].note.amount;
      }
    } else {
      const inputsTotal = spent.reduce((s, a) => s + a, 0n);
      const myOutTotal = outs.reduce((s, o) => s + o.note.amount, 0n);
      if (outs.length <= 1) {
        // we spent and kept only the change ⇒ sent to someone else
        kind = "transfer";
        amount = inputsTotal - myOutTotal;
      } else if (myOutTotal < inputsTotal) {
        // we spent and funds left the shielded pool ⇒ withdraw
        kind = "withdraw";
        amount = inputsTotal - myOutTotal;
      } else {
        // funds preserved across our own outputs ⇒ self-transfer (a self-send,
        // decoy round, or scheduled-self). Cryptographically indistinguishable
        // from an outbound transfer to an outsider; we only know it's ours because
        // we can decrypt BOTH outputs.
        kind = "self";
        amount = outs.reduce((m, o) => (o.note.amount > m ? o.note.amount : m), 0n);
      }
    }

    entries.push({ id: k, txHash: k.startsWith("leaf:") ? undefined : k, kind, amount, currencyId, time, leafIndex });
  }

  // newest first; ledger time is primary, leaf index breaks ties / fills gaps
  entries.sort((a, b) => b.time - a.time || b.leafIndex - a.leafIndex);
  return entries;
}
