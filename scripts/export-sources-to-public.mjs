/**
 * Writes public/project-sources.json with repo source files as embedded strings.
 * Run: node scripts/export-sources-to-public.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const GLOBS = [
  "package.json",
  "index.html",
  "src/main.js",
  "src/style.css",
  "server/index.js",
  "server/state.js",
  "server/engine-store.js",
  "server/meta-graph.js",
  "server/targeting-catalog.js",
  "server/meta-audience.js",
  "server/meta-capi.js",
  "server/loop-engine.js",
  "server/orchestrator.js",
  "server/insights-sync.js",
  "server/policy.js",
  "server/scheduler.js",
  "server/scaling-config.js",
  "server/rate-limit.js",
  "server/webhook-verify.js",
  "server/ad-preview.js",
  "server/content-templates.js",
  "server/creative-score.js",
  "server/db/sqlite.js",
];

async function main() {
  const files = {};
  for (const rel of GLOBS) {
    const abs = path.join(ROOT, rel);
    try {
      files[rel] = await fs.readFile(abs, "utf8");
    } catch (e) {
      console.warn(`skip ${rel}: ${e.message}`);
    }
  }

  const out = {
    document: "my-project-source-snapshot",
    version: "1.0.1",
    description_si:
      "Vite UI + Node API (travel-roi bot) — source files embedded for backup / portability.",
    generatedAt: new Date().toISOString(),
    repo: files,
  };

  const dest = path.join(ROOT, "public", "project-sources.json");
  await fs.writeFile(dest, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${Object.keys(files).length} files → ${path.relative(ROOT, dest)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
