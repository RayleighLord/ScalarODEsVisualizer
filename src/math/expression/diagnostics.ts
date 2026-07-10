import type {
  EvaluationDiagnostics,
  EvaluationOptions,
  EvaluationStatus,
  NormalizedEvaluationOptions
} from "./api";

const DEFAULT_DOMAIN_TOLERANCE = 1e-8;
const DEFAULT_SEGMENT_SAMPLE_COUNT = 8;

export const DEFAULT_NORMALIZED_EVALUATION_OPTIONS: NormalizedEvaluationOptions = {
  domainTolerance: DEFAULT_DOMAIN_TOLERANCE,
  derivativeMagnitudeLimit: undefined,
  segmentSampleCount: DEFAULT_SEGMENT_SAMPLE_COUNT
};

export function normalizeEvaluationOptions(
  options: EvaluationOptions
): NormalizedEvaluationOptions {
  const requestedDomainTolerance = options.domainTolerance;
  const domainTolerance =
    requestedDomainTolerance !== undefined &&
    Number.isFinite(requestedDomainTolerance) &&
    requestedDomainTolerance > 0
      ? requestedDomainTolerance
      : DEFAULT_DOMAIN_TOLERANCE;
  const requestedSampleCount = options.segmentSampleCount;
  const segmentSampleCount =
    requestedSampleCount !== undefined && Number.isFinite(requestedSampleCount)
      ? Math.max(1, Math.round(requestedSampleCount))
      : DEFAULT_SEGMENT_SAMPLE_COUNT;

  return {
    domainTolerance,
    derivativeMagnitudeLimit: options.derivativeMagnitudeLimit,
    segmentSampleCount
  };
}

export function finalizeDiagnostics(
  value: number,
  status: EvaluationStatus,
  options: NormalizedEvaluationOptions,
  reason?: string
): EvaluationDiagnostics {
  if (!Number.isFinite(value)) {
    return {
      value,
      status: "invalid",
      reason: reason ?? "The expression evaluates to a non-finite value."
    };
  }

  if (
    options.derivativeMagnitudeLimit !== undefined &&
    Math.abs(value) > options.derivativeMagnitudeLimit
  ) {
    return {
      value,
      status: mergeStatuses(status, "near-singular"),
      reason: reason ?? "The derivative is too large to step through reliably."
    };
  }

  return { value, status, reason };
}

function mergeStatuses(...statuses: EvaluationStatus[]): EvaluationStatus {
  if (statuses.includes("invalid")) {
    return "invalid";
  }

  if (statuses.includes("near-singular")) {
    return "near-singular";
  }

  return "ok";
}
