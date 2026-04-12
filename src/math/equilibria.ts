import type { AxisBounds, EquilibriumResult } from "../types";
import type { CompiledExpression } from "./parser";

interface RootSearchOptions {
  sampleCount?: number;
  zeroTolerance?: number;
}

export function findEquilibria(
  expression: CompiledExpression,
  bounds: AxisBounds,
  options: RootSearchOptions = {}
): EquilibriumResult {
  if (!expression.isAutonomous || !expression.evaluateAutonomous) {
    return {
      mode: "not-autonomous",
      levels: [],
      message: "Equilibrium lines are available for autonomous equations only."
    };
  }

  const evaluate = expression.evaluateAutonomous;

  if (!expression.dependsOnY) {
    const constantValue = evaluate(bounds.yMin);
    if (approximatelyZero(constantValue, options.zeroTolerance ?? 1e-8)) {
      return {
        mode: "all",
        levels: [],
        message: "Every horizontal line is an equilibrium because the ODE is identically zero."
      };
    }

    return {
      mode: "none",
      levels: [],
      message: "This autonomous equation has no equilibria in the visible range."
    };
  }

  const levels = findRootsBySampling(evaluate, bounds.yMin, bounds.yMax, options);

  if (levels.length === 0) {
    return {
      mode: "none",
      levels: [],
      message: "No equilibrium level was detected inside the visible y-range."
    };
  }

  return {
    mode: "roots",
    levels,
    message:
      levels.length === 1
        ? `One equilibrium level detected at y = ${formatNumber(levels[0])}.`
        : `${levels.length} equilibrium levels detected in the visible range.`
  };
}

function findRootsBySampling(
  fn: (y: number) => number,
  min: number,
  max: number,
  options: RootSearchOptions
): number[] {
  const sampleCount = options.sampleCount ?? 720;
  const zeroTolerance = options.zeroTolerance ?? 1e-6;
  const samples = sampleFunction(fn, min, max, sampleCount);
  const roots: number[] = [];

  for (let index = 0; index < samples.length - 1; index += 1) {
    const current = samples[index];
    const next = samples[index + 1];

    if (!Number.isFinite(current.value) || !Number.isFinite(next.value)) {
      continue;
    }

    if (approximatelyZero(current.value, zeroTolerance)) {
      roots.push(current.y);
      continue;
    }

    if (current.value === 0 || next.value === 0 || current.value * next.value < 0) {
      roots.push(bisectRoot(fn, current.y, next.y, zeroTolerance, 60));
      continue;
    }

    if (index > 0 && index < samples.length - 2) {
      const previous = samples[index - 1];
      const afterNext = samples[index + 2];

      if (!Number.isFinite(previous.value) || !Number.isFinite(afterNext.value)) {
        continue;
      }

      const valley =
        Math.abs(current.value) <= Math.abs(previous.value) &&
        Math.abs(current.value) <= Math.abs(next.value);
      const hill =
        Math.abs(next.value) <= Math.abs(current.value) &&
        Math.abs(next.value) <= Math.abs(afterNext.value);

      if (valley && Math.abs(current.value) < zeroTolerance * 25) {
        roots.push(current.y);
      }

      if (hill && Math.abs(next.value) < zeroTolerance * 25) {
        roots.push(next.y);
      }
    }
  }

  const lastSample = samples[samples.length - 1];
  if (Number.isFinite(lastSample.value) && approximatelyZero(lastSample.value, zeroTolerance)) {
    roots.push(lastSample.y);
  }

  return dedupeSortedRoots(roots, Math.max((max - min) / sampleCount, 1e-4));
}

function sampleFunction(
  fn: (y: number) => number,
  min: number,
  max: number,
  sampleCount: number
): Array<{ y: number; value: number }> {
  const step = (max - min) / sampleCount;
  const samples: Array<{ y: number; value: number }> = [];

  for (let index = 0; index <= sampleCount; index += 1) {
    const y = min + step * index;
    const value = fn(y);
    samples.push({ y, value });
  }

  return samples;
}

function bisectRoot(
  fn: (y: number) => number,
  start: number,
  end: number,
  tolerance: number,
  maxIterations: number
): number {
  let left = start;
  let right = end;
  let leftValue = fn(left);
  let rightValue = fn(right);

  if (approximatelyZero(leftValue, tolerance)) {
    return left;
  }

  if (approximatelyZero(rightValue, tolerance)) {
    return right;
  }

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const midpoint = (left + right) / 2;
    const midpointValue = fn(midpoint);

    if (!Number.isFinite(midpointValue) || approximatelyZero(midpointValue, tolerance)) {
      return midpoint;
    }

    if (leftValue * midpointValue <= 0) {
      right = midpoint;
      rightValue = midpointValue;
    } else {
      left = midpoint;
      leftValue = midpointValue;
    }

    if (Math.abs(right - left) <= tolerance) {
      return (left + right) / 2;
    }
  }

  return (left + right) / 2;
}

function dedupeSortedRoots(roots: number[], tolerance: number): number[] {
  const sorted = roots
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  const deduped: number[] = [];
  for (const value of sorted) {
    if (deduped.length === 0 || Math.abs(value - deduped[deduped.length - 1]) > tolerance) {
      deduped.push(value);
    }
  }

  return deduped;
}

function approximatelyZero(value: number, tolerance: number): boolean {
  return Math.abs(value) <= tolerance;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(4)).toString();
}
