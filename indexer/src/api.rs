//! Read API (axum) for client scanning and spend-state checks.
//!
//! Routes (CLAUDE.md Part 9):
//! - `GET /notes?since_index=N`  → `[{cm, idx, ct, view_tag}]`
//! - `GET /nullifiers?since=L`   → `[{nf}]`
//! - `GET /tree/root`            → `{root, ledger}` or 501 if none recorded yet
//! - `GET /health`               → `{status, commitments, nullifiers, checkpoint}`

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::store::Store;

/// Build the axum router over a shared store.
pub fn router(store: Arc<Store>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/notes", get(notes))
        .route("/nullifiers", get(nullifiers))
        .route("/tree/root", get(tree_root))
        .with_state(store)
}

#[derive(Debug, Deserialize)]
struct NotesQuery {
    #[serde(default)]
    since_index: u32,
}

async fn notes(
    State(store): State<Arc<Store>>,
    Query(q): Query<NotesQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let rows = store.notes_since(q.since_index)?;
    Ok(Json(rows))
}

#[derive(Debug, Deserialize)]
struct NullifiersQuery {
    #[serde(default)]
    since: u64,
}

#[derive(Serialize)]
struct NullifierOut {
    nf: String,
}

async fn nullifiers(
    State(store): State<Arc<Store>>,
    Query(q): Query<NullifiersQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let rows = store.nullifiers_since(q.since)?;
    let out: Vec<NullifierOut> = rows.into_iter().map(|nf| NullifierOut { nf }).collect();
    Ok(Json(out))
}

#[derive(Serialize)]
struct RootOut {
    root: String,
    ledger: u64,
}

async fn tree_root(State(store): State<Arc<Store>>) -> Result<impl IntoResponse, ApiError> {
    match store.root()? {
        Some((root, ledger)) => Ok(Json(RootOut { root, ledger }).into_response()),
        // No Transact event ingested yet — the indexer does not reconstruct the
        // frontier itself (the contract is the tree authority), so this is a
        // stub until a root has been observed. 501 per the deliverable spec.
        None => Ok((
            StatusCode::NOT_IMPLEMENTED,
            Json(serde_json::json!({ "error": "no root observed yet" })),
        )
            .into_response()),
    }
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    commitments: u64,
    nullifiers: u64,
    checkpoint: Option<u64>,
}

async fn health(State(store): State<Arc<Store>>) -> Result<impl IntoResponse, ApiError> {
    Ok(Json(Health {
        status: "ok",
        commitments: store.commitment_count()?,
        nullifiers: store.nullifier_count()?,
        checkpoint: store.checkpoint()?,
    }))
}

/// Maps store errors to a 500 JSON body.
struct ApiError(anyhow::Error);

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        tracing::error!(error = %self.0, "api error");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": self.0.to_string() })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CommitmentRow, NullifierRow};
    use axum::body::Body;
    use axum::http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt; // for `oneshot`

    fn seeded_store() -> Arc<Store> {
        let s = Store::in_memory().unwrap();
        s.upsert_commitment(&CommitmentRow {
            cm: "cm0".into(),
            leaf_index: 0,
            ciphertext: "aa".into(),
            view_tag: 1,
            ledger: 1,
        })
        .unwrap();
        s.upsert_commitment(&CommitmentRow {
            cm: "cm1".into(),
            leaf_index: 1,
            ciphertext: "bb".into(),
            view_tag: 2,
            ledger: 1,
        })
        .unwrap();
        s.upsert_nullifier(&NullifierRow {
            nf: "nf0".into(),
            ledger: 3,
        })
        .unwrap();
        s.set_checkpoint(5).unwrap();
        Arc::new(s)
    }

    async fn body_json(resp: axum::response::Response) -> serde_json::Value {
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    #[tokio::test]
    async fn notes_endpoint_returns_inserted_rows() {
        let app = router(seeded_store());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/notes?since_index=0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp).await;
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["cm"], "cm0");
        assert_eq!(arr[0]["idx"], 0);
        assert_eq!(arr[0]["ct"], "aa");
        assert_eq!(arr[0]["view_tag"], 1);
    }

    #[tokio::test]
    async fn notes_endpoint_filters_by_since_index() {
        let app = router(seeded_store());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/notes?since_index=1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let json = body_json(resp).await;
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["cm"], "cm1");
    }

    #[tokio::test]
    async fn nullifiers_endpoint_returns_rows() {
        let app = router(seeded_store());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/nullifiers?since=0")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp).await;
        let arr = json.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["nf"], "nf0");
    }

    #[tokio::test]
    async fn tree_root_returns_501_when_unset() {
        let app = router(seeded_store());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/tree/root")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::NOT_IMPLEMENTED);
    }

    #[tokio::test]
    async fn tree_root_returns_root_when_set() {
        let s = seeded_store();
        s.set_root("rootbeer", 42).unwrap();
        let app = router(s);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/tree/root")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp).await;
        assert_eq!(json["root"], "rootbeer");
        assert_eq!(json["ledger"], 42);
    }

    #[tokio::test]
    async fn health_reports_counts() {
        let app = router(seeded_store());
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp).await;
        assert_eq!(json["status"], "ok");
        assert_eq!(json["commitments"], 2);
        assert_eq!(json["nullifiers"], 1);
        assert_eq!(json["checkpoint"], 5);
    }
}
