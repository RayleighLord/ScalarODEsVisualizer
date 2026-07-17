import { describe, expect, it } from "vitest";

import { compileExpression } from "../math/parser";

describe("compileExpression", () => {
  it("evaluates parsed expressions with t and y", () => {
    const expression = compileExpression("sin(t) - y^2");
    const value = expression.evaluate(Math.PI / 2, 3);

    expect(value).toBeCloseTo(-8, 8);
  });

  it("gives exponentiation conventional precedence over unary signs", () => {
    expect(compileExpression("-y^2").evaluate(0, 3)).toBe(-9);
    expect(compileExpression("(-y)^2").evaluate(0, 3)).toBe(9);
    expect(compileExpression("y^-2").evaluate(0, 2)).toBeCloseTo(0.25, 12);
    expect(compileExpression("-2^-2").evaluate(0, 0)).toBeCloseTo(-0.25, 12);
    expect(compileExpression("2^(-2)").evaluate(0, 0)).toBeCloseTo(0.25, 12);

    expect(compileExpression("-y^2").latex).toBe("-y^{2}");
    expect(compileExpression("(-y)^2").latex).toBe("\\left(-y\\right)^{2}");
    expect(compileExpression("y^-2").latex).toBe("y^{-2}");
  });

  it("detects autonomous equations", () => {
    const autonomous = compileExpression("y * (1 - y)");
    const nonAutonomous = compileExpression("t - y");
    const canceledTime = compileExpression("t - t");
    const zeroTimeProduct = compileExpression("0 * t + y");
    const domainLimitedTime = compileExpression("0 / t");

    expect(autonomous.isAutonomous).toBe(true);
    expect(autonomous.dependsOnY).toBe(true);
    expect(nonAutonomous.isAutonomous).toBe(false);
    expect(canceledTime.isAutonomous).toBe(true);
    expect(canceledTime.isIdenticallyZero).toBe(true);
    expect(zeroTimeProduct.isAutonomous).toBe(true);
    expect(zeroTimeProduct.dependsOnY).toBe(true);
    expect(domainLimitedTime.isAutonomous).toBe(false);
    expect(domainLimitedTime.evaluateWithDiagnostics(0, 1).status).toBe("invalid");
  });

  it("generates LaTeX for rendered previews", () => {
    const expression = compileExpression("y * (1 - y)");
    const second = compileExpression("sin(t) - y^2");

    expect(expression.latex).toBe("y \\cdot \\left(1 - y\\right)");
    expect(second.latex).toBe("\\sin\\left(t\\right) - y^{2}");
  });

  it("places a whole-numerator minus before a rendered fraction", () => {
    expect(compileExpression("-y/2").latex).toBe("-\\frac{y}{2}");
    expect(compileExpression("(-y)/(-2)").latex).toBe("-\\frac{y}{-2}");
    expect(compileExpression("-(y/2)").latex).toBe(
      "-\\left(\\frac{y}{2}\\right)"
    );
    expect(compileExpression("y/-t").latex).toBe("\\frac{y}{-t}");
    expect(compileExpression("-(y + t)/2").latex).toBe(
      "-\\frac{y + t}{2}"
    );
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

  it("detects hidden even-order and paired denominator boundaries", () => {
    const squaredPole = compileExpression("1 / (y - 0.123)^2");
    const pairedPoles = compileExpression("1 / ((y - 0.123) * (y - 0.124))");
    const negativePowerPole = compileExpression("(y - 0.123)^-2");
    const safeMinimum = compileExpression("1 / ((y - 0.123)^2 + 0.01)");

    expect(
      squaredPole.checkSegmentDomain(
        { t: 0, y: 0 },
        { t: 0.1, y: 1 },
        { segmentSampleCount: 2 }
      ).ok
    ).toBe(false);
    expect(
      pairedPoles.checkSegmentDomain(
        { t: 0, y: 0 },
        { t: 0.1, y: 1 },
        { segmentSampleCount: 2 }
      ).ok
    ).toBe(false);
    expect(
      negativePowerPole.checkSegmentDomain(
        { t: 0, y: 0 },
        { t: 0.1, y: 1 },
        { segmentSampleCount: 2 }
      ).ok
    ).toBe(false);
    expect(
      safeMinimum.checkSegmentDomain(
        { t: 0, y: 0 },
        { t: 0.1, y: 1 },
        { segmentSampleCount: 2 }
      ).ok
    ).toBe(true);
  });

  it("does not invent a boundary when t and y vary together safely", () => {
    const expression = compileExpression("1 / (t - y)");

    expect(
      expression.checkSegmentDomain(
        { t: 0, y: -2 },
        { t: 2, y: 0 },
        { segmentSampleCount: 2 }
      ).ok
    ).toBe(true);
  });

  it("preserves exact cancellation in domain interval checks", () => {
    const expression = compileExpression("1 / (1e12*y - 1e12*y + 1)");

    expect(
      expression.checkSegmentDomain(
        { t: -1, y: -2 },
        { t: 1, y: 2 },
        { segmentSampleCount: 2 }
      ).ok
    ).toBe(true);
  });

  it("prepares reusable diagnostic evaluators and observes option changes safely", () => {
    const expression = compileExpression("1 / y");
    const prepared = expression.prepareEvaluation?.({ domainTolerance: 1e-4 });

    expect(prepared).toBeDefined();

    expect(prepared?.evaluateWithDiagnostics(0, 1e-5).status).toBe("near-singular");
    expect(
      prepared?.checkSegmentDomain({ t: 0, y: -1 }, { t: 0, y: 1 }).ok
    ).toBe(false);

    const mutableOptions = { domainTolerance: 1e-4 };
    expect(expression.evaluateWithDiagnostics(0, 1e-5, mutableOptions).status).toBe(
      "near-singular"
    );
    mutableOptions.domainTolerance = 1e-6;
    expect(expression.evaluateWithDiagnostics(0, 1e-5, mutableOptions).status).toBe("ok");
  });

  it("conservatively proves simple zero identities", () => {
    expect(compileExpression("y - y").isIdenticallyZero).toBe(true);
    expect(compileExpression("0 * y").isIdenticallyZero).toBe(true);
    expect(compileExpression("sin(y) + -sin(y)").isIdenticallyZero).toBe(true);
    expect(compileExpression("0 / y").isIdenticallyZero).toBe(false);
    expect(compileExpression("0 * t^-1").isAutonomous).toBe(false);
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
