import type { AxisBounds, CurvePoint, IntegralCurve, CurveSeed, SolverSettings, TerminationReason } from "../types";

interface TraceResult {
  points: CurvePoint[];
  terminationReason: TerminationReason;
}

export function createSolverSettings(bounds: AxisBounds): SolverSettings {
  const span = bounds.tMax - bounds.tMin;

  return {
    stepSize: span / 320,
    maxSteps: 5000,
    blowUpThreshold: Math.max(Math.abs(bounds.yMin), Math.abs(bounds.yMax), 10) * 6
  };
}

export function solveIntegralCurve(
  seed: CurveSeed,
  bounds: AxisBounds,
  evaluate: (t: number, y: number) => number,
  settings: SolverSettings
): IntegralCurve {
  const backward = traceDirection(seed, bounds, evaluate, settings, -1);
  const forward = traceDirection(seed, bounds, evaluate, settings, 1);
  const merged = [...backward.points.reverse(), ...forward.points.slice(1)];

  return {
    id: seed.id,
    seed,
    points: merged,
    terminationReason: selectTerminationReason(backward, forward)
  };
}

function traceDirection(
  seed: CurveSeed,
  bounds: AxisBounds,
  evaluate: (t: number, y: number) => number,
  settings: SolverSettings,
  direction: -1 | 1
): TraceResult {
  const points: CurvePoint[] = [{ t: seed.t, y: seed.y }];
  let t = seed.t;
  let y = seed.y;
  let steps = 0;

  while (steps < settings.maxSteps) {
    const remaining =
      direction > 0 ? bounds.tMax - t : t - bounds.tMin;

    if (remaining <= 1e-10) {
      return { points, terminationReason: "domain-limit" };
    }

    const step = Math.min(settings.stepSize, remaining) * direction;

    try {
      const next = rk4Step(evaluate, t, y, step);
      if (!Number.isFinite(next.t) || !Number.isFinite(next.y)) {
        return { points, terminationReason: "invalid-value" };
      }

      if (Math.abs(next.y) > settings.blowUpThreshold) {
        const clipped = clipSegmentToVerticalBounds({ t, y }, next, bounds);
        if (clipped) {
          points.push(clipped);
        }
        return { points, terminationReason: "vertical-boundary" };
      }

      if (next.y < bounds.yMin || next.y > bounds.yMax) {
        const clipped = clipSegmentToVerticalBounds({ t, y }, next, bounds);
        if (clipped) {
          points.push(clipped);
        }
        return { points, terminationReason: "vertical-boundary" };
      }

      points.push(next);
      t = next.t;
      y = next.y;
      steps += 1;
    } catch {
      return { points, terminationReason: "solver-error" };
    }
  }

  return { points, terminationReason: "max-steps" };
}

function rk4Step(
  evaluate: (t: number, y: number) => number,
  t: number,
  y: number,
  step: number
): CurvePoint {
  const k1 = evaluate(t, y);
  const k2 = evaluate(t + step / 2, y + (step * k1) / 2);
  const k3 = evaluate(t + step / 2, y + (step * k2) / 2);
  const k4 = evaluate(t + step, y + step * k3);

  if (![k1, k2, k3, k4].every(Number.isFinite)) {
    throw new Error("Encountered a non-finite derivative.");
  }

  return {
    t: t + step,
    y: y + (step / 6) * (k1 + 2 * k2 + 2 * k3 + k4)
  };
}

function clipSegmentToVerticalBounds(
  start: CurvePoint,
  end: CurvePoint,
  bounds: AxisBounds
): CurvePoint | null {
  const targetY = end.y < bounds.yMin ? bounds.yMin : bounds.yMax;
  const deltaY = end.y - start.y;

  if (Math.abs(deltaY) < 1e-12) {
    return null;
  }

  const ratio = (targetY - start.y) / deltaY;
  if (ratio < 0 || ratio > 1) {
    return null;
  }

  return {
    t: start.t + ratio * (end.t - start.t),
    y: targetY
  };
}

function selectTerminationReason(backward: TraceResult, forward: TraceResult): TerminationReason {
  const candidates: TerminationReason[] = [
    forward.terminationReason,
    backward.terminationReason
  ];

  return (
    candidates.find((reason) => reason !== "domain-limit") ??
    candidates.find((reason) => reason === "domain-limit") ??
    "domain-limit"
  );
}
