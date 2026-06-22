//! Client-side note encryption: X25519 ECDH → ChaCha20-Poly1305 AEAD, with a
//! 1-byte view tag for fast trial-decryption.
//!
//! Note encryption flow:
//! ```text
//! ephemeral X25519 keypair (e, E)
//! shared   = ECDH(e, recipient_pub) = ECDH(recipient_secret, E)
//! view_tag = sha256(shared)[0]
//! key      = sha256("veil-note-key" || shared)        (ChaCha20Poly1305 key)
//! ct       = AEAD(key, nonce=0, plaintext)
//! ```
//! The ephemeral public `E` is published alongside `ct` so the recipient can
//! recompute `shared` from their secret. The AEAD authentication tag makes
//! decryption fail closed for everyone except the intended recipient — the view
//! tag is *only* a speed filter, never a proof of ownership.

use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use sha2::{Digest, Sha256};
use poof_crypto::{fr_from_be_bytes, fr_to_be_bytes, Note};
use x25519_dalek::{EphemeralSecret, PublicKey as X25519Public, StaticSecret as X25519Secret};

/// Note plaintext = amount(8, big-endian) || currencyId(4, big-endian) ||
/// pubkey(32, big-endian) || blinding(32, big-endian) = 76 bytes. Round-trips
/// exactly.
pub const PLAINTEXT_LEN: usize = 8 + 4 + 32 + 32;

/// The nonce is fixed at zero: every (ephemeral key, shared secret) pair is
/// unique per encryption, so the AEAD key is never reused and a constant nonce
/// is safe (single message per key).
const ZERO_NONCE: [u8; 12] = [0u8; 12];

/// Domain-separation prefix for deriving the AEAD key from the ECDH secret.
const KEY_DOMAIN: &[u8] = b"veil-note-key";

/// Serialize a note to its 76-byte plaintext form.
pub fn serialize_note(note: &Note) -> [u8; PLAINTEXT_LEN] {
    let mut out = [0u8; PLAINTEXT_LEN];
    out[0..8].copy_from_slice(&note.amount.to_be_bytes());
    out[8..12].copy_from_slice(&note.currency_id.to_be_bytes());
    out[12..44].copy_from_slice(&fr_to_be_bytes(&note.pubkey));
    out[44..76].copy_from_slice(&fr_to_be_bytes(&note.blinding));
    out
}

/// Parse a 76-byte plaintext back into a note.
pub fn deserialize_note(bytes: &[u8]) -> Option<Note> {
    if bytes.len() != PLAINTEXT_LEN {
        return None;
    }
    let mut amt = [0u8; 8];
    amt.copy_from_slice(&bytes[0..8]);
    let mut cur = [0u8; 4];
    cur.copy_from_slice(&bytes[8..12]);
    let mut pk = [0u8; 32];
    pk.copy_from_slice(&bytes[12..44]);
    let mut bl = [0u8; 32];
    bl.copy_from_slice(&bytes[44..76]);
    Some(Note {
        amount: u64::from_be_bytes(amt),
        currency_id: u32::from_be_bytes(cur),
        pubkey: fr_from_be_bytes(&pk),
        blinding: fr_from_be_bytes(&bl),
    })
}

/// Derive (view_tag, aead_key) from a raw 32-byte ECDH shared secret.
fn derive(shared: &[u8; 32]) -> (u8, Key) {
    let view_tag = Sha256::digest(shared)[0];
    let mut h = Sha256::new();
    h.update(KEY_DOMAIN);
    h.update(shared);
    let key_bytes = h.finalize();
    (view_tag, *Key::from_slice(&key_bytes))
}

/// An encrypted note ready to be carried in `ExtData`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedNote {
    /// Ephemeral X25519 public key `E` (32 bytes).
    pub ephemeral_pub: [u8; 32],
    /// 1-byte view tag = sha256(shared)[0].
    pub view_tag: u8,
    /// AEAD ciphertext (plaintext + 16-byte Poly1305 tag = 88 bytes).
    pub ciphertext: Vec<u8>,
}

/// Encrypt `note` to the recipient's X25519 public key. A fresh ephemeral key is
/// generated per call (so each ciphertext is unlinkable and the nonce is safe).
pub fn encrypt_note(recipient_x25519_pub: &[u8; 32], note: &Note) -> EncryptedNote {
    let ephemeral = EphemeralSecret::random_from_rng(rand::rngs::OsRng);
    let ephemeral_pub = X25519Public::from(&ephemeral);
    let recipient = X25519Public::from(*recipient_x25519_pub);
    let shared = ephemeral.diffie_hellman(&recipient);

    let (view_tag, key) = derive(shared.as_bytes());
    let cipher = ChaCha20Poly1305::new(&key);
    let plaintext = serialize_note(note);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&ZERO_NONCE), plaintext.as_ref())
        .expect("chacha20poly1305 encryption is infallible for valid key/nonce");

    EncryptedNote {
        ephemeral_pub: *ephemeral_pub.as_bytes(),
        view_tag,
        ciphertext,
    }
}

/// The view tag a holder of `recipient_secret` would compute for `ephemeral_pub`.
/// Used by the scanner's fast path.
pub fn compute_view_tag(recipient_secret: &X25519Secret, ephemeral_pub: &[u8; 32]) -> u8 {
    let shared = recipient_secret.diffie_hellman(&X25519Public::from(*ephemeral_pub));
    derive(shared.as_bytes()).0
}

impl EncryptedNote {
    /// The self-contained on-wire ciphertext blob carried in `ExtData`:
    /// `ephemeral_pub(32) || aead_ciphertext`. This is what the contract hashes
    /// into `extDataHash` and the indexer stores; it contains everything the
    /// recipient's scanner needs.
    pub fn wire(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(32 + self.ciphertext.len());
        out.extend_from_slice(&self.ephemeral_pub);
        out.extend_from_slice(&self.ciphertext);
        out
    }

    /// Reconstruct an [`EncryptedNote`] from a wire blob + its view tag.
    /// Returns `None` if the blob is too short to hold an ephemeral key.
    pub fn from_wire(wire: &[u8], view_tag: u8) -> Option<Self> {
        if wire.len() < 32 {
            return None;
        }
        let mut ephemeral_pub = [0u8; 32];
        ephemeral_pub.copy_from_slice(&wire[..32]);
        Some(EncryptedNote {
            ephemeral_pub,
            view_tag,
            ciphertext: wire[32..].to_vec(),
        })
    }
}

/// Attempt to decrypt an [`EncryptedNote`] with the recipient's secret.
///
/// Returns `Some(note)` only if the AEAD tag verifies — i.e. this note really
/// was encrypted to us. Returns `None` on any failure (wrong key, tampered
/// ciphertext, view-tag false positive). **Fails closed**: never trust the view
/// tag alone.
pub fn decrypt_note(recipient_secret: &X25519Secret, enc: &EncryptedNote) -> Option<Note> {
    let shared = recipient_secret.diffie_hellman(&X25519Public::from(enc.ephemeral_pub));
    let (_tag, key) = derive(shared.as_bytes());
    let cipher = ChaCha20Poly1305::new(&key);
    let pt = cipher
        .decrypt(Nonce::from_slice(&ZERO_NONCE), enc.ciphertext.as_ref())
        .ok()?;
    deserialize_note(&pt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::Keys;
    use ark_bn254::Fr;

    fn sample_note() -> Note {
        Note::new(12345, 3, Fr::from(99u64), Fr::from(7u64))
    }

    #[test]
    fn plaintext_roundtrips() {
        let n = sample_note();
        let bytes = serialize_note(&n);
        assert_eq!(bytes.len(), PLAINTEXT_LEN);
        let back = deserialize_note(&bytes).unwrap();
        assert_eq!(n, back);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let recipient = Keys::from_seed([11u8; 32]);
        let n = sample_note();
        let enc = encrypt_note(&recipient.enc_public_bytes(), &n);
        // ciphertext is plaintext + 16-byte AEAD tag.
        assert_eq!(enc.ciphertext.len(), PLAINTEXT_LEN + 16);
        let dec = decrypt_note(&recipient.enc_secret, &enc).unwrap();
        assert_eq!(dec, n);
    }

    #[test]
    fn view_tag_matches_for_recipient() {
        let recipient = Keys::from_seed([12u8; 32]);
        let n = sample_note();
        let enc = encrypt_note(&recipient.enc_public_bytes(), &n);
        assert_eq!(
            enc.view_tag,
            compute_view_tag(&recipient.enc_secret, &enc.ephemeral_pub)
        );
    }

    #[test]
    fn wrong_recipient_fails_closed() {
        let recipient = Keys::from_seed([13u8; 32]);
        let attacker = Keys::from_seed([14u8; 32]);
        let n = sample_note();
        let enc = encrypt_note(&recipient.enc_public_bytes(), &n);
        // Wrong secret cannot decrypt (AEAD tag fails).
        assert!(decrypt_note(&attacker.enc_secret, &enc).is_none());
    }

    #[test]
    fn wire_roundtrip() {
        let recipient = Keys::from_seed([16u8; 32]);
        let n = sample_note();
        let enc = encrypt_note(&recipient.enc_public_bytes(), &n);
        let wire = enc.wire();
        assert_eq!(wire.len(), 32 + enc.ciphertext.len());
        let back = EncryptedNote::from_wire(&wire, enc.view_tag).unwrap();
        assert_eq!(back, enc);
        assert_eq!(decrypt_note(&recipient.enc_secret, &back).unwrap(), n);
        // Too-short blob rejected.
        assert!(EncryptedNote::from_wire(&[0u8; 10], 0).is_none());
    }

    #[test]
    fn tampered_ciphertext_fails_closed() {
        let recipient = Keys::from_seed([15u8; 32]);
        let n = sample_note();
        let mut enc = encrypt_note(&recipient.enc_public_bytes(), &n);
        enc.ciphertext[0] ^= 0xff;
        assert!(decrypt_note(&recipient.enc_secret, &enc).is_none());
    }
}
