import crypto from "node:crypto";

/**
 * Optional HMAC-SHA256 for CRM webhooks.
 * Header: X-Webhook-Signature: sha256=<hex>
 */
export function verifyCrmWebhookSignature(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  if (!signatureHeader || typeof signatureHeader !== "string") return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const got = signatureHeader.slice(prefix.length);
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
