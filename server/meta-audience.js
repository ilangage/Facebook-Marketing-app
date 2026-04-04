/**
 * Meta Custom Audiences — create audience + upload hashed identifiers.
 * Requires ads_management + audience permissions on the token.
 */
import crypto from "node:crypto";
import { graphPostForm, getMetaConfig } from "./meta-graph.js";

export function normalizeAndHashEmail(email) {
  const e = String(email || "")
    .trim()
    .toLowerCase();
  return crypto.createHash("sha256").update(e, "utf8").digest("hex");
}

/**
 * Create a CUSTOM audience owned by the ad account.
 */
export async function createCustomAudience(name) {
  const c = getMetaConfig();
  return graphPostForm(`/${c.adAccountId}/customaudiences`, {
    name: name || "Travel Audience",
    subtype: "CUSTOM",
    customer_file_source: "USER_PROVIDED_ONLY",
  });
}

/**
 * Add rows of EMAIL hashes (or plain emails — hashed server-side).
 * @param {string} audienceId — Graph custom audience id
 * @param {string[]} emailsOrHexHashes — plain emails or 64-char hex SHA256
 */
export async function addUsersToCustomAudience(audienceId, emailsOrHexHashes) {
  if (!audienceId) throw new Error("audienceId is required");
  const rows = Array.isArray(emailsOrHexHashes) ? emailsOrHexHashes : [];
  const schema = ["EMAIL"];
  const data = rows.map((x) => {
    const s = String(x || "").trim();
    if (/^[0-9a-f]{64}$/i.test(s)) {
      return [s.toLowerCase()];
    }
    return [normalizeAndHashEmail(s)];
  });
  const payload = { schema, data };
  return graphPostForm(`/${audienceId}/users`, {
    payload,
  });
}
