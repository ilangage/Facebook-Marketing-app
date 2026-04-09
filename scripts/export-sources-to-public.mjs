/**
 * Writes public/project-sources.json with repo source files as embedded strings.
 * Run: npm run export:sources
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

/** Full bot snapshot: UI, API, configs, legal pages, tests. */
const FILES = [
  "package.json",
  "package-lock.json",
  "index.html",
  "vite.config.js",
  "vercel.json",
  "vitest.config.js",
  "render.yaml",
  ".nvmrc",
  "src/main.js",
  "src/creative-meta-specs.js",
  "src/style.css",
  "src/counter.js",
  "src/assets/vite.svg",
  "src/assets/javascript.svg",
  "server/index.js",
  "server/env-bootstrap.js",
  "server/state.js",
  "server/engine-store.js",
  "server/meta-graph.js",
  "server/meta-creative-validate.js",
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
  "server/dashboard-extras.js",
  "server/db/sqlite.js",
  "server/meta-graph.test.js",
  "server/optimizer.test.js",
  "server/creative-score.test.js",
  "server/scaling-config.test.js",
  "server/webhook-verify.test.js",
  "server/meta-audience.test.js",
  "server/dashboard-extras.test.js",
  "scripts/export-sources-to-public.mjs",
  "public/privacy/index.html",
  "public/terms/index.html",
  "public/data-deletion/index.html",
  "docs/backend-blueprint.schema.json",
  "docs/backend-blueprint.md",
  "README.md",
  ".env.example",
];

async function main() {
  const files = {};
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    try {
      files[rel] = await fs.readFile(abs, "utf8");
    } catch (e) {
      console.warn(`skip ${rel}: ${e.message}`);
    }
  }

  const out = {
    document: "my-project-source-snapshot",
    version: "1.5.0",
    description_si:
      "Vite UI + Node API (travel-roi bot) — full source snapshot embedded for backup / portability.",
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
