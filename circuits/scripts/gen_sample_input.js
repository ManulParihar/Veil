// Generate a valid, value-conserving sample witness input for the joinsplit:
// two zero-value dummy inputs funded by publicAmount=100, outputs 100 + 0.
// Writes build/sample_input.json. Used by prove.sh to exercise the real proof
// pipeline and to feed the contract integration test.
const path = require("path");
const fs = require("fs");
const wasm_tester = require("circom_tester").wasm;

const INCLUDE = [
  path.join(__dirname, "../node_modules/circomlib/circuits"),
  path.join(__dirname, "../src"),
];
const ZEROS20 = Array(20).fill("0");

(async () => {
  const noteVec = await wasm_tester(path.join(__dirname, "../test/circuits/note_vec.circom"), { include: INCLUDE });
  const pos4 = await wasm_tester(path.join(__dirname, "../test/circuits/pos4.circom"), { include: INCLUDE });

  const CUR = "1"; // sample currency id

  const nfcm = async (sk, amount, blinding, idx) => {
    const w = await noteVec.calculateWitness({ sk, amount, currencyId: CUR, blinding, pathIndex: idx }, true);
    return { cm: w[2].toString(), nf: w[3].toString() };
  };
  const cm = async (a, b, c) => (await pos4.calculateWitness({ a, b: CUR, c: b, d: c }, true))[1].toString();

  const in0 = await nfcm("11", "0", "111", "0");
  const in1 = await nfcm("22", "0", "222", "1");
  const outCm0 = await cm("100", "7", "5");
  const outCm1 = await cm("0", "7", "6");

  const input = {
    root: "0",
    publicAmount: "100",
    extDataHash: "12345",
    inputNullifier: [in0.nf, in1.nf],
    outputCommitment: [outCm0, outCm1],
    currencyId: CUR,
    inAmount: ["0", "0"],
    inPrivateKey: ["11", "22"],
    inBlinding: ["111", "222"],
    inPathIndices: ["0", "1"],
    inPathElements: [ZEROS20, ZEROS20],
    outAmount: ["100", "0"],
    outPubkey: ["7", "7"],
    outBlinding: ["5", "6"],
  };
  const outPath = path.join(__dirname, "../build/sample_input.json");
  fs.writeFileSync(outPath, JSON.stringify(input, null, 2));
  console.log("wrote", outPath);
})();
