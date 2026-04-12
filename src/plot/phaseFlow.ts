import type { AxisBounds } from "../types";

export type PhaseFlowDirection = "up" | "down";
export type EquilibriumStability =
  | "stable"
  | "unstable"
  | "semistable-from-above"
  | "semistable-from-below";

export interface PhaseFlowBand {
  yStart: number;
  yEnd: number;
  direction: PhaseFlowDirection;
}

export interface EquilibriumMarker {
  level: number;
  stability: EquilibriumStability;
}

export function computePhaseFlowBands(
  bounds: AxisBounds,
  levels: number[],
  evaluateAutonomous: (y: number) => number,
  zeroTolerance = 1e-6
): PhaseFlowBand[] {
  const visibleLevels = dedupeLevels(levels, zeroTolerance).filter(
    (level) => level > bounds.yMin + zeroTolerance && level < bounds.yMax - zeroTolerance
  );

  if (visibleLevels.length === 0) {
    return [];
  }

  const boundaries = [bounds.yMin, ...visibleLevels, bounds.yMax];
  const bands: PhaseFlowBand[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const yStart = boundaries[index];
    const yEnd = boundaries[index + 1];

    if (yEnd - yStart <= zeroTolerance) {
      continue;
    }

    const sampleY = (yStart + yEnd) / 2;
    const slope = evaluateAutonomous(sampleY);

    if (!Number.isFinite(slope) || Math.abs(slope) <= zeroTolerance) {
      continue;
    }

    bands.push({
      yStart,
      yEnd,
      direction: slope > 0 ? "up" : "down"
    });
  }

  return bands;
}

export function classifyEquilibriumMarkers(
  bounds: AxisBounds,
  levels: number[],
  evaluateAutonomous: (y: number) => number,
  zeroTolerance = 1e-6
): EquilibriumMarker[] {
  const visibleLevels = dedupeLevels(levels, zeroTolerance).filter(
    (level) => level > bounds.yMin + zeroTolerance && level < bounds.yMax - zeroTolerance
  );

  if (visibleLevels.length === 0) {
    return [];
  }

  const boundaries = [bounds.yMin, ...visibleLevels, bounds.yMax];
  const intervalDirections: Array<PhaseFlowDirection | null> = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];

    if (end - start <= zeroTolerance) {
      intervalDirections.push(null);
      continue;
    }

    const sampleY = (start + end) / 2;
    const slope = evaluateAutonomous(sampleY);

    if (!Number.isFinite(slope) || Math.abs(slope) <= zeroTolerance) {
      intervalDirections.push(null);
      continue;
    }

    intervalDirections.push(slope > 0 ? "up" : "down");
  }

  return visibleLevels.map((level, index) => ({
    level,
    stability: classifyFromAdjacentDirections(intervalDirections[index], intervalDirections[index + 1])
  }));
}

function classifyFromAdjacentDirections(
  lowerDirection: PhaseFlowDirection | null | undefined,
  upperDirection: PhaseFlowDirection | null | undefined
): EquilibriumStability {
  const towardFromBelow = lowerDirection === "up";
  const towardFromAbove = upperDirection === "down";

  if (towardFromBelow && towardFromAbove) {
    return "stable";
  }

  if (!towardFromBelow && !towardFromAbove) {
    return "unstable";
  }

  if (towardFromAbove) {
    return "semistable-from-above";
  }

  return "semistable-from-below";
}

function dedupeLevels(levels: number[], tolerance: number): number[] {
  const sorted = [...levels]
    .filter((level) => Number.isFinite(level))
    .sort((left, right) => left - right);

  const deduped: number[] = [];
  for (const level of sorted) {
    if (deduped.length === 0 || Math.abs(level - deduped[deduped.length - 1]) > tolerance) {
      deduped.push(level);
    }
  }

  return deduped;
}
