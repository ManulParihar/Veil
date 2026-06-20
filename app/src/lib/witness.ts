// Build circom witnesses + public signals + ExtData for the three flows.
// Field names match transaction.circom exactly; all values are decimal strings.
import {
  R, commitment, nullifier, signature, hash1, extDataHash as computeExtDataHash,
  encryptNote, encWire, fieldToBytes, type Note, type ExtData,
} from "./crypto";
import { ClientMerkleTree } from "./merkleTree";
import { TREE_LEVELS } from "./types";

export interface WitnessBundle {
  /** circom input (decimal strings) */
  input: Record<string, unknown>;
  /** the 8 public signals in INTERFACES §3 order (decimal strings) */
  publicSignals: string[];
  extData: ExtData;
  /** the output notes we now own (recipient, change) with their pubkeys */
  outputs: { note: Note; viewTag: number }[];
}

const ZEROS20 = () => Array(TREE_LEVELS).fill("0");
const S = (x: bigint) => (((x % R) + R) % R).toString();

interface InputSpec {
  amount: bigint;
  sk: bigint;
  blinding: bigint;
  pathIndex: number;
  pathElements: bigint[]; // length 20
}

interface OutputSpec {
  amount: bigint;
  pubkey: bigint;
  blinding: bigint;
  encPub: Uint8Array; // recipient x25519 pub, to encrypt the note to
}

/** Assemble the full witness from two inputs + two outputs + publicAmount + root.
 *  A single transaction is bound to one `currencyId`, fed into every commitment
 *  so all four notes share the same asset. */
function assemble(
  root: bigint,
  publicAmount: bigint,
  currencyId: number,
  ins: [InputSpec, InputSpec],
  outs: [OutputSpec, OutputSpec],
  relayer: Uint8Array,
  recipient: Uint8Array,
  fee: bigint,
  settlementAddress: string
): WitnessBundle {
  // encrypt outputs to their owners
  const encrypted = outs.map((o) => {
    const note: Note = { amount: o.amount, currencyId, pubkey: o.pubkey, blinding: o.blinding };
    const enc = encryptNote(o.encPub, note);
    return { note, enc, wire: encWire(enc) };
  });

  const extData: ExtData = {
    recipient,
    relayer,
    fee,
    ciphertexts: [encrypted[0].wire, encrypted[1].wire],
    viewTags: [encrypted[0].enc.viewTag, encrypted[1].enc.viewTag],
    settlementAddress,
  };
  const extHash = computeExtDataHash(extData);

  const inNullifiers = ins.map((i) => {
    const note: Note = { amount: i.amount, currencyId, pubkey: hash1(i.sk), blinding: i.blinding };
    return nullifier(note, i.sk, BigInt(i.pathIndex));
  });
  const outCommitments = outs.map((o) =>
    commitment({ amount: o.amount, currencyId, pubkey: o.pubkey, blinding: o.blinding })
  );

  const input: Record<string, unknown> = {
    root: S(root),
    publicAmount: S(publicAmount),
    extDataHash: S(extHash),
    inputNullifier: inNullifiers.map(S),
    outputCommitment: outCommitments.map(S),
    currencyId: currencyId.toString(),
    inAmount: ins.map((i) => S(i.amount)),
    inPrivateKey: ins.map((i) => S(i.sk)),
    inBlinding: ins.map((i) => S(i.blinding)),
    inPathIndices: ins.map((i) => i.pathIndex.toString()),
    inPathElements: ins.map((i) => i.pathElements.map(S)),
    outAmount: outs.map((o) => S(o.amount)),
    outPubkey: outs.map((o) => S(o.pubkey)),
    outBlinding: outs.map((o) => S(o.blinding)),
  };

  const publicSignals = [
    S(root), S(publicAmount), S(extHash),
    S(inNullifiers[0]), S(inNullifiers[1]),
    S(outCommitments[0]), S(outCommitments[1]),
    currencyId.toString(),
  ];

  return {
    input,
    publicSignals,
    extData,
    outputs: [
      { note: encrypted[0].note, viewTag: encrypted[0].enc.viewTag },
      { note: encrypted[1].note, viewTag: encrypted[1].enc.viewTag },
    ],
  };
}

const rand = () => {
  const b = new Uint8Array(31); // 248 bits < field, always reduced
  globalThis.crypto.getRandomValues(b);
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v % R;
};

function dummyInput(sk: bigint, pathIndex: number): InputSpec {
  return { amount: 0n, sk, blinding: rand(), pathIndex, pathElements: Array(TREE_LEVELS).fill(0n) };
}

/**
 * A note is spendable only by the key whose public key it commits to. The
 * circuit recomputes the input commitment with `pk = Poseidon(sk)` and checks
 * Merkle membership; if `note.pubkey != Poseidon(sk)` the leaf won't match and
 * the proof fails deep inside the circuit (ForceEqualIfEnabled). Catch it here
 * with an actionable message instead — this means the connected identity isn't
 * the one that owns the note (e.g. a different wallet account than the depositor).
 */
function assertSpendable(sk: bigint, inputNote: Note): void {
  const owner = hash1(sk);
  if (owner !== inputNote.pubkey) {
    // eslint-disable-next-line no-console
    console.warn("[veil] note not spendable by this identity", {
      noteOwnerPubkey: inputNote.pubkey.toString(),
      thisIdentityPubkey: owner.toString(),
      currencyId: inputNote.currencyId,
    });
    throw new Error(
      "This note belongs to a different account and can't be spent by the connected " +
        "identity. Reconnect the exact wallet account that deposited it (the shielded " +
        "identity is derived from that account's signature)."
    );
  }
}

/** Deposit: pull `amount` from `settlementAddress` into a self-note.
 *  publicAmount = +amount, dummy inputs. */
export function buildDeposit(params: {
  root: bigint; sk: bigint; selfPub: bigint; selfEncPub: Uint8Array; amount: bigint;
  currencyId: number; settlementAddress: string;
}): WitnessBundle {
  const { root, sk, selfPub, selfEncPub, amount, currencyId, settlementAddress } = params;
  return assemble(
    root, amount, currencyId,
    [dummyInput(sk, 0), dummyInput(sk, 1)],
    [
      { amount, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
      { amount: 0n, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
    ],
    new Uint8Array(32), fieldToBytes(selfPub), 0n, settlementAddress
  );
}

/** A real note being spent, with its on-chain leaf position. */
export interface SpendInput {
  note: Note;
  leafIndex: number;
}

/** Build the circuit's two input slots from 1 or 2 real notes (the joinsplit is
 *  2-in). One note → [real, dummy]; two notes → [real, real], which lets a spend
 *  COMBINE notes (the key to spending more than your largest single note). All
 *  inputs must be the same asset; returns the specs + their value sum. */
function spendInputs(
  tree: ClientMerkleTree, sk: bigint, inputs: SpendInput[]
): { specs: [InputSpec, InputSpec]; sumIn: bigint; currencyId: number } {
  if (inputs.length < 1 || inputs.length > 2) throw new Error("a spend takes 1 or 2 input notes");
  const currencyId = inputs[0].note.currencyId;
  const real = inputs.map((inp) => {
    if (inp.note.currencyId !== currencyId) throw new Error("all inputs must be the same asset");
    assertSpendable(sk, inp.note);
    const path = tree.path(inp.leafIndex);
    if (!path) throw new Error("input note not in tree");
    return {
      amount: inp.note.amount, sk, blinding: inp.note.blinding,
      pathIndex: path.pathIndex, pathElements: path.pathElements,
    } as InputSpec;
  });
  const sumIn = inputs.reduce((s, i) => s + i.note.amount, 0n);
  if (real.length === 1) {
    // pad with a dummy at a distinct index (its random blinding already makes its
    // nullifier distinct, but keep the index different too).
    const p = real[0].pathIndex;
    real.push(dummyInput(sk, p === 0 ? 1 : p - 1));
  } else if (real[0].pathIndex === real[1].pathIndex) {
    throw new Error("cannot spend the same note twice");
  }
  return { specs: [real[0], real[1]], sumIn, currencyId };
}

/** Transfer: spend 1–2 real notes, send `amount` to recipient, change back to self. */
export function buildTransfer(params: {
  tree: ClientMerkleTree;
  sk: bigint; selfPub: bigint; selfEncPub: Uint8Array;
  inputs: SpendInput[];
  amount: bigint; recipientPub: bigint; recipientEncPub: Uint8Array;
  settlementAddress: string;
}): WitnessBundle {
  const { tree, sk, selfPub, selfEncPub, inputs, amount, recipientPub, recipientEncPub, settlementAddress } = params;
  const { specs, sumIn, currencyId } = spendInputs(tree, sk, inputs);
  const change = sumIn - amount;
  if (change < 0n) throw new Error("inputs don't cover the amount");
  return assemble(
    tree.root(), 0n, currencyId,
    specs,
    [
      { amount, pubkey: recipientPub, blinding: rand(), encPub: recipientEncPub },
      { amount: change, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
    ],
    new Uint8Array(32), fieldToBytes(recipientPub), 0n, settlementAddress
  );
}

/** Withdraw: burn `amount` from 1–2 real notes (publicAmount = R - amount), change to self. */
export function buildWithdraw(params: {
  tree: ClientMerkleTree;
  sk: bigint; selfPub: bigint; selfEncPub: Uint8Array;
  inputs: SpendInput[]; amount: bigint;
  settlementAddress: string;
}): WitnessBundle {
  const { tree, sk, selfPub, selfEncPub, inputs, amount, settlementAddress } = params;
  const { specs, sumIn, currencyId } = spendInputs(tree, sk, inputs);
  const change = sumIn - amount;
  if (change < 0n) throw new Error("inputs don't cover the amount");
  return assemble(
    tree.root(), (R - amount) % R, currencyId,
    specs,
    [
      { amount: change, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
      { amount: 0n, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
    ],
    new Uint8Array(32), fieldToBytes(selfPub), 0n, settlementAddress
  );
}
