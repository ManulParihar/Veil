pragma circom 2.0.0;

include "poseidon.circom";
include "comparators.circom";
include "bitify.circom";
include "merkleproof.circom";
include "keypair.circom";

// The Veil 2-in / 2-out joinsplit.
//
// Public signals (FROZEN order - must equal INTERFACES.md §3 and the contract's
// PublicSignals layout):
//   [0] root
//   [1] publicAmount
//   [2] extDataHash
//   [3] inputNullifier[0]
//   [4] inputNullifier[1]
//   [5] outputCommitment[0]
//   [6] outputCommitment[1]
//   [7] currencyId          // multi-currency: the asset all notes in this tx use
//
// All note math mirrors crates/veil-crypto (the single source of Poseidon truth):
//   pk         = Poseidon(sk)
//   commitment = Poseidon(amount, currencyId, pk, blinding)
//   signature  = Poseidon(sk, commitment, pathIndex)
//   nullifier  = Poseidon(commitment, pathIndex, signature)
//
// currencyId is fed into every input and output commitment, so all four notes
// in a transaction are forced to the same asset: an input leaf only matches the
// tree if its baked-in currency equals the public currencyId.
template Transaction(levels) {
    // ---- public inputs (declared first so they take public-signal slots 0..) ----
    signal input root;
    signal input publicAmount;
    signal input extDataHash;
    signal input inputNullifier[2];
    signal input outputCommitment[2];
    signal input currencyId;

    // ---- private inputs: spent notes ----
    signal input inAmount[2];
    signal input inPrivateKey[2];
    signal input inBlinding[2];
    signal input inPathIndices[2];
    signal input inPathElements[2][levels];

    // ---- private inputs: created notes ----
    signal input outAmount[2];
    signal input outPubkey[2];
    signal input outBlinding[2];

    var MAX_BITS = 64;                    // value range: [0, 2^64)

    component inKeypair[2];
    component inCommitment[2];
    component inSignature[2];
    component inNullifier[2];
    component inTree[2];
    component inCheckRoot[2];
    component inIsReal[2];
    component inRange[2];

    var sumIn = 0;

    for (var i = 0; i < 2; i++) {
        // ownership: spender knows the key behind the note
        inKeypair[i] = Keypair();
        inKeypair[i].privateKey <== inPrivateKey[i];

        // commitment well-formedness (binds the asset via currencyId)
        inCommitment[i] = Poseidon(4);
        inCommitment[i].inputs[0] <== inAmount[i];
        inCommitment[i].inputs[1] <== currencyId;
        inCommitment[i].inputs[2] <== inKeypair[i].publicKey;
        inCommitment[i].inputs[3] <== inBlinding[i];

        // signature + nullifier (binds path so position is unique)
        inSignature[i] = Signature();
        inSignature[i].privateKey <== inPrivateKey[i];
        inSignature[i].commitment <== inCommitment[i].out;
        inSignature[i].merklePath <== inPathIndices[i];

        inNullifier[i] = Poseidon(3);
        inNullifier[i].inputs[0] <== inCommitment[i].out;
        inNullifier[i].inputs[1] <== inPathIndices[i];
        inNullifier[i].inputs[2] <== inSignature[i].out;
        inNullifier[i].out === inputNullifier[i];

        // merkle membership, GATED on amount>0 (dummy zero-value inputs skip)
        inTree[i] = MerkleProof(levels);
        inTree[i].leaf <== inCommitment[i].out;
        inTree[i].pathIndices <== inPathIndices[i];
        for (var l = 0; l < levels; l++) {
            inTree[i].pathElements[l] <== inPathElements[i][l];
        }

        inIsReal[i] = IsZero();
        inIsReal[i].in <== inAmount[i];          // out == 1 when amount == 0 (dummy)
        // enabled = (amount != 0) = 1 - inIsReal.out
        inCheckRoot[i] = ForceEqualIfEnabled();
        inCheckRoot[i].enabled <== 1 - inIsReal[i].out;
        inCheckRoot[i].in[0] <== root;
        inCheckRoot[i].in[1] <== inTree[i].root;

        // RANGE CHECK — prevents field-wrap minting
        inRange[i] = Num2Bits(MAX_BITS);
        inRange[i].in <== inAmount[i];

        sumIn += inAmount[i];
    }

    // no same-note-twice
    component sameNullifier = IsEqual();
    sameNullifier.in[0] <== inputNullifier[0];
    sameNullifier.in[1] <== inputNullifier[1];
    sameNullifier.out === 0;

    component outCommitment[2];
    component outRange[2];
    var sumOut = 0;

    for (var i = 0; i < 2; i++) {
        outCommitment[i] = Poseidon(4);
        outCommitment[i].inputs[0] <== outAmount[i];
        outCommitment[i].inputs[1] <== currencyId;
        outCommitment[i].inputs[2] <== outPubkey[i];
        outCommitment[i].inputs[3] <== outBlinding[i];
        outCommitment[i].out === outputCommitment[i];

        outRange[i] = Num2Bits(MAX_BITS);
        outRange[i].in <== outAmount[i];

        sumOut += outAmount[i];
    }

    // VALUE CONSERVATION (the heart): publicAmount + Σin === Σout
    sumIn + publicAmount === sumOut;

    // Bind extDataHash into the system so a relayer editing recipient/fee
    // produces a different hash and the contract's recompute-and-compare rejects.
    signal extDataSquare;
    extDataSquare <== extDataHash * extDataHash;
}

component main {public [
    root,
    publicAmount,
    extDataHash,
    inputNullifier,
    outputCommitment,
    currencyId
]} = Transaction(20);
