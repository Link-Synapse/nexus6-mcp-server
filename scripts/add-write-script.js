// C:\Users\STENCH\Documents\Projects\mcp-server\scripts\add-write-script.js
// Node 20+ — Adds "test:ws:write" to package.json if missing.
import fs from "fs";
import path from "path";

const pkgPath = path.resolve("package.json");
const raw = fs.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);

pkg.scripts = pkg.scripts || {};
pkg.scripts["test:ws"] = pkg.scripts["test:ws"] || "node scripts/test-ws.js";
pkg.scripts["test:ws:write"] = "node scripts/test-ws-write.js";

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
console.log('✅ Added scripts: "test:ws" and "test:ws:write" to package.json');
