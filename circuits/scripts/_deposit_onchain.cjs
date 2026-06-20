const path=require("path"),fs=require("fs");
const wasm_tester=require("circom_tester").wasm;
const R=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const ROOT=path.join(__dirname,"..");
const INCLUDE=[path.join(ROOT,"node_modules/circomlib/circuits"),path.join(ROOT,"src")];
const GEN="20460142462285856218765860898052067672306981225120697436392828593803361495377";
const EXT="12274180586256115613035258515313315225750750685679601860991516828731164881326";
const be32=(d)=>{let v=((BigInt(d)%R)+R)%R;const b=Buffer.alloc(32);for(let i=31;i>=0;i--){b[i]=Number(v&0xffn);v>>=8n;}return b;};
const g1=(p)=>Buffer.concat([be32(p[0]),be32(p[1])]).toString("hex");
const g2=(p)=>Buffer.concat([be32(p[0][1]),be32(p[0][0]),be32(p[1][1]),be32(p[1][0])]).toString("hex");
(async()=>{
  const nv=await wasm_tester(path.join(ROOT,"test/circuits/note_vec.circom"),{include:INCLUDE});
  const p3=await wasm_tester(path.join(ROOT,"test/circuits/pos3.circom"),{include:INCLUDE});
  const nf=async(sk,a,b,i)=>(await nv.calculateWitness({sk,amount:a,blinding:b,pathIndex:i},true))[3].toString();
  const cm=async(a,b,c)=>(await p3.calculateWitness({a,b,c},true))[1].toString();
  const z=Array(20).fill("0");
  const input={root:GEN,publicAmount:"1000",extDataHash:EXT,
    inputNullifier:[await nf("31","0","311","0"),await nf("42","0","422","1")],
    outputCommitment:[await cm("1000","7","51"),await cm("0","7","61")],
    inAmount:["0","0"],inPrivateKey:["31","42"],inBlinding:["311","422"],
    inPathIndices:["0","1"],inPathElements:[z,z],
    outAmount:["1000","0"],outPubkey:["7","7"],outBlinding:["51","61"]};
  fs.writeFileSync(path.join(ROOT,"build/onchain_dep_input.json"),JSON.stringify(input));
  console.log("wrote deposit input");
})().catch(e=>{console.error(e.message);process.exit(1)});
