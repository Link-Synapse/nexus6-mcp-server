// server/mcp.js
// Nexus6 MCP WebSocket server (Phase 2.0, Windows-safe autostart)

import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendStateLog } from '../utils/log.js';
import {
  listProjects as atListProjects,
  listDocs as atListDocs,
  writeDoc as atWriteDoc
} from '../adapters/airtable.js';

// ---- Auth ------------------------------------------------------------
function getBearerFromEnv() {
  const token = process.env.N6_BEARER;
  if (!token || typeof token !== 'string' || token.trim().length < 12) {
    console.warn('[MCP] Warning: N6_BEARER is missing/too short. Set a long random token.');
  }
  return token;
}
function isAuthorized(req) {
  const expected = getBearerFromEnv();
  const header = req.headers?.authorization || '';
  if (!expected) return false;
  if (!header.startsWith('Bearer ')) return false;
  const supplied = header.slice('Bearer '.length).trim();
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

// ---- Utils -----------------------------------------------------------
function ok(result) { return { ok: true, result }; }
function err(code, message, hint) { return { ok: false, error: { code, message, hint } }; }
function sendJson(ws, id, payload) {
  const frame = id === undefined ? payload : { id, ...payload };
  try { ws.send(JSON.stringify(frame)); } catch (e) { console.error('[MCP] sendJson error:', e); }
}
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function newConnectionId() { return crypto.randomUUID(); }

// ---- RPC Router ------------------------------------------------------
async function handleRpc({ method, params }) {
  const t0 = performance.now();
  try {
    switch (method) {
      case 'mcp.ping':
        return ok({ ok: true, ts: new Date().toISOString(), agent: 'Axlon' });

      case 'mcp.info':
        return ok({
          name: 'nexus6-mcp-server',
          version: 'v1.1.3',
          ws_port: 3001,
          capabilities: [
            'mcp.ping',
            'mcp.info',
            'mcp.list_projects',
            'mcp.list_docs',
            'mcp.write_doc'
          ]
        });

      case 'mcp.list_projects': {
        const projects = await atListProjects();
        return ok({ projects });
      }

      case 'mcp.list_docs': {
        if (!params || typeof params.project !== 'string' || !params.project.trim()) {
          return err('BadRequest', 'Missing required param: project', 'Provide { project: "<slug>" }');
        }
        const project = params.project.trim();
        const docs = await atListDocs(project);
        return ok({ project, docs });
      }

      case 'mcp.write_doc': {
        if (!params || typeof params !== 'object') {
          return err('BadRequest', 'Missing params', 'Provide { project, slug, name?, doctype?, status?, content? }');
        }
        const { project, slug } = params;
        if (!project || !slug) {
          return err('BadRequest', 'project and slug are required', 'Provide { project:"...", slug:"..." }');
        }
        const written = await atWriteDoc({
          project,
          slug,
          name: params.name,
          doctype: params.doctype || 'md',
          status: params.status || 'draft',
          content: params.content ?? ''
        });
        return ok({ written });
      }

      default:
        return err('MethodNotFound', `Unknown method ${method}`, 'Call mcp.info to list capabilities');
    }
  } catch (e) {
    return err('Internal', e?.message || String(e), 'Check server logs and Airtable config');
  } finally {
    const t1 = performance.now();
    appendStateLog({ event: 'ws:rpc', data: { method, ms: Math.round(t1 - t0) } });
  }
}

// ---- Server lifecycle ------------------------------------------------
export function startMcpWsServer(opts = {}) {
  const port = Number.isFinite(opts.port) ? opts.port : 3001;
  const wss = new WebSocketServer({ port });

  console.log(`[MCP] WebSocket server listening on ws://localhost:${port}`);

  wss.on('connection', (ws, req) => {
    if (!isAuthorized(req)) {
      try { ws.close(1008, 'Unauthorized'); } catch {}
      appendStateLog({ event: 'ws:reject', data: { reason: 'unauthorized', ip: req.socket?.remoteAddress || 'unknown' } });
      return;
    }
    const cid = newConnectionId();
    appendStateLog({ event: 'ws:connect', data: { cid, ip: req.socket?.remoteAddress || 'unknown', ua: req.headers['user-agent'] || 'unknown' } });

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
      const msg = typeof raw === 'string' ? raw : raw.toString('utf8');
      const parsed = safeParse(msg);
      if (!parsed) return sendJson(ws, undefined, err('BadJSON', 'Invalid JSON', 'Send a JSON-RPC-like object'));
      const { id, method, params } = parsed;
      if (!method || typeof method !== 'string') return sendJson(ws, id, err('BadRequest', 'Missing method', 'Include a string "method"'));
      const result = await handleRpc({ method, params });
      sendJson(ws, id, result);
    });

    ws.on('close', (code, reasonBuf) => {
      const reason = reasonBuf?.toString?.() || '';
      appendStateLog({ event: 'ws:disconnect', data: { cid, code, reason } });
    });
    ws.on('error', (e) => {
      appendStateLog({ event: 'ws:error', data: { cid, message: e?.message || String(e) } });
    });
  });

  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} ; continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, 30000);
  wss.on('close', () => clearInterval(interval));

  async function close() {
    await new Promise((resolve) => {
      clearInterval(interval);
      try { wss.close(() => resolve()); } catch { resolve(); }
    });
  }
  return { wss, close };
}

// ---- Robust "run as script" check (works on Windows paths) -----------
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  startMcpWsServer({ port: 3001 });
}
