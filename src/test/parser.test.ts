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

  it("reports denominator singularities and crossed denominator boundaries", () => {
    const expression = compileExpression("1 / y");

    expect(expression.evaluateWithDiagnostics(0, 0).status).toBe("invalid");
    expect(expression.evaluateWithDiagnostics(0, 1e-10).status).toBe("near-singular");
    expect(expression.checkSegmentDomain({ t: 0, y: 1 }, { t: 0.1, y: -1 }).ok).toBe(false);
  });

  it("reports log and sqrt domain boundaries", () => {
    const logExpression = compileExpression("log(y)");
    const sqrtExpression = compileExpression("sqrt(y)");

    expect(logExpression.evaluateWithDiagnostics(0, -1).status).toBe("invalid");
    expect(logExpression.evaluateWithDiagnostics(0, 1e-10).status).toBe("near-singular");
    expect(sqrtExpression.evaluateWithDiagnostics(0, -1).status).toBe("invalid");
    expect(sqrtExpression.evaluateWithDiagnostics(0, 0).status).toBe("near-singular");
  });

  it("reports inverse-trig and tan domain boundaries", () => {
    const asinExpression = compileExpression("asin(y)");
    const tanExpression = compileExpression("tan(y)");

    expect(asinExpression.evaluateWithDiagnostics(0, 1.2).status).toBe("invalid");
    expect(asinExpression.evaluateWithDiagnostics(0, 1).status).toBe("near-singular");
    expect(tanExpression.evaluateWithDiagnostics(0, Math.PI / 2).status).toBe("near-singular");
    expect(
      tanExpression.checkSegmentDomain({ t: 0, y: 1 }, { t: 0, y: 2 }).status
    ).toBe("near-singular");
  });
});
