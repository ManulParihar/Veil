pragma circom 2.0.0;

include "poseidon.circom";
include "bitify.circom";

// Selects (left, right) ordering by a single index bit.
// s == 0 -> out = [in[0], in[1]]   (we are the left child)
// s == 1 -> out = [in[1], in[0]]   (we are the right child)
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;               // s is boolean
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

// Standard binary Merkle membership proof.
// parent = Poseidon(left, right), matching poof-crypto::compress and the
// contract's incremental tree. `pathIndices` is the leaf index; bit i selects
// whether the running hash is the right child at level i.
template MerkleProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices;
    signal output root;

    component indexBits = Num2Bits(levels);
    indexBits.in <== pathIndices;

    component mux[levels];
    component hasher[levels];

    signal levelHash[levels + 1];
    levelHash[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        mux[i] = DualMux();
        mux[i].in[0] <== levelHash[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== indexBits.out[i];

        hasher[i] = Poseidon(2);
        hasher[i].inputs[0] <== mux[i].out[0];
        hasher[i].inputs[1] <== mux[i].out[1];

        levelHash[i + 1] <== hasher[i].out;
    }

    root <== levelHash[levels];
}
