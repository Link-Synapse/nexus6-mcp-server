// C:\Users\STENCH\Documents\Projects\mcp-server\scripts\airtable-assert-schema.js
// Node 20+ (ESM). Verifies the Docs table fields & select options using Meta API (case-insensitive).

import fs from "fs/promises";
import path from "path";

function fatal(msg, code=1) { console.error(msg); process.exit(code); }

async function loadCfg() {
  const p = path.resolve("config/airtable.json");
  const raw = await fs.readFile(p, "utf8");
  const cfg = JSON.parse(raw);
  if (!cfg.api_key || !cfg.base_id || !cfg.tables) {
    fatal("config/airtable.json missing api_key/base_id/tables");
  }
  return cfg;
}

async function fetchJson(url, headers) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, ok: r.ok, body };
}

function wantField(name, type, opts=null) { return { name, type, opts }; }

const REQUIRED = [
  wantField("slug", "singleLineText"),
  wantField("project", "singleLineText"),
  wantField("name", "singleLineText"),
  wantField("doctype", "singleSelect", { choices: ["md","txt","json"] }),
  // status accepts any case; we only require these three values (case-insensitive)
  wantField("status", "singleSelect", { choices: ["draft","ready","approved"] }),
  wantField("content", "multilineText"),
];

function norm(s){ return String(s || "").trim(); }
function lower(s){ return norm(s).toLowerCase(); }

function compareChoicesCaseInsensitive(haveChoices, wantChoices){
  const have = new Set((haveChoices||[]).map(c => lower(c.name)));
  const want = (wantChoices||[]).map(lower);
  const missing = want.filter(w => !have.has(w));
  return { missing, extra: [] };
}

async function main(){
  const cfg = await loadCfg();
  const PAT = cfg.api_key;
  const BASE = cfg.base_id;
  const TABLE_ID = cfg.tables.docs_id || null;
  const TABLE_NAME = cfg.tables.docs || null;
  if (!TABLE_ID && !TABLE_NAME) fatal("tables.docs_id or tables.docs must be set in config/airtable.json");

  const headers = { Authorization: `Bearer ${PAT}` };
  const metaUrl = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
  const meta = await fetchJson(metaUrl, headers);
  if (!meta.ok) fatal(`[Meta] ${meta.status} ${JSON.stringify(meta.body)}`);

  const tables = Array.isArray(meta.body?.tables) ? meta.body.tables : [];
  const table = tables.find(t => (TABLE_ID && t.id === TABLE_ID) || (!TABLE_ID && t.name === TABLE_NAME));
  if (!table) {
    const list = tables.map(t => `${t.name} (${t.id})`).join(", ");
    fatal(`Docs table not found. Config key=${TABLE_ID || TABLE_NAME}. In base: ${list}`);
  }

  const fields = table.fields || [];
  const byName = new Map(fields.map(f => [lower(f.name), f]));
  const problems = [];

  // Primary field should be slug
  const primary = fields.find(f => f.id === table.primaryFieldId);
  if (!primary || lower(primary.name) !== "slug") {
    problems.push(`Primary field must be 'slug' (currently: '${primary?.name || "unknown"}')`);
  }

  for (const req of REQUIRED) {
    const have = byName.get(lower(req.name));
    if (!have) { problems.push(`Missing field: ${req.name} (${req.type})`); continue; }

    const haveType = have.type; // e.g., 'singleLineText', 'singleSelect', 'multilineText'
    if (haveType !== req.type) problems.push(`Field '${req.name}' type mismatch: want ${req.type}, have ${haveType}`);

    if (req.type === "singleSelect") {
      const cmp = compareChoicesCaseInsensitive(have.options?.choices, req.opts?.choices);
      if (cmp.missing.length) problems.push(`Field '${req.name}' missing choices (case-insensitive): ${cmp.missing.join(", ")}`);
    }
  }

  if (problems.length) {
    console.log("❌ Schema check failed:");
    for (const p of problems) console.log(" - " + p);
    console.log("\nFix in Airtable, then re-run this script.");
    process.exit(2);
  }

  console.log("✅ Schema check passed for table:", `${table.name} (${table.id})`);
  console.log("Fields:", fields.map(f => `${f.name}:${f.type}${f.id===table.primaryFieldId?"*":""}`).join(", "));
}

main().catch(e => fatal("Schema assert error: " + (e?.message || e)));
