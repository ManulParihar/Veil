#!/usr/bin/env bash
# Deploy Veil to Stellar testnet. Permissionless: friendbot funds the deployer,
# so no pre-existing credentials are needed.
set -euo pipefail
cd "$(dirname "$0")/.."

IDENTITY="${VEIL_IDENTITY:-veil-deployer}"
NETWORK="${VEIL_NETWORK:-testnet}"

echo "==> ensure funded identity '$IDENTITY'"
stellar keys generate "$IDENTITY" --network "$NETWORK" --fund 2>/dev/null || \
  stellar keys fund "$IDENTITY" --network "$NETWORK" || true
ADDR=$(stellar keys address "$IDENTITY")
echo "    deployer: $ADDR"

echo "==> build optimized contract wasm (wasm32v1-none, real verifier)"
cargo build -p veil-contract --target wasm32v1-none --release
WASM=target/wasm32v1-none/release/veil_contract.wasm
stellar contract optimize --wasm "$WASM" 2>/dev/null || true
OPT=target/wasm32v1-none/release/veil_contract.optimized.wasm
[ -f "$OPT" ] && WASM="$OPT"

echo "==> deploy"
CID=$(stellar contract deploy --wasm "$WASM" --source "$IDENTITY" --network "$NETWORK")
echo "    contract: $CID"

# Native XLM Stellar Asset Contract (testnet). Override with VEIL_TOKEN.
TOKEN="${VEIL_TOKEN:-$(stellar contract id asset --asset native --network "$NETWORK")}"
echo "    token (SAC): $TOKEN"

echo "==> init (levels=20, root_history_size=64, token=native XLM as currency 0)"
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" \
  -- init --admin "$ADDR" --config '{"levels":20,"root_history_size":64}' --token "$TOKEN"

# Register a second asset to prove the registry works with NO new vkey/upgrade.
# A custom asset issued by the deployer; its SAC is deployed then registered.
ASSET2="${VEIL_ASSET2:-VUSD:$ADDR}"
echo "==> deploy + register a second asset ($ASSET2) as currency 1"
stellar contract asset deploy --asset "$ASSET2" --source "$IDENTITY" --network "$NETWORK" 2>/dev/null || true
TOKEN2=$(stellar contract id asset --asset "$ASSET2" --network "$NETWORK")
echo "    second token (SAC): $TOKEN2"
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" \
  -- register_token --token "$TOKEN2"

echo "==> sanity reads"
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" -- get_config
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" -- current_root
echo "    token_count:"
stellar contract invoke --id "$CID" --source "$IDENTITY" --network "$NETWORK" -- token_count

echo "==> done."
echo "    contract:      $CID"
echo "    currency 0:    $TOKEN  (native XLM)"
echo "    currency 1:    $TOKEN2 ($ASSET2)"
