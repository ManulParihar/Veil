//! BN254 scalar-field (`Fr`) helpers.
//!
//! The canonical wire representation everywhere in Veil is a **32-byte
//! big-endian** encoding of a field element. The contract receives
//! commitments / nullifiers / roots as `BytesN<32>` and reduces them with the
//! same `from_be_bytes_mod_order` rule used here, so the SDK, the contract and
//! the circuit's public-signal serialisation all agree byte-for-byte.

use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};

/// Reduce 32 big-endian bytes into the BN254 scalar field.
pub fn fr_from_be_bytes(bytes: &[u8; 32]) -> Fr {
    Fr::from_be_bytes_mod_order(bytes)
}

/// Serialise a field element to its canonical 32-byte big-endian form.
pub fn fr_to_be_bytes(x: &Fr) -> [u8; 32] {
    let be = x.into_bigint().to_bytes_be();
    // `to_bytes_be` returns exactly the minimal big-endian bytes for the
    // modulus width (32 bytes for BN254 Fr), but guard defensively.
    let mut out = [0u8; 32];
    let n = be.len().min(32);
    out[32 - n..].copy_from_slice(&be[be.len() - n..]);
    out
}

/// Lift a `u64` (e.g. a note amount or a path index) into `Fr`.
pub fn fr_from_u64(x: u64) -> Fr {
    Fr::from(x)
}
