pragma circom 2.0.0;

include "poseidon.circom";

// Poseidon(4) exposed as an output - used by the test harness to compute the
// expected output commitments Poseidon(amount, currencyId, pubkey, blinding)
// that the joinsplit constrains against.
template Pos4() {
    signal input a;
    signal input b;
    signal input c;
    signal input d;
    signal output out;
    component h = Poseidon(4);
    h.inputs[0] <== a;
    h.inputs[1] <== b;
    h.inputs[2] <== c;
    h.inputs[3] <== d;
    out <== h.out;
}

component main = Pos4();
