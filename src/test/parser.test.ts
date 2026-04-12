import { describe, expect, it } from "vitest";

import { compileExpression } from "../math/parser";

describe("compileExpression", () => {
  it("evaluates parsed expressions with t and y", () => {
    const expression = compileExpression("sin(t) - y^2");
    const value = expression.evaluate(Math.PI / 2, 3);

    expect(value).toBeCloseTo(-8, 8);
  });

  it("detects autonomous equations", () => {
    const autonomous = compileExpression("y * (1 - y)");
    const nonAutonomous = compileExpression("t - y");

    expect(autonomous.isAutonomous).toBe(true);
    expect(autonomous.dependsOnY).toBe(true);
    expect(nonAutonomous.isAutonomous).toBe(false);
  });

  it("generates LaTeX for rendered previews", () => {
    const expression = compileExpression("y * (1 - y)");
    const second = compileExpression("sin(t) - y^2");

    expect(expression.latex).toBe("y \\cdot \\left(1 - y\\right)");
    expect(second.latex).toBe("\\sin\\left(t\\right) - y^{2}");
  });

  it("rejects malformed expressions", () => {
    expect(() => compileExpression("sin(")).toThrow();
    expect(() => compileExpression("foo + y")).toThrow();
  });
});
