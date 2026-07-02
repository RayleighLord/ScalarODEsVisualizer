import type { CompiledExpression, EvaluationOptions } from "../math/parser";
import type {
  AxisBounds,
  CurvePoint,
  IntegralCurve,
  CurveSeed,
  SolverSettings,
  TerminationReason
} from "../types";

interface TraceResult {
  points: CurvePoint[];
  terminationReason: TerminationReason;
}

type SolverExpression = Pick<
  CompiledExpression,
  "evaluateWithDiagnostics" | "checkSegmentDomain"
>;

type StepAttempt =
  | { accepted: true; point: CurvePoint; errorEstimate: number; tolerance: number }
  | { accepted: false };

type DerivativeAttempt =
  | { accepted: true; value: number }
  | { accepted: false };

export function createSolverSettings(bounds: AxisBounds): SolverSettings {
  const span = bounds.tMax - bounds.tMin;

  return {
    stepSize: span / 320,
    minStepSize: span / 100000,
    maxSteps: 5000,
    blowUpThreshold: Math.max(Math.abs(bounds.yMin), Math.abs(bounds.yMax), 10) * 6,
    absoluteTolerance: Math.max(1e-6, (bounds.yMax - bounds.yMin) / 10000),
    relativeTolerance: 1e-4,
    domainTolerance: 1e-8,
    derivativeMagnitudeLimit:
      Math.max(1, (bounds.yMax - bounds.yMin) / span) * 1e6
  };
}

export function solveIntegralCurve(
  seed: CurveSeed,
  bounds: AxisBounds,
  expression: SolverExpression,
  settings: SolverSettings
): IntegralCurve {
  const evaluationOptions = createEvaluationOptions(settings);
  const backward = traceDirection(seed, bounds, expression, settings, evaluationOptions, -1);
  const forward = traceDirection(seed, bounds, expression, settings, evaluationOptions, 1);
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
  expression: SolverExpression,
  settings: SolverSettings,
  evaluationOptions: EvaluationOptions,
  direction: -1 | 1
): TraceResult {
  const points: CurvePoint[] = [{ t: seed.t, y: seed.y }];
  let t = seed.t;
  let y = seed.y;
  let stepSize = settings.stepSize;
  let steps = 0;

  if (!evaluateDerivative(expression, seed, evaluationOptions).accepted) {
    return { points, terminationReason: "singularity" };
  }

  while (steps < settings.maxSteps) {
    const remaining =
      direction > 0 ? bounds.tMax - t : t - bounds.tMin;

    if (remaining <= 1e-10) {
      return { points, terminationReason: "domain-limit" };
    }

    const step = Math.min(stepSize, remaining) * direction;
    const attempt = attemptAdaptiveStep({ t, y }, step, expression, settings, evaluationOptions);

    if (!attempt.accepted) {
      if (stepSize <= settings.minStepSize) {
        return { points, terminationReason: "singularity" };
      }

      stepSize = Math.max(settings.minStepSize, stepSize / 2);
      continue;
    }

    const next = attempt.point;
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
    stepSize = chooseNextStepSize(stepSize, attempt.errorEstimate, attempt.tolerance, settings);
    steps += 1;
  }

  return { points, terminationReason: "max-steps" };
}

function attemptAdaptiveStep(
  start: CurvePoint,
  step: number,
  expression: SolverExpression,
  settings: SolverSettings,
  evaluationOptions: EvaluationOptions
): StepAttempt {
  const fullStep = rk4GuardedStep(start, step, expression, settings, evaluationOptions);
  if (!fullStep.accepted) {
    return { accepted: false };
  }

  const firstHalfStep = rk4GuardedStep(start, step / 2, expression, settings, evaluationOptions);
  if (!firstHalfStep.accepted) {
    return { accepted: false };
  }

  const secondHalfStep = rk4GuardedStep(
    firstHalfStep.point,
    step / 2,
    expression,
    settings,
    evaluationOptions
  );
  if (!secondHalfStep.accepted) {
    return { accepted: false };
  }

  if (!checkSegment(expression, start, secondHalfStep.point, evaluationOptions)) {
    return { accepted: false };
  }

  const errorEstimate = Math.abs(secondHalfStep.point.y - fullStep.point.y) / 15;
  const tolerance =
    settings.absoluteTolerance +
    settings.relativeTolerance * Math.max(1, Math.abs(start.y), Math.abs(secondHalfStep.point.y));

  if (errorEstimate > tolerance) {
    return { accepted: false };
  }

  return {
    accepted: true,
    point: secondHalfStep.point,
    errorEstimate,
    tolerance
  };
}

function rk4GuardedStep(
  start: CurvePoint,
  step: number,
  expression: SolverExpression,
  settings: SolverSettings,
  evaluationOptions: EvaluationOptions
): StepAttempt {
  const k1 = evaluateDerivative(expression, start, evaluationOptions);
  if (!k1.accepted) {
    return { accepted: false };
  }

  const stage2 = {
    t: start.t + step / 2,
    y: start.y + (step * k1.value) / 2
  };
  const k2 = evaluateStage(expression, start, stage2, evaluationOptions);
  if (!k2.accepted) {
    return { accepted: false };
  }

  const stage3 = {
    t: start.t + step / 2,
    y: start.y + (step * k2.value) / 2
  };
  const k3 = evaluateStage(expression, start, stage3, evaluationOptions);
  if (!k3.accepted) {
    return { accepted: false };
  }

  const stage4 = {
    t: start.t + step,
    y: start.y + step * k3.value
  };
  const k4 = evaluateStage(expression, start, stage4, evaluationOptions);
  if (!k4.accepted) {
    return { accepted: false };
  }

  const point = {
    t: start.t + step,
    y: start.y + (step / 6) * (k1.value + 2 * k2.value + 2 * k3.value + k4.value)
  };

  if (!Number.isFinite(point.t) || !Number.isFinite(point.y)) {
    return { accepted: false };
  }

  if (!checkSegment(expression, start, point, evaluationOptions)) {
    return { accepted: false };
  }

  return {
    accepted: true,
    point,
    errorEstimate: 0,
    tolerance: 0
  };
}

function evaluateStage(
  expression: SolverExpression,
  start: CurvePoint,
  stage: CurvePoint,
  evaluationOptions: EvaluationOptions
): DerivativeAttempt {
  if (!checkSegment(expression, start, stage, evaluationOptions)) {
    return { accepted: false };
  }

  return evaluateDerivative(expression, stage, evaluationOptions);
}

function evaluateDerivative(
  expression: SolverExpression,
  point: CurvePoint,
  evaluationOptions: EvaluationOptions
): DerivativeAttempt {
  const diagnostics = expression.evaluateWithDiagnostics(
    point.t,
    point.y,
    evaluationOptions
  );

  if (diagnostics.status !== "ok" || !Number.isFinite(diagnostics.value)) {
    return { accepted: false };
  }

  return { accepted: true, value: diagnostics.value };
}

function checkSegment(
  expression: SolverExpression,
  start: CurvePoint,
  end: CurvePoint,
  evaluationOptions: EvaluationOptions
): boolean {
  return expression.checkSegmentDomain(start, end, evaluationOptions).ok;
}

function createEvaluationOptions(settings: SolverSettings): EvaluationOptions {
  return {
    domainTolerance: settings.domainTolerance,
    derivativeMagnitudeLimit: settings.derivativeMagnitudeLimit
  };
}

function chooseNextStepSize(
  current: number,
  errorEstimate: number,
  tolerance: number,
  settings: SolverSettings
): number {
  if (errorEstimate <= tolerance * 0.02) {
    return Math.min(settings.stepSize, current * 1.6);
  }

  if (errorEstimate <= tolerance * 0.25) {
    return Math.min(settings.stepSize, current * 1.25);
  }

  return current;
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

  if (candidates.includes("singularity")) {
    return "singularity";
  }

  return (
    candidates.find((reason) => reason !== "domain-limit") ??
    candidates.find((reason) => reason === "domain-limit") ??
    "domain-limit"
  );
}
