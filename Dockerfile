# Poof indexer — long-running RPC poller + read API (the only real "backend").
# Build context MUST be the workspace root (this crate is a Cargo workspace member).
#   docker build -t poof-indexer .
#   docker run -p 8080:8080 -e POOF_CONTRACT_ID=CDVNLQYW... -v poofdata:/data poof-indexer

# ---- build stage --------------------------------------------------------------
FROM rust:1-bookworm AS build
WORKDIR /src
# rusqlite is `bundled` (compiles libsqlite3 from source) -> needs a C toolchain,
# which the full rust image already provides. reqwest uses rustls -> no OpenSSL.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY indexer ./indexer
# The indexer embeds deploy/addresses.json (contract id + start ledger) at compile
# time via include_str!, so the deploy record must be in the build context.
COPY deploy ./deploy
# Build only the indexer; other members (e.g. the wasm contract) aren't needed.
RUN cargo build --release -p poof-indexer
RUN strip target/release/poof-indexer || true

# ---- runtime stage ------------------------------------------------------------
FROM debian:bookworm-slim AS runtime
# ca-certificates so the RPC poller can make HTTPS calls.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/poof-indexer /usr/local/bin/poof-indexer

# Persist the SQLite DB on a mounted volume (see fly.toml / -v above).
# POOF_BIND is intentionally NOT baked in: the binary defaults to 0.0.0.0:8080
# but honors a PaaS-injected $PORT (Railway) when POOF_BIND is unset. Fly sets
# POOF_BIND explicitly in fly.toml, so its behavior is unchanged.
ENV POOF_DB_PATH=/data/poof-indexer.db \
    POOF_RPC_URL=https://soroban-testnet.stellar.org \
    RUST_LOG=info
# POOF_CONTRACT_ID must be supplied at runtime, or it serves the DB read-only.
#
# Persistence: Railway does NOT support the Dockerfile `VOLUME` instruction —
# attach a Railway Volume to this service with mount path /data instead (Service
# -> Settings -> Volumes). Fly mounts /data via fly.toml. Create the dir so the
# binary can write even when no volume is attached (ephemeral in that case).
RUN mkdir -p /data
EXPOSE 8080
ENTRYPOINT ["poof-indexer"]
