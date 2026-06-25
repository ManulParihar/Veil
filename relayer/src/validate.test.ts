import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRequest, type RelayRequest } from "./relay.js";
import type { Config } from "./config.js";

const cfg: Config = {
  port: 8787,
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CDVNLQYWDDH4BJQJBIOWW2CJELVR62FGGVPQN3ZMUNS7PUCIWH3SBLPN",
  relayerSecret: "S".padEnd(56, "A"),
  relayerPublicKey: "GRELAYER",
  minFee: 1_000_000n,
  baseFee: "1000000",
};

const withdrawSignals = () => {
  const z = "00".repeat(32);
  const nonzero = "00".repeat(31) + "2a"; // publicAmount != 0 → withdraw
  return [z, nonzero, z, z, z, z, z, z];
};

const goodReq = (over: Partial<RelayRequest["extData"]> = {}): RelayRequest => ({
  proof: { a: "00", b: "00", c: "00" },
  publicSignals: withdrawSignals(),
  extData: {
    recipient: "00".repeat(32), relayer: "00".repeat(32), fee: "1000000",
    ciphertext0: "", ciphertext1: "", viewTag0: 0, viewTag1: 0,
    settlementAddress: "GRECIPIENT", relayerAddress: "GRELAYER", ...over,
  },
});

test("accepts a well-formed relayer-payable withdraw", () => {
  assert.equal(validateRequest(goodReq(), cfg), null);
});

test("rejects a relayerAddress that isn't this relayer", () => {
  assert.match(validateRequest(goodReq({ relayerAddress: "GSOMEONEELSE" }), cfg)!, /not this relayer/);
});

test("rejects a fee below the minimum", () => {
  assert.match(validateRequest(goodReq({ fee: "1" }), cfg)!, /below relayer minimum/);
});

test("rejects a non-withdraw (zero publicAmount)", () => {
  const req = goodReq();
  req.publicSignals[1] = "00".repeat(32);
  assert.match(validateRequest(req, cfg)!, /not a withdraw/);
});

test("rejects wrong-length publicSignals", () => {
  const req = goodReq();
  req.publicSignals = req.publicSignals.slice(0, 7);
  assert.match(validateRequest(req, cfg)!, /8 entries/);
});

test("rejects a non-integer fee", () => {
  assert.match(validateRequest(goodReq({ fee: "abc" }), cfg)!, /not an integer/);
});
