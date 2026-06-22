pragma circom 2.0.0;

include "poseidon.circom";

// pk = Poseidon(sk)  — matches poof-crypto::Keypair::from_private.
template Keypair() {
    signal input privateKey;
    signal output publicKey;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== privateKey;
    publicKey <== hasher.out;
}

// signature = Poseidon(sk, commitment, pathIndex)
//   — matches poof-crypto::Note::signature. Binds the spender's secret to the
//     note's tree position so one note yields exactly one nullifier.
template Signature() {
    signal input privateKey;
    signal input commitment;
    signal input merklePath;
    signal output out;

    component hasher = Poseidon(3);
    hasher.inputs[0] <== privateKey;
    hasher.inputs[1] <== commitment;
    hasher.inputs[2] <== merklePath;
    out <== hasher.out;
}
