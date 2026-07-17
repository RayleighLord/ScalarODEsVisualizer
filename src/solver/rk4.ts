import type { CompiledExpression, EvaluationOptions } from "../math/parser";
import type {
  AxisBounds,
  CurvePoint,
  CurveSeed,
  IntegralCurve,
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
> &
  Partial<Pick<CompiledExpression, "prepareEvaluation">>;

interface PreparedSolverExpression {
  evaluateWithDiagnostics: (
    t: number,
    y: number
  ) => ReturnType<CompiledExpression["evaluateWithDiagnostics"]>;
  checkSegmentDomain: (
    start: CurvePoint,
    end: CurvePoint
  ) => ReturnType<CompiledExpression["checkSegmentDomain"]>;
}

type StepRejectionCause = "accuracy" | "domain" | "non-finite";

type StepAttempt =
  | {
      accepted: true;
      point: CurvePoint;
      endDerivative: number;
      stepFactor: number;
    }
  | {
      accepted: false;
      cause: StepRejectionCause;
      stepFactor: number;
    };

type DerivativeAttempt =
  | { accepted: true; value: number }
  | { accepted: false; cause: Exclude<StepRejectionCause, "accuracy"> };

const SAFETY_FACTOR = 0.9;
const MINIMUM_REDUCTION_FACTOR = 0.1;
const MAXIMUM_REDUCTION_FACTOR = 0.5;
const MINIMUM_GROWTH_FACTOR = 0.2;
const MAXIMUM_GROWTH_FACTOR = 5;
const VISIBLE_Y_STEP_FRACTION = 0.25;
const MIN_NORMAL_NUMBER = 2 ** -1022;

export function createSolverSettings(bounds: AxisBounds): SolverSettings {
  const tSpan = bounds.tMax - bounds.tMin;
  const ySpan = bounds.yMax - bounds.yMin;

  return {
    stepSize: tSpan / 160,
    minStepSize: tSpan / 1e10,
    maxSteps: 5000,
    absoluteTolerance: Math.max(1e-9, ySpan * 1e-7),
    relativeTolerance: 1e-6,
    domainTolerance: 1e-8
  };
}

export function solveIntegralCurve(
  seed: CurveSeed,
  bounds: AxisBounds,
  expression: SolverExpression,
  settings: SolverSettings
): IntegralCurve {
  const evaluationOptions = createEvaluationOptions(settings);
  const preparedExpression = prepareSolverExpression(expression, evaluationOptions);
  const initialPoint = { t: seed.t, y: seed.y };
  const initialDerivative = evaluateDerivative(preparedExpression, initialPoint);

  if (!initialDerivative.accepted) {
    return {
      id: seed.id,
      seed,
      points: [initialPoint],
      terminationReason: terminationForRejection(initialDerivative.cause)
    };
  }

  const backward = traceDirection(
    seed,
    bounds,
    preparedExpression,
    settings,
    initialDerivative.value,
    -1
  );
  const forward = traceDirection(
    seed,
    bounds,
    preparedExpression,
    settings,
    initialDerivative.value,
    1
  );
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
  expression: PreparedSolverExpression,
  settings: SolverSettings,
  initialDerivative: number,
  direction: -1 | 1
): TraceResult {
  const points: CurvePoint[] = [{ t: seed.t, y: seed.y }];
  let current: CurvePoint = { t: seed.t, y: seed.y };
  const maximumStep = normalizedMaximumStep(settings, bounds);
  let stepSize = maximumStep;
  const minimumStep = normalizedMinimumStep(settings, bounds, maximumStep);
  let currentDerivative = initialDerivative;
  let acceptedSteps = 0;
  let consecutiveRejections = 0;

  while (acceptedSteps < settings.maxSteps) {
    const remaining = direction > 0 ? bounds.tMax - current.t : current.t - bounds.tMin;
    const timeTolerance = timeResolution(current.t, direction > 0 ? bounds.tMax : bounds.tMin);

    if (remaining <= timeTolerance) {
      return { points, terminationReason: "domain-limit" };
    }

    const unconstrainedStep = Math.min(stepSize, remaining);
    const stepMagnitude = limitStepToVisibleYScale(
      unconstrainedStep,
      currentDerivative,
      bounds
    );

    if (
      stepMagnitude <= 0 ||
      !Number.isFinite(stepMagnitude) ||
      current.t + direction * stepMagnitude === current.t
    ) {
      return { points, terminationReason: "step-underflow" };
    }

    const attempt = attemptDormandPrinceStep(
      current,
      direction * stepMagnitude,
      currentDerivative,
      expression,
      settings
    );

    if (!attempt.accepted) {
      consecutiveRejections += 1;

      if (stepMagnitude <= minimumStep * (1 + 1e-12) || consecutiveRejections >= 64) {
        return {
          points,
          terminationReason:
            attempt.cause === "accuracy"
              ? "step-underflow"
              : terminationForRejection(attempt.cause)
        };
      }

      stepSize = Math.max(minimumStep, stepMagnitude * attempt.stepFactor);
      continue;
    }

    consecutiveRejections = 0;
    const next = attempt.point;

    if (!Number.isFinite(next.t) || !Number.isFinite(next.y)) {
      return { points, terminationReason: "invalid-value" };
    }

    if (next.y < bounds.yMin || next.y > bounds.yMax) {
      const clipped = clipSegmentToVerticalBounds(current, next, bounds);
      if (clipped) {
        points.push(clipped);
      }
      return { points, terminationReason: "vertical-boundary" };
    }

    points.push(next);
    current = next;
    currentDerivative = attempt.endDerivative;
    stepSize = Math.min(
      maximumStep,
      Math.max(minimumStep, stepMagnitude * attempt.stepFactor)
    );
    acceptedSteps += 1;
  }

  return { points, terminationReason: "max-steps" };
}

/**
 * One Dormand-Prince 5(4) step. The fifth-order solution is accepted while the
 * embedded fourth-order solution supplies a local error estimate. k7 is the
 * derivative at the accepted endpoint, so the caller can reuse it as the next
 * step's k1 (the FSAL property).
 */
function attemptDormandPrinceStep(
  start: CurvePoint,
  step: number,
  k1: number,
  expression: PreparedSolverExpression,
  settings: SolverSettings
): StepAttempt {
  const k2 = evaluateStage(
    expression,
    start,
    stagePoint(start, step, 1 / 5, (1 / 5) * k1)
  );
  if (!k2.accepted) {
    return rejectedStep(k2.cause);
  }

  const k3 = evaluateStage(
    expression,
    start,
    stagePoint(start, step, 3 / 10, (3 / 40) * k1 + (9 / 40) * k2.value)
  );
  if (!k3.accepted) {
    return rejectedStep(k3.cause);
  }

  const k4 = evaluateStage(
    expression,
    start,
    stagePoint(
      start,
      step,
      4 / 5,
      (44 / 45) * k1 - (56 / 15) * k2.value + (32 / 9) * k3.value
    )
  );
  if (!k4.accepted) {
    return rejectedStep(k4.cause);
  }

  const k5 = evaluateStage(
    expression,
    start,
    stagePoint(
      start,
      step,
      8 / 9,
      (19372 / 6561) * k1 -
        (25360 / 2187) * k2.value +
        (64448 / 6561) * k3.value -
        (212 / 729) * k4.value
    )
  );
  if (!k5.accepted) {
    return rejectedStep(k5.cause);
  }

  const k6 = evaluateStage(
    expression,
    start,
    stagePoint(
      start,
      step,
      1,
      (9017 / 3168) * k1 -
        (355 / 33) * k2.value +
        (46732 / 5247) * k3.value +
        (49 / 176) * k4.value -
        (5103 / 18656) * k5.value
    )
  );
  if (!k6.accepted) {
    return rejectedStep(k6.cause);
  }

  const fifthOrderPoint = stagePoint(
    start,
    step,
    1,
    (35 / 384) * k1 +
      (500 / 1113) * k3.value +
      (125 / 192) * k4.value -
      (2187 / 6784) * k5.value +
      (11 / 84) * k6.value
  );
  const k7 = evaluateStage(expression, start, fifthOrderPoint);
  if (!k7.accepted) {
    return rejectedStep(k7.cause);
  }

  const fourthOrderY =
    start.y +
    step *
      ((5179 / 57600) * k1 +
        (7571 / 16695) * k3.value +
        (393 / 640) * k4.value -
        (92097 / 339200) * k5.value +
        (187 / 2100) * k6.value +
        (1 / 40) * k7.value);

  if (!Number.isFinite(fourthOrderY)) {
    return rejectedStep("non-finite");
  }

  const tolerance =
    Math.max(0, settings.absoluteTolerance) +
    Math.max(0, settings.relativeTolerance) *
      Math.max(Math.abs(start.y), Math.abs(fifthOrderPoint.y));
  const errorEstimate = Math.abs(fifthOrderPoint.y - fourthOrderY);
  const errorRatio = tolerance > 0 ? errorEstimate / tolerance : errorEstimate === 0 ? 0 : Infinity;

  if (!Number.isFinite(errorRatio) || errorRatio > 1) {
    return {
      accepted: false,
      cause: "accuracy",
      stepFactor: rejectedStepFactor(errorRatio)
    };
  }

  return {
    accepted: true,
    point: fifthOrderPoint,
    endDerivative: k7.value,
    stepFactor: acceptedStepFactor(errorRatio)
  };
}

function stagePoint(
  start: CurvePoint,
  step: number,
  timeCoefficient: number,
  weightedDerivative: number
): CurvePoint {
  return {
    t: start.t + timeCoefficient * step,
    y: start.y + step * weightedDerivative
  };
}

function evaluateStage(
  expression: PreparedSolverExpression,
  start: CurvePoint,
  stage: CurvePoint
): DerivativeAttempt {
  if (!Number.isFinite(stage.t) || !Number.isFinite(stage.y)) {
    return { accepted: false, cause: "non-finite" };
  }

  const segmentCheck = expression.checkSegmentDomain(start, stage);
  if (!segmentCheck.ok) {
    return { accepted: false, cause: "domain" };
  }

  return evaluateAtKnownDomainPoint(expression, stage);
}

function evaluateDerivative(
  expression: PreparedSolverExpression,
  point: CurvePoint
): DerivativeAttempt {
  const pointDomain = expression.checkSegmentDomain(point, point);
  if (!pointDomain.ok) {
    return { accepted: false, cause: "domain" };
  }

  return evaluateAtKnownDomainPoint(expression, point);
}

function evaluateAtKnownDomainPoint(
  expression: PreparedSolverExpression,
  point: CurvePoint
): DerivativeAttempt {
  const diagnostics = expression.evaluateWithDiagnostics(point.t, point.y);

  if (diagnostics.status === "near-singular") {
    return { accepted: false, cause: "domain" };
  }

  if (diagnostics.status === "invalid" || !Number.isFinite(diagnostics.value)) {
    return { accepted: false, cause: "non-finite" };
  }

  return { accepted: true, value: diagnostics.value };
}

function rejectedStep(cause: Exclude<StepRejectionCause, "accuracy">): StepAttempt {
  return {
    accepted: false,
    cause,
    stepFactor: MAXIMUM_REDUCTION_FACTOR
  };
}

function createEvaluationOptions(settings: SolverSettings): EvaluationOptions {
  return {
    domainTolerance: settings.domainTolerance
  };
}

function prepareSolverExpression(
  expression: SolverExpression,
  options: EvaluationOptions
): PreparedSolverExpression {
  if (expression.prepareEvaluation) {
    return expression.prepareEvaluation(options);
  }

  return {
    evaluateWithDiagnostics: (t, y) =>
      expression.evaluateWithDiagnostics(t, y, options),
    checkSegmentDomain: (start, end) =>
      expression.checkSegmentDomain(start, end, options)
  };
}

function acceptedStepFactor(errorRatio: number): number {
  if (errorRatio === 0) {
    return MAXIMUM_GROWTH_FACTOR;
  }

  return clamp(
    SAFETY_FACTOR * errorRatio ** (-1 / 5),
    MINIMUM_GROWTH_FACTOR,
    MAXIMUM_GROWTH_FACTOR
  );
}

function rejectedStepFactor(errorRatio: number): number {
  if (!Number.isFinite(errorRatio) || errorRatio <= 0) {
    return MINIMUM_REDUCTION_FACTOR;
  }

  return clamp(
    SAFETY_FACTOR * errorRatio ** (-1 / 5),
    MINIMUM_REDUCTION_FACTOR,
    MAXIMUM_REDUCTION_FACTOR
  );
}

function limitStepToVisibleYScale(
  requestedStep: number,
  derivative: number,
  bounds: AxisBounds
): number {
  if (derivative === 0) {
    return requestedStep;
  }

  const visibleYSpan = bounds.yMax - bounds.yMin;
  const verticalScaleStep =
    (VISIBLE_Y_STEP_FRACTION * visibleYSpan) / Math.abs(derivative);

  if (!Number.isFinite(verticalScaleStep) || verticalScaleStep <= 0) {
    return requestedStep;
  }

  return Math.min(requestedStep, verticalScaleStep);
}

function normalizedMaximumStep(settings: SolverSettings, bounds: AxisBounds): number {
  const span = bounds.tMax - bounds.tMin;
  const fallback = span / 160;
  const configured =
    Number.isFinite(settings.stepSize) && settings.stepSize > 0
      ? settings.stepSize
      : fallback;
  const representableStep = Math.max(
    numberResolution(bounds.tMin),
    numberResolution(bounds.tMax)
  );

  // A span can be perfectly valid even when its default fraction is smaller
  // than one ULP at the window's offset (for example, [1e16, 1e16 + 20]).
  // Ensure an accepted step can actually advance the floating-point clock,
  // while never stepping farther than the visible interval.
  return Math.min(span, Math.max(configured, representableStep));
}

function normalizedMinimumStep(
  settings: SolverSettings,
  bounds: AxisBounds,
  maximumStep: number
): number {
  const fallback = (bounds.tMax - bounds.tMin) / 1e10;
  const configured =
    Number.isFinite(settings.minStepSize) && settings.minStepSize > 0
      ? settings.minStepSize
      : fallback;

  return Math.min(configured, maximumStep);
}

function timeResolution(left: number, right: number): number {
  // A positive gap of one ULP is still traversable and must not be mistaken
  // for arrival at the boundary. Half the smaller local ULP remains below the
  // gap even when the two values straddle a binary exponent boundary. It
  // underflows harmlessly to zero for the smallest subnormal values, where
  // exact equality remains sufficient.
  return 0.5 * Math.min(numberResolution(left), numberResolution(right));
}

function numberResolution(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude < MIN_NORMAL_NUMBER) {
    return Number.MIN_VALUE;
  }

  // Adjacent IEEE-754 doubles in a binary exponent band are 2^(e - 52)
  // apart. Unlike an absolute epsilon floor, this still permits integration
  // across small, representable time windows near zero.
  const exponent = Math.min(1023, Math.floor(Math.log2(magnitude)));
  return 2 ** (exponent - 52);
}

function terminationForRejection(
  cause: Exclude<StepRejectionCause, "accuracy">
): TerminationReason {
  return cause === "domain" ? "singularity" : "invalid-value";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clipSegmentToVerticalBounds(
  start: CurvePoint,
  end: CurvePoint,
  bounds: AxisBounds
): CurvePoint | null {
  let targetY: number;

  if (end.y < bounds.yMin) {
    targetY = bounds.yMin;
  } else if (end.y > bounds.yMax) {
    targetY = bounds.yMax;
  } else {
    return null;
  }

  const deltaY = end.y - start.y;

  if (Math.abs(deltaY) < Number.EPSILON) {
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
  const candidates = new Set<TerminationReason>([
    forward.terminationReason,
    backward.terminationReason
  ]);
  const priority: TerminationReason[] = [
    "solver-error",
    "invalid-value",
    "step-underflow",
    "singularity",
    "max-steps",
    "vertical-boundary",
    "domain-limit"
  ];

  return priority.find((reason) => candidates.has(reason)) ?? "domain-limit";
}
