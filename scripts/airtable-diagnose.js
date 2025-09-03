// scripts/airtable-diagnose.js (ESM, Node 20+)
import fs from "fs/promises";
import path from "path";

function mask(s = "") {
  if (!s) return "(missing)";
  return s.length <= 8 ? "****" + s.slice(-2) : s.slice(0, 2) + "****" + s.slice(-4);
}

async function loadConfig() {
  const p = path.resolve("config/airtable.json");
  const raw = await fs.readFile(p, "utf8");
  const cfg = JSON.parse(raw);
  if (!cfg.api_key || !cfg.base_id || !cfg.tables?.docs) {
    throw new Error(`config/airtable.json is missing required keys. Expect:
{
  "api_key": "...",
  "base_id": "...",
  "tables": { "docs": "Docs" }
}`);
  }
  return cfg;
}

async function fetchJson(url, headers) {
  const r = await fetch(url, { headers });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, ok: r.ok, body };
}

async function main() {
  const cfg = await loadConfig();
  const PAT = process.env.AIRTABLE_PAT || cfg.api_key;
  const BASE = process.env.AIRTABLE_BASE || cfg.base_id;
  const TABLE = process.env.AIRTABLE_TABLE || cfg.tables.docs;

  console.log("== Airtable Diagnose ==");
  console.log("Base ID :", BASE);
  console.log("Table   :", TABLE);
  console.log("PAT     :", mask(PAT));

  const headers = { Authorization: `Bearer ${PAT}` };

  // 1) Check Meta API (requires schema.bases:read AND base access)
  const metaUrl = `https://api.airtable.com/v0/meta/bases/${BASE}/tables`;
  const meta = await fetchJson(metaUrl, headers);
  console.log("\n[Meta] GET", metaUrl);
  console.log("Status :", meta.status);
  if (!meta.ok) {
    console.log("Body   :", JSON.stringify(meta.body));
    if (meta.status === 403) {
      console.log("\n❌ 403 on Meta API. Likely causes:");
      console.log("  • PAT missing 'schema.bases:read' scope");
      console.log("  • PAT's user does not have access to this Base ID");
      console.log("  • Base ID is wrong");
    } else if (meta.status === 404) {
      console.log("\n❌ 404 on Meta API. Likely wrong Base ID.");
    }
    process.exit(2);
  } else {
    const names = (meta.body?.tables || []).map(t => t.name);
    console.log("Tables :", names);
    if (!names.includes(TABLE)) {
      console.log(`\n⚠️ Table '${TABLE}' not found in base. Did you name it one of: ${names.join(", ")} ?`);
    } else {
      console.log("✓ Meta API confirms table exists.");
    }
  }

  // 2) Check Data API list (requires data.records:read AND base access)
  const listUrl = `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}?maxRecords=1`;
  const list = await fetchJson(listUrl, headers);
  console.log("\n[Data] GET", listUrl);
  console.log("Status :", list.status);
  if (!list.ok) {
    console.log("Body   :", JSON.stringify(list.body));
    if (list.status === 403) {
      console.log("\n❌ 403 on Data API. Likely causes:");
      console.log("  • PAT missing 'data.records:read' scope");
      console.log("  • PAT's user does not have access to this Base/Table");
      console.log("  • Table name mismatch (must be EXACT, e.g., 'Docs')");
    } else if (list.status === 404) {
      console.log("\n❌ 404 on Data API. Likely wrong Base ID or table name.");
    }
    process.exit(3);
  } else {
    console.log("✓ Data API read is OK.");
    console.log("Sample:", JSON.stringify(list.body?.records?.[0]?.fields || {}, null, 2));
  }

  console.log("\nAll read checks passed. If writes still 403, ensure PAT also has 'data.records:write' and try again.");
}

main().catch((e) => {
  console.error("Diagnose failed:", e.message);
  process.exit(1);
});
