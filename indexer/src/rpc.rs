//! Real Stellar RPC `getEvents` poller implementing [`EventSource`].
//!
//! NOTE: this is smoke-compiled, not exercised against a live network in this
//! plane (deferred to integration). The JSON shapes follow Soroban RPC's
//! `getEvents` / `getLatestLedger` methods. Event-value decoding from XDR is
//! intentionally permissive: it expects the contract to emit the topics in
//! INTERFACES.md §5 and the indexer to receive already-decoded scval JSON
//! (Soroban RPC supports `xdrFormat: "json"`). If integration shows the RPC
//! returns base64 XDR instead, swap [`decode_event`] for an XDR path — the
//! `EventSource` boundary keeps the loop untouched.

use serde::Deserialize;

use crate::ingest::EventSource;
use crate::types::{LedgerEvent, VeilEvent};

/// A Soroban RPC `getEvents` poller scoped to one contract id.
pub struct StellarRpcSource {
    client: reqwest::blocking::Client,
    rpc_url: String,
    contract_id: String,
}

impl StellarRpcSource {
    pub fn new(rpc_url: impl Into<String>, contract_id: impl Into<String>) -> Self {
        Self {
            client: reqwest::blocking::Client::new(),
            rpc_url: rpc_url.into(),
            contract_id: contract_id.into(),
        }
    }

    fn rpc<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<T> {
        let body = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params,
        });
        let resp: JsonRpcResponse<T> = self
            .client
            .post(&self.rpc_url)
            .json(&body)
            .send()?
            .json()?;
        if let Some(err) = resp.error {
            anyhow::bail!("rpc error {}: {}", err.code, err.message);
        }
        resp.result
            .ok_or_else(|| anyhow::anyhow!("rpc returned no result"))
    }
}

impl EventSource for StellarRpcSource {
    fn fetch_events(&self, from_ledger: u64) -> anyhow::Result<Vec<LedgerEvent>> {
        let params = serde_json::json!({
            "startLedger": from_ledger,
            "filters": [{
                "type": "contract",
                "contractIds": [self.contract_id],
            }],
            "xdrFormat": "json",
            "pagination": { "limit": 200 },
        });
        let result: GetEventsResult = self.rpc("getEvents", params)?;
        let mut out = Vec::new();
        for ev in result.events {
            if let Some(parsed) = decode_event(&ev) {
                out.push(LedgerEvent {
                    ledger: ev.ledger,
                    event: parsed,
                });
            }
        }
        Ok(out)
    }

    fn latest_ledger(&self) -> anyhow::Result<u64> {
        let r: LatestLedgerResult = self.rpc("getLatestLedger", serde_json::json!({}))?;
        Ok(r.sequence)
    }
}

// ── JSON-RPC envelope ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Deserialize)]
struct GetEventsResult {
    #[serde(default)]
    events: Vec<RpcEvent>,
}

#[derive(Deserialize)]
struct LatestLedgerResult {
    sequence: u64,
}

/// One event as returned by `getEvents`. `topic` / `value` are scval-JSON when
/// `xdrFormat: "json"` is requested. We keep them as raw `serde_json::Value`
/// and decode defensively.
#[derive(Deserialize)]
struct RpcEvent {
    ledger: u64,
    #[serde(default)]
    topic: Vec<serde_json::Value>,
    #[serde(default, alias = "valueJson", alias = "value")]
    value: serde_json::Value,
}

/// Best-effort decode of a single RPC event into a [`VeilEvent`] per
/// INTERFACES.md §5. Returns `None` for unrecognized topics so unrelated
/// contract events are skipped rather than failing the whole batch.
///
/// Topic[0] is the discriminant symbol: `NewCommitment` / `Nullifier` /
/// `Transact`. The data tuple is in `value`.
fn decode_event(ev: &RpcEvent) -> Option<VeilEvent> {
    let tag = ev.topic.first().and_then(scval_symbol)?;
    match tag.as_str() {
        "NewCommitment" => {
            // value = (commitment, leaf_index, ciphertext, view_tag)
            let arr = scval_vec(&ev.value)?;
            Some(VeilEvent::NewCommitment {
                cm: scval_bytes_hex(arr.first()?)?,
                leaf_index: scval_u32(arr.get(1)?)?,
                ciphertext: scval_bytes_hex(arr.get(2)?)?,
                view_tag: scval_u32(arr.get(3)?)?,
            })
        }
        "Nullifier" => Some(VeilEvent::Nullifier {
            nf: scval_bytes_hex(&ev.value)?,
        }),
        "Transact" => {
            // value = (root,) — accept either a 1-tuple or a bare bytes value.
            let root = match scval_vec(&ev.value) {
                Some(arr) => scval_bytes_hex(arr.first()?)?,
                None => scval_bytes_hex(&ev.value)?,
            };
            Some(VeilEvent::Transact { root })
        }
        _ => None,
    }
}

// ── tiny scval-JSON helpers ──────────────────────────────────────────────
// Soroban scval-JSON encodes a symbol as {"symbol":"X"}, a u32 as {"u32":N},
// bytes as {"bytes":"<hex>"}, a vec as {"vec":[...]}. We also tolerate plain
// JSON (string/number/array) for resilience across RPC versions.

fn scval_symbol(v: &serde_json::Value) -> Option<String> {
    v.get("symbol")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .or_else(|| v.as_str().map(|s| s.to_string()))
}

fn scval_u32(v: &serde_json::Value) -> Option<u32> {
    v.get("u32")
        .and_then(|x| x.as_u64())
        .or_else(|| v.as_u64())
        .map(|n| n as u32)
}

fn scval_bytes_hex(v: &serde_json::Value) -> Option<String> {
    // {"bytes":"<hex>"} or a bare hex string.
    if let Some(s) = v.get("bytes").and_then(|x| x.as_str()) {
        return Some(s.to_lowercase());
    }
    v.as_str().map(|s| s.to_lowercase())
}

fn scval_vec(v: &serde_json::Value) -> Option<Vec<serde_json::Value>> {
    if let Some(arr) = v.get("vec").and_then(|x| x.as_array()) {
        return Some(arr.clone());
    }
    v.as_array().cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_new_commitment_scval_json() {
        let ev = RpcEvent {
            ledger: 7,
            topic: vec![serde_json::json!({"symbol": "NewCommitment"})],
            value: serde_json::json!({"vec": [
                {"bytes": "AABB"},
                {"u32": 4},
                {"bytes": "CAFE"},
                {"u32": 9},
            ]}),
        };
        let got = decode_event(&ev).unwrap();
        assert_eq!(
            got,
            VeilEvent::NewCommitment {
                cm: "aabb".into(),
                leaf_index: 4,
                ciphertext: "cafe".into(),
                view_tag: 9,
            }
        );
    }

    #[test]
    fn decodes_nullifier_and_transact() {
        let nf = RpcEvent {
            ledger: 1,
            topic: vec![serde_json::json!({"symbol": "Nullifier"})],
            value: serde_json::json!({"bytes": "DEAD"}),
        };
        assert_eq!(
            decode_event(&nf).unwrap(),
            VeilEvent::Nullifier { nf: "dead".into() }
        );

        let tx = RpcEvent {
            ledger: 1,
            topic: vec![serde_json::json!({"symbol": "Transact"})],
            value: serde_json::json!({"vec": [{"bytes": "B00B"}]}),
        };
        assert_eq!(
            decode_event(&tx).unwrap(),
            VeilEvent::Transact { root: "b00b".into() }
        );
    }

    #[test]
    fn unknown_topic_is_skipped() {
        let ev = RpcEvent {
            ledger: 1,
            topic: vec![serde_json::json!({"symbol": "SomethingElse"})],
            value: serde_json::json!({}),
        };
        assert!(decode_event(&ev).is_none());
    }
}
