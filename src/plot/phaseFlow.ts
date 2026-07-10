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

export interface PhaseFlowAnalysis {
  bands: PhaseFlowBand[];
  markers: EquilibriumMarker[];
}

const SINGULAR_INTERVAL_SUBDIVISIONS = 48;
const LOCAL_DIRECTION_PROBES = [1e-6, 1e-4, 1e-2, 0.1, 0.5] as const;

export function computePhaseFlowBands(
  bounds: AxisBounds,
  levels: number[],
  evaluateAutonomous: (y: number) => number,
  zeroTolerance = 1e-6
): PhaseFlowBand[] {
  return analyzePhaseFlow(bounds, levels, evaluateAutonomous, zeroTolerance).bands;
}

export function analyzePhaseFlow(
  bounds: AxisBounds,
  levels: number[],
  evaluateAutonomous: (y: number) => number,
  zeroTolerance = 1e-6,
  isIntervalInDomain?: (start: number, end: number) => boolean
): PhaseFlowAnalysis {
  const visibleLevels = dedupeLevels(levels, zeroTolerance).filter(
    (level) => level > bounds.yMin + zeroTolerance && level < bounds.yMax - zeroTolerance
  );

  if (visibleLevels.length === 0) {
    return { bands: [], markers: [] };
  }

  const boundaries = [bounds.yMin, ...visibleLevels, bounds.yMax];
  const bands: PhaseFlowBand[] = [];

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const yStart = boundaries[index];
    const yEnd = boundaries[index + 1];

    if (yEnd - yStart <= zeroTolerance) {
      continue;
    }

    bands.push(
      ...computeBandsForInterval(
        yStart,
        yEnd,
        evaluateAutonomous,
        zeroTolerance,
        isIntervalInDomain
      )
    );
  }

  return {
    bands,
    markers: visibleLevels.map((level, index) => ({
      level,
      stability: classifyFromAdjacentDirections(
        findLocalDirection(
          level,
          boundaries[index],
          evaluateAutonomous,
          isIntervalInDomain
        ),
        findLocalDirection(
          level,
          boundaries[index + 2],
          evaluateAutonomous,
          isIntervalInDomain
        )
      )
    }))
  };
}

function computeBandsForInterval(
  start: number,
  end: number,
  evaluate: (y: number) => number,
  zeroTolerance: number,
  isIntervalInDomain?: (start: number, end: number) => boolean
): PhaseFlowBand[] {
  if (!isIntervalInDomain || isIntervalInDomain(start, end)) {
    const direction = evaluateDirection((start + end) / 2, evaluate, zeroTolerance);
    return direction ? [{ yStart: start, yEnd: end, direction }] : [];
  }

  const bands: PhaseFlowBand[] = [];
  const width = (end - start) / SINGULAR_INTERVAL_SUBDIVISIONS;

  for (let index = 0; index < SINGULAR_INTERVAL_SUBDIVISIONS; index += 1) {
    const segmentStart = start + index * width;
    const segmentEnd = index === SINGULAR_INTERVAL_SUBDIVISIONS - 1 ? end : segmentStart + width;
    const direction = isIntervalInDomain(segmentStart, segmentEnd)
      ? evaluateDirection((segmentStart + segmentEnd) / 2, evaluate, zeroTolerance)
      : null;
    const previous = bands[bands.length - 1];

    if (!direction) {
      continue;
    }

    if (
      previous &&
      previous.direction === direction &&
      Math.abs(previous.yEnd - segmentStart) <= Math.abs(width) * 1e-9
    ) {
      previous.yEnd = segmentEnd;
    } else {
      bands.push({ yStart: segmentStart, yEnd: segmentEnd, direction });
    }
  }

  return bands;
}

function findLocalDirection(
  equilibrium: number,
  boundary: number,
  evaluate: (y: number) => number,
  isIntervalInDomain?: (start: number, end: number) => boolean
): PhaseFlowDirection | null {
  for (const fraction of LOCAL_DIRECTION_PROBES) {
    const sample = equilibrium + (boundary - equilibrium) * fraction;
    if (sample === equilibrium) {
      continue;
    }
    if (isIntervalInDomain && !isIntervalInDomain(equilibrium, sample)) {
      continue;
    }

    const slope = evaluate(sample);
    if (Number.isFinite(slope) && slope !== 0) {
      return slope > 0 ? "up" : "down";
    }
  }

  return null;
}

function evaluateDirection(
  sample: number,
  evaluate: (y: number) => number,
  zeroTolerance: number
): PhaseFlowDirection | null {
  const slope = evaluate(sample);
  if (!Number.isFinite(slope) || Math.abs(slope) <= zeroTolerance) {
    return null;
  }
  return slope > 0 ? "up" : "down";
}

export function classifyEquilibriumMarkers(
  bounds: AxisBounds,
  levels: number[],
  evaluateAutonomous: (y: number) => number,
  zeroTolerance = 1e-6
): EquilibriumMarker[] {
  return analyzePhaseFlow(bounds, levels, evaluateAutonomous, zeroTolerance).markers;
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
