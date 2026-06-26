//! Poof indexer entry point: wires config from env, starts the ingest loop and
//! the axum read API.
//!
//! Config (env vars):
//! - `POOF_DB_PATH`        SQLite file path                 (default: `poof-indexer.db`)
//! - `POOF_RPC_URL`        Soroban RPC endpoint             (default: testnet)
//! - `POOF_CONTRACT_ID`    pool contract id to filter on    (default: embedded addresses.json)
//! - `POOF_START_LEDGER`   fresh-DB scan seed ledger        (default: embedded deploy_ledger)
//! - `POOF_POLL_SECS`      poll interval in seconds         (default: 5)
//! - `POOF_FINALITY_LAG`   confirmations before ingest      (default: 5)
//! - `POOF_BIND`           HTTP bind address                (default: 0.0.0.0:$PORT or 0.0.0.0:8080)
//!
//! The contract id and start ledger default to the values embedded from
//! `deploy/addresses.json` at compile time (see `config.rs`), so following a
//! redeploy is a code change (edit the JSON + rebuild), not a Railway env edit.
//! The env vars above remain as operational overrides.

use std::sync::Arc;
use std::time::Duration;

use poof_indexer::ingest;
use poof_indexer::rpc::StellarRpcSource;
use poof_indexer::{testnet_deployment, Store};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let db_path = env_or("POOF_DB_PATH", "poof-indexer.db");
    let rpc_url = env_or(
        "POOF_RPC_URL",
        "https://soroban-testnet.stellar.org",
    );
    // Contract id + start ledger default to the embedded deploy/addresses.json
    // record; env vars override. A parse failure is fatal — shipping an indexer
    // with no contract to watch is never intended.
    let deployment = testnet_deployment()?;
    let contract_id =
        std::env::var("POOF_CONTRACT_ID").unwrap_or_else(|_| deployment.contract_id.clone());
    let start_ledger: u64 = std::env::var("POOF_START_LEDGER")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(deployment.start_ledger);
    let poll_secs: u64 = env_or("POOF_POLL_SECS", "5").parse().unwrap_or(5);
    let finality_lag: u64 = env_or("POOF_FINALITY_LAG", "5")
        .parse()
        .unwrap_or(ingest::DEFAULT_FINALITY_LAG);
    // `POOF_BIND` wins when set (Fly sets it explicitly). Otherwise, honor the
    // `PORT` injected by PaaS hosts like Railway/Render; fall back to 8080.
    let bind = std::env::var("POOF_BIND").unwrap_or_else(|_| match std::env::var("PORT") {
        Ok(port) => format!("0.0.0.0:{port}"),
        Err(_) => "0.0.0.0:8080".to_string(),
    });

    let store = Arc::new(Store::open(&db_path)?);
    tracing::info!(db = %db_path, "store ready");

    // Self-heal across a redeploy: if the DB holds a different contract's events,
    // wipe them and the checkpoint so the loop reseeds from `start_ledger`. The
    // new contract starts a fresh tree at leaf 0, so stale leaves would collide
    // on leaf_index and corrupt client scans. No-op on a same-contract restart.
    if store.active_contract()?.as_deref() != Some(contract_id.as_str()) {
        if store.active_contract()?.is_some() {
            tracing::warn!(contract = %contract_id, "watched contract changed — wiping stale events");
        }
        store.reset_events()?;
        store.set_active_contract(&contract_id)?;
    }

    let source = Arc::new(StellarRpcSource::new(rpc_url.clone(), contract_id.clone()));
    let s = store.clone();
    tracing::info!(
        rpc = %rpc_url,
        contract = %contract_id,
        start = start_ledger,
        lag = finality_lag,
        "starting ingest loop"
    );
    tokio::spawn(ingest::run_loop(
        s,
        source,
        finality_lag,
        start_ledger,
        Duration::from_secs(poll_secs),
    ));

    let app = poof_indexer::api::router(store);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!(addr = %bind, "serving read API");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
