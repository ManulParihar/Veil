//! Reproducible generator for the Poseidon constant blocks in
//! `src/poseidon_constants.rs`. Dumps the circomlib-compatible ark + MDS for a
//! given width straight out of the audited `light-poseidon` 0.4 parameters, in
//! the exact `MontFp!` source format the constants file uses. Nothing here is
//! hand-typed: run it and paste the output.
//!
//!   cargo run -p veil-crypto --example gen_poseidon_constants -- 4
//!
//! The argument is the circom input count (width); the generated `PARAMS_T{t}`
//! uses `t = width + 1`. We use it for width 4 (t=5), the 4-input note
//! commitment Poseidon(amount, currency_id, pk, blinding).

use ark_bn254::Fr;
use ark_ff::PrimeField;
use light_poseidon::parameters::bn254_x5::get_poseidon_parameters;

fn dec(f: &Fr) -> String {
    f.into_bigint().to_string()
}

fn main() {
    let width: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .map(|inputs: usize| inputs + 1)
        .expect("usage: gen_poseidon_constants <nr_inputs>");

    let p = get_poseidon_parameters::<Fr>(width as u8).expect("params");
    let t = p.width;
    assert_eq!(t, width, "width mismatch");

    println!("#[rustfmt::skip]");
    println!("static T{t}_ARK: &[Fr] = &[");
    for f in &p.ark {
        println!("    MontFp!(\"{}\"),", dec(f));
    }
    println!("];");

    for (i, row) in p.mds.iter().enumerate() {
        println!("#[rustfmt::skip]");
        println!("static T{t}_MDS_{i}: &[Fr] = &[");
        for f in row {
            println!("    MontFp!(\"{}\"),", dec(f));
        }
        println!("];");
    }
    print!("static T{t}_MDS: &[&[Fr]] = &[");
    for i in 0..p.mds.len() {
        print!("T{t}_MDS_{i}, ");
    }
    println!("];");
    println!(
        "pub static PARAMS_T{t}: PoseidonParams = PoseidonParams {{ t: {t}, full_rounds: {}, partial_rounds: {}, ark: T{t}_ARK, mds: T{t}_MDS }};",
        p.full_rounds, p.partial_rounds
    );
}
