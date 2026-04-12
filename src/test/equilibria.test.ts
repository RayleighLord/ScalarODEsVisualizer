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
});
