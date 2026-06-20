//! Trial-decryption note discovery with the view-tag fast path.
//!
//! The indexer hands the wallet a stream of `(ephemeral_pub, view_tag,
//! ciphertext, leaf_index)` records. For each, the wallet:
//!   1. recomputes its own view tag from the ephemeral pubkey + its X25519 secret;
//!   2. only the ~1/256 whose tag matches survive to the (relatively expensive)
//!      AEAD decrypt;
//!   3. a successful AEAD decrypt — and only that — means "this note is mine".
//!
//! The view tag is a *filter*, not an authenticator. The AEAD must (and does)
//! fail closed on the 1/256 false positives where the tag matches by chance but
//! the key is wrong (CLAUDE.md edge case: "Never trust the tag alone").

use crate::encrypt::{compute_view_tag, decrypt_note, EncryptedNote};
use crate::note::StoredNote;
use veil_crypto::Note;
use x25519_dalek::StaticSecret as X25519Secret;

/// One record to scan, as delivered by the indexer.
#[derive(Clone, Debug)]
pub struct ScanRecord {
    pub leaf_index: u32,
    pub enc: EncryptedNote,
}

impl ScanRecord {
    pub fn new(leaf_index: u32, enc: EncryptedNote) -> Self {
        ScanRecord { leaf_index, enc }
    }
}

/// A note discovered to belong to the wallet.
#[derive(Clone, Debug)]
pub struct DiscoveredNote {
    pub leaf_index: u32,
    pub note: Note,
}

/// Result of a scan pass, with stats useful for diagnostics/tests.
#[derive(Default, Debug)]
pub struct ScanResult {
    pub found: Vec<DiscoveredNote>,
    /// How many records passed the view-tag filter (incl. false positives).
    pub tag_hits: usize,
    /// How many tag-hits failed AEAD decrypt (the false positives, rejected).
    pub false_positives: usize,
}

/// Scan a batch of records with my X25519 secret. Returns every note that is
/// genuinely mine, plus filter statistics.
pub fn scan(my_secret: &X25519Secret, records: &[ScanRecord]) -> ScanResult {
    let mut result = ScanResult::default();
    for rec in records {
        // Fast path: cheap tag recompute. Skip non-matches outright.
        let my_tag = compute_view_tag(my_secret, &rec.enc.ephemeral_pub);
        if my_tag != rec.enc.view_tag {
            continue;
        }
        result.tag_hits += 1;

        // Survivor: full AEAD decrypt. Fails closed on false positives.
        match decrypt_note(my_secret, &rec.enc) {
            Some(note) => result.found.push(DiscoveredNote {
                leaf_index: rec.leaf_index,
                note,
            }),
            None => result.false_positives += 1,
        }
    }
    result
}

/// Convenience: scan and turn discoveries directly into [`StoredNote`]s.
pub fn scan_to_stored(my_secret: &X25519Secret, records: &[ScanRecord]) -> Vec<StoredNote> {
    scan(my_secret, records)
        .found
        .into_iter()
        .map(|d| StoredNote::new(d.note, d.leaf_index))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encrypt::{encrypt_note, EncryptedNote};
    use crate::keys::Keys;
    use ark_bn254::Fr;

    fn note(amount: u64) -> Note {
        Note::new(amount, 0, Fr::from(1u64), Fr::from(amount))
    }

    #[test]
    fn finds_own_rejects_others() {
        let me = Keys::from_seed([20u8; 32]);
        let other = Keys::from_seed([21u8; 32]);

        let mine = encrypt_note(&me.enc_public_bytes(), &note(100));
        let theirs = encrypt_note(&other.enc_public_bytes(), &note(200));

        let records = vec![
            ScanRecord::new(0, mine),
            ScanRecord::new(1, theirs),
        ];

        let res = scan(&me.enc_secret, &records);
        assert_eq!(res.found.len(), 1);
        assert_eq!(res.found[0].leaf_index, 0);
        assert_eq!(res.found[0].note.amount, 100);
    }

    #[test]
    fn forced_tag_collision_fails_closed() {
        // Construct a record whose view tag matches mine but whose ciphertext
        // was encrypted to someone else: the AEAD MUST reject it.
        let me = Keys::from_seed([22u8; 32]);
        let other = Keys::from_seed([23u8; 32]);

        // Encrypt to `other`, then forge the tag to equal what *I* would compute
        // for that ephemeral key — simulating the 1/256 chance collision.
        let mut forged = encrypt_note(&other.enc_public_bytes(), &note(500));
        forged.view_tag = compute_view_tag(&me.enc_secret, &forged.ephemeral_pub);

        let records = vec![ScanRecord::new(7, forged)];
        let res = scan(&me.enc_secret, &records);

        // Tag matched (forced) but decrypt failed → rejected, nothing found.
        assert_eq!(res.tag_hits, 1);
        assert_eq!(res.false_positives, 1);
        assert!(res.found.is_empty(), "must not accept a tag-only match");
    }

    #[test]
    fn scan_to_stored_produces_notes() {
        let me = Keys::from_seed([24u8; 32]);
        let enc = encrypt_note(&me.enc_public_bytes(), &note(42));
        let stored = scan_to_stored(&me.enc_secret, &[ScanRecord::new(3, enc)]);
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].leaf_index, Some(3));
        assert_eq!(stored[0].note.amount, 42);
    }

    #[test]
    fn empty_ciphertext_does_not_panic() {
        let me = Keys::from_seed([25u8; 32]);
        let rec = ScanRecord::new(
            0,
            EncryptedNote {
                ephemeral_pub: [9u8; 32],
                view_tag: compute_view_tag(&me.enc_secret, &[9u8; 32]),
                ciphertext: vec![],
            },
        );
        let res = scan(&me.enc_secret, &[rec]);
        assert!(res.found.is_empty());
    }
}
