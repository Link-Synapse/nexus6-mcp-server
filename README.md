# Nexus6 MCP Server — v1.1

Three‑way A2A console (you ⇄ Axlon ⇄ Claude/ChatGPT) with append‑only logs, plus ready handlers for **OpenAI (ChatGPT)** and **Anthropic (Claude)**.

- UI: http://localhost:3002/ui
- Health: http://localhost:3002/api/health
- SSE feed: /api/a2a/feed
- Send A2A: POST /api/a2a/send
- Send to ChatGPT: POST /api/chatgpt/send
- Send to Claude: POST /api/claude/send

> Phase 2 adds MCP (ws://localhost:3001) and Airtable/GitHub adapters.

## Setup

1) Install Node 20+ and Git.
2) Copy `.env.example` → `.env` and fill keys.
3) Install deps:
```powershell
npm install
```
4) Run:
```powershell
npm run start
# UI: http://localhost:3002/ui
```

## Quick tests (PowerShell)

```powershell
# A2A test
curl -X POST http://localhost:3002/api/a2a/send `
  -H "Content-Type: application/json" `
  -d '{"from":"Chaz","to":"Axlon","project":"nexus6","subject":"Ping","body":"Hello from PowerShell"}'

# ChatGPT test
curl -X POST http://localhost:3002/api/chatgpt/send `
  -H "Content-Type: application/json" `
  -d '{"from":"Chaz","body":"Say hi in 5 words.","project":"nexus6"}'

# Claude test
curl -X POST http://localhost:3002/api/claude/send `
  -H "Content-Type: application/json" `
  -d '{"from":"Chaz","body":"Respond with a short greeting.","project":"nexus6"}'
```

## Repo Structure

```
/nexus6-mcp-server/
 ├─ README.md
 ├─ .env.example
 ├─ package.json
 ├─ /server/server.js
 ├─ /ui/index.html
 ├─ /config/*.json (placeholders)
 ├─ /adapters/ (future: airtable.js, github.js)
 ├─ /logs/a2a.ndjson
 └─ /projects/{nexus6,link_synapse,wp_auto_poster}/STATE_LOG.md
```

## Notes
- Append‑only logs stored at `logs/a2a.ndjson`.
- Uses Node 20 `fetch` built‑in (no extra deps).
- Graceful error handling; messages always logged/broadcasted with timestamps.
