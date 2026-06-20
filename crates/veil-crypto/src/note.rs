//! Note, key hierarchy and the commitment / signature / nullifier derivations.
//!
//! These formulas are the contract between the circuit and the clients. The
//! circom circuit (`circuits/src/transaction.circom`) recomputes every one of
//! them in-constraint; the SDK computes them in the clear to build witnesses
//! and to scan. They MUST stay identical — change one, change all three.
//!
//! Derivations (matching CLAUDE.md Part 7 / Tornado-Nova's flat scheme, with the
//! Phase-3 multi-currency `currency_id` folded into the commitment):
//! ```text
//! pk        = Poseidon(sk)                                  // note owner field
//! commitment= Poseidon(amount, currency_id, pk, blinding)
//! signature = Poseidon(sk, commitment, pathIndex)
//! nullifier = Poseidon(commitment, pathIndex, signature)
//! ```
//!
//! Binding `currency_id` into the commitment is what makes a note asset-specific:
//! a note minted under one currency can never be spent in a transaction that
//! declares another, because the recomputed leaf would not match the tree.

use ark_bn254::Fr;

use crate::field::{fr_from_be_bytes, fr_from_u64};
use crate::poseidon::{hash1, hash2, hash3, hash4};

/// The 32-byte secret the user backs up. Everything derives from it.
#[derive(Clone, Copy, Debug)]
pub struct Seed(pub [u8; 32]);

impl Seed {
    fn as_fr(&self) -> Fr {
        fr_from_be_bytes(&self.0)
    }

    /// Spend key `sk = Poseidon(seed, 0)`. Authorises spends; used in-circuit
    /// as `inPrivKey` and to sign the nullifier.
    pub fn spend_key(&self) -> Fr {
        hash2(self.as_fr(), fr_from_u64(0))
    }

    /// Nullifier key `nk = Poseidon(seed, 1)`. Reserved for the Phase-2 nk/ak
    /// split; the MVP nullifier signs with `sk` directly.
    pub fn nullifier_key(&self) -> Fr {
        hash2(self.as_fr(), fr_from_u64(1))
    }

    /// Incoming viewing key `ivk = Poseidon(seed, 2)` — note discovery.
    pub fn incoming_viewing_key(&self) -> Fr {
        hash2(self.as_fr(), fr_from_u64(2))
    }

    /// Outgoing viewing key `ovk = Poseidon(seed, 3)` — sent-note recovery.
    pub fn outgoing_viewing_key(&self) -> Fr {
        hash2(self.as_fr(), fr_from_u64(3))
    }

    /// The full keypair derived from this seed.
    pub fn keypair(&self) -> Keypair {
        Keypair::from_private(self.spend_key())
    }
}

/// A spend keypair. `public_key` is the note-owner field embedded in commitments.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Keypair {
    pub private_key: Fr,
    pub public_key: Fr,
}

impl Keypair {
    /// `pk = Poseidon(sk)`.
    pub fn from_private(private_key: Fr) -> Self {
        Keypair {
            private_key,
            public_key: hash1(private_key),
        }
    }
}

/// A UTXO-style note (an off-chain secret). On-chain it exists only as its
/// Poseidon `commitment`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Note {
    /// Value in [0, 2^64) - range-checked in-circuit.
    pub amount: u64,
    /// Registry index of the asset this note represents. Bound into the
    /// commitment so the note is spendable only as that currency.
    pub currency_id: u32,
    /// Owner public key `pk`.
    pub pubkey: Fr,
    /// Randomness `rho`. MUST be sampled with real entropy by the client so two
    /// equal-value notes to the same owner do not collide.
    pub blinding: Fr,
}

impl Note {
    pub fn new(amount: u64, currency_id: u32, pubkey: Fr, blinding: Fr) -> Self {
        Note { amount, currency_id, pubkey, blinding }
    }

    /// `commitment = Poseidon(amount, currency_id, pubkey, blinding)`.
    pub fn commitment(&self) -> Fr {
        hash4(
            fr_from_u64(self.amount),
            fr_from_u64(self.currency_id as u64),
            self.pubkey,
            self.blinding,
        )
    }

    /// `signature = Poseidon(sk, commitment, pathIndex)`.
    ///
    /// Binds the spender's secret and the note's tree position so the same note
    /// cannot produce two different nullifiers and two notes at different
    /// positions cannot collide.
    pub fn signature(&self, private_key: Fr, path_index: u64) -> Fr {
        hash3(private_key, self.commitment(), fr_from_u64(path_index))
    }

    /// `nullifier = Poseidon(commitment, pathIndex, signature)`.
    pub fn nullifier(&self, private_key: Fr, path_index: u64) -> Fr {
        let sig = self.signature(private_key, path_index);
        hash3(self.commitment(), fr_from_u64(path_index), sig)
    }
}
