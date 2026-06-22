#!/usr/bin/env bash
# Poof trusted setup — Groth16 over BN254.
#
# ⚠️  SINGLE-CONTRIBUTOR, NOT A CEREMONY, NOT PRODUCTION-SAFE.  ⚠️
# This generates a fresh local powers-of-tau and a one-contribution zkey purely
# so the MVP can produce verifiable proofs. A real deployment needs a multi-party
# ceremony. This is single-contributor setup material and is not production-safe.
set -euo pipefail

cd "$(dirname "$0")/.."
SNARKJS="node $(pwd)/node_modules/.bin/snarkjs"
POWER=15                       # 2^15 = 32768 ≥ ~26.8k constraints
mkdir -p build
cd build

echo "==> [1/6] powersoftau new (bn128, 2^$POWER)"
$SNARKJS powersoftau new bn128 "$POWER" pot_0000.ptau -v

echo "==> [2/6] contribute to powers of tau (single contributor)"
$SNARKJS powersoftau contribute pot_0000.ptau pot_0001.ptau \
    --name="poof-mvp-single-contributor" -v -e="poof mvp $(date +%s) not production"

echo "==> [3/6] prepare ptau"
$SNARKJS powersoftau prepare phase2 pot_0001.ptau pot_final.ptau -v

echo "==> [4/6] groth16 setup"
$SNARKJS groth16 setup transaction.r1cs pot_final.ptau transaction_0000.zkey

echo "==> [5/6] zkey contribute (single contributor)"
$SNARKJS zkey contribute transaction_0000.zkey transaction.zkey \
    --name="poof-mvp-zkey" -v -e="poof zkey $(date +%s) not production"

echo "==> [6/6] export verification key"
$SNARKJS zkey export verificationkey transaction.zkey verification_key.json

echo "==> done. artifacts in circuits/build/:"
ls -la transaction.zkey verification_key.json
