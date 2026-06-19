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
  /** the 7 public signals in INTERFACES §3 order (decimal strings) */
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

/** Assemble the full witness from two inputs + two outputs + publicAmount + root. */
function assemble(
  root: bigint,
  publicAmount: bigint,
  ins: [InputSpec, InputSpec],
  outs: [OutputSpec, OutputSpec],
  relayer: Uint8Array,
  recipient: Uint8Array,
  fee: bigint
): WitnessBundle {
  // encrypt outputs to their owners
  const encrypted = outs.map((o) => {
    const note: Note = { amount: o.amount, pubkey: o.pubkey, blinding: o.blinding };
    const enc = encryptNote(o.encPub, note);
    return { note, enc, wire: encWire(enc) };
  });

  const extData: ExtData = {
    recipient,
    relayer,
    fee,
    ciphertexts: [encrypted[0].wire, encrypted[1].wire],
    viewTags: [encrypted[0].enc.viewTag, encrypted[1].enc.viewTag],
  };
  const extHash = computeExtDataHash(extData);

  const inNullifiers = ins.map((i) => {
    const note: Note = { amount: i.amount, pubkey: hash1(i.sk), blinding: i.blinding };
    return nullifier(note, i.sk, BigInt(i.pathIndex));
  });
  const outCommitments = outs.map((o) =>
    commitment({ amount: o.amount, pubkey: o.pubkey, blinding: o.blinding })
  );

  const input: Record<string, unknown> = {
    root: S(root),
    publicAmount: S(publicAmount),
    extDataHash: S(extHash),
    inputNullifier: inNullifiers.map(S),
    outputCommitment: outCommitments.map(S),
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

/** Deposit: mint `amount` into a self-note. publicAmount = +amount, dummy inputs. */
export function buildDeposit(params: {
  root: bigint; sk: bigint; selfPub: bigint; selfEncPub: Uint8Array; amount: bigint;
}): WitnessBundle {
  const { root, sk, selfPub, selfEncPub, amount } = params;
  return assemble(
    root, amount,
    [dummyInput(sk, 0), dummyInput(sk, 1)],
    [
      { amount, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
      { amount: 0n, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
    ],
    new Uint8Array(32), fieldToBytes(selfPub), 0n
  );
}

/** Transfer: spend one real note, send `amount` to recipient, change back to self. */
export function buildTransfer(params: {
  tree: ClientMerkleTree;
  sk: bigint; selfPub: bigint; selfEncPub: Uint8Array;
  inputNote: Note; inputLeafIndex: number;
  amount: bigint; recipientPub: bigint; recipientEncPub: Uint8Array;
}): WitnessBundle {
  const { tree, sk, selfPub, selfEncPub, inputNote, inputLeafIndex, amount, recipientPub, recipientEncPub } = params;
  const path = tree.path(inputLeafIndex);
  if (!path) throw new Error("input note not in tree");
  const change = inputNote.amount - amount;
  if (change < 0n) throw new Error("insufficient note value");
  const real: InputSpec = {
    amount: inputNote.amount, sk, blinding: inputNote.blinding,
    pathIndex: path.pathIndex, pathElements: path.pathElements,
  };
  const dummy = dummyInput(sk, (path.pathIndex ^ 1) >>> 0 === path.pathIndex ? path.pathIndex + 2 : path.pathIndex + 1);
  return assemble(
    tree.root(), 0n,
    [real, dummy],
    [
      { amount, pubkey: recipientPub, blinding: rand(), encPub: recipientEncPub },
      { amount: change, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
    ],
    new Uint8Array(32), fieldToBytes(recipientPub), 0n
  );
}

/** Withdraw: burn `amount` from a real note (publicAmount = R - amount), change to self. */
export function buildWithdraw(params: {
  tree: ClientMerkleTree;
  sk: bigint; selfPub: bigint; selfEncPub: Uint8Array;
  inputNote: Note; inputLeafIndex: number; amount: bigint;
}): WitnessBundle {
  const { tree, sk, selfPub, selfEncPub, inputNote, inputLeafIndex, amount } = params;
  const path = tree.path(inputLeafIndex);
  if (!path) throw new Error("input note not in tree");
  const change = inputNote.amount - amount;
  if (change < 0n) throw new Error("insufficient note value");
  const real: InputSpec = {
    amount: inputNote.amount, sk, blinding: inputNote.blinding,
    pathIndex: path.pathIndex, pathElements: path.pathElements,
  };
  const dummy = dummyInput(sk, path.pathIndex + 1);
  return assemble(
    tree.root(), (R - amount) % R,
    [real, dummy],
    [
      { amount: change, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
      { amount: 0n, pubkey: selfPub, blinding: rand(), encPub: selfEncPub },
    ],
    new Uint8Array(32), fieldToBytes(selfPub), 0n
  );
}
