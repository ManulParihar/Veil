const path=require("path"),fs=require("fs");
const wasm_tester=require("circom_tester").wasm;
const ROOT=path.join(__dirname,"..");
const INCLUDE=[path.join(ROOT,"node_modules/circomlib/circuits"),path.join(ROOT,"src")];
(async()=>{
  const nv=await wasm_tester(path.join(ROOT,"test/circuits/note_vec.circom"),{include:INCLUDE});
  const p3=await wasm_tester(path.join(ROOT,"test/circuits/pos3.circom"),{include:INCLUDE});
  const nf=async(sk,a,b,i)=>(await nv.calculateWitness({sk,amount:a,blinding:b,pathIndex:i},true))[3].toString();
  const cm=async(a,b,c)=>(await p3.calculateWitness({a,b,c},true))[1].toString();
  const z=Array(20).fill("0");
  const input={root:"0",publicAmount:"1000",extDataHash:"7",
    inputNullifier:[await nf("11","0","111","0"),await nf("22","0","222","1")],
    outputCommitment:[await cm("1000","7","5"),await cm("0","7","6")],
    inAmount:["0","0"],inPrivateKey:["11","22"],inBlinding:["111","222"],
    inPathIndices:["0","1"],inPathElements:[z,z],
    outAmount:["1000","0"],outPubkey:["7","7"],outBlinding:["5","6"]};
  fs.writeFileSync(path.join(ROOT,"build/dep_input.json"),JSON.stringify(input));
  console.log("wrote deposit witness");
})().catch(e=>{console.error(e.message);process.exit(1)});
