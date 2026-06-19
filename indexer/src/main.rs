//! Veil indexer entry point: wires config from env, starts the ingest loop and
//! the axum read API.
//!
//! Config (env vars):
//! - `VEIL_DB_PATH`        SQLite file path                 (default: `veil-indexer.db`)
//! - `VEIL_RPC_URL`        Soroban RPC endpoint             (default: testnet)
//! - `VEIL_CONTRACT_ID`    pool contract id to filter on    (required for live ingest)
//! - `VEIL_POLL_SECS`      poll interval in seconds         (default: 5)
//! - `VEIL_FINALITY_LAG`   confirmations before ingest      (default: 5)
//! - `VEIL_BIND`           HTTP bind address                (default: 0.0.0.0:8080)

use std::sync::Arc;
use std::time::Duration;

use veil_indexer::ingest;
use veil_indexer::rpc::StellarRpcSource;
use veil_indexer::Store;

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

    let db_path = env_or("VEIL_DB_PATH", "veil-indexer.db");
    let rpc_url = env_or(
        "VEIL_RPC_URL",
        "https://soroban-testnet.stellar.org",
    );
    let contract_id = std::env::var("VEIL_CONTRACT_ID").ok();
    let poll_secs: u64 = env_or("VEIL_POLL_SECS", "5").parse().unwrap_or(5);
    let finality_lag: u64 = env_or("VEIL_FINALITY_LAG", "5")
        .parse()
        .unwrap_or(ingest::DEFAULT_FINALITY_LAG);
    let bind = env_or("VEIL_BIND", "0.0.0.0:8080");

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
        tracing::warn!("VEIL_CONTRACT_ID unset — serving read API only, no ingest");
    }

    let app = veil_indexer::api::router(store);
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
