// Client mirror of the contract's depth-20 incremental Merkle tree. Reproduces
// the contract exactly (parent = Poseidon(l,r), zeros from Zero(0)=Poseidon(0),
// two leaves per transact, lone leaf pairs with Zero(0)) so the paths/roots we
// feed the prover match what the contract verified against.
import { compress, zeroLeaf } from "./crypto";
import { TREE_LEVELS } from "./types";

export class ClientMerkleTree {
  readonly levels: number;
  private leaves: bigint[] = [];
  private zeros: bigint[] = [];

  constructor(levels = TREE_LEVELS) {
    this.levels = levels;
    let z = zeroLeaf();
    this.zeros.push(z);
    for (let i = 0; i < levels; i++) {
      z = compress(z, z);
      this.zeros.push(z);
    }
  }

  get length() {
    return this.leaves.length;
  }

  insert(leaf: bigint): number {
    const idx = this.leaves.length;
    this.leaves.push(leaf);
    return idx;
  }

  insertMany(leaves: bigint[]) {
    for (const l of leaves) this.insert(l);
  }

  zero(level: number): bigint {
    return this.zeros[level];
  }

  /** node value at (level, pos); empty positions read the zero subtree. */
  private node(level: number, pos: number): bigint {
    if (level === 0) return pos < this.leaves.length ? this.leaves[pos] : this.zeros[0];
    const countAtLevel = Math.ceil(this.leaves.length / 2 ** level);
    if (pos >= countAtLevel) return this.zeros[level];
    return compress(this.node(level - 1, pos * 2), this.node(level - 1, pos * 2 + 1));
  }

  root(): bigint {
    return this.node(this.levels, 0);
  }

  /** authentication path for the leaf at `index`: siblings per level + pathIndex==index. */
  path(index: number): { pathElements: bigint[]; pathIndex: number } | null {
    if (index >= this.leaves.length) return null;
    const elements: bigint[] = [];
    let pos = index;
    for (let level = 0; level < this.levels; level++) {
      elements.push(this.node(level, pos ^ 1)); // sibling
      pos >>= 1;
    }
    return { pathElements: elements, pathIndex: index };
  }
}
