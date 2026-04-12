import type { AxisBounds, CurvePoint } from "../types";

export interface PlotSnapOptions {
  bounds: AxisBounds;
  equilibriumLevels?: number[];
  scaleX: number;
  scaleY: number;
  axisSnapPixels?: number;
  equilibriumSnapPixels?: number;
}

export function snapPointToTargets(
  point: CurvePoint,
  options: PlotSnapOptions
): CurvePoint {
  const axisSnapPixels = options.axisSnapPixels ?? 14;
  const equilibriumSnapPixels = options.equilibriumSnapPixels ?? 10;
  const tCandidates: number[] = [];
  const equilibriumCandidates = dedupeCandidates(options.equilibriumLevels ?? []);
  const yAxisCandidates: number[] = [];

  if (options.bounds.tMin <= 0 && options.bounds.tMax >= 0) {
    tCandidates.push(0);
  }

  if (
    options.bounds.yMin <= 0 &&
    options.bounds.yMax >= 0 &&
    !equilibriumCandidates.some((candidate) => Math.abs(candidate) <= 1e-9)
  ) {
    yAxisCandidates.push(0);
  }

  const snappedY = snapCoordinate(
    point.y,
    equilibriumCandidates,
    options.scaleY,
    equilibriumSnapPixels
  );

  return {
    t: snapCoordinate(point.t, dedupeCandidates(tCandidates), options.scaleX, axisSnapPixels),
    y:
      snappedY !== point.y
        ? snappedY
        : snapCoordinate(point.y, yAxisCandidates, options.scaleY, axisSnapPixels)
  };
}

function snapCoordinate(
  value: number,
  candidates: number[],
  scale: number,
  snapPixels: number
): number {
  if (!Number.isFinite(scale) || scale <= 0 || candidates.length === 0) {
    return value;
  }

  const threshold = snapPixels / scale;
  let best = value;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= threshold && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

function dedupeCandidates(candidates: number[]): number[] {
  const sorted = candidates
    .filter((candidate) => Number.isFinite(candidate))
    .sort((left, right) => left - right);

  const deduped: number[] = [];
  for (const candidate of sorted) {
    if (deduped.length === 0 || Math.abs(candidate - deduped[deduped.length - 1]) > 1e-9) {
      deduped.push(candidate);
    }
  }

  return deduped;
}
