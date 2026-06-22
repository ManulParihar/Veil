//! Poof indexer entry point: wires config from env, starts the ingest loop and
//! the axum read API.
//!
//! Config (env vars):
//! - `POOF_DB_PATH`        SQLite file path                 (default: `poof-indexer.db`)
//! - `POOF_RPC_URL`        Soroban RPC endpoint             (default: testnet)
//! - `POOF_CONTRACT_ID`    pool contract id to filter on    (required for live ingest)
//! - `POOF_POLL_SECS`      poll interval in seconds         (default: 5)
//! - `POOF_FINALITY_LAG`   confirmations before ingest      (default: 5)
//! - `POOF_BIND`           HTTP bind address                (default: 0.0.0.0:8080)

use std::sync::Arc;
use std::time::Duration;

use poof_indexer::ingest;
use poof_indexer::rpc::StellarRpcSource;
use poof_indexer::Store;

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
    let contract_id = std::env::var("POOF_CONTRACT_ID").ok();
    let poll_secs: u64 = env_or("POOF_POLL_SECS", "5").parse().unwrap_or(5);
    let finality_lag: u64 = env_or("POOF_FINALITY_LAG", "5")
        .parse()
        .unwrap_or(ingest::DEFAULT_FINALITY_LAG);
    let bind = env_or("POOF_BIND", "0.0.0.0:8080");

    let store = Arc::new(Store::open(&db_path)?);
    tracing::info!(db = %db_path, "store ready");

    // Start the ingest loop only if we have a contract to watch. Without one,
    // we still serve the (possibly pre-populated) DB read-only.
    if let Some(cid) = contract_id {
        let source = Arc::new(StellarRpcSource::new(rpc_url.clone(), cid.clone()));
        let s = store.clone();
        tracing::info!(rpc = %rpc_url, contract = %cid, lag = finality_lag, "starting ingest loop");
        tokio::spawn(ingest::run_loop(
            s,
            source,
            finality_lag,
            Duration::from_secs(poll_secs),
        ));
    } else {
        tracing::warn!("POOF_CONTRACT_ID unset — serving read API only, no ingest");
    }

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
