#!/usr/bin/env bash
# Bootstrap Poof from a fresh clone.
#
#   bash deploy/bootstrap.sh            # use the SHARED transaction.zkey + live contract
#   bash deploy/bootstrap.sh --fresh    # regenerate setup, rebuild VK, redeploy a new contract
#
# Default mode expects the proving key (gitignored, ~11 MB) to already be in
# place at app/public/circuit/transaction.zkey — get it from whoever shared the
# project. It must match the deployed contract's verifying key ("same world"),
# which this script verifies by running the integration gate.
set -euo pipefail
cd "$(dirname "$0")/.."
FRESH=0; [ "${1:-}" = "--fresh" ] && FRESH=1

echo "==> check prerequisites"
for bin in cargo node npm; do command -v "$bin" >/dev/null || { echo "missing: $bin"; exit 1; }; done
rustup target list --installed 2>/dev/null | grep -q wasm32v1-none || rustup target add wasm32v1-none
if [ "$FRESH" = 1 ]; then command -v circom  >/dev/null || { echo "missing: circom (needed for --fresh)";  exit 1; }; fi
if [ "$FRESH" = 1 ]; then command -v stellar >/dev/null || { echo "missing: stellar CLI (needed for --fresh)"; exit 1; }; fi

echo "==> fetch Rust deps"
cargo fetch

echo "==> install JS deps (circuits + app)"
(cd circuits && npm install)
(cd app && npm install)

if [ "$FRESH" = 1 ]; then
  echo "==> [fresh] compile circuit"
  (cd circuits && circom src/transaction.circom --r1cs --wasm --sym \
      -l "$(pwd)/node_modules/circomlib/circuits" -l "$(pwd)/src" -o build)
  echo "==> [fresh] trusted setup (single-contributor; use ceremony.sh for production)"
  (cd circuits && bash scripts/setup.sh)
  echo "==> [fresh] sync artifacts into the app"
  cp circuits/build/transaction.zkey            app/public/circuit/transaction.zkey
  cp circuits/build/transaction_js/transaction.wasm app/public/circuit/transaction.wasm
  cp circuits/build/verification_key.json       app/public/circuit/verification_key.json
  echo "==> [fresh] generate a real proof fixture + export the Rust verifying key"
  (cd circuits && node scripts/gen_sample_input.js && bash scripts/prove.sh build/sample_input.json && node scripts/export_vk_rust.js)
  echo "==> [fresh] redeploy the contract (its VK now matches the new zkey)"
  bash deploy/deploy_testnet.sh
  echo "    !! update CONTRACT_ID + CONTRACT_START_LEDGER in app/src/lib/types.ts and deploy/addresses.json with the printed values."
else
  echo "==> verify the shared proving key is present"
  [ -f app/public/circuit/transaction.zkey ] || { echo "MISSING app/public/circuit/transaction.zkey — get it from whoever shared the project (gitignored, ~11 MB)."; exit 1; }
  cp -n app/public/circuit/transaction.zkey circuits/build/transaction.zkey 2>/dev/null || true
fi

echo "==> integration gate (proves browser crypto + zkey match the contract's world)"
(cd app && npm test)

echo "==> production build"
(cd app && npm run build)

echo "==> done. Run 'cd app && npm run dev' (or 'npm run e2e' for the real on-chain flow)."
