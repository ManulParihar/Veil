#!/usr/bin/env bash
# Poof multi-party trusted setup (Groth16 phase-2 ceremony).
#
# Security: the proving key is sound as long as AT LEAST ONE contributor
# destroyed their entropy. So invite as many independent people as you can.
# Contribution is sequential — each person builds on the previous .zkey.
#
# Roles & flow:
#   COORDINATOR:  ceremony.sh init                       -> contrib_0000.zkey  (publish it)
#   CONTRIBUTOR:  ceremony.sh contribute <in> <out> <name>   (then send <out> back)
#   COORDINATOR:  ceremony.sh finalize <last_contrib.zkey>   -> transaction.zkey + verification_key.json
#
# Distribute the intermediate .zkey files however you like (S3, a private file
# host, GitHub release assets, even email for a small zkey) — they contain no
# secrets, only public proving material. Each contributor MUST verify the file
# they received before contributing (this script does that automatically).
set -euo pipefail
cd "$(dirname "$0")/.."
SNARKJS="node $(pwd)/node_modules/.bin/snarkjs"
B=build
mkdir -p "$B/ceremony"

cmd="${1:-help}"; shift || true

case "$cmd" in
  init)
    # Phase 1 (powers of tau) is universal; we generate + beacon a fresh one,
    # then run the circuit-specific groth16 setup to seed contribution #0.
    POWER="${POOF_PTAU_POWER:-15}"
    echo "==> phase-1 powers of tau (2^$POWER, bn128)"
    $SNARKJS powersoftau new bn128 "$POWER" "$B/ceremony/pot_0000.ptau" -v
    $SNARKJS powersoftau contribute "$B/ceremony/pot_0000.ptau" "$B/ceremony/pot_0001.ptau" \
        --name="coordinator phase1" -v -e="$(head -c 64 /dev/urandom | base64)"
    $SNARKJS powersoftau beacon "$B/ceremony/pot_0001.ptau" "$B/ceremony/pot_beacon.ptau" \
        0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20 10 -n="phase1 beacon"
    $SNARKJS powersoftau prepare phase2 "$B/ceremony/pot_beacon.ptau" "$B/pot_final.ptau" -v
    echo "==> groth16 setup -> contribution #0 (no secrets yet)"
    [ -f "$B/transaction.r1cs" ] || { echo "missing $B/transaction.r1cs — compile the circuit first (see circuits/README.md)"; exit 1; }
    $SNARKJS groth16 setup "$B/transaction.r1cs" "$B/pot_final.ptau" "$B/ceremony/contrib_0000.zkey"
    echo "==> publish this file for the first contributor: $B/ceremony/contrib_0000.zkey"
    ;;

  contribute)
    IN="${1:?usage: contribute <in.zkey> <out.zkey> <your-name>}"
    OUT="${2:?usage: contribute <in.zkey> <out.zkey> <your-name>}"
    NAME="${3:?usage: contribute <in.zkey> <out.zkey> <your-name>}"
    echo "==> verify the file you received before trusting it"
    $SNARKJS zkey verify "$B/transaction.r1cs" "$B/pot_final.ptau" "$IN"
    echo "==> your contribution (snarkjs will prompt for random text; also seeded from OS entropy)"
    $SNARKJS zkey contribute "$IN" "$OUT" --name="$NAME" -v -e="$(head -c 64 /dev/urandom | base64)"
    echo "==> done. SEND '$OUT' to the coordinator, then DELETE your local entropy/terminal scrollback."
    echo "    (Print the attestation hash below and post it publicly so the transcript is auditable.)"
    $SNARKJS zkey verify "$B/transaction.r1cs" "$B/pot_final.ptau" "$OUT"
    ;;

  finalize)
    LAST="${1:?usage: finalize <last_contribution.zkey>}"
    echo "==> verify the final contribution"
    $SNARKJS zkey verify "$B/transaction.r1cs" "$B/pot_final.ptau" "$LAST"
    echo "==> apply public random beacon (seals the ceremony)"
    $SNARKJS zkey beacon "$LAST" "$B/transaction.zkey" \
        0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20 10 -n="final beacon"
    echo "==> verify the beaconed proving key"
    $SNARKJS zkey verify "$B/transaction.r1cs" "$B/pot_final.ptau" "$B/transaction.zkey"
    echo "==> export verifying key"
    $SNARKJS zkey export verificationkey "$B/transaction.zkey" "$B/verification_key.json"
    cat <<EOF

==> ceremony complete. New "world" produced. Now propagate it:
    cp build/transaction.zkey            ../app/public/circuit/transaction.zkey
    cp build/verification_key.json       ../app/public/circuit/verification_key.json
    node scripts/gen_sample_input.js && bash scripts/prove.sh build/sample_input.json
    node scripts/export_vk_rust.js        # rewrites crates/poof-contract/src/{vk.rs,sample_proof.rs}
    bash ../deploy/deploy_testnet.sh      # REDEPLOY — the old contract's VK is now a different world
EOF
    ;;

  *)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
