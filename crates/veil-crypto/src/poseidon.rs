//! Poseidon permutation (circomlib-compatible, BN254), `no_std`.
//!
//! Implemented directly over `ark-bn254` `Fr` so the crate is truly `no_std`
//! (the Soroban contract target `wasm32v1-none` has no `std`). The round
//! constants and MDS matrices in [`crate::poseidon_constants`] are the exact
//! Grain-LFSR circomlib parameters (extracted from `light-poseidon`); the
//! cross-impl test asserts this implementation is bit-identical to both
//! `light-poseidon` (dev-only) and the circom witness.
//!
//! State layout matches circomlib `Poseidon(width)`: `t = width + 1`, capacity
//! element `state[0] = 0`, the `width` inputs at `state[1..t]`, output `state[0]`.

use ark_bn254::Fr;
use ark_ff::Zero;

use crate::poseidon_constants::{params_for_width, PoseidonParams};

#[inline]
fn pow5(x: Fr) -> Fr {
    let x2 = x * x;
    let x4 = x2 * x2;
    x4 * x
}

#[allow(clippy::needless_range_loop)] // indices index ark[r*t+i] / mds[i][j]
fn permute(p: &PoseidonParams, state: &mut [Fr; 4]) {
    let t = p.t;
    let half_full = p.full_rounds / 2;
    let rounds = p.full_rounds + p.partial_rounds;

    for r in 0..rounds {
        // add round constants
        for i in 0..t {
            state[i] += p.ark[r * t + i];
        }
        // S-box: x^5 on all elements in full rounds, on state[0] only in partial
        let is_full = r < half_full || r >= half_full + p.partial_rounds;
        if is_full {
            for s in state.iter_mut().take(t) {
                *s = pow5(*s);
            }
        } else {
            state[0] = pow5(state[0]);
        }
        // MDS mix
        let mut next = [Fr::zero(); 4];
        for i in 0..t {
            let mut acc = Fr::zero();
            for j in 0..t {
                acc += p.mds[i][j] * state[j];
            }
            next[i] = acc;
        }
        *state = next;
    }
}

/// Hash an input vector of width 1, 2 or 3 with the circomlib parameter set.
pub fn hashn(inputs: &[Fr]) -> Fr {
    let p = params_for_width(inputs.len());
    let mut state = [Fr::zero(); 4];
    // state[0] is the capacity (0); inputs occupy 1..t.
    for (i, inp) in inputs.iter().enumerate() {
        state[i + 1] = *inp;
    }
    permute(p, &mut state);
    state[0]
}

/// `Poseidon(a)` — single input (public-key derivation).
pub fn hash1(a: Fr) -> Fr {
    hashn(&[a])
}

/// `Poseidon(a, b)` — two inputs (Merkle parent / key derivation).
pub fn hash2(a: Fr, b: Fr) -> Fr {
    hashn(&[a, b])
}

/// `Poseidon(a, b, c)` — three inputs (commitment / signature / nullifier).
pub fn hash3(a: Fr, b: Fr, c: Fr) -> Fr {
    hashn(&[a, b, c])
}

/// Merkle parent hash. Identical to `hash2`, named for intent at call sites and
/// matching the contract's `poseidon_host::compress`.
pub fn compress(left: Fr, right: Fr) -> Fr {
    hash2(left, right)
}

/// The empty-leaf value `Zero(0) = Poseidon(0)`. A fixed, non-trivial field
/// element real commitments (themselves Poseidon outputs) never collide with.
pub fn zero_leaf() -> Fr {
    hash1(Fr::zero())
}
