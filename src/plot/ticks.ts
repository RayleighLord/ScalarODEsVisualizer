export interface NiceTickLayout {
  major: number[];
  minor: number[];
  majorStep: number;
}

const MAX_TICKS_PER_STEP = 10_000;
const MAX_SCIENTIFIC_FRACTION_DIGITS = 16;
const MAX_FIXED_FRACTION_DIGITS = 18;
const MIN_NORMAL_NUMBER = 2 ** -1022;

export function computeNiceTickLayout(
  min: number,
  max: number,
  targetCount = 7,
  minorDivisions = 5
): NiceTickLayout {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return { major: [], minor: [], majorStep: Number.NaN };
  }

  const roughStep = span / Math.max(targetCount, 2);
  const resolution = rangeResolution(min, max);
  const majorStep = niceStep(Math.max(roughStep, resolution));
  const major = ticksForStep(min, max, majorStep);
  const subdivisions = Math.max(1, Math.round(minorDivisions));
  const minorStep = majorStep / subdivisions;
  const tolerance = Math.max(Math.abs(majorStep) * 1e-9, resolution);
  const minor =
    subdivisions === 1
      ? []
      : withoutOverlappingTicks(ticksForStep(min, max, minorStep), major, tolerance);

  return { major, minor, majorStep };
}

export function computeNiceTicks(min: number, max: number, targetCount = 7): number[] {
  return computeNiceTickLayout(min, max, targetCount).major;
}

function ticksForStep(min: number, max: number, step: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) {
    return [];
  }

  const span = max - min;
  if (!Number.isFinite(span) || span < 0) {
    return [];
  }

  const resolution = rangeResolution(min, max);
  if (step < resolution) {
    return [];
  }

  const tolerance = Math.max(Math.abs(step) * 1e-9, resolution);
  const toleranceInSteps = tolerance / step;
  const minInSteps = min / step;
  if (!Number.isFinite(toleranceInSteps) || !Number.isFinite(minInSteps)) {
    return [];
  }

  let startMultiple = Math.ceil(minInSteps - toleranceInSteps);
  let start = startMultiple * step;
  if (!Number.isFinite(start)) {
    // A tolerance-adjusted multiple can sit just beyond Number.MAX_VALUE.
    // Move one lattice point toward zero rather than carrying an infinity
    // into every subsequent index calculation.
    startMultiple += startMultiple < 0 ? 1 : -1;
    start = startMultiple * step;
  }
  if (!Number.isFinite(start)) {
    return [];
  }

  const candidateCount = Math.min(
    MAX_TICKS_PER_STEP,
    Math.max(1, Math.ceil(span / step + 2 * toleranceInSteps) + 2)
  );
  const ticks: number[] = [];

  for (let index = 0; index < candidateCount; index += 1) {
    const candidate = start + index * step;
    if (!Number.isFinite(candidate) || (candidate > max && candidate - max > tolerance)) {
      break;
    }

    const tick = normalizeTick(candidate, step);
    if (tick < min || tick > max || tick === ticks.at(-1)) {
      continue;
    }

    ticks.push(tick);
  }

  return ticks;
}

function normalizeTick(candidate: number, step: number): number {
  if (candidate === 0) {
    return 0;
  }

  // Clean up arithmetic noise only when the candidate is already within a few
  // representable values of the corresponding decimal lattice point. A fixed
  // number of fraction digits loses valid ticks in narrow, offset windows.
  const candidateExponent = Math.floor(Math.log10(Math.abs(candidate)));
  const stepExponent = Math.floor(Math.log10(step));
  const significantDigits = Math.max(
    1,
    Math.min(17, candidateExponent - stepExponent + 1)
  );
  const rounded = Number(candidate.toPrecision(significantDigits));
  const roundingTolerance =
    4 * Math.max(numberResolution(candidate), numberResolution(rounded));

  return Number.isFinite(rounded) && Math.abs(candidate - rounded) <= roundingTolerance
    ? rounded
    : candidate;
}

function withoutOverlappingTicks(minor: number[], major: number[], tolerance: number): number[] {
  let majorIndex = 0;

  return minor.filter((tick) => {
    while (majorIndex < major.length && major[majorIndex] < tick - tolerance) {
      majorIndex += 1;
    }

    return majorIndex >= major.length || Math.abs(tick - major[majorIndex]) > tolerance;
  });
}

function rangeResolution(min: number, max: number): number {
  return Math.max(numberResolution(min), numberResolution(max));
}

function numberResolution(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0 || magnitude < MIN_NORMAL_NUMBER) {
    return Number.MIN_VALUE;
  }

  // Within a binary exponent band, adjacent IEEE-754 doubles are 2^(e - 52) apart.
  // Clamp the exponent because Math.log2(Number.MAX_VALUE) rounds up to 1024.
  const exponent = Math.min(1023, Math.floor(Math.log2(magnitude)));
  return 2 ** (exponent - 52);
}

export function formatTick(value: number, majorStep?: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;

  if (Math.abs(normalized) >= 1000 || (Math.abs(normalized) > 0 && Math.abs(normalized) < 0.01)) {
    return normalized.toExponential(
      resolveTickFractionDigits(normalized, majorStep, true, 1)
    );
  }

  const rounded = Number(
    normalized.toFixed(resolveTickFractionDigits(normalized, majorStep, false, 4))
  );
  return `${rounded}`;
}

export function formatTickLatex(value: number, majorStep?: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;

  if (Math.abs(normalized) >= 1000 || (Math.abs(normalized) > 0 && Math.abs(normalized) < 0.01)) {
    const fractionDigits = resolveTickFractionDigits(normalized, majorStep, true, 1);
    const [mantissaText, exponentText] = normalized.toExponential(fractionDigits).split("e");
    const mantissa = Number(mantissaText);
    const exponent = Number(exponentText);
    return `${mantissa} \\times 10^{${exponent}}`;
  }

  const rounded = Number(
    normalized.toFixed(resolveTickFractionDigits(normalized, majorStep, false, 4))
  );
  return `${rounded}`;
}

function resolveTickFractionDigits(
  value: number,
  majorStep: number | undefined,
  scientific: boolean,
  fallback: number
): number {
  if (majorStep === undefined || !Number.isFinite(majorStep) || majorStep <= 0) {
    return fallback;
  }

  const stepExponent = Math.floor(Math.log10(Math.abs(majorStep)));
  const requestedDigits = scientific
    ? Math.floor(Math.log10(Math.abs(value))) - stepExponent
    : -stepExponent;
  const maximumDigits = scientific
    ? MAX_SCIENTIFIC_FRACTION_DIGITS
    : MAX_FIXED_FRACTION_DIGITS;
  return Math.max(0, Math.min(maximumDigits, requestedDigits));
}

function niceStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) {
    return Number.NaN;
  }

  const exponent = Math.floor(Math.log10(step));
  if (exponent < -323) {
    return step;
  }

  const fraction = step / 10 ** exponent;

  if (fraction <= 1) {
    return 1 * 10 ** exponent;
  }

  if (fraction <= 2) {
    return 2 * 10 ** exponent;
  }

  if (fraction <= 5) {
    return 5 * 10 ** exponent;
  }

  return 10 * 10 ** exponent;
}
