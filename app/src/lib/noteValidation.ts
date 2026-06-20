import { commitment, fieldToBytes, toHex } from "./crypto";
import type { CommitmentEvent } from "./chain";
import type { StoredNote } from "./types";

function validNote(n: StoredNote): StoredNote {
  const { invalidReason: _invalidReason, ...rest } = n;
  return rest;
}

export function validateStoredNotes(
  notes: StoredNote[],
  events: CommitmentEvent[],
  ownerPubkey: bigint
): StoredNote[] {
  const eventCommitments = new Map(events.map((e) => [e.leafIndex, toHex(e.commitment)]));
  return notes.map((n) => {
    let invalidReason: string | undefined;
    if (n.leafIndex == null) {
      invalidReason = "missing leaf index";
    } else if (n.note.pubkey !== ownerPubkey) {
      invalidReason = "encrypted to this wallet but owned by a different spend key";
    } else {
      const eventCommitment = eventCommitments.get(n.leafIndex);
      if (!eventCommitment) {
        invalidReason = "leaf not found in the synced tree";
      } else if (toHex(fieldToBytes(commitment(n.note))) !== eventCommitment) {
        invalidReason = "note commitment does not match this leaf";
      }
    }
    return invalidReason ? { ...n, invalidReason } : validNote(n);
  });
}
