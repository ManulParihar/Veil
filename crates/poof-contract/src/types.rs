//! On-the-wire types passed into `transact`, plus the contract config.
//!
//! All field elements are 32-byte big-endian (`BytesN<32>`), reduced mod the
//! BN254 scalar field `r` when interpreted (INTERFACES §1). BN254 points use
//! the host serialization: G1 = 64 bytes `X||Y` BE, G2 = 128 bytes (see
//! `vk.rs` for the G2 coordinate-ordering note).

use soroban_sdk::{contracttype, Address, Bytes, BytesN};

/// A Groth16 proof. `a`, `c` are G1 (64 bytes); `b` is G2 (128 bytes).
/// Byte layout matches the snarkjs→`vk.rs` handoff documented in `vk.rs`.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

/// The 8 public signals, in the FROZEN order of INTERFACES §3:
/// `[root, publicAmount, extDataHash, nf0, nf1, cm0, cm1, currencyId]`.
///
/// `#[contracttype]` structs cannot carry fixed-size `[T; 2]` array fields, so
/// the two-element pairs are flattened to `*0`/`*1` named fields. The frozen
/// public-signal *order* is preserved by [`PublicSignals::as_field_array`],
/// which yields them in exactly the order the circuit's vkey was generated
/// against. Convenience accessors [`nullifiers`](Self::nullifiers) /
/// [`commitments`](Self::commitments) return them as `[_; 2]`.
///
/// `currency_id` is the asset every note in the transaction is bound to (it is
/// fed into all four commitments in-circuit). On the wire it is a 32-byte field
/// element; the contract decodes it to a `u32` registry index via
/// [`currency_id_u32`](Self::currency_id_u32).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicSignals {
    pub root: BytesN<32>,
    pub public_amount: BytesN<32>,
    pub ext_data_hash: BytesN<32>,
    pub nullifier0: BytesN<32>,
    pub nullifier1: BytesN<32>,
    pub commitment0: BytesN<32>,
    pub commitment1: BytesN<32>,
    pub currency_id: BytesN<32>,
}

impl PublicSignals {
    /// The two input nullifiers as a `[_; 2]`.
    pub fn nullifiers(&self) -> [BytesN<32>; 2] {
        [self.nullifier0.clone(), self.nullifier1.clone()]
    }

    /// The two output commitments as a `[_; 2]`.
    pub fn commitments(&self) -> [BytesN<32>; 2] {
        [self.commitment0.clone(), self.commitment1.clone()]
    }

    /// Decode `currency_id` to a `u32` registry index. Returns `None` if the
    /// field element does not fit in a `u32` (high 28 bytes must be zero), so a
    /// prover cannot alias a registered token with an out-of-range field value.
    pub fn currency_id_u32(&self) -> Option<u32> {
        let b = self.currency_id.to_array();
        if b[..28].iter().any(|&x| x != 0) {
            return None;
        }
        Some(u32::from_be_bytes([b[28], b[29], b[30], b[31]]))
    }
}

/// External data bound into the proof via `extDataHash` so a relayer cannot
/// redirect funds. The contract recomputes the hash and compares (INTERFACES §4).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExtData {
    /// 32-byte recipient identity (MVP: Ed25519 public key bytes).
    pub recipient: BytesN<32>,
    /// 32-byte relayer identity.
    pub relayer: BytesN<32>,
    /// Relayer fee. `u128`, hashed as 16 big-endian bytes.
    pub fee: u128,
    /// AEAD ciphertext for output note 0 (variable length).
    pub ciphertext0: Bytes,
    /// AEAD ciphertext for output note 1 (variable length).
    pub ciphertext1: Bytes,
    /// 1-byte view tag for output note 0, carried as `u32` (low byte significant).
    pub view_tag0: u32,
    /// 1-byte view tag for output note 1.
    pub view_tag1: u32,
    /// Settlement counterparty (Stellar address):
    ///   * DEPOSIT (publicAmount > 0) — the depositor; XLM is pulled from here.
    ///   * WITHDRAW (publicAmount < 0) — the recipient; XLM is released to here.
    ///   * TRANSFER (publicAmount == 0) — unused; any valid address (it is still
    ///     bound into `extDataHash`, so the client must pass a fixed one).
    /// Bound into `extDataHash` via its strkey so a relayer cannot redirect a
    /// withdraw.
    pub settlement_address: Address,
}

/// Immutable-after-init tree parameters.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Config {
    /// Tree depth. Capacity is `2^levels` leaves. INTERFACES §2: 20.
    pub levels: u32,
    /// Size of the rolling root-history ring buffer. INTERFACES §2: 64.
    pub root_history_size: u32,
}
