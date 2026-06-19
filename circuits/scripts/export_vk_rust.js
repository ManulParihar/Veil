// Convert snarkjs verification_key.json + a sample proof.json/public.json into
// Rust the contract can consume:
//   - crates/veil-contract/src/vk.rs           (the real verifying key)
//   - crates/veil-contract/src/sample_proof.rs (a real proof fixture)
//
// Byte layout (Soroban host, soroban_sdk::crypto::bn254):
//   G1  = be(x) || be(y)                       (64 bytes)
//   G2  = be(x.c1)||be(x.c0) || be(y.c1)||be(y.c0)   (128 bytes)  <-- c1 FIRST
//   Fr  = be(value)                            (32 bytes)
// snarkjs lists G2 coords as [c0, c1], so we SWAP the halves.

const fs = require("fs");
const path = require("path");

const BUILD = path.join(__dirname, "../build");
const vk = JSON.parse(fs.readFileSync(path.join(BUILD, "verification_key.json")));
const proof = JSON.parse(fs.readFileSync(path.join(BUILD, "proof.json")));
const pub = JSON.parse(fs.readFileSync(path.join(BUILD, "public.json")));

const P = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function be32(decStr) {
  let v = BigInt(decStr) % P;
  if (v < 0n) v += P;
  const b = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}
// G1: [x, y, "1"] -> be(x)||be(y)
function g1(p) {
  return Buffer.concat([be32(p[0]), be32(p[1])]);
}
// G2: [[x_c0, x_c1], [y_c0, y_c1], ...] -> be(x_c1)||be(x_c0)||be(y_c1)||be(y_c0)
function g2(p) {
  return Buffer.concat([be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0])]);
}
const bytesLit = (buf) => "[" + Array.from(buf).join(", ") + "]";

// ---- vk.rs ----
const ic = vk.IC.map(g1);
if (ic.length !== Number(vk.nPublic) + 1) throw new Error("IC length mismatch");

let s = `//! Groth16 verifying key — GENERATED from circuits/build/verification_key.json
//! by circuits/scripts/export_vk_rust.js. Do not edit by hand.
//!
//! Byte layout (Soroban host, soroban_sdk::crypto::bn254):
//!  * G1 = be(X) || be(Y)                                    (64 bytes)
//!  * G2 = be(X.c1) || be(X.c0) || be(Y.c1) || be(Y.c0)      (128 bytes; c1 first)
//! snarkjs lists G2 as [c0, c1]; the converter swaps to host order.

/// Number of public signals (INTERFACES §3). \`IC\` has \`NUM_PUBLIC + 1\` points.
pub const NUM_PUBLIC: usize = ${vk.nPublic};

/// The verifying key, as raw host-serialized point bytes.
pub struct Vk {
    pub alpha_g1: [u8; 64],
    pub beta_g2: [u8; 128],
    pub gamma_g2: [u8; 128],
    pub delta_g2: [u8; 128],
    pub ic: [[u8; 64]; NUM_PUBLIC + 1],
}

pub const VK: Vk = Vk {
    alpha_g1: ${bytesLit(g1(vk.vk_alpha_1))},
    beta_g2: ${bytesLit(g2(vk.vk_beta_2))},
    gamma_g2: ${bytesLit(g2(vk.vk_gamma_2))},
    delta_g2: ${bytesLit(g2(vk.vk_delta_2))},
    ic: [
${ic.map((b) => "        " + bytesLit(b) + ",").join("\n")}
    ],
};
`;
fs.writeFileSync(path.join(__dirname, "../../crates/veil-contract/src/vk.rs"), s);
console.log("wrote crates/veil-contract/src/vk.rs (NUM_PUBLIC=" + vk.nPublic + ", IC=" + ic.length + ")");

// ---- sample_proof.rs fixture ----
const a = g1(proof.pi_a);
const b = g2(proof.pi_b);
const c = g1(proof.pi_c);
let f = `//! GENERATED real proof fixture (circuits/scripts/export_vk_rust.js).
//! A genuine Groth16 proof + its 7 public signals for the sample transfer, used
//! by tests/verifier.rs to validate the REAL BN254 pairing path against the real
//! VK in the Soroban host environment. Do not edit by hand.

pub const PROOF_A: [u8; 64] = ${bytesLit(a)};
pub const PROOF_B: [u8; 128] = ${bytesLit(b)};
pub const PROOF_C: [u8; 64] = ${bytesLit(c)};

/// Public signals in INTERFACES §3 order: [root, publicAmount, extDataHash, nf0, nf1, cm0, cm1].
pub const PUBLIC_SIGNALS: [[u8; 32]; 7] = [
${pub.map((x) => "    " + bytesLit(be32(x)) + ",").join("\n")}
];
`;
fs.writeFileSync(path.join(__dirname, "../../crates/veil-contract/src/sample_proof.rs"), f);
console.log("wrote crates/veil-contract/src/sample_proof.rs (" + pub.length + " signals)");
