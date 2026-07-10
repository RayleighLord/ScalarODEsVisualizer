import type { AxisBounds, EquilibriumInterval, EquilibriumResult } from "../types";
import type {
  CompiledExpression,
  EvaluationDiagnostics,
  EvaluationOptions,
  PreparedExpressionEvaluation
} from "./parser";

interface RootSearchOptions {
  sampleCount?: number;
  zeroTolerance?: number;
}

interface FunctionSample {
  y: number;
  diagnostics: EvaluationDiagnostics;
}

interface RootCandidate {
  y: number;
  normalizedResidual: number;
}

interface RootSearchResult {
  levels: number[];
  intervals: EquilibriumInterval[];
}

interface AutonomousEvaluation {
  evaluate: (y: number) => EvaluationDiagnostics;
  segmentIsSafe: (start: number, end: number) => boolean;
}

const DEFAULT_SAMPLE_COUNT = 720;
const DEFAULT_ZERO_TOLERANCE = 1e-6;
const MAX_REFINEMENT_ITERATIONS = 80;
const GOLDEN_RATIO_COMPLEMENT = (Math.sqrt(5) - 1) / 2;

export function findEquilibria(
  expression: CompiledExpression,
  bounds: AxisBounds,
  options: RootSearchOptions = {}
): EquilibriumResult {
  if (!expression.isAutonomous || !expression.evaluateAutonomous) {
    return {
      mode: "not-autonomous",
      levels: [],
      intervals: [],
      message: "Equilibrium lines are available for autonomous equations only."
    };
  }

  if (expression.isIdenticallyZero) {
    return allEquilibriaResult();
  }

  const zeroTolerance = normalizeZeroTolerance(options.zeroTolerance);
  const evaluation = createAutonomousEvaluation(expression, zeroTolerance);

  if (!expression.dependsOnY) {
    const diagnostics = evaluation.evaluate(bounds.yMin);
    if (
      diagnostics.status !== "invalid" &&
      Number.isFinite(diagnostics.value) &&
      diagnostics.value === 0
    ) {
      return allEquilibriaResult();
    }

    return {
      mode: "none",
      levels: [],
      intervals: [],
      message: "This autonomous equation has no equilibria in the visible range."
    };
  }

  const { levels, intervals } = findRootsBySampling(
    evaluation,
    bounds.yMin,
    bounds.yMax,
    options.sampleCount,
    zeroTolerance
  );

  if (levels.length === 0 && intervals.length === 0) {
    return {
      mode: "none",
      levels: [],
      intervals: [],
      message: "No equilibrium level was detected inside the visible y-range."
    };
  }

  return {
    mode: "roots",
    levels,
    intervals,
    message:
      intervals.length > 0
        ? formatEquilibriumSetMessage(levels, intervals)
        : levels.length === 1
        ? `One equilibrium level detected at y = ${formatNumber(levels[0])}.`
        : `${levels.length} equilibrium levels detected in the visible range.`
  };
}

function allEquilibriaResult(): EquilibriumResult {
  return {
    mode: "all",
    levels: [],
    intervals: [],
    message: "Every horizontal line is an equilibrium because the ODE is identically zero."
  };
}

function createAutonomousEvaluation(
  expression: CompiledExpression,
  zeroTolerance: number
): AutonomousEvaluation {
  const evaluationOptions: EvaluationOptions = {
    domainTolerance: Math.max(1e-12, Math.min(1e-8, zeroTolerance * 0.01))
  };
  const prepared: PreparedExpressionEvaluation = expression.prepareEvaluation
    ? expression.prepareEvaluation(evaluationOptions)
    : {
        evaluateWithDiagnostics: (t, y) =>
          expression.evaluateWithDiagnostics(t, y, evaluationOptions),
        checkSegmentDomain: (start, end) =>
          expression.checkSegmentDomain(start, end, evaluationOptions)
      };

  return {
    evaluate: (y) => prepared.evaluateWithDiagnostics(0, y),
    segmentIsSafe: (start, end) =>
      prepared.checkSegmentDomain(
        { t: 0, y: start },
        { t: 0, y: end }
      ).ok
  };
}

function findRootsBySampling(
  evaluation: AutonomousEvaluation,
  min: number,
  max: number,
  requestedSampleCount: number | undefined,
  zeroTolerance: number
): RootSearchResult {
  const sampleCount = normalizeSampleCount(requestedSampleCount);
  const samples = sampleFunction(evaluation.evaluate, min, max, sampleCount);
  const step = (max - min) / sampleCount;
  const candidates: RootCandidate[] = [];
  const { intervals, coveredSampleIndexes } = findExactZeroIntervals(
    samples,
    evaluation,
    step
  );

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    if (
      !coveredSampleIndexes.has(index) &&
      isFiniteDomainValue(current.diagnostics) &&
      sampleLooksLikeRoot(samples, index, zeroTolerance)
    ) {
      const exactCandidate = validateRootCandidate(
        current.y,
        samples[Math.max(0, index - 1)].y,
        samples[Math.min(samples.length - 1, index + 1)].y,
        evaluation,
        zeroTolerance,
        step
      );
      if (exactCandidate) {
        candidates.push(exactCandidate);
      }
    }

    if (index >= samples.length - 1) {
      continue;
    }

    const next = samples[index + 1];
    if (!isRegularDomainValue(current.diagnostics) || !isRegularDomainValue(next.diagnostics)) {
      continue;
    }

    if (
      haveOppositeSigns(current.diagnostics.value, next.diagnostics.value) &&
      evaluation.segmentIsSafe(current.y, next.y)
    ) {
      const root = refineSignChangingRoot(
        current,
        next,
        evaluation,
        zeroTolerance,
        step
      );
      if (root) {
        candidates.push(root);
      }
    }
  }

  // Sign changes do not reveal roots with even multiplicity. A local minimum
  // of |f| is refined independently and then subjected to the same residual
  // and domain validation as a bracketed root.
  for (let index = 1; index < samples.length - 1; index += 1) {
    if (coveredSampleIndexes.has(index)) {
      continue;
    }

    const previous = samples[index - 1];
    const current = samples[index];
    const next = samples[index + 1];

    if (
      !isRegularDomainValue(previous.diagnostics) ||
      !isRegularDomainValue(current.diagnostics) ||
      !isRegularDomainValue(next.diagnostics)
    ) {
      continue;
    }

    const previousMagnitude = Math.abs(previous.diagnostics.value);
    const currentMagnitude = Math.abs(current.diagnostics.value);
    const nextMagnitude = Math.abs(next.diagnostics.value);
    const isLocalMinimum =
      currentMagnitude <= previousMagnitude &&
      currentMagnitude <= nextMagnitude &&
      (currentMagnitude < previousMagnitude || currentMagnitude < nextMagnitude);

    if (!isLocalMinimum || !evaluation.segmentIsSafe(previous.y, next.y)) {
      continue;
    }

    const refined = minimizeAbsoluteValue(previous.y, next.y, evaluation, step);
    if (refined === null) {
      continue;
    }

    const candidate = validateRootCandidate(
      refined,
      previous.y,
      next.y,
      evaluation,
      zeroTolerance,
      step
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const levels = dedupeRootCandidates(candidates, max - min).filter(
    (level) => !intervals.some((interval) => level >= interval.min && level <= interval.max)
  );
  return { levels, intervals };
}

function findExactZeroIntervals(
  samples: FunctionSample[],
  evaluation: AutonomousEvaluation,
  sampleStep: number
): { intervals: EquilibriumInterval[]; coveredSampleIndexes: Set<number> } {
  const intervals: EquilibriumInterval[] = [];
  const coveredSampleIndexes = new Set<number>();
  let index = 0;

  while (index < samples.length) {
    if (!isExactRegularZero(samples[index].diagnostics)) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index + 1 < samples.length && isExactRegularZero(samples[index + 1].diagnostics)) {
      index += 1;
    }
    const runEnd = index;

    const fillsSampleGaps =
      runEnd > runStart && zeroRunFillsSampleGaps(samples, runStart, runEnd, evaluation);

    if (fillsSampleGaps) {
      for (let covered = runStart; covered <= runEnd; covered += 1) {
        coveredSampleIndexes.add(covered);
      }

      const min =
        runStart === 0
          ? samples[runStart].y
          : refineZeroIntervalBoundary(
              samples[runStart].y,
              samples[runStart - 1].y,
              evaluation,
              sampleStep
            );
      const max =
        runEnd === samples.length - 1
          ? samples[runEnd].y
          : refineZeroIntervalBoundary(
              samples[runEnd].y,
              samples[runEnd + 1].y,
              evaluation,
              sampleStep
            );
      const minDiagnostics = evaluation.evaluate(min);
      const maxDiagnostics = evaluation.evaluate(max);

      if (max > min) {
        intervals.push({
          min,
          max,
          minInclusive: isExactRegularZero(minDiagnostics),
          maxInclusive: isExactRegularZero(maxDiagnostics)
        });
      }
    }

    index += 1;
  }

  return { intervals, coveredSampleIndexes };
}

function refineZeroIntervalBoundary(
  zeroPoint: number,
  outsidePoint: number,
  evaluation: AutonomousEvaluation,
  sampleStep: number
): number {
  let zeroSide = zeroPoint;
  let outsideSide = outsidePoint;
  const tolerance = coordinateRefinementTolerance(zeroPoint, outsidePoint, sampleStep);

  for (let iteration = 0; iteration < MAX_REFINEMENT_ITERATIONS; iteration += 1) {
    if (Math.abs(zeroSide - outsideSide) <= tolerance) {
      break;
    }
    const midpoint = (zeroSide + outsideSide) / 2;
    if (isExactRegularZero(evaluation.evaluate(midpoint))) {
      zeroSide = midpoint;
    } else {
      outsideSide = midpoint;
    }
  }

  const candidate = (zeroSide + outsideSide) / 2;
  if (Math.abs(candidate) <= tolerance * 2) {
    return 0;
  }

  const rounded = Number(candidate.toPrecision(12));
  return Math.abs(candidate - rounded) <= tolerance * 2 ? rounded : candidate;
}

function isExactRegularZero(diagnostics: EvaluationDiagnostics): boolean {
  return diagnostics.status === "ok" && diagnostics.value === 0;
}

function zeroRunFillsSampleGaps(
  samples: FunctionSample[],
  start: number,
  end: number,
  evaluation: AutonomousEvaluation
): boolean {
  for (let index = start; index < end; index += 1) {
    const midpoint = (samples[index].y + samples[index + 1].y) / 2;
    if (!isExactRegularZero(evaluation.evaluate(midpoint))) {
      return false;
    }
  }
  return true;
}

function sampleFunction(
  evaluate: (y: number) => EvaluationDiagnostics,
  min: number,
  max: number,
  sampleCount: number
): FunctionSample[] {
  const step = (max - min) / sampleCount;
  const samples = new Array<FunctionSample>(sampleCount + 1);

  for (let index = 0; index <= sampleCount; index += 1) {
    const y = index === sampleCount ? max : min + step * index;
    samples[index] = { y, diagnostics: evaluate(y) };
  }

  return samples;
}

function refineSignChangingRoot(
  start: FunctionSample,
  end: FunctionSample,
  evaluation: AutonomousEvaluation,
  zeroTolerance: number,
  sampleStep: number
): RootCandidate | null {
  let left = start.y;
  let right = end.y;
  let leftValue = start.diagnostics.value;
  let rightValue = end.diagnostics.value;
  const coordinateTolerance = coordinateRefinementTolerance(left, right);

  for (let iteration = 0; iteration < MAX_REFINEMENT_ITERATIONS; iteration += 1) {
    const midpoint = (left + right) / 2;
    const diagnostics = evaluation.evaluate(midpoint);
    if (!isFiniteDomainValue(diagnostics)) {
      return null;
    }

    if (diagnostics.value === 0) {
      return validateRootCandidate(
        midpoint,
        start.y,
        end.y,
        evaluation,
        zeroTolerance,
        sampleStep
      );
    }

    if (haveOppositeSigns(leftValue, diagnostics.value)) {
      right = midpoint;
      rightValue = diagnostics.value;
    } else {
      left = midpoint;
      leftValue = diagnostics.value;
    }

    if (Math.abs(right - left) <= coordinateTolerance) {
      break;
    }
  }

  const candidate =
    Math.abs(leftValue) <= Math.abs(rightValue) ? left : right;
  return validateRootCandidate(
    candidate,
    start.y,
    end.y,
    evaluation,
    zeroTolerance,
    sampleStep
  );
}

function minimizeAbsoluteValue(
  start: number,
  end: number,
  evaluation: AutonomousEvaluation,
  sampleStep: number
): number | null {
  let left = start;
  let right = end;
  let innerLeft = right - GOLDEN_RATIO_COMPLEMENT * (right - left);
  let innerRight = left + GOLDEN_RATIO_COMPLEMENT * (right - left);
  let leftMagnitude = safeMagnitude(evaluation.evaluate(innerLeft));
  let rightMagnitude = safeMagnitude(evaluation.evaluate(innerRight));
  const tolerance = coordinateRefinementTolerance(start, end, sampleStep);

  for (let iteration = 0; iteration < MAX_REFINEMENT_ITERATIONS; iteration += 1) {
    if (!Number.isFinite(leftMagnitude) || !Number.isFinite(rightMagnitude)) {
      return null;
    }
    if (Math.abs(right - left) <= tolerance) {
      break;
    }

    if (leftMagnitude <= rightMagnitude) {
      right = innerRight;
      innerRight = innerLeft;
      rightMagnitude = leftMagnitude;
      innerLeft = right - GOLDEN_RATIO_COMPLEMENT * (right - left);
      leftMagnitude = safeMagnitude(evaluation.evaluate(innerLeft));
    } else {
      left = innerLeft;
      innerLeft = innerRight;
      leftMagnitude = rightMagnitude;
      innerRight = left + GOLDEN_RATIO_COMPLEMENT * (right - left);
      rightMagnitude = safeMagnitude(evaluation.evaluate(innerRight));
    }
  }

  return leftMagnitude <= rightMagnitude ? innerLeft : innerRight;
}

function validateRootCandidate(
  candidate: number,
  searchStart: number,
  searchEnd: number,
  evaluation: AutonomousEvaluation,
  zeroTolerance: number,
  sampleStep: number
): RootCandidate | null {
  const diagnostics = evaluation.evaluate(candidate);
  if (!isFiniteDomainValue(diagnostics)) {
    return null;
  }

  const searchWidth = Math.abs(searchEnd - searchStart);
  const coordinateScale = Math.max(1, Math.abs(candidate));
  const probeRadius = Math.max(
    coordinateScale * Number.EPSILON * 256,
    Math.min(searchWidth / 8, Math.abs(sampleStep) * 1e-3)
  );
  const lowerProbe = Math.max(Math.min(searchStart, searchEnd), candidate - probeRadius);
  const upperProbe = Math.min(Math.max(searchStart, searchEnd), candidate + probeRadius);
  const lowerDiagnostics = evaluation.evaluate(lowerProbe);
  const upperDiagnostics = evaluation.evaluate(upperProbe);
  const localScale = Math.max(
    Math.abs(diagnostics.value),
    finiteMagnitude(lowerDiagnostics),
    finiteMagnitude(upperDiagnostics),
    Number.MIN_VALUE
  );
  const normalizedResidual = Math.abs(diagnostics.value) / localScale;

  if (normalizedResidual > zeroTolerance) {
    return null;
  }

  return { y: candidate, normalizedResidual };
}

function sampleLooksLikeRoot(
  samples: FunctionSample[],
  index: number,
  zeroTolerance: number
): boolean {
  const value = Math.abs(samples[index].diagnostics.value);
  if (value === 0) {
    return true;
  }

  const neighborScale = Math.max(
    index > 0 ? finiteMagnitude(samples[index - 1].diagnostics) : 0,
    index + 1 < samples.length ? finiteMagnitude(samples[index + 1].diagnostics) : 0,
    Number.MIN_VALUE
  );
  return value <= zeroTolerance * neighborScale;
}

function dedupeRootCandidates(candidates: RootCandidate[], span: number): number[] {
  const sorted = candidates
    .filter((candidate) => Number.isFinite(candidate.y))
    .sort((left, right) => left.y - right.y);
  const deduped: RootCandidate[] = [];

  for (const candidate of sorted) {
    const previous = deduped[deduped.length - 1];
    if (!previous) {
      deduped.push(candidate);
      continue;
    }

    const scale = Math.max(1, Math.abs(previous.y), Math.abs(candidate.y), Math.abs(span));
    const tolerance = Math.max(scale * Number.EPSILON * 256, Math.abs(span) * 1e-11);
    if (Math.abs(candidate.y - previous.y) <= tolerance) {
      if (candidate.normalizedResidual < previous.normalizedResidual) {
        deduped[deduped.length - 1] = candidate;
      }
      continue;
    }

    deduped.push(candidate);
  }

  return deduped.map((candidate) => candidate.y);
}

function isFiniteDomainValue(diagnostics: EvaluationDiagnostics): boolean {
  return diagnostics.status !== "invalid" && Number.isFinite(diagnostics.value);
}

function isRegularDomainValue(diagnostics: EvaluationDiagnostics): boolean {
  return diagnostics.status === "ok" && Number.isFinite(diagnostics.value);
}

function safeMagnitude(diagnostics: EvaluationDiagnostics): number {
  return isFiniteDomainValue(diagnostics) ? Math.abs(diagnostics.value) : Number.POSITIVE_INFINITY;
}

function finiteMagnitude(diagnostics: EvaluationDiagnostics): number {
  return isFiniteDomainValue(diagnostics) ? Math.abs(diagnostics.value) : 0;
}

function haveOppositeSigns(left: number, right: number): boolean {
  return (left < 0 && right > 0) || (left > 0 && right < 0);
}

function coordinateRefinementTolerance(
  start: number,
  end: number,
  sampleStep = Math.abs(end - start)
): number {
  const scale = Math.max(1, Math.abs(start), Math.abs(end));
  return Math.max(
    scale * Number.EPSILON * 64,
    Math.abs(sampleStep) * 1e-12
  );
}

function normalizeSampleCount(sampleCount: number | undefined): number {
  if (sampleCount === undefined || !Number.isFinite(sampleCount)) {
    return DEFAULT_SAMPLE_COUNT;
  }
  return Math.max(16, Math.round(sampleCount));
}

function normalizeZeroTolerance(tolerance: number | undefined): number {
  if (tolerance === undefined || !Number.isFinite(tolerance) || tolerance <= 0) {
    return DEFAULT_ZERO_TOLERANCE;
  }
  return Math.max(Number.EPSILON, tolerance);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function formatEquilibriumSetMessage(
  levels: number[],
  intervals: EquilibriumInterval[]
): string {
  const intervalLabel =
    intervals.length === 1
      ? "one equilibrium interval"
      : `${intervals.length} equilibrium intervals`;
  if (levels.length === 0) {
    return `Detected ${intervalLabel} in the visible range.`;
  }
  const levelLabel =
    levels.length === 1 ? "one isolated level" : `${levels.length} isolated levels`;
  return `Detected ${intervalLabel} and ${levelLabel} in the visible range.`;
}
