import { describe, expect, it } from "vitest";

import {
  computeNiceTickLayout,
  computeNiceTicks,
  formatTick,
  formatTickLatex
} from "../plot/ticks";

describe("formatTickLatex", () => {
  it("formats ordinary numeric ticks as plain LaTeX text", () => {
    expect(formatTickLatex(-1.5)).toBe("-1.5");
    expect(formatTickLatex(2)).toBe("2");
  });

  it("formats scientific-notation ticks as LaTeX powers of ten", () => {
    expect(formatTickLatex(0.0012)).toBe("1.2 \\times 10^{-3}");
    expect(formatTickLatex(12000)).toBe("1.2 \\times 10^{4}");
  });

  it("uses the major step to distinguish labels in narrow windows", () => {
    expect(formatTickLatex(1, 0.000001)).toBe("1");
    expect(formatTickLatex(1.000001, 0.000001)).toBe("1.000001");
    expect(formatTickLatex(1000, 0.001)).toBe("1 \\times 10^{3}");
    expect(formatTickLatex(1000.001, 0.001)).toBe("1.000001 \\times 10^{3}");
  });

  it("keeps adjacent ordinary floating-point values distinguishable", () => {
    const left = 0.1;
    const right = 0.10000000000000002;
    const step = right - left;

    expect(formatTick(left, step)).toBe("0.1");
    expect(formatTick(right, step)).toBe("0.10000000000000002");
    expect(formatTickLatex(left, step)).toBe("0.1");
    expect(formatTickLatex(right, step)).toBe("0.10000000000000002");
  });
});

describe("computeNiceTicks", () => {
  it("does not place ticks beyond non-integer bounds", () => {
    expect(computeNiceTicks(-2.5, 2.5, 8)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("still includes boundary ticks when they land exactly on the range edge", () => {
    expect(computeNiceTicks(0, 0.3, 7)).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
  });

  it("uses representable steps for narrow windows at very large offsets", () => {
    const layout = computeNiceTickLayout(1e16, 1e16 + 2);

    expect(layout.majorStep).toBe(2);
    expect(layout.major).toEqual([1e16, 1e16 + 2]);
    expect(layout.minor).toEqual([]);
  });

  it("preserves distinct ticks in a sub-picosecond window at an ordinary offset", () => {
    const layout = computeNiceTickLayout(1, 1 + 1e-13);

    expect(layout.majorStep).toBe(2e-14);
    expect(layout.major).toEqual([
      1,
      1.00000000000002,
      1.00000000000004,
      1.00000000000006,
      1.00000000000008,
      1.0000000000001
    ]);
    expect(layout.major.every((tick, index) => index === 0 || tick > layout.major[index - 1])).toBe(
      true
    );
  });

  it("preserves the smallest representable finite span", () => {
    const min = Number.MIN_VALUE;
    const max = min * 2;
    const layout = computeNiceTickLayout(min, max);

    expect(layout.majorStep).toBe(Number.MIN_VALUE);
    expect(layout.major).toEqual([min, max]);
  });

  it("generates finite ticks when the lower-bound tolerance would overflow", () => {
    const min = -Number.MAX_VALUE;
    const max = -1e308;
    const layout = computeNiceTickLayout(min, max, 12, 5);

    expect(layout.majorStep).toBe(1e307);
    expect(layout.major).toHaveLength(8);
    expect(layout.major[0]).toBe(-1.7e308);
    expect(layout.major.at(-1)).toBe(max);
    expect([...layout.major, ...layout.minor].every(Number.isFinite)).toBe(true);
    expect([...layout.major, ...layout.minor].every((tick) => tick >= min && tick <= max)).toBe(
      true
    );
  });

  it("bounds pathological tick requests", () => {
    const ticks = computeNiceTickLayout(0, 1, 1e12, 1).major;

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(10_000);
  });
});

describe("computeNiceTickLayout", () => {
  it("builds five subintervals per major interval without overlapping ticks", () => {
    const layout = computeNiceTickLayout(-6, 6, 12, 5);

    expect(layout.majorStep).toBe(1);
    expect(layout.major).toEqual([
      -6,
      -5,
      -4,
      -3,
      -2,
      -1,
      0,
      1,
      2,
      3,
      4,
      5,
      6
    ]);
    expect(layout.minor.filter((tick) => tick > -6 && tick < -5)).toEqual([
      -5.8,
      -5.6,
      -5.4,
      -5.2
    ]);
    expect(layout.minor).toContain(5.8);
    expect(layout.minor).not.toContain(0);
    expect(layout.minor.every((tick) => tick >= -6 && tick <= 6)).toBe(true);
  });

  it("keeps a narrow large-offset grid inside its bounds", () => {
    const min = 1e12;
    const max = min + 6;
    const layout = computeNiceTickLayout(min, max, 6, 5);

    expect(layout.majorStep).toBe(1);
    expect(layout.major).toHaveLength(7);
    expect(layout.minor).toHaveLength(24);
    expect(layout.major[0]).toBe(min);
    expect(layout.major.at(-1)).toBe(max);
    expect([...layout.major, ...layout.minor].every((tick) => tick >= min && tick <= max)).toBe(
      true
    );
  });
});
