// server/server.js
// Nexus6 MCP Server — v1.1 (A2A + ChatGPT + Claude)
// Node 20+
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const UI_PORT = Number(process.env.UI_PORT || 3002);
const DATA_DIR = path.resolve('./');
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const A2A_LOG = path.join(LOGS_DIR, 'a2a.ndjson');
const UI_DIR = path.join(DATA_DIR, 'ui');

fs.mkdirSync(LOGS_DIR, { recursive: true });
if (!fs.existsSync(A2A_LOG)) fs.writeFileSync(A2A_LOG, '');

const RECENT_MAX = 500;
let recentMessages = [];

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/ui', express.static(UI_DIR, { extensions: ['html'] }));

app.get('/api/health', (_req, res) => res.json({ ok: true, version: 'v1.1' }));

// SSE
const sseClients = new Set();
app.get('/api/a2a/feed', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\n`);
  res.write(`data: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
  const client = { res };
  sseClients.add(client);
  req.on('close', () => sseClients.delete(client));
});

function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of sseClients) { try { c.res.write(data); } catch {} }
}

function appendA2ALog(obj) { fs.appendFile(A2A_LOG, JSON.stringify(obj) + '\n', () => {}); }

// Helper
function cryptoRandomId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 18);
  return `${ts}-${rand}`;
}

// A2A (manual/human messages)
app.post('/api/a2a/send', (req, res) => {
  const { from, to, project, subject, body, correlationId } = req.body || {};
  if (!from || !to || !body) return res.status(400).json({ ok: false, error: 'from, to, body are required' });
  const msg = {
    id: cryptoRandomId(),
    ts: Date.now(),
    from, to, project: project || null, subject: subject || null,
    body, correlationId: correlationId || null,
  };
  recentMessages.push(msg);
  if (recentMessages.length > RECENT_MAX) recentMessages.shift();
  appendA2ALog(msg);
  broadcast('a2a.message', msg);
  res.json({ ok: true, id: msg.id, ts: msg.ts });
});

// hydrate recent
app.get('/api/a2a/messages', (req, res) => {
  const sinceTs = Number(req.query.sinceTs || 0);
  const out = recentMessages.filter(m => m.ts > sinceTs);
  res.json({ ok: true, messages: out });
});

// === ChatGPT handler ===
app.post('/api/chatgpt/send', async (req, res) => {
  try {
    const { from, body, project, subject } = req.body || {};
    if (!from || !body) return res.status(400).json({ ok: false, error: 'from and body are required' });
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    if (!apiKey) return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY not set' });

    const sys = `You are Axlon's ChatGPT peer inside the Nexus6 MCP server.Respond concisely. Project=${project||'none'}`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: body }
        ]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`OpenAI error: ${r.status} ${t}`);
    }
    const j = await r.json();
    const reply = j.choices?.[0]?.message?.content ?? '[no content]';

    const msg = {
      id: cryptoRandomId(),
      ts: Date.now(),
      from: 'ChatGPT',
      to: from,
      project: project || null,
      subject: subject || null,
      body: reply
    };
    recentMessages.push(msg);
    if (recentMessages.length > RECENT_MAX) recentMessages.shift();
    appendA2ALog(msg);
    broadcast('a2a.message', msg);
    res.json({ ok: true, id: msg.id, ts: msg.ts });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// === Claude handler ===
app.post('/api/claude/send', async (req, res) => {
  try {
    const { from, body, project, subject } = req.body || {};
    if (!from || !body) return res.status(400).json({ ok: false, error: 'from and body are required' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
    const version = process.env.ANTHROPIC_VERSION || '2023-06-01';
    if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY not set' });

    const system = `You are Axlon's Claude peer inside the Nexus6 MCP server.Respond concisely. Project=${project||'none'}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': version,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        system,
        max_tokens: 512,
        messages: [{ role: 'user', content: body }]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Anthropic error: ${r.status} ${t}`);
    }
    const j = await r.json();
    // Claude returns content as an array of blocks; we concatenate text blocks
    const blocks = Array.isArray(j.content) ? j.content : [];
    const reply = blocks.map(b => b.text || '').join('\n').trim() || '[no content]';

    const msg = {
      id: cryptoRandomId(),
      ts: Date.now(),
      from: 'Claude',
      to: from,
      project: project || null,
      subject: subject || null,
      body: reply
    };
    recentMessages.push(msg);
    if (recentMessages.length > RECENT_MAX) recentMessages.shift();
    appendA2ALog(msg);
    broadcast('a2a.message', msg);
    res.json({ ok: true, id: msg.id, ts: msg.ts });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

const server = http.createServer(app);
server.listen(UI_PORT, () => {
  console.log(`UI & REST listening on http://localhost:${UI_PORT}/ui`);
});
