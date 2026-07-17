import { describe, expect, it } from "vitest";

import { compileExpression } from "../math/parser";
import { createSolverSettings, solveIntegralCurve } from "../solver/rk4";
import type { AxisBounds, CurveSeed } from "../types";

describe("solveIntegralCurve", () => {
  it("tracks a smooth exponential trajectory accurately in both directions", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -10,
      yMax: 10
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 1
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("y"),
      createSolverSettings(bounds)
    );
    const finalPoint = trajectory.points[trajectory.points.length - 1];

    const firstPoint = trajectory.points[0];

    expect(firstPoint.t).toBeCloseTo(-1, 12);
    expect(firstPoint.y).toBeCloseTo(Math.exp(-1), 5);
    expect(finalPoint.t).toBeCloseTo(1, 12);
    expect(finalPoint.y).toBeCloseTo(Math.E, 5);
  });

  it("converges as the embedded RK45 tolerance is tightened", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 1,
      yMin: -100,
      yMax: 100
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 1
    };
    const defaults = createSolverSettings(bounds);
    const loose = solveIntegralCurve(seed, bounds, compileExpression("y"), {
      ...defaults,
      stepSize: 1,
      minStepSize: 1e-12,
      absoluteTolerance: 1e-1,
      relativeTolerance: 1e-1
    });
    const tight = solveIntegralCurve(seed, bounds, compileExpression("y"), {
      ...defaults,
      stepSize: 1,
      minStepSize: 1e-12,
      absoluteTolerance: 1e-11,
      relativeTolerance: 1e-11
    });
    const looseError = Math.abs(loose.points.at(-1)!.y - Math.E);
    const tightError = Math.abs(tight.points.at(-1)!.y - Math.E);

    expect(tightError).toBeLessThan(looseError / 100);
    expect(tightError).toBeLessThan(1e-8);
  });

  it("prepares evaluation once and reuses the accepted endpoint derivative", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 1,
      yMin: -1,
      yMax: 1
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 0
    };
    let prepareCalls = 0;
    let derivativeCalls = 0;
    const expression = {
      evaluateWithDiagnostics: () => {
        throw new Error("The prepared evaluator should be used.");
      },
      checkSegmentDomain: () => {
        throw new Error("The prepared evaluator should be used.");
      },
      prepareEvaluation: () => {
        prepareCalls += 1;
        return {
          evaluateWithDiagnostics: () => {
            derivativeCalls += 1;
            return { value: 0, status: "ok" as const };
          },
          checkSegmentDomain: () => ({ ok: true, status: "ok" as const })
        };
      }
    };
    const trajectory = solveIntegralCurve(seed, bounds, expression, {
      ...createSolverSettings(bounds),
      stepSize: 0.25
    });

    expect(trajectory.points).toHaveLength(5);
    expect(prepareCalls).toBe(1);
    // One seed evaluation plus six new stages for each of four accepted steps.
    expect(derivativeCalls).toBe(25);
  });

  it("integrates backward from a seed at the right edge", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 1,
      yMin: -10,
      yMax: 10
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 1,
      y: Math.E
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("y"),
      createSolverSettings(bounds)
    );

    expect(trajectory.points[0].t).toBeCloseTo(0, 12);
    expect(trajectory.points[0].y).toBeCloseTo(1, 5);
    expect(trajectory.points.at(-1)).toEqual({ t: seed.t, y: seed.y });
  });

  it("stops when the curve exits the visible y-range", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 3,
      yMin: -2,
      yMax: 2
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 0
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("y^2 + 1"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("vertical-boundary");
    expect(trajectory.points.at(-1)!.y).toBe(2);
  });

  it("traces an equilibrium that lies exactly on a visible y boundary", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -2,
      yMax: 2
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: bounds.yMin
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("0"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("domain-limit");
    expect(trajectory.points[0].t).toBeCloseTo(bounds.tMin, 12);
    expect(trajectory.points[0].y).toBe(bounds.yMin);
    expect(trajectory.points.at(-1)!.t).toBeCloseTo(bounds.tMax, 12);
    expect(trajectory.points.at(-1)!.y).toBe(bounds.yMin);
  });

  it("integrates across a tiny representable time window near zero", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 1e-16,
      yMin: -1,
      yMax: 1
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 5e-17,
      y: 0
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("0"),
      createSolverSettings(bounds)
    );

    expect(trajectory.points.length).toBeGreaterThan(1);
    expect(trajectory.points[0]).toEqual({ t: bounds.tMin, y: seed.y });
    expect(trajectory.points.at(-1)).toEqual({ t: bounds.tMax, y: seed.y });
    expect(trajectory.terminationReason).toBe("domain-limit");
  });

  it("reaches both bounds across a representable window at a large time offset", () => {
    const bounds: AxisBounds = {
      tMin: 1e16,
      tMax: 1e16 + 20,
      yMin: -1,
      yMax: 1
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 1e16 + 10,
      y: 0
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("0"),
      createSolverSettings(bounds)
    );

    expect(trajectory.points.length).toBeGreaterThan(1);
    expect(trajectory.points[0]).toEqual({ t: bounds.tMin, y: seed.y });
    expect(trajectory.points.at(-1)).toEqual({ t: bounds.tMax, y: seed.y });
    expect(trajectory.terminationReason).toBe("domain-limit");
  });

  it("resolves steep finite slopes without classifying them as singular", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -1,
      yMax: 1
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 0
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1000000000"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("vertical-boundary");
    expect(trajectory.points[0].y).toBe(-1);
    expect(trajectory.points.at(-1)!.y).toBe(1);
    expect(trajectory.points.every(({ t, y }) => Number.isFinite(t) && Number.isFinite(y))).toBe(
      true
    );
  });

  it("reports accuracy failure at the minimum step as step underflow", () => {
    const bounds: AxisBounds = {
      tMin: -0.1,
      tMax: 0.1,
      yMin: -1e50,
      yMax: 1e50
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 1
    };
    const settings = {
      ...createSolverSettings(bounds),
      stepSize: 0.01,
      minStepSize: 0.01,
      absoluteTolerance: 1e-12,
      relativeTolerance: 1e-12
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("-10000 * y"),
      settings
    );

    expect(trajectory.terminationReason).toBe("step-underflow");
    expect(trajectory.points).toEqual([{ t: seed.t, y: seed.y }]);
  });

  it("keeps non-domain non-finite values distinct from singularities", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -2,
      yMax: 2
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 0
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("exp(1000)"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("invalid-value");
    expect(trajectory.points).toEqual([{ t: seed.t, y: seed.y }]);
  });

  it("stops above y = 0 for the singular equation y' = 1 / y", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -2,
      yMax: 2
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 1
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1 / y"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("singularity");
    expect(Math.min(...trajectory.points.map((point) => point.y))).toBeGreaterThan(0);
  });

  it("stops below y = 0 for the negative branch of y' = 1 / y", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -2,
      yMax: 2
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: -1
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1 / y"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("singularity");
    expect(Math.max(...trajectory.points.map((point) => point.y))).toBeLessThan(0);
  });

  it("does not cross shifted denominator singularities", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -1,
      yMax: 3
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 2
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1 / (y - 1)"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("singularity");
    expect(Math.min(...trajectory.points.map((point) => point.y))).toBeGreaterThan(1);
  });

  it("does not cross even-powered denominator singularities", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -1,
      yMax: 3
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 1
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1 / (y - 0.123)^2"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("singularity");
    expect(Math.min(...trajectory.points.map((point) => point.y))).toBeGreaterThan(0.123);
  });

  it("integrates through algebraically canceled denominator dependencies", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -3,
      yMax: 3
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 0
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1 / (1e12*y - 1e12*y + 1)"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("domain-limit");
    expect(trajectory.points[0].t).toBeCloseTo(-1, 12);
    expect(trajectory.points[0].y).toBeCloseTo(-1, 12);
    expect(trajectory.points.at(-1)!.t).toBeCloseTo(1, 12);
    expect(trajectory.points.at(-1)!.y).toBeCloseTo(1, 12);
  });

  it("does not cross oblique denominator singularities", () => {
    const bounds: AxisBounds = {
      tMin: -1,
      tMax: 1,
      yMin: -2,
      yMax: 2
    };
    const seed: CurveSeed = {
      id: "seed",
      t: 0,
      y: 1
    };

    const trajectory = solveIntegralCurve(
      seed,
      bounds,
      compileExpression("1 / (t - y)"),
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("singularity");
    expect(trajectory.points.every((point) => point.t - point.y < 0)).toBe(true);
  });
});
