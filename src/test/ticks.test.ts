import { describe, expect, it } from "vitest";

import { computeNiceTicks, formatTickLatex } from "../plot/ticks";

describe("formatTickLatex", () => {
  it("formats ordinary numeric ticks as plain LaTeX text", () => {
    expect(formatTickLatex(-1.5)).toBe("-1.5");
    expect(formatTickLatex(2)).toBe("2");
  });

  it("formats scientific-notation ticks as LaTeX powers of ten", () => {
    expect(formatTickLatex(0.0012)).toBe("1.2 \\times 10^{-3}");
    expect(formatTickLatex(12000)).toBe("1.2 \\times 10^{4}");
  });
});

describe("computeNiceTicks", () => {
  it("does not place ticks beyond non-integer bounds", () => {
    expect(computeNiceTicks(-2.5, 2.5, 8)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("still includes boundary ticks when they land exactly on the range edge", () => {
    expect(computeNiceTicks(0, 0.3, 7)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
  });
});
