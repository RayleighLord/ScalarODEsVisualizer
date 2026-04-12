import { describe, expect, it } from "vitest";

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

    const trajectory = solveIntegralCurve(seed, bounds, (_t, y) => y, createSolverSettings(bounds));
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
      (_t, y) => y * y + 1,
      createSolverSettings(bounds)
    );

    expect(trajectory.terminationReason).toBe("vertical-boundary");
  });
});
