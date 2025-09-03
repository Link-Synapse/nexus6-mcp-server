// C:\Users\STENCH\Documents\Projects\mcp-server\adapters\airtable.js
// Node 20+ (ESM).
// Airtable = source of truth. Prefers table ID when available.
// Tolerant formula fallback + single-select choice coercion for 'status' and 'doctype' (case-insensitive).
// Approved filter matches regardless of case via LOWER({status})='approved'.

import fs from "fs/promises";
import path from "path";

/* ----------------------------- helpers ----------------------------- */

async function loadJson(p) {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw);
}

async function loadAirCfg() {
  const p = path.resolve("config/airtable.json");
  const cfg = await loadJson(p);
  if (!cfg.api_key || !cfg.base_id || !cfg.tables) {
    throw new Error("airtable.json missing api_key/base_id/tables");
  }
  return cfg;
}

async function loadProjectsCfg() {
  const p = path.resolve("config/projects.json");
  const cfg = await loadJson(p).catch(() => ({ projects: [] }));
  const projects = Array.isArray(cfg.projects)
    ? cfg.projects.map((x) => (typeof x === "string" ? x : x?.slug)).filter(Boolean)
    : [];
  return projects;
}

function tableKey(tables) {
  return tables.docs_id || tables.docs || "Docs";
}

function hdrs(PAT) {
  return {
    Authorization: `Bearer ${PAT}`,
    "Content-Type": "application/json",
  };
}

function enc(s) { return encodeURIComponent(s); }
function norm(s){ return String(s || ""); }
function lower(s){ return norm(s).toLowerCase(); }

function escStr(v) {
  // Escape single quotes for Airtable formula single-quoted strings
  return String(v).replace(/'/g, "\\'");
}

function filterFormulaByProject(project) {
  return `{project}='${escStr(project)}'`;
}

function filterFormulaByProjectAndSlug(project, slug) {
  return `AND({project}='${escStr(project)}', {slug}='${escStr(slug)}')`;
}

async function fetchJson(url, init) {
  const r = await fetch(url, init);
  const txt = await r.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = { raw: txt }; }
  if (!r.ok) {
    const err = new Error(`Airtable HTTP ${r.status}`);
    err.status = r.status;
    err.body = body;
    err.url = url;
    throw err;
  }
  return body;
}

function isFormulaParserError(e) {
  const msg = JSON.stringify(e?.body || {});
  return (
    /expected to find a '\}' to match the '\{' token/i.test(msg) ||
    /INVALID_FILTER_BY_FORMULA/i.test(msg) ||
    /invalid formula/i.test(msg)
  );
}

async function listAllRecords({ base, table, PAT, fields = [] }) {
  const baseUrl = `https://api.airtable.com/v0/${base}/${enc(table)}`;
  const headers = hdrs(PAT);
  let out = [];
  let offset;

  do {
    const url =
      `${baseUrl}?pageSize=100` +
      (offset ? `&offset=${offset}` : "") +
      (fields.length ? `&fields[]=${fields.map(enc).join("&fields[]=")}` : "");
    const j = await fetchJson(url, { headers });
    const rows = Array.isArray(j.records) ? j.records : [];
    out.push(...rows);
    offset = j.offset;
  } while (offset);

  return out;
}

/* ---- single-select choice coercion (doctype/status), cached per base/table/field --- */

const choiceCache = new Map(); // key: `${base}/${table}/${fieldLower}` -> Map(lower->actualName)

async function getChoiceMap({ base, table, PAT, fieldName }) {
  const fieldLower = lower(fieldName);
  const key = `${base}/${table}/${fieldLower}`;
  if (choiceCache.has(key)) return choiceCache.get(key);

  const headers = { Authorization: `Bearer ${PAT}` };
  const metaUrl = `https://api.airtable.com/v0/meta/bases/${base}/tables`;
  const meta = await fetchJson(metaUrl, { headers });
  const tables = Array.isArray(meta?.tables) ? meta.tables : (meta?.body?.tables || []);
  const t = tables.find(t => t.id === table || t.name === table);
  const map = new Map();

  if (t && Array.isArray(t.fields)) {
    const fld = t.fields.find(f => lower(f.name) === fieldLower && f.type === "singleSelect");
    if (fld && Array.isArray(fld.options?.choices)) {
      for (const c of fld.options.choices) {
        map.set(lower(c.name), c.name);
      }
    }
  }

  choiceCache.set(key, map);
  return map;
}

async function coerceSelectValue({ base, table, PAT, fieldName, value }) {
  const map = await getChoiceMap({ base, table, PAT, fieldName });
  const canon = map.get(lower(value));
  return canon || value; // fall back to as-provided
}

/* ------------------------------ exports ---------------------------- */

export async function listProjects() {
  return await loadProjectsCfg();
}

export async function listDocs(project) {
  if (!project) throw new Error("listDocs requires 'project'");
  const cfg = await loadAirCfg();
  const table = tableKey(cfg.tables);
  const base = cfg.base_id;
  const PAT = cfg.api_key;
  const baseUrl = `https://api.airtable.com/v0/${base}/${enc(table)}`;
  const headers = hdrs(PAT);

  const formula = filterFormulaByProject(project);
  const firstUrl = `${baseUrl}?filterByFormula=${enc(formula)}&pageSize=100`;

  try {
    let out = [];
    let nextUrl = firstUrl;
    while (true) {
      const j = await fetchJson(nextUrl, { headers });
      const rows = Array.isArray(j.records) ? j.records : [];
      out.push(...rows.map((r) => r.fields));
      if (!j.offset) break;
      nextUrl = `${baseUrl}?filterByFormula=${enc(formula)}&pageSize=100&offset=${j.offset}`;
    }
    return out;
  } catch (e) {
    if (!isFormulaParserError(e)) throw e;
    const all = await listAllRecords({ base, table, PAT });
    return all.map((r) => r.fields).filter((f) => f?.project === project);
  }
}

export async function readDoc({ project, slug }) {
  if (!project || !slug) throw new Error("readDoc requires 'project' and 'slug'");
  const cfg = await loadAirCfg();
  const table = tableKey(cfg.tables);
  const base = cfg.base_id;
  const PAT = cfg.api_key;
  const baseUrl = `https://api.airtable.com/v0/${base}/${enc(table)}`;
  const headers = hdrs(PAT);

  const formula = filterFormulaByProjectAndSlug(project, slug);
  const url = `${baseUrl}?filterByFormula=${enc(formula)}&maxRecords=1`;

  try {
    const j = await fetchJson(url, { headers });
    const rec = j.records?.[0];
    if (!rec) return null;
    return { id: rec.id, fields: rec.fields };
  } catch (e) {
    if (!isFormulaParserError(e)) throw e;
    const all = await listAllRecords({ base, table, PAT });
    const hit = all.find(
      (r) => r?.fields?.project === project && r?.fields?.slug === slug
    );
    return hit ? { id: hit.id, fields: hit.fields } : null;
  }
}

export async function writeDoc({ project, slug, name, doctype, status, content }) {
  if (!project || !slug) throw new Error("writeDoc requires 'project' and 'slug'");
  const cfg = await loadAirCfg();
  const table = tableKey(cfg.tables);
  const base = cfg.base_id;
  const PAT = cfg.api_key;
  const baseUrl = `https://api.airtable.com/v0/${base}/${enc(table)}`;
  const headers = hdrs(PAT);

  // Coerce both 'status' and 'doctype' to existing choices
  const coercedStatus  = await coerceSelectValue({ base, table, PAT, fieldName: "status",  value: status  });
  const coercedDoctype = await coerceSelectValue({ base, table, PAT, fieldName: "doctype", value: doctype });

  const fields = { project, slug, name, doctype: coercedDoctype, status: coercedStatus, content };

  const formula = filterFormulaByProjectAndSlug(project, slug);
  const findUrl = `${baseUrl}?filterByFormula=${enc(formula)}&maxRecords=1`;

  try {
    const found = await fetchJson(findUrl, { headers });
    const rec = found.records?.[0];

    if (rec) {
      const payload = JSON.stringify({ records: [{ id: rec.id, fields }] });
      const j = await fetchJson(baseUrl, { method: "PATCH", headers, body: payload });
      const updated = j.records?.[0];
      return { action: "updated", id: updated?.id || rec.id, fields };
    } else {
      const payload = JSON.stringify({ records: [{ fields }] });
      const j = await fetchJson(baseUrl, { method: "POST", headers, body: payload });
      const created = j.records?.[0];
      return { action: "created", id: created?.id, fields };
    }
  } catch (e) {
    if (!isFormulaParserError(e)) throw e;
    const all = await listAllRecords({ base, table, PAT });
    const hit = all.find(
      (r) => r?.fields?.project === project && r?.fields?.slug === slug
    );

    if (hit) {
      const payload = JSON.stringify({ records: [{ id: hit.id, fields }] });
      const j = await fetchJson(baseUrl, { method: "PATCH", headers, body: payload });
      const updated = j.records?.[0];
      return { action: "updated", id: updated?.id || hit.id, fields };
    } else {
      const payload = JSON.stringify({ records: [{ fields }] });
      const j = await fetchJson(baseUrl, { method: "POST", headers, body: payload });
      const created = j.records?.[0];
      return { action: "created", id: created?.id, fields };
    }
  }
}

export async function listApprovedDocs(project) {
  const cfg = await loadAirCfg();
  const table = tableKey(cfg.tables);
  const base = cfg.base_id;
  const PAT = cfg.api_key;
  const baseUrl = `https://api.airtable.com/v0/${base}/${enc(table)}`;
  const headers = hdrs(PAT);

  // Case-insensitive filter for status=approved
  const statusExpr = "LOWER({status})='approved'";
  const formula = project
    ? `AND(${filterFormulaByProject(project)}, ${statusExpr})`
    : statusExpr;
  const firstUrl = `${baseUrl}?filterByFormula=${enc(formula)}&pageSize=100`;

  try {
    let out = [];
    let nextUrl = firstUrl;
    while (true) {
      const j = await fetchJson(nextUrl, { headers });
      const rows = Array.isArray(j.records) ? j.records : [];
      out.push(...rows.map((r) => r.fields));
      if (!j.offset) break;
      nextUrl = `${baseUrl}?filterByFormula=${enc(formula)}&pageSize=100&offset=${j.offset}`;
    }
    return out;
  } catch (e) {
    if (!isFormulaParserError(e)) throw e;
    const all = await listAllRecords({ base, table, PAT });
    return all
      .map((r) => r.fields)
      .filter((f) => (!project || f?.project === project) && lower(f?.status) === "approved");
  }
}
