import { describe, it, expect } from "vitest";
import { normalizeAndHashEmail } from "./meta-audience.js";

describe("meta-audience", () => {
  it("normalizes and hashes email deterministically", () => {
    const a = normalizeAndHashEmail(" Test@Example.COM ");
    const b = normalizeAndHashEmail("test@example.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
