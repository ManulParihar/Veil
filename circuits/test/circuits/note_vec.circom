pragma circom 2.0.0;

include "poseidon.circom";
include "keypair.circom";

// Exposes the note pipeline outputs so the test can assert they equal the
// pinned poof-crypto vectors — i.e. proves the circuit's Poseidon is identical
// to the Rust single-source-of-truth (the cross-impl gate, through the circuit).
template NoteVec() {
    signal input sk;
    signal input amount;
    signal input currencyId;
    signal input blinding;
    signal input pathIndex;
    signal output pk;
    signal output cm;
    signal output nf;

    component kp = Keypair();
    kp.privateKey <== sk;
    pk <== kp.publicKey;

    component cmh = Poseidon(4);
    cmh.inputs[0] <== amount;
    cmh.inputs[1] <== currencyId;
    cmh.inputs[2] <== kp.publicKey;
    cmh.inputs[3] <== blinding;
    cm <== cmh.out;

    component sig = Poseidon(3);
    sig.inputs[0] <== sk;
    sig.inputs[1] <== cmh.out;
    sig.inputs[2] <== pathIndex;

    component nfh = Poseidon(3);
    nfh.inputs[0] <== cmh.out;
    nfh.inputs[1] <== pathIndex;
    nfh.inputs[2] <== sig.out;
    nf <== nfh.out;
}

component main = NoteVec();
