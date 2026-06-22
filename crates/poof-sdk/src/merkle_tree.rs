//! Client-side mirror of the contract's incremental Merkle tree.
//!
//! Must reproduce the contract's tree *exactly* so the paths and root the SDK
//! feeds the prover match what the contract verified against (INTERFACES §2):
//!   * depth (levels) = 20, capacity 2^20 leaves;
//!   * parent = `poof_crypto::compress(left, right)` = `Poseidon(left, right)`;
//!   * empty subtrees from `poof_crypto::zero_leaf` (`Zero(0)=Poseidon(0)`,
//!     `Zero(i+1)=compress(Zero(i),Zero(i))`);
//!   * leaves are inserted **two at a time** (the two output commitments), so a
//!     transact appends commitments at indices `(n, n+1)`.
//!
//! The leaf index `p` doubles as the circuit's `pathIndices`: bit `i` of `p`
//! tells the Merkle proof whether the running hash is the right child at level
//! `i` (see `merkleproof.circom`'s `DualMux`).

use ark_bn254::Fr;
use poof_crypto::{compress, zero_leaf};

/// Tree depth, frozen at 20 (INTERFACES §2).
pub const LEVELS: usize = 20;

/// A simple dense client-side tree. Stores all inserted leaves and recomputes
/// nodes on demand; correct and adequate for wallet-scale note counts.
#[derive(Clone)]
pub struct ClientMerkleTree {
    levels: usize,
    /// Inserted leaves in index order.
    leaves: Vec<Fr>,
    /// Precomputed empty-subtree roots, `zeros[i] = Zero(i)`, len = levels + 1.
    zeros: Vec<Fr>,
}

impl Default for ClientMerkleTree {
    fn default() -> Self {
        Self::new(LEVELS)
    }
}

impl ClientMerkleTree {
    /// Build an empty tree of the given depth.
    pub fn new(levels: usize) -> Self {
        let mut zeros = Vec::with_capacity(levels + 1);
        zeros.push(zero_leaf());
        for i in 0..levels {
            let z = zeros[i];
            zeros.push(compress(z, z));
        }
        ClientMerkleTree {
            levels,
            leaves: Vec::new(),
            zeros,
        }
    }

    /// Number of leaves currently inserted.
    pub fn len(&self) -> usize {
        self.leaves.len()
    }

    pub fn is_empty(&self) -> bool {
        self.leaves.is_empty()
    }

    /// Capacity = 2^levels.
    pub fn capacity(&self) -> u64 {
        1u64 << self.levels
    }

    /// Append a single leaf, returning its index.
    pub fn insert(&mut self, leaf: Fr) -> u32 {
        let idx = self.leaves.len() as u32;
        assert!((idx as u64) < self.capacity(), "tree full");
        self.leaves.push(leaf);
        idx
    }

    /// Append the two output commitments of a transact (matching the contract's
    /// `insert_two`). Returns the two leaf indices `(n, n+1)`.
    pub fn insert_two(&mut self, leaf0: Fr, leaf1: Fr) -> (u32, u32) {
        let i0 = self.insert(leaf0);
        let i1 = self.insert(leaf1);
        (i0, i1)
    }

    /// The node value at `(level, pos)`. Level 0 is the leaves; level `levels`
    /// is the root. Positions beyond the filled frontier read the empty subtree.
    fn node(&self, level: usize, pos: usize) -> Fr {
        if level == 0 {
            return self.leaves.get(pos).copied().unwrap_or(self.zeros[0]);
        }
        // Number of real (non-empty) nodes at this level.
        let count_at_level = self.leaves.len().div_ceil(1usize << level);
        if pos >= count_at_level {
            return self.zeros[level];
        }
        let left = self.node(level - 1, pos * 2);
        let right = self.node(level - 1, pos * 2 + 1);
        compress(left, right)
    }

    /// The current root.
    pub fn root(&self) -> Fr {
        self.node(self.levels, 0)
    }

    /// The Merkle authentication path for the leaf at `index`:
    /// `(path_elements[levels], path_index)` where `path_index == index`.
    /// `path_elements[i]` is the sibling at level `i`.
    pub fn path(&self, index: u32) -> Option<(Vec<Fr>, u32)> {
        if index as usize >= self.leaves.len() {
            return None;
        }
        let mut elements = Vec::with_capacity(self.levels);
        let mut pos = index as usize;
        for level in 0..self.levels {
            let sibling = pos ^ 1; // flip the low bit → sibling position
            elements.push(self.node(level, sibling));
            pos >>= 1;
        }
        Some((elements, index))
    }

    /// The empty-subtree value at a level (exposed for dummy-input padding).
    pub fn zero(&self, level: usize) -> Fr {
        self.zeros[level]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use poof_crypto::compress;

    /// Recompute a root from a leaf + its path the way the circuit's
    /// `MerkleProof` template does: at each level, place the running hash left or
    /// right according to bit `i` of the path index.
    fn root_from_path(leaf: Fr, elements: &[Fr], path_index: u32) -> Fr {
        let mut cur = leaf;
        for (i, sib) in elements.iter().enumerate() {
            let bit = (path_index >> i) & 1;
            cur = if bit == 0 {
                compress(cur, *sib)
            } else {
                compress(*sib, cur)
            };
        }
        cur
    }

    #[test]
    fn empty_tree_root_is_zero_subtree() {
        let t = ClientMerkleTree::new(LEVELS);
        assert_eq!(t.root(), t.zero(LEVELS));
    }

    #[test]
    fn path_reconstructs_root_single_leaf() {
        let mut t = ClientMerkleTree::new(LEVELS);
        let leaf = Fr::from(123456u64);
        let idx = t.insert(leaf);
        let (elems, pi) = t.path(idx).unwrap();
        assert_eq!(elems.len(), LEVELS);
        assert_eq!(pi, idx);
        assert_eq!(root_from_path(leaf, &elems, pi), t.root());
    }

    #[test]
    fn path_reconstructs_root_many_leaves() {
        let mut t = ClientMerkleTree::new(LEVELS);
        let leaves: Vec<Fr> = (0..6u64).map(Fr::from).collect();
        for &l in &leaves {
            t.insert(l);
        }
        let root = t.root();
        for (i, &l) in leaves.iter().enumerate() {
            let (elems, pi) = t.path(i as u32).unwrap();
            assert_eq!(
                root_from_path(l, &elems, pi),
                root,
                "leaf {i} path does not reconstruct root"
            );
        }
    }

    #[test]
    fn insert_two_indices() {
        let mut t = ClientMerkleTree::new(LEVELS);
        let (a, b) = t.insert_two(Fr::from(1u64), Fr::from(2u64));
        assert_eq!((a, b), (0, 1));
        let (c, d) = t.insert_two(Fr::from(3u64), Fr::from(4u64));
        assert_eq!((c, d), (2, 3));
        assert_eq!(t.len(), 4);
    }

    #[test]
    fn root_advances_on_insert() {
        let mut t = ClientMerkleTree::new(LEVELS);
        let r0 = t.root();
        t.insert(Fr::from(99u64));
        assert_ne!(t.root(), r0);
    }
}
