export function computeNiceTicks(min: number, max: number, targetCount = 7): number[] {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return [];
  }

  const roughStep = span / Math.max(targetCount, 2);
  const step = niceStep(roughStep);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];

  for (let value = start; value <= max + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(12)));
  }

  return ticks;
}

export function formatTick(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;

  if (Math.abs(normalized) >= 1000 || (Math.abs(normalized) > 0 && Math.abs(normalized) < 0.01)) {
    return normalized.toExponential(1);
  }

  const rounded = Number(normalized.toFixed(4));
  return `${rounded}`;
}

export function formatTickLatex(value: number): string {
  const normalized = Object.is(value, -0) ? 0 : value;

  if (Math.abs(normalized) >= 1000 || (Math.abs(normalized) > 0 && Math.abs(normalized) < 0.01)) {
    const [mantissaText, exponentText] = normalized.toExponential(1).split("e");
    const mantissa = Number(mantissaText);
    const exponent = Number(exponentText);
    return `${mantissa} \\times 10^{${exponent}}`;
  }

  const rounded = Number(normalized.toFixed(4));
  return `${rounded}`;
}

function niceStep(step: number): number {
  const exponent = Math.floor(Math.log10(step));
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
