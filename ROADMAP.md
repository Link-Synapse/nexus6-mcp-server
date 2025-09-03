# Nexus6 MCP Server — ROADMAP (v1.x)

Owner: Axlon (lead)  
Repo: `Link-Synapse/nexus6-mcp-server`  
Last updated: 2025-09-03

---

## 0) Current Status (v1.1 MVP)
- ✅ A2A Chat UI (`/ui`) with live SSE feed
- ✅ Handlers: **OpenAI (ChatGPT)** and **Anthropic (Claude)**
- ✅ **Model Picker** (per-request override with whitelists)
- ✅ Append-only A2A log at `logs/a2a.ndjson`
- ✅ Project scaffolding (`projects/*/STATE_LOG.md`, prompts, config)
- ✅ Hygiene: `.gitignore`, `.editorconfig`, `.gitattributes`, `.env.example`

**Usage:** `npm run start` → http://localhost:3002/ui

---

## 1) Phase 2 — MCP Transport & Auth
### 2.0 — MCP Scaffold (ws://localhost:3001)
- Implement JSON-RPC over WebSocket for MCP tools:
  - `mcp.message({ from, to, body, project? }) -> { id }`
  - `mcp.list_docs({ project }) -> { docs }`
  - `mcp.read_doc({ project, slug }) -> { doc }`
  - `mcp.write_doc({ project, slug, name, content, doctype }) -> { id }`
  - `mcp.sync_repo({ project, slug }) -> { sha }`
- Ship `mcp.manifest.json` with tool schemas and examples.
- **Acceptance:** Claude Desktop connects; tools discoverable and callable.

### 2.1 — API Auth (Bearer Token)
- Add `N6_API_TOKEN` to `.env`.
- Middleware: require header `Authorization: Bearer <token>` for `/api/*`.
- **Acceptance:** Requests without token return `401`.

### 2.2 — Token Usage & Balance Endpoints
- `/api/usage/openai` and `/api/usage/anthropic` (best effort via headers/responses).
- Track estimated token usage per request into `logs/usage.ndjson`.
- UI badges: show last call’s model + approx tokens.

---

## 2) Phase 3 — Adapters (Airtable ↔ GitHub)
### 3.0 — Airtable Adapter
- Config: `config/airtable.json` + `.env` keys.
- Implement functions:
  - `listDocs()`, `readDoc(slug)`, `writeDoc(doc)`
- Add server endpoints for testing (`/api/airtable/*`).  
- **Acceptance:** Can round-trip a doc from UI to Airtable.

### 3.1 — GitHub Sync Adapter
- Config: `config/github.json` + `.env` token.
- Implement `pushDoc(project, slug)` → commits to `docs/` in repo.
- Implement `listRepoDocs()` / `readRepoDoc(slug)` for pull.
- **Acceptance:** Change approved doc → push returns commit SHA.

### 3.2 — Guardrails
- Enforce **append-only** `STATE_LOG.md` writes.
- Require `Status=approved` to push (server-side check).

---

## 3) Phase 4 — UX & Reliability
### 4.0 — Chat UI Enhancements
- Keyboard: **Ctrl+Enter** = send; **Shift+Enter** = newline.
- Per-project filters, quick recipient chips.
- Persist chosen model per recipient (localStorage).

### 4.1 — Observability
- `/api/health` extended: versions, adapter status, last error.
- `logs/audit.ndjson`: API calls (method, status, ms, model).

### 4.2 — Error Handling & Retries
- Exponential backoff for provider 429/5xx.
- Graceful UI toasts with last error reason.

---

## 4) Phase 5 — Packaging & Deployment
- `npm run package` → produces `dist/` zip with pinned deps.
- Optional Dockerfile (Windows-friendly).
- Optional nssm/winsw service for Windows auto-start.

---

## 5) Security & Secrets
- `.env` stays local; NEVER commit.
- Consider `.env.local` variants per machine.
- Optional Vault/KMS later (n8n or local wrapper).

---

## 6) Milestones & Acceptance Checklist
- [ ] **2.0** MCP WS live; Claude Desktop tools visible/callable
- [ ] **2.1** Bearer auth enforced on `/api/*`
- [ ] **2.2** Usage endpoints working; logs/usage.ndjson populates
- [ ] **3.0** Airtable round-trip working
- [ ] **3.1** GitHub push/pull working with commit SHA
- [ ] **3.2** Guardrails enforced (`STATE_LOG.md` append-only, Status=approved)
- [ ] **4.0** UI quality-of-life shipped
- [ ] **4.1** Health & audit logs in place
- [ ] **5.x** Packaging + (optional) Windows service

---

## 7) Commands & Snippets
**Run:**
```powershell
npm install
npm run start
```

**Set bearer token (future):**
```
N6_API_TOKEN=your-long-random-token
```

**Test (future):**
```powershell
# Requires Authorization header once auth is enabled
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3002/api/health
```

---

## 8) Notes
- Models can be changed per-request via the UI picker.
- Costs: prefer `gpt-4o-mini` and `claude-3.5-haiku` for utility work; use `gpt-4o` and `claude-3.5-sonnet` for coding/reasoning.
- Keep an eye on credits during early testing.
