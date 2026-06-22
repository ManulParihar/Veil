//! Contract error enum.
//!
//! Numbers are stable wire values — the SDK matches on them. Do not renumber.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Proof was generated against a root outside the rolling history window.
    UnknownRoot = 1,
    /// One of the nullifiers was already spent — double-spend attempt.
    NullifierSpent = 2,
    /// The two input nullifiers are equal — same note used twice in one tx.
    DuplicateNullifier = 3,
    /// Recomputed `extDataHash` did not match the public signal — the recipient,
    /// relayer, fee or ciphertexts were tampered with (front-run attempt).
    ExtDataMismatch = 4,
    /// Groth16 pairing check failed.
    ProofInvalid = 5,
    /// The tree already holds `2^levels` leaves; no room for two more.
    TreeFull = 6,
    /// Deposit/withdraw settlement could not balance.
    InsufficientFunds = 7,
    /// `transact` (or any reader) was called before `init`.
    NotInitialized = 8,
    /// The transaction's `currency_id` is not a registered token (or does not fit
    /// in the u32 registry index range).
    UnknownCurrency = 9,
    /// A privileged call (e.g. `register_token`) was made by a non-admin.
    Unauthorized = 10,
}
