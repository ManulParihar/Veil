// Trial-decrypt NewCommit events to discover incoming notes. Fast-path on the
// 1-byte view tag, then full AEAD decrypt (fail-closed) — never trust the tag.
import { computeViewTag, decryptNote, encFromWire, type Note, type Keys } from "./crypto";
import type { CommitmentEvent } from "./chain";

export interface FoundNote {
  note: Note;
  leafIndex: number;
}

export function scanEvents(keys: Keys, events: CommitmentEvent[]): FoundNote[] {
  const found: FoundNote[] = [];
  for (const ev of events) {
    if (ev.ciphertext.length < 32) continue;
    const enc = encFromWire(ev.ciphertext, ev.viewTag);
    if (!enc) continue;
    // fast path: does our view tag match?
    if (computeViewTag(keys.encSecret, enc.ephemeralPub) !== ev.viewTag) continue;
    // authoritative: AEAD decrypt
    const note = decryptNote(keys.encSecret, enc);
    if (note && note.amount > 0n) found.push({ note, leafIndex: ev.leafIndex });
  }
  return found;
}
