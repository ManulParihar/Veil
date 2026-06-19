// Generate a REAL proof + fixture for a native, full-`transact` contract test:
// a Phase-1 transfer with two zero-value dummy inputs and two zero-value outputs
// (value-conserving, publicAmount=0), bound to the EMPTY ExtData and the
// contract's genesis root. Exercises extDataHash recompute + real BN254 verify +
// Merkle insert in one shot.
//
// Writes:
//   - build/transact_input.json   (witness)
//   - crates/veil-contract/src/transact_fixture.rs (proof + signals for the test)

const fs = require("fs");
const path = require("path");
const { keccak256 } = require("js-sha3");
const wasm_tester = require("circom_tester").wasm;

const R = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const INCLUDE = [
  path.join(__dirname, "../node_modules/circomlib/circuits"),
  path.join(__dirname, "../src"),
];

// Contract genesis root (Zero(20)) — from the live deploy / contract.current_root().
const GENESIS_ROOT_HEX = "2d3c07bea6883428edd2d80d07cec4b911309fed96743822d6aadea06313a951";

function be32(decStr) {
  let v = BigInt(decStr) % R;
  if (v < 0n) v += R;
  const b = Buffer.alloc(32);
  for (let i = 31; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}
const g1 = (p) => Buffer.concat([be32(p[0]), be32(p[1])]);
const g2 = (p) => Buffer.concat([be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0])]);
const lit = (b) => "[" + Array.from(b).join(", ") + "]";

// extDataHash for the EMPTY ExtData, exactly as the contract computes it
// (INTERFACES §4): recipient(32 z) || relayer(32 z) || fee_be(16 z) ||
// len(ct0)=0 be(4 z) || len(ct1)=0 be(4 z) || tag0(1 z) || tag1(1 z) = 90 zero bytes.
// The fixed settlement address the fixture binds (a transfer → no funds move).
// Mirrored in crates/veil-contract/src/transact_e2e_test.rs (SETTLE_G).
const SETTLE_G = "GAKON75EXHETR5EAUTZLO5S7YSYMUXV4VRAPYWHHD4AG2QVSBAM3CJLM";

function emptyExtDataHashDec() {
  const zeros = Buffer.alloc(32 + 32 + 16 + 4 + 4 + 1 + 1); // recipient..viewtags, all 0
  const addr = Buffer.from(SETTLE_G, "ascii");
  const addrLen = Buffer.alloc(4);
  addrLen.writeUInt32BE(addr.length);
  const buf = Buffer.concat([zeros, addrLen, addr]); // + settlement strkey binding
  const digestHex = keccak256(buf);
  const reduced = BigInt("0x" + digestHex) % R;
  return reduced.toString();
}

(async () => {
  const rootDec = BigInt("0x" + GENESIS_ROOT_HEX).toString();
  const extHashDec = emptyExtDataHashDec();

  const noteVec = await wasm_tester(path.join(__dirname, "../test/circuits/note_vec.circom"), { include: INCLUDE });
  const pos3 = await wasm_tester(path.join(__dirname, "../test/circuits/pos3.circom"), { include: INCLUDE });
  const nf = async (sk, amount, blinding, idx) =>
    (await noteVec.calculateWitness({ sk, amount, blinding, pathIndex: idx }, true))[3].toString();
  const cm = async (a, b, c) => (await pos3.calculateWitness({ a, b, c }, true))[1].toString();

  const zeros20 = Array(20).fill("0");
  const nf0 = await nf("11", "0", "111", "0");
  const nf1 = await nf("22", "0", "222", "1");
  const cm0 = await cm("0", "7", "5");
  const cm1 = await cm("0", "7", "6");

  const input = {
    root: rootDec,
    publicAmount: "0",
    extDataHash: extHashDec,
    inputNullifier: [nf0, nf1],
    outputCommitment: [cm0, cm1],
    inAmount: ["0", "0"],
    inPrivateKey: ["11", "22"],
    inBlinding: ["111", "222"],
    inPathIndices: ["0", "1"],
    inPathElements: [zeros20, zeros20],
    outAmount: ["0", "0"],
    outPubkey: ["7", "7"],
    outBlinding: ["5", "6"],
  };
  fs.writeFileSync(path.join(__dirname, "../build/transact_input.json"), JSON.stringify(input, null, 2));
  console.log("genesis root dec:", rootDec);
  console.log("empty extDataHash dec:", extHashDec);
  console.log("wrote build/transact_input.json — now run prove.sh, then re-run with --emit-fixture");

  if (process.argv.includes("--emit-fixture")) {
    const proof = JSON.parse(fs.readFileSync(path.join(__dirname, "../build/transact_proof.json")));
    const pub = JSON.parse(fs.readFileSync(path.join(__dirname, "../build/transact_public.json")));
    let f = `//! GENERATED real-proof fixture for the native full-\`transact\` test
//! (circuits/scripts/gen_transact_fixture.js). A value-conserving Phase-1
//! transfer (2 dummy in, 2 zero-value out) bound to the EMPTY ExtData and the
//! genesis root. Do not edit by hand.

pub const PROOF_A: [u8; 64] = ${lit(g1(proof.pi_a))};
pub const PROOF_B: [u8; 128] = ${lit(g2(proof.pi_b))};
pub const PROOF_C: [u8; 64] = ${lit(g1(proof.pi_c))};

/// [root, publicAmount, extDataHash, nf0, nf1, cm0, cm1]
pub const PUBLIC_SIGNALS: [[u8; 32]; 7] = [
${pub.map((x) => "    " + lit(be32(x)) + ",").join("\n")}
];
`;
    fs.writeFileSync(path.join(__dirname, "../../crates/veil-contract/src/transact_fixture.rs"), f);
    console.log("wrote crates/veil-contract/src/transact_fixture.rs");
  }
})();
