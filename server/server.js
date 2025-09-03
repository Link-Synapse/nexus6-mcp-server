// server/server.js
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");

const bearerAuth = require("./middleware/auth");
const chatRoute = require("./routes/chat");
const modelsRoute = require("./routes/models"); // NEW

const app = express();
const API_PORT = Number(process.env.API_PORT || 3002);
const MCP_PORT = Number(process.env.MCP_PORT || 3001); // reserved for Phase 2 MCP WS

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Ensure logs dir exists
const logsDir = path.join(__dirname, "..", "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

// === Health (no auth) ===
app.get("/health", (_req, res) => res.json({ ok: true, ver: "v1.1.3" }));

// === Bearer auth for /api/* (UI + /health remain public) ===
app.use(bearerAuth);

// === A2A SSE FEED (left public in dev via middleware exemption) ===
const sseClients = new Set();

app.get("/api/a2a/feed", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
  sseClients.add(res);

  const interval = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    } catch {
      // client likely closed
    }
  }, 20000);

  req.on("close", () => {
    clearInterval(interval);
    sseClients.delete(res);
  });
});

// Broadcast helper for A2A
function broadcastA2A(evt, payload) {
  for (const client of sseClients) {
    try {
      client.write(`event: ${evt}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      // ignore broken pipes
    }
  }
}

// === A2A MESSAGE INGEST (requires bearer via /api/*) ===
app.post("/api/a2a/message", (req, res) => {
  const { from, to, project, subject, body, correlationId } = req.body || {};
  if (!from || !to || !project || !body) {
    return res.status(400).json({ error: "missing_fields", required: ["from", "to", "project", "body"] });
  }
  const msg = {
    id: `a2a_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    ts: new Date().toISOString(),
    from,
    to,
    project,
    subject: subject || null,
    body,
    correlationId: correlationId || null,
  };

  const logPath = path.join(logsDir, "a2a.ndjson");
  fs.appendFileSync(logPath, JSON.stringify(msg) + "\n", "utf8");

  broadcastA2A("message", msg);

  return res.json({ ok: true, id: msg.id });
});

// === LLM Chat Route ===
app.use("/api/chat", chatRoute);

// === Models route (so UI can fetch valid models) ===
app.use("/api/models", modelsRoute);

// === Static UI (no auth) ===
app.use("/ui", express.static(path.join(__dirname, "..", "ui")));

// === Root ===
app.get("/", (_req, res) => {
  res.send("Nexus6 MCP Server is running. See /ui for UI.");
});

// === Start API/UI server ===
app.listen(API_PORT, () => {
  console.log(`API/UI listening on http://localhost:${API_PORT}`);
});

// === MCP WebSocket (Phase 2 placeholder) ===
// Port reserved; will be implemented in Phase 2 per ROADMAP.md
