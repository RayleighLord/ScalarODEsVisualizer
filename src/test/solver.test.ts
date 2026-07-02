import { describe, expect, it } from "vitest";

import { compileExpression } from "../math/parser";
import { createSolverSettings, solveIntegralCurve } from "../solver/rk4";
import type { AxisBounds, CurveSeed } from "../types";

describe("solveIntegralCurve", () => {
  it("tracks a smooth exponential trajectory with RK4 accuracy", () => {
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

    const trajectory = solveIntegralCurve(seed, bounds, compileExpression("y"), createSolverSettings(bounds));
    const finalPoint = trajectory.points[trajectory.points.length - 1];

    expect(finalPoint.t).toBeCloseTo(1, 6);
    expect(finalPoint.y).toBeCloseTo(Math.E, 2);
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
