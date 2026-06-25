# Poof relayer — gasless private withdrawals

> ⚠️ Activating gasless withdrawals requires the **fee-settling contract**
> (`ExtData.relayer_address` + withdraw fee split). Redeploy with
> `bash deploy/deploy_testnet.sh` and point this relayer + the frontend at the new
> contract id. The live contract in the repo root README predates this and does
> **not** pay relayer fees.

The single biggest privacy gap a shielded pool has left is the **fee payer**: even
with a perfect ZK withdrawal, *someone* signs and pays the Stellar network fee, and
that account is public. A fresh recipient that has to pre-fund itself with XLM to
withdraw leaks exactly the link the pool was hiding.

This relayer closes it. The user proves a withdraw **in their browser**, then hands
`{proof, publicSignals, extData}` to the relayer. Because a withdraw places no
`require_auth` on the user's notes (the proof is the authorization, funds leave the
pool's own custody), the relayer can submit and sign the envelope entirely on its
own. The contract pays the relayer `fee` out of the withdrawn amount and the
recipient `amount − fee` — both bound into `extDataHash`, so the relayer can
redirect neither. The user never touches the chain.

## API

```
GET  /health → { ok: true }
GET  /info   → { relayerAddress, minFee, contractId, network }
POST /relay  → { hash }
```

`GET /info` is called **before** proving: the wallet must bind `relayerAddress`
(and a `fee >= minFee`) into the withdraw's `extDataHash`, so the relayer's payout
is part of what the proof commits to.

`POST /relay` body:
```jsonc
{
  "proof": { "a": "<hex 64B>", "b": "<hex 128B>", "c": "<hex 64B>" },
  "publicSignals": ["<hex32>", … 8 total],   // INTERFACES §3 order
  "extData": {
    "recipient": "<hex32>", "relayer": "<hex32>", "fee": "<decimal u128>",
    "ciphertext0": "<hex>", "ciphertext1": "<hex>",
    "viewTag0": 0, "viewTag1": 0,
    "settlementAddress": "G…",   // recipient, gets amount − fee
    "relayerAddress": "G…"       // this relayer, gets fee
  }
}
```

The relayer rejects anything where `relayerAddress` isn't its own account, where
`fee < minFee`, or that isn't a withdraw (`publicAmount == 0`).

## Run locally

```bash
cd relayer
npm install
cp .env.example .env   # set POOF_RELAYER_SECRET (fund it via friendbot) + POOF_CONTRACT_ID
npm run dev
```

## Deploy (Railway / Fly / any container host)

Ships a `Dockerfile`; config is all env vars (see `.env.example`). Railway/Fly
inject `$PORT` automatically. Set `POOF_RELAYER_SECRET` and `POOF_CONTRACT_ID`,
generate a public domain, then set `VITE_RELAYER_URL=https://<host>` on the
frontend — the wallet shows a "Gasless (via relayer)" toggle on Withdraw only when
that env is set, so the default app is unaffected.
