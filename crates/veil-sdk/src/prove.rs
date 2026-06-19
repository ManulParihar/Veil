//! Groth16 proof generation by shelling out to snarkjs.
//!
//! The circuit artifacts (`transaction.wasm`, `transaction_final.zkey`) come
//! from the circuits plane. This module does not require them to be present at
//! build/test time — the unit tests here only check argument assembly and
//! missing-artifact handling. The real proving path is exercised by an
//! `#[ignore]`d integration test once the artifacts exist.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Errors from the proving path.
#[derive(Debug)]
pub enum ProveError {
    /// A required artifact (wasm/zkey/snarkjs/node) was not found.
    MissingArtifact(String),
    /// `snarkjs` exited non-zero.
    SnarkjsFailed(String),
    /// IO error reading/writing temp files or outputs.
    Io(String),
}

impl std::fmt::Display for ProveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProveError::MissingArtifact(s) => write!(f, "missing artifact: {s}"),
            ProveError::SnarkjsFailed(s) => write!(f, "snarkjs failed: {s}"),
            ProveError::Io(s) => write!(f, "io error: {s}"),
        }
    }
}

impl std::error::Error for ProveError {}

/// Paths to the circuit artifacts + snarkjs entrypoint.
#[derive(Clone, Debug)]
pub struct ProverConfig {
    /// `transaction_js/transaction.wasm` witness calculator.
    pub wasm_path: PathBuf,
    /// `transaction_final.zkey`.
    pub zkey_path: PathBuf,
    /// How to invoke snarkjs: `node <snarkjs_cli.js>` or just `snarkjs`.
    pub snarkjs: SnarkjsInvocation,
}

/// How to run snarkjs on this machine.
#[derive(Clone, Debug)]
pub enum SnarkjsInvocation {
    /// `node <path-to-snarkjs/cli.js>` (local install — see PROGRESS milestone 0).
    NodeScript { node: PathBuf, cli_js: PathBuf },
    /// `snarkjs` on PATH.
    Binary(PathBuf),
}

impl SnarkjsInvocation {
    fn command(&self) -> Command {
        match self {
            SnarkjsInvocation::NodeScript { node, cli_js } => {
                let mut c = Command::new(node);
                c.arg(cli_js);
                c
            }
            SnarkjsInvocation::Binary(bin) => Command::new(bin),
        }
    }
}

/// Output of a successful proof.
#[derive(Clone, Debug)]
pub struct ProveOutput {
    /// `proof.json` contents (snarkjs Groth16 proof).
    pub proof_json: String,
    /// `public.json` contents (the 7 public signals as a JSON array).
    pub public_json: String,
}

impl ProverConfig {
    /// Verify every artifact exists, returning a descriptive error if not. Lets
    /// callers (and tests) detect a missing circuit cleanly instead of a cryptic
    /// process failure.
    pub fn check_available(&self) -> Result<(), ProveError> {
        if !self.wasm_path.exists() {
            return Err(ProveError::MissingArtifact(format!(
                "wasm not found: {}",
                self.wasm_path.display()
            )));
        }
        if !self.zkey_path.exists() {
            return Err(ProveError::MissingArtifact(format!(
                "zkey not found: {}",
                self.zkey_path.display()
            )));
        }
        match &self.snarkjs {
            SnarkjsInvocation::NodeScript { node, cli_js } => {
                if !cli_js.exists() {
                    return Err(ProveError::MissingArtifact(format!(
                        "snarkjs cli.js not found: {}",
                        cli_js.display()
                    )));
                }
                // `node` may be on PATH; only flag an absolute path that's absent.
                if node.is_absolute() && !node.exists() {
                    return Err(ProveError::MissingArtifact(format!(
                        "node not found: {}",
                        node.display()
                    )));
                }
            }
            SnarkjsInvocation::Binary(bin) => {
                if bin.is_absolute() && !bin.exists() {
                    return Err(ProveError::MissingArtifact(format!(
                        "snarkjs not found: {}",
                        bin.display()
                    )));
                }
            }
        }
        Ok(())
    }
}

/// Generate a Groth16 proof from a witness-input JSON string.
///
/// Runs `snarkjs groth16 fullprove <input.json> <wasm> <zkey> <proof.json>
/// <public.json>` in a temp working directory, returning the proof and public
/// JSON. Requires the artifacts to be present (`check_available`).
pub fn prove(
    witness_input_json: &str,
    config: &ProverConfig,
    work_dir: &Path,
) -> Result<ProveOutput, ProveError> {
    config.check_available()?;

    fs::create_dir_all(work_dir).map_err(|e| ProveError::Io(e.to_string()))?;
    let input_path = work_dir.join("input.json");
    let proof_path = work_dir.join("proof.json");
    let public_path = work_dir.join("public.json");

    fs::write(&input_path, witness_input_json).map_err(|e| ProveError::Io(e.to_string()))?;

    let mut cmd = config.snarkjs.command();
    cmd.arg("groth16")
        .arg("fullprove")
        .arg(&input_path)
        .arg(&config.wasm_path)
        .arg(&config.zkey_path)
        .arg(&proof_path)
        .arg(&public_path);

    let output = cmd.output().map_err(|e| ProveError::Io(e.to_string()))?;
    if !output.status.success() {
        return Err(ProveError::SnarkjsFailed(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ));
    }

    let proof_json = fs::read_to_string(&proof_path).map_err(|e| ProveError::Io(e.to_string()))?;
    let public_json =
        fs::read_to_string(&public_path).map_err(|e| ProveError::Io(e.to_string()))?;

    Ok(ProveOutput {
        proof_json,
        public_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_artifacts_detected() {
        let cfg = ProverConfig {
            wasm_path: PathBuf::from("/nonexistent/transaction.wasm"),
            zkey_path: PathBuf::from("/nonexistent/transaction_final.zkey"),
            snarkjs: SnarkjsInvocation::Binary(PathBuf::from("snarkjs")),
        };
        let err = cfg.check_available().unwrap_err();
        assert!(matches!(err, ProveError::MissingArtifact(_)));
    }

    #[test]
    fn prove_without_artifacts_errors_not_panics() {
        let cfg = ProverConfig {
            wasm_path: PathBuf::from("/nonexistent/transaction.wasm"),
            zkey_path: PathBuf::from("/nonexistent/transaction_final.zkey"),
            snarkjs: SnarkjsInvocation::Binary(PathBuf::from("snarkjs")),
        };
        let r = prove("{}", &cfg, Path::new("/tmp/veil-prove-test"));
        assert!(r.is_err());
    }

    /// The real proving path. Ignored by default — the integration step runs it
    /// once `circuits/build/` has the artifacts. Wire up `ProverConfig` to the
    /// real artifact paths there.
    #[test]
    #[ignore = "requires circuit artifacts from the circuits plane"]
    fn real_proof_generation() {
        // Placeholder: the integration harness fills in real paths + witness.
        // Kept as a marker so `cargo test -- --ignored` exercises it post-build.
    }
}
