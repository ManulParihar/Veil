//! Key hierarchy: seed (32 bytes) → all keys, fully deterministic.
//!
//! Two distinct key families derive from the one 32-byte seed:
//!
//! * The **BN254 spend / viewing keys** — `sk`, `nk`, `ivk`, `ovk` — come from
//!   `poof-crypto::Seed` (Poseidon over the field). These live in-circuit.
//! * A **separate X25519 encryption keypair** for client-side note encryption
//!   (Soroban has no ECDH host function, so encryption is entirely off-chain on
//!   a separate curve). Derived via `HKDF-SHA256(seed, "veil-enc")`.
//!
//! Everything is reproducible from the seed alone; no device-local randomness
//! is ever mixed into a key path.

use hkdf::Hkdf;
use sha2::Sha256;
use poof_crypto::{fr_to_be_bytes, Keypair, Seed};
use x25519_dalek::{PublicKey as X25519Public, StaticSecret as X25519Secret};

use ark_bn254::Fr;

/// HKDF info string binding the encryption key to this protocol/use.
const ENC_INFO: &[u8] = b"veil-enc";

/// The full set of keys a wallet holds, all derived from one seed.
#[derive(Clone)]
pub struct Keys {
    seed: Seed,
    /// BN254 spend keypair: `sk` (private) and `pk = Poseidon(sk)` (note owner).
    pub keypair: Keypair,
    /// X25519 secret for note decryption (ECDH).
    pub enc_secret: X25519Secret,
    /// X25519 public — recipients hand this out so others can encrypt to them.
    pub enc_public: X25519Public,
}

impl Keys {
    /// Derive the complete key hierarchy from a 32-byte seed.
    pub fn from_seed(seed_bytes: [u8; 32]) -> Self {
        let seed = Seed(seed_bytes);
        let keypair = seed.keypair();

        // X25519 secret = HKDF-SHA256(salt=seed, ikm=seed, info="veil-enc").
        // We use the seed as both salt and IKM so a single 32-byte backup
        // reproduces the encryption key on any device with no extra state.
        let hk = Hkdf::<Sha256>::new(Some(&seed_bytes), &seed_bytes);
        let mut okm = [0u8; 32];
        hk.expand(ENC_INFO, &mut okm)
            .expect("32 is a valid HKDF-SHA256 output length");
        let enc_secret = X25519Secret::from(okm);
        let enc_public = X25519Public::from(&enc_secret);

        Keys {
            seed,
            keypair,
            enc_secret,
            enc_public,
        }
    }

    /// Spend private key `sk` — used in-circuit as `inPrivateKey`.
    pub fn spend_key(&self) -> Fr {
        self.keypair.private_key
    }

    /// Note-owner public key `pk = Poseidon(sk)`.
    pub fn public_key(&self) -> Fr {
        self.keypair.public_key
    }

    /// Nullifier key `nk` (reserved for a future nk/ak split).
    pub fn nullifier_key(&self) -> Fr {
        self.seed.nullifier_key()
    }

    /// Incoming viewing key `ivk` — note discovery / trial decryption.
    pub fn incoming_viewing_key(&self) -> Fr {
        self.seed.incoming_viewing_key()
    }

    /// Outgoing viewing key `ovk` — sent-note recovery.
    pub fn outgoing_viewing_key(&self) -> Fr {
        self.seed.outgoing_viewing_key()
    }

    /// The X25519 public key bytes a sender encrypts to.
    pub fn enc_public_bytes(&self) -> [u8; 32] {
        *self.enc_public.as_bytes()
    }

    /// 32-byte big-endian encoding of the note-owner public key (wire form).
    pub fn public_key_bytes(&self) -> [u8; 32] {
        fr_to_be_bytes(&self.public_key())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_from_seed() {
        let seed = [7u8; 32];
        let a = Keys::from_seed(seed);
        let b = Keys::from_seed(seed);

        // BN254 keys reproduce.
        assert_eq!(a.spend_key(), b.spend_key());
        assert_eq!(a.public_key(), b.public_key());
        assert_eq!(a.incoming_viewing_key(), b.incoming_viewing_key());
        assert_eq!(a.outgoing_viewing_key(), b.outgoing_viewing_key());
        assert_eq!(a.nullifier_key(), b.nullifier_key());

        // X25519 enc keys reproduce.
        assert_eq!(a.enc_public_bytes(), b.enc_public_bytes());
    }

    #[test]
    fn different_seeds_differ() {
        let a = Keys::from_seed([1u8; 32]);
        let b = Keys::from_seed([2u8; 32]);
        assert_ne!(a.public_key(), b.public_key());
        assert_ne!(a.enc_public_bytes(), b.enc_public_bytes());
    }

    #[test]
    fn key_families_are_independent() {
        // The four BN254 viewing/spend keys are all distinct derivations.
        let k = Keys::from_seed([9u8; 32]);
        let set = [
            k.spend_key(),
            k.nullifier_key(),
            k.incoming_viewing_key(),
            k.outgoing_viewing_key(),
        ];
        for i in 0..set.len() {
            for j in (i + 1)..set.len() {
                assert_ne!(set[i], set[j], "derived keys {i} and {j} collide");
            }
        }
    }
}
