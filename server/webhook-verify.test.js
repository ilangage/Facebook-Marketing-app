import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifyCrmWebhookSignature } from "./webhook-verify.js";

describe("webhook-verify", () => {
  it("accepts when secret is empty", () => {
    expect(verifyCrmWebhookSignature("", "", "")).toBe(true);
  });

  it("validates HMAC signature", () => {
    const secret = "secret";
    const raw = '{"a":1}';
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    expect(verifyCrmWebhookSignature(raw, sig, secret)).toBe(true);
    expect(verifyCrmWebhookSignature(raw, "sha256=deadbeef", secret)).toBe(false);
  });
});
