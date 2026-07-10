import { describe, expect, it } from "vitest";

import { findEquilibria } from "../math/equilibria";
import { compileExpression } from "../math/parser";

const bounds = {
  tMin: -2,
  tMax: 2,
  yMin: -2,
  yMax: 2
};

describe("findEquilibria", () => {
  it("finds roots for autonomous equations in the visible range", () => {
    const expression = compileExpression("y * (1 - y)");
    const result = findEquilibria(expression, bounds);

    expect(result.mode).toBe("roots");
    expect(result.levels).toHaveLength(2);
    expect(result.levels[0]).toBeCloseTo(0, 3);
    expect(result.levels[1]).toBeCloseTo(1, 3);
  });

  it("skips fixed-point detection for non-autonomous equations", () => {
    const expression = compileExpression("t - y");
    const result = findEquilibria(expression, bounds);

    expect(result.mode).toBe("not-autonomous");
    expect(result.levels).toHaveLength(0);
  });

  it("recognizes the identically zero equation", () => {
    const expression = compileExpression("0");
    const result = findEquilibria(expression, bounds);

    expect(result.mode).toBe("all");
  });

  it("does not treat a small nonzero constant as identically zero", () => {
    const result = findEquilibria(compileExpression("1e-9"), bounds);

    expect(result.mode).toBe("none");
    expect(result.levels).toEqual([]);
    expect(result.intervals).toEqual([]);
  });

  it("recognizes zero identities that still mention y", () => {
    expect(findEquilibria(compileExpression("y - y"), bounds).mode).toBe("all");
    expect(findEquilibria(compileExpression("0 * y"), bounds).mode).toBe("all");
    expect(findEquilibria(compileExpression("t - t"), bounds).mode).toBe("all");

    const canceledTimeTerm = findEquilibria(compileExpression("0 * t + y"), bounds);
    expect(canceledTimeTerm.mode).toBe("roots");
    expect(canceledTimeTerm.levels).toHaveLength(1);
    expect(canceledTimeTerm.levels[0]).toBeCloseTo(0, 8);

    expect(findEquilibria(compileExpression("0 / t"), bounds).mode).toBe(
      "not-autonomous"
    );
  });

  it("never reports poles as equilibrium levels", () => {
    const tangent = findEquilibria(compileExpression("tan(y)"), bounds);
    const simplePole = findEquilibria(compileExpression("1 / (y - 0.123)"), bounds);
    const evenPole = findEquilibria(compileExpression("1 / (y - 0.123)^2"), bounds);

    expect(tangent.mode).toBe("roots");
    expect(tangent.levels).toHaveLength(1);
    expect(tangent.levels[0]).toBeCloseTo(0, 8);
    expect(tangent.levels).not.toContainEqual(expect.closeTo(Math.PI / 2, 4));
    expect(tangent.levels).not.toContainEqual(expect.closeTo(-Math.PI / 2, 4));
    expect(simplePole.mode).toBe("none");
    expect(evenPole.mode).toBe("none");
  });

  it("refines even-multiplicity roots across very different function scales", () => {
    const largeScale = findEquilibria(
      compileExpression("1e12 * (y - 0.12345)^2"),
      bounds
    );
    const smallScale = findEquilibria(
      compileExpression("1e-12 * (y + 0.54321)^2"),
      bounds
    );

    expect(largeScale.mode).toBe("roots");
    expect(largeScale.levels).toHaveLength(1);
    expect(largeScale.levels[0]).toBeCloseTo(0.12345, 8);
    expect(smallScale.mode).toBe("roots");
    expect(smallScale.levels).toHaveLength(1);
    expect(smallScale.levels[0]).toBeCloseTo(-0.54321, 8);
  });

  it("rejects nonzero local minima instead of treating them as tangent roots", () => {
    const result = findEquilibria(
      compileExpression("1e12 * ((y - 0.12345)^2 + 1e-12)"),
      bounds
    );

    expect(result.mode).toBe("none");
    expect(result.levels).toHaveLength(0);
  });

  it("represents a continuum of equilibria as one interval instead of sampled lines", () => {
    const result = findEquilibria(compileExpression("floor(y)"), bounds);

    expect(result.mode).toBe("roots");
    expect(result.levels).toEqual([]);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0].min).toBeCloseTo(0, 10);
    expect(result.intervals[0].max).toBeCloseTo(1, 10);
    expect(result.intervals[0].minInclusive).toBe(true);
    expect(result.intervals[0].maxInclusive).toBe(false);
  });
});
