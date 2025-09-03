// C:\Users\STENCH\Documents\Projects\mcp-server\scripts\test-ws-write.js
// ESM / Node 20+ — write + verify round-trip
import WebSocket from "ws";

const WS_URL = process.env.MCP_URL || "ws://localhost:3001";
const BEARER = process.env.N6_BEARER;
const PROJECT = process.env.PROJECT || "nexus6";

if (!BEARER) {
  console.error("[test-ws-write] Missing N6_BEARER"); process.exit(1);
}

let nextId = 1;
const pending = new Map();

function rpc(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = String(nextId++);
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, jsonrpc: "2.0", method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }
    }, 15000);
  });
}

function onMessage(data) {
  let msg;
  try { msg = JSON.parse(data.toString()); } catch { return; }
  const { id, result, error } = msg;
  if (!id) return;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (error) p.reject(new Error(error.message || "RPC error"));
  else p.resolve(result);
}

async function main() {
  const ws = new WebSocket(WS_URL, {
    headers: { Authorization: `Bearer ${BEARER}` }
  });

  ws.on("message", onMessage);
  await new Promise((res, rej) => {
    ws.once("open", res);
    ws.once("error", rej);
  });

  console.log("[test-ws-write] Connected to", WS_URL);

  const slug = `mcp-write-${Date.now()}`;

  // Write new doc
  const writeRes = await rpc(ws, "mcp.write_doc", {
    project: PROJECT,
    slug,
    name: "MCP Write Test",
    doctype: "md",            // must exist as a Single select option
    status: "draft",          // adapter coerces to your 'Draft' choice
    content: "# Hello from MCP\n\nThis came from test-ws-write.js"
  });
  console.log("write_doc:", JSON.stringify(writeRes, null, 2));

  // Verify it appears in list
  const ld = await rpc(ws, "mcp.list_docs", { project: PROJECT });
  const docs = Array.isArray(ld?.docs) ? ld.docs : [];
  const found = docs.some(d => (d.slug || d.fields?.slug) === slug);
  console.log("Found newly created slug in list:", found);

  if (!found) {
    console.error("[test-ws-write] Not found after write.");
    process.exit(2);
  }

  console.log("[test-ws-write] All checks passed.");
  ws.close();
}

main().catch((e) => {
  console.error("[test-ws-write] Failed:", e.message);
  process.exit(1);
});
