import { describe, it, expect } from "vitest";
import { normalizeAdsetSpecs, normalizeTargetingSearchQuery } from "./meta-graph.js";

describe("normalizeAdsetSpecs", () => {
  it("returns single spec from legacy adsetName + targeting", () => {
    const specs = normalizeAdsetSpecs({
      adsetName: "A",
      targeting: { geo_locations: { countries: ["LK"] }, age_min: 21, age_max: 55 },
    });
    expect(specs).toHaveLength(1);
    expect(specs[0].name).toBe("A");
    expect(specs[0].targeting.geo_locations.countries).toEqual(["LK"]);
  });

  it("maps adsets array up to 4", () => {
    const specs = normalizeAdsetSpecs({
      adsets: [
        { name: "S1", targeting: { geo_locations: { countries: ["US"] }, age_min: 25, age_max: 45 } },
        { name: "S2", targeting: { geo_locations: { countries: ["LK"] }, age_min: 21, age_max: 55 } },
      ],
    });
    expect(specs).toHaveLength(2);
    expect(specs[1].name).toBe("S2");
  });

  it("throws when more than 4 ad sets", () => {
    expect(() =>
      normalizeAdsetSpecs({
        adsets: [{ targeting: { geo_locations: { countries: ["LK"] } } }, {}, {}, {}, {}],
      })
    ).toThrow(/Maximum 4/);
  });
});

describe("normalizeTargetingSearchQuery", () => {
  it("strips wrapping quotes", () => {
    expect(normalizeTargetingSearchQuery('"Sri Lanka travel"')).toBe("Sri Lanka travel");
    expect(normalizeTargetingSearchQuery("'travel'")).toBe("travel");
  });
});
