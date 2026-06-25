// Poof gasless-withdrawal relayer — a tiny HTTP service (Node stdlib only, plus
// stellar-sdk). Three routes:
//   GET  /health → liveness
//   GET  /info   → { relayerAddress, minFee, contractId } so a wallet can bind the
//                  relayer's payout address into its withdraw proof BEFORE proving
//   POST /relay  → { proof, publicSignals, extData } → { hash }; submits + pays
import http from "node:http";
import { loadConfig } from "./config.js";
import { relay, validateRequest, type RelayRequest } from "./relay.js";

const cfg = loadConfig();

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function send(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", ...CORS });
  res.end(data);
}

function readBody(req: http.IncomingMessage, limit = 256 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/info") {
      return send(res, 200, {
        relayerAddress: cfg.relayerPublicKey,
        minFee: cfg.minFee.toString(),
        contractId: cfg.contractId,
        network: cfg.networkPassphrase,
      });
    }
    if (req.method === "POST" && url.pathname === "/relay") {
      let body: RelayRequest;
      try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "invalid JSON" }); }
      const invalid = validateRequest(body, cfg);
      if (invalid) return send(res, 400, { error: invalid });
      try {
        const result = await relay(body, cfg);
        console.log(`[relay] submitted ${result.hash} fee=${body.extData.fee}`);
        return send(res, 200, result);
      } catch (e: any) {
        console.error("[relay] failed:", e?.message ?? e);
        return send(res, 502, { error: String(e?.message ?? e) });
      }
    }
    return send(res, 404, { error: "not found" });
  } catch (e: any) {
    return send(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(cfg.port, () => {
  console.log(`poof-relayer listening on :${cfg.port}`);
  console.log(`  relayer account : ${cfg.relayerPublicKey}`);
  console.log(`  contract        : ${cfg.contractId}`);
  console.log(`  min fee         : ${cfg.minFee} (base units)`);
});
