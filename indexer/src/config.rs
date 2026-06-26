//! Deployment config, embedded from `deploy/addresses.json` at compile time so a
//! redeploy is a code change (edit the JSON + rebuild), not a hand-managed env var.
//!
//! This makes `deploy/addresses.json` the single source of truth for the contract
//! id and its deploy ledger — the same record the frontend hardcodes in
//! `app/src/lib/types.ts`. Env vars (`POOF_CONTRACT_ID`, `POOF_START_LEDGER`) remain
//! as operational escape hatches in `main.rs`, but the embedded values are the
//! default so no Railway env edits are needed to follow a redeploy.
//!
//! Build note: the Dockerfile must `COPY deploy ./deploy` for this `include_str!`
//! to resolve inside the image (the build context is the workspace root).

use serde::Deserialize;

/// The committed deployment record. Embedded at compile time.
const ADDRESSES_JSON: &str = include_str!("../../deploy/addresses.json");

/// The bits of a network deployment the indexer needs to watch a contract.
#[derive(Debug, Clone)]
pub struct Deployment {
    /// Pool contract id to filter `getEvents` on.
    pub contract_id: String,
    /// Ledger the contract was deployed at — the seed for a fresh-DB scan.
    pub start_ledger: u64,
}

// ── addresses.json shape (only the fields we read) ───────────────────────────

#[derive(Deserialize)]
struct AddressesFile {
    testnet: NetworkEntry,
}

#[derive(Deserialize)]
struct NetworkEntry {
    contract_id: String,
    current: CurrentEntry,
}

#[derive(Deserialize)]
struct CurrentEntry {
    deploy_ledger: u64,
}

/// Parse the embedded testnet deployment record.
pub fn testnet_deployment() -> anyhow::Result<Deployment> {
    let file: AddressesFile = serde_json::from_str(ADDRESSES_JSON)
        .map_err(|e| anyhow::anyhow!("parse embedded deploy/addresses.json: {e}"))?;
    Ok(Deployment {
        contract_id: file.testnet.contract_id,
        start_ledger: file.testnet.current.deploy_ledger,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_addresses_parse() {
        let d = testnet_deployment().unwrap();
        // The contract id is a 56-char Stellar contract (`C...`) and the start
        // ledger is set — this guards against a malformed addresses.json landing
        // in a build.
        assert!(d.contract_id.starts_with('C'));
        assert_eq!(d.contract_id.len(), 56);
        assert!(d.start_ledger > 0);
    }
}
