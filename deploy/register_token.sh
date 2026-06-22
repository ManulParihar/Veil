#!/usr/bin/env bash
# Register a new asset (currency) in the Poof shielded pool.
#
#   bash deploy/register_token.sh <SYMBOL> <ASSET> [DECIMALS]
#
# <SYMBOL>   display ticker, e.g. USDC          (app metadata only)
# <ASSET>    EITHER a SAC contract id (C…)        -> registered as-is
#            OR a classic asset CODE:ISSUER (G…)  -> its SAC is resolved
#                                                    (and deployed if missing)
# [DECIMALS] display decimals (default 7; app metadata only — the contract is
#            unit-agnostic)
#
# register_token is ADMIN-ONLY: it is authorized by the identity that deployed
# the contract (the admin set at init). That key lives in your local Stellar CLI
# keystore, NOT in this repo. Override which identity signs with POOF_IDENTITY.
#
#   POOF_IDENTITY   signing identity   (default: poof-deployer)
#   POOF_NETWORK    network            (default: testnet)
#   POOF_CONTRACT   pool contract id   (default: read from deploy/addresses.json)
set -euo pipefail
cd "$(dirname "$0")/.."

SYMBOL="${1:?usage: register_token.sh <SYMBOL> <ASSET:  C… SAC | CODE:ISSUER> [DECIMALS]}"
ASSET="${2:?usage: register_token.sh <SYMBOL> <ASSET:  C… SAC | CODE:ISSUER> [DECIMALS]}"
DECIMALS="${3:-7}"
IDENTITY="${POOF_IDENTITY:-poof-deployer}"
NETWORK="${POOF_NETWORK:-testnet}"

# Contract id: explicit override, else pull from the deployment manifest.
CONTRACT="${POOF_CONTRACT:-$(grep -o '"contract_id"[^,]*' deploy/addresses.json | head -1 | grep -o 'C[A-Z0-9]\{55\}')}"
[ -n "$CONTRACT" ] || { echo "could not determine contract id — set POOF_CONTRACT"; exit 1; }

command -v stellar >/dev/null || { echo "missing: stellar CLI"; exit 1; }

ADMIN=$(stellar keys address "$IDENTITY" 2>/dev/null) || {
  echo "identity '$IDENTITY' not found in your keystore."
  echo "register_token is admin-only; you need the deployer key that created $CONTRACT."
  exit 1
}
echo "==> contract:  $CONTRACT"
echo "==> signer:    $IDENTITY ($ADMIN)"

# Resolve the SAC address to register.
if [[ "$ASSET" == C* && ${#ASSET} -eq 56 ]]; then
  SAC="$ASSET"                       # already a SAC contract id
  echo "==> using SAC as given: $SAC"
else
  echo "==> resolving SAC for classic asset '$ASSET' (deploying it if needed)"
  stellar contract asset deploy --asset "$ASSET" --source "$IDENTITY" --network "$NETWORK" 2>/dev/null || true
  SAC=$(stellar contract id asset --asset "$ASSET" --network "$NETWORK")
  echo "    SAC: $SAC"
fi

echo "==> register_token (admin-authorized)"
NEW_ID=$(stellar contract invoke --id "$CONTRACT" --source "$IDENTITY" --network "$NETWORK" \
  -- register_token --token "$SAC")
# strip any quotes the CLI may wrap scalar return values in
NEW_ID=$(echo "$NEW_ID" | tr -d '"[:space:]')
echo "    assigned currency_id: $NEW_ID"

echo "==> verify"
stellar contract invoke --id "$CONTRACT" --source "$IDENTITY" --network "$NETWORK" -- token_count
stellar contract invoke --id "$CONTRACT" --source "$IDENTITY" --network "$NETWORK" -- token --id "$NEW_ID"

cat <<EOF

==> registered on-chain. Now add it to the wallet UI in app/src/lib/currencies.ts:

  {
    id: $NEW_ID,
    symbol: "$SYMBOL",
    decimals: $DECIMALS,
    sac: "$SAC",
  },

(then rebuild/redeploy the app — no circuit, vkey, or contract change is needed.)
EOF
