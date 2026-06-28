# Deploy the Poof indexer to Railway

The **only** backend service is the Rust `poof-indexer` (RPC poller + read API).
Railway builds it from the repo-root `Dockerfile`; `railway.json` (repo root) pins
the builder, health check, and restart policy. `.dockerignore` already strips the
app, circuits, and other workspace members so only the Rust crates are sent.

## One-time setup

1. **Create the service** — point Railway at this GitHub repo (root directory `/`).
   It auto-detects `railway.json` + `Dockerfile`, no Nixpacks involved.

   ```bash
   # or via CLI, from the repo root:
   railway init
   railway up
   ```

2. **Add a persistent Volume** for the SQLite DB (the DB lives outside the image so
   it survives redeploys). In the service → **Variables/Volumes** → New Volume,
   mount path:

   ```
   /data
   ```

   This matches `POOF_DB_PATH=/data/poof-indexer.db` below.

3. **Set environment variables** (service → Variables):

   | Variable            | Value                                                                   | Notes |
   | ------------------- | ----------------------------------------------------------------------- | ----- |
   | `POOF_DB_PATH`      | `/data/poof-indexer.db`                                                  | Must sit on the mounted volume. |
   | `POOF_RPC_URL`      | `https://soroban-testnet.stellar.org`                                   | Soroban testnet RPC. |
   | `POOF_POLL_SECS`    | `5`                                                                     | Poll interval. |
   | `POOF_FINALITY_LAG` | `5`                                                                     | Confirmations before ingest. |
   | `RUST_LOG`          | `info`                                                                  | Log level. |

   **Do not set `POOF_CONTRACT_ID` / `POOF_START_LEDGER`.** The contract id and
   deploy ledger are embedded at build time from `deploy/addresses.json` (the
   source of truth — currently `CDLDIXFX...`), so a redeploy is a code change
   (edit the JSON + rebuild), not a Railway env edit. These env vars exist only
   as operational overrides; a stale `POOF_CONTRACT_ID` here would silently
   point ingest at the wrong contract.

   **Do not set `POOF_BIND`.** Railway injects `PORT` and the indexer now binds to
   `0.0.0.0:$PORT` automatically (see `indexer/src/main.rs`). Setting `POOF_BIND`
   would override that and break Railway's routing.

4. **Generate a public domain** (service → Settings → Networking → Generate Domain).
   Railway routes HTTPS traffic to the detected port.

## Health check

`railway.json` health-checks `GET /health`, which returns
`{status, commitments, nullifiers, checkpoint}` with `200` once the store is up.

## Point the frontend at it

Set the app's indexer base URL to the generated Railway domain, e.g.
`https://<service>.up.railway.app` (used by the client scanner for
`/notes`, `/nullifiers`, `/tree/root`).

## Redeploys

Pushing to the tracked branch triggers a rebuild. The `/data` volume (SQLite DB)
persists across deploys, so ingest resumes from the last checkpoint.

### Aged-out cursor self-heal

Soroban RPC only retains ~7 days (~120k ledgers) of events. If the service is
down (or the cursor stalls) long enough that the persisted checkpoint slides
below the RPC retention floor, every `getEvents` would fail with
`-32600 startLedger ... out of range` and the loop would retry the dead ledger
forever. At boot the indexer now queries `getHealth` for the retention floor and:

- **reseeds** from the embedded deploy ledger (wiping the stale DB) when the
  cursor aged out but the deploy ledger is still retained — logs a `WARN`
  ("reseeding from deploy ledger"), then backfills the full current-contract
  history; or
- logs an `ERROR` ("events permanently lost from RPC; archival backfill
  required") when even the deploy ledger has aged out — the read API keeps
  serving whatever is already in the DB, but a clean rebuild from RPC is no
  longer possible.

So redeploying the current build is itself the fix for a stuck cursor; no manual
volume surgery is needed in the common case.
