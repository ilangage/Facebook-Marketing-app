/**
 * Must be imported first from server/index.js so .env is applied before other modules read process.env.
 * dotenv default does not override existing env vars — a stale META_ACCESS_TOKEN in your shell wins over .env.
 * In non-production we override so the token saved in .env is always what the API uses locally.
 */
import crypto from "node:crypto";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");
const isProd = process.env.NODE_ENV === "production";

const result = dotenv.config({
  path: envPath,
  override: !isProd,
});

if (!isProd) {
  if (result.error) {
    console.warn(`[env] No .env at ${envPath} (${result.error.message})`);
  } else {
    console.log(`[env] Loaded ${envPath} (override shell=${!isProd})`);
  }
  const t = (process.env.META_ACCESS_TOKEN || "").trim();
  if (t) {
    const fp = crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);
    console.log(`[env] META_ACCESS_TOKEN fingerprint: ${fp}`);
  } else {
    console.warn("[env] META_ACCESS_TOKEN is empty after load");
  }
}
