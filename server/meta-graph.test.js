import { describe, it, expect, afterEach } from "vitest";
import { majorCurrencyToMinorUnits, mergePlacementIntoTargeting } from "./meta-graph.js";
import { validateAdCopyForLinkCreative } from "./meta-creative-validate.js";

describe("meta-graph", () => {
  const prev = process.env.META_CURRENCY_MINOR_EXPONENT;
  const prevPreset = process.env.META_PLACEMENT_PRESET;
  const prevJson = process.env.META_PLACEMENT_TARGETING_JSON;

  afterEach(() => {
    if (prev === undefined) delete process.env.META_CURRENCY_MINOR_EXPONENT;
    else process.env.META_CURRENCY_MINOR_EXPONENT = prev;
    if (prevPreset === undefined) delete process.env.META_PLACEMENT_PRESET;
    else process.env.META_PLACEMENT_PRESET = prevPreset;
    if (prevJson === undefined) delete process.env.META_PLACEMENT_TARGETING_JSON;
    else process.env.META_PLACEMENT_TARGETING_JSON = prevJson;
  });

  it("converts USD-style major to minor (cents)", () => {
    process.env.META_CURRENCY_MINOR_EXPONENT = "2";
    expect(majorCurrencyToMinorUnits(20)).toBe(2000);
    expect(majorCurrencyToMinorUnits(0.5)).toBe(100);
  });

  it("supports zero-decimal currency", () => {
    process.env.META_CURRENCY_MINOR_EXPONENT = "0";
    expect(majorCurrencyToMinorUnits(5000)).toBe(5000);
  });

  it("mergePlacementIntoTargeting adds fb_ig_mobile keys when missing", () => {
    delete process.env.META_PLACEMENT_TARGETING_JSON;
    process.env.META_PLACEMENT_PRESET = "fb_ig_mobile";
    const t = { geo_locations: { countries: ["US"] } };
    const out = mergePlacementIntoTargeting(t, {});
    expect(out.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(out.device_platforms).toEqual(["mobile"]);
    expect(out.geo_locations).toEqual({ countries: ["US"] });
  });

  it("mergePlacementIntoTargeting skips when preset auto", () => {
    delete process.env.META_PLACEMENT_TARGETING_JSON;
    process.env.META_PLACEMENT_PRESET = "auto";
    const out = mergePlacementIntoTargeting({ geo_locations: { countries: ["US"] } }, {});
    expect(out.publisher_platforms).toBeUndefined();
  });

  it("mergePlacementIntoTargeting respects skipPlacementMerge", () => {
    delete process.env.META_PLACEMENT_TARGETING_JSON;
    process.env.META_PLACEMENT_PRESET = "fb_ig_mobile";
    const out = mergePlacementIntoTargeting(
      { geo_locations: { countries: ["US"] } },
      { skipPlacementMerge: true }
    );
    expect(out.publisher_platforms).toBeUndefined();
  });

  it("mergePlacementIntoTargeting uses placementTargeting body", () => {
    const out = mergePlacementIntoTargeting(
      { geo_locations: { countries: ["US"] } },
      { placementTargeting: { publisher_platforms: ["facebook"] } }
    );
    expect(out.publisher_platforms).toEqual(["facebook"]);
  });
});

describe("meta-creative-validate", () => {
  const prevSkip = process.env.META_SKIP_CREATIVE_COPY_VALIDATION;

  afterEach(() => {
    if (prevSkip === undefined) delete process.env.META_SKIP_CREATIVE_COPY_VALIDATION;
    else process.env.META_SKIP_CREATIVE_COPY_VALIDATION = prevSkip;
  });

  it("validateAdCopyForLinkCreative throws when headline too long", () => {
    expect(() =>
      validateAdCopyForLinkCreative({
        message: "ok",
        headline: "a".repeat(41),
        description: "ok",
      })
    ).toThrow(/headline/);
  });

  it("validateAdCopyForLinkCreative skipped when env set", () => {
    process.env.META_SKIP_CREATIVE_COPY_VALIDATION = "true";
    expect(() =>
      validateAdCopyForLinkCreative({
        message: "ok",
        headline: "a".repeat(200),
        description: "ok",
      })
    ).not.toThrow();
  });
});
