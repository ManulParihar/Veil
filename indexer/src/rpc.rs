//! Real Stellar RPC `getEvents` poller implementing [`EventSource`].
//!
//! NOTE: this is smoke-compiled, not exercised against a live network in this
//! component tests. The JSON shapes follow Soroban RPC's
//! `getEvents` / `getLatestLedger` methods. Event-value decoding from XDR is
//! intentionally permissive: it expects the contract to emit the topics in
//! INTERFACES.md §5 and the indexer to receive already-decoded scval JSON
//! (Soroban RPC supports `xdrFormat: "json"`). If integration shows the RPC
//! returns base64 XDR instead, swap [`decode_event`] for an XDR path — the
//! `EventSource` boundary keeps the loop untouched.

use serde::Deserialize;

use crate::ingest::EventSource;
use crate::types::{LedgerEvent, PoofEvent};

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
        // Soroban RPC caps a single getEvents at ~10k scanned ledgers AND 200
        // events, whichever comes first — so one call rarely spans the whole
        // range from the resume point to the tip. Page via the returned cursor
        // until it scans through `latestLedger`; otherwise events past the first
        // page are silently dropped while `ingest_once` still advances the
        // checkpoint to the tip, permanently skipping them.
        let mut out = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut params = serde_json::json!({
                "filters": [{
                    "type": "contract",
                    "contractIds": [self.contract_id],
                }],
                "xdrFormat": "json",
            });
            // `startLedger` and `cursor` are mutually exclusive: seed the first
            // page from `from_ledger`, then follow the cursor.
            match &cursor {
                None => {
                    params["startLedger"] = serde_json::json!(from_ledger);
                    params["pagination"] = serde_json::json!({ "limit": 200 });
                }
                Some(c) => {
                    params["pagination"] = serde_json::json!({ "cursor": c, "limit": 200 });
                }
            }

            let result: GetEventsResult = self.rpc("getEvents", params)?;
            for ev in &result.events {
                if let Some(parsed) = decode_event(ev) {
                    out.push(LedgerEvent {
                        ledger: ev.ledger,
                        event: parsed,
                    });
                }
            }

            // Stop once the cursor has scanned through the chain tip. Guard a
            // missing/stuck cursor so a malformed response can't spin forever
            // (degrades to the pages already collected).
            let next = result.cursor;
            let reached_tip = next
                .as_deref()
                .and_then(cursor_ledger)
                .map(|cl| cl >= result.latest_ledger)
                .unwrap_or(true);
            let stuck = next.is_some() && next == cursor;
            cursor = next;
            if cursor.is_none() || reached_tip || stuck {
                break;
            }
        }
        Ok(out)
    }

    fn latest_ledger(&self) -> anyhow::Result<u64> {
        let r: LatestLedgerResult = self.rpc("getLatestLedger", serde_json::json!({}))?;
        Ok(r.sequence)
    }

    fn oldest_ledger(&self) -> anyhow::Result<u64> {
        // `getHealth` is the only method that reports the retention floor
        // (`getEvents`/`getLatestLedger` do not). Below it, `getEvents` fails.
        let r: HealthResult = self.rpc("getHealth", serde_json::json!({}))?;
        Ok(r.oldest_ledger)
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
    /// Paging token to fetch the next page; encodes the last scanned ledger.
    #[serde(default)]
    cursor: Option<String>,
    /// The chain tip at query time — pagination is complete once the cursor
    /// reaches it.
    #[serde(default, rename = "latestLedger")]
    latest_ledger: u64,
}

#[derive(Deserialize)]
struct LatestLedgerResult {
    sequence: u64,
}

#[derive(Deserialize)]
struct HealthResult {
    #[serde(rename = "oldestLedger")]
    oldest_ledger: u64,
}

/// One event as returned by `getEvents`. `topic` / `value` are scval-JSON when
/// `xdrFormat: "json"` is requested. We keep them as raw `serde_json::Value`
/// and decode defensively.
#[derive(Deserialize)]
struct RpcEvent {
    ledger: u64,
    // With `xdrFormat: "json"` the live RPC names these `topicJson`/`valueJson`;
    // the bare `topic`/`value` aliases keep older/base64 responses decoding too.
    #[serde(default, alias = "topicJson", alias = "topic")]
    topic: Vec<serde_json::Value>,
    #[serde(default, alias = "valueJson", alias = "value")]
    value: serde_json::Value,
}

/// Best-effort decode of a single RPC event into a [`PoofEvent`] per
/// INTERFACES.md §5. Returns `None` for unrecognized topics so unrelated
/// contract events are skipped rather than failing the whole batch.
///
/// Topic[0] is the discriminant symbol: `NewCommitment` / `Nullifier` /
/// `Transact`. The data tuple is in `value`.
fn decode_event(ev: &RpcEvent) -> Option<PoofEvent> {
    let tag = ev.topic.first().and_then(scval_symbol)?;
    match tag.as_str() {
        // The contract emits the short symbol "NewCommit" (see live getEvents
        // topicJson), not "NewCommitment".
        "NewCommit" => {
            // value = (commitment, leaf_index, ciphertext, view_tag)
            let arr = scval_vec(&ev.value)?;
            Some(PoofEvent::NewCommitment {
                cm: scval_bytes_hex(arr.first()?)?,
                leaf_index: scval_u32(arr.get(1)?)?,
                ciphertext: scval_bytes_hex(arr.get(2)?)?,
                view_tag: scval_u32(arr.get(3)?)?,
            })
        }
        "Nullifier" => Some(PoofEvent::Nullifier {
            nf: scval_bytes_hex(&ev.value)?,
        }),
        "Transact" => {
            // value = (root,) — accept either a 1-tuple or a bare bytes value.
            let root = match scval_vec(&ev.value) {
                Some(arr) => scval_bytes_hex(arr.first()?)?,
                None => scval_bytes_hex(&ev.value)?,
            };
            Some(PoofEvent::Transact { root })
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

/// Extract the ledger sequence from a getEvents cursor. The cursor is
/// `"<toid>-<event_index>"`, where the toid packs the ledger in its high 32
/// bits (`toid = ledger << 32 | ...`). Used to detect when pagination has
/// scanned through the chain tip.
fn cursor_ledger(cursor: &str) -> Option<u64> {
    let toid: u64 = cursor.split('-').next()?.parse().ok()?;
    Some(toid >> 32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_new_commitment_scval_json() {
        let ev = RpcEvent {
            ledger: 7,
            topic: vec![serde_json::json!({"symbol": "NewCommit"})],
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
            PoofEvent::NewCommitment {
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
            PoofEvent::Nullifier { nf: "dead".into() }
        );

        let tx = RpcEvent {
            ledger: 1,
            topic: vec![serde_json::json!({"symbol": "Transact"})],
            value: serde_json::json!({"vec": [{"bytes": "B00B"}]}),
        };
        assert_eq!(
            decode_event(&tx).unwrap(),
            PoofEvent::Transact { root: "b00b".into() }
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

    #[test]
    fn deserializes_real_getevents_shape() {
        // Regression: the prior struct read `topic`/`value` and matched
        // "NewCommitment", but the live RPC (xdrFormat: json) names the fields
        // `topicJson`/`valueJson` and the contract emits the symbol "NewCommit"
        // — so every event decoded to None and nothing was ingested. This locks
        // the real wire shape and the cursor/latestLedger paging fields.
        let raw = serde_json::json!({
            "events": [{
                "ledger": 3297817u64,
                "topicJson": [{"symbol": "NewCommit"}],
                "valueJson": {"vec": [
                    {"bytes": "25BC"},
                    {"u32": 0},
                    {"bytes": "0BE1"},
                    {"u32": 233},
                ]}
            }],
            "cursor": "0014201610011955200-0000000003",
            "latestLedger": 3323332u64,
        });
        let result: GetEventsResult = serde_json::from_value(raw).unwrap();
        assert_eq!(result.latest_ledger, 3323332);
        assert_eq!(
            result.cursor.as_deref(),
            Some("0014201610011955200-0000000003")
        );
        assert_eq!(
            decode_event(&result.events[0]).unwrap(),
            PoofEvent::NewCommitment {
                cm: "25bc".into(),
                leaf_index: 0,
                ciphertext: "0be1".into(),
                view_tag: 233,
            }
        );
    }

    #[test]
    fn cursor_ledger_extracts_sequence() {
        // toid 14201610011955200 >> 32 == 3306570 (validated against live RPC).
        assert_eq!(cursor_ledger("0014201610011955200-0000000003"), Some(3306570));
        assert_eq!(cursor_ledger("garbage"), None);
    }
}
