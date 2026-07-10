import type { ExpressionNode, NumericInterval } from "./model";
import { nodesAreAdditiveInverses, structurallyEqual } from "./evaluator";

/**
 * Computes a conservative interval enclosure for an AST over a rectangular
 * `(t, y)` region. `null` means the operation cannot be bounded safely here.
 */
export function evaluateNodeInterval(
  node: ExpressionNode,
  tRange: NumericInterval,
  yRange: NumericInterval
): NumericInterval | null {
  switch (node.type) {
    case "number":
    case "constant":
      return { min: node.value, max: node.value };
    case "variable":
      return node.name === "t" ? tRange : yRange;
    case "unary": {
      const argument = evaluateNodeInterval(node.argument, tRange, yRange);
      if (!argument) {
        return null;
      }
      return node.operator === "-"
        ? { min: -argument.max, max: -argument.min }
        : argument;
    }
    case "binary": {
      // Ordinary interval arithmetic loses correlations between identical
      // subexpressions. Preserve the two exact cancellation identities used by
      // the evaluator so expressions such as `1e12*y - 1e12*y + 1` do not
      // acquire a fictitious zero-width domain barrier.
      if (
        (node.operator === "-" && structurallyEqual(node.left, node.right)) ||
        (node.operator === "+" && nodesAreAdditiveInverses(node.left, node.right))
      ) {
        return { min: 0, max: 0 };
      }

      const left = evaluateNodeInterval(node.left, tRange, yRange);
      const right = evaluateNodeInterval(node.right, tRange, yRange);
      if (!left || !right) {
        return null;
      }

      switch (node.operator) {
        case "+":
          return finiteInterval(left.min + right.min, left.max + right.max);
        case "-":
          return finiteInterval(left.min - right.max, left.max - right.min);
        case "*":
          return multiplyIntervals(left, right);
        case "/":
          if (right.min <= 0 && right.max >= 0) {
            return null;
          }
          return multiplyIntervals(left, {
            min: Math.min(1 / right.min, 1 / right.max),
            max: Math.max(1 / right.min, 1 / right.max)
          });
        case "^":
          return powerInterval(left, right);
      }
    }
    case "function": {
      const argumentRanges = node.arguments.map((argument) =>
        evaluateNodeInterval(argument, tRange, yRange)
      );
      if (argumentRanges.some((range) => range === null)) {
        return null;
      }

      const ranges = argumentRanges as NumericInterval[];
      const first = ranges[0];
      switch (node.name) {
        case "abs":
          return {
            min:
              first.min <= 0 && first.max >= 0
                ? 0
                : Math.min(Math.abs(first.min), Math.abs(first.max)),
            max: Math.max(Math.abs(first.min), Math.abs(first.max))
          };
        case "acos":
          if (first.min < -1 || first.max > 1) return null;
          return finiteInterval(Math.acos(first.max), Math.acos(first.min));
        case "asin":
          if (first.min < -1 || first.max > 1) return null;
          return finiteInterval(Math.asin(first.min), Math.asin(first.max));
        case "atan":
          return finiteInterval(Math.atan(first.min), Math.atan(first.max));
        case "ceil":
          return finiteInterval(Math.ceil(first.min), Math.ceil(first.max));
        case "cos":
          return trigonometricInterval("cos", first);
        case "cosh": {
          const left = Math.cosh(first.min);
          const right = Math.cosh(first.max);
          return finiteInterval(
            first.min <= 0 && first.max >= 0 ? 1 : Math.min(left, right),
            Math.max(left, right)
          );
        }
        case "exp":
          return finiteInterval(Math.exp(first.min), Math.exp(first.max));
        case "floor":
          return finiteInterval(Math.floor(first.min), Math.floor(first.max));
        case "log":
          if (first.min <= 0) return null;
          return finiteInterval(Math.log(first.min), Math.log(first.max));
        case "max":
          return finiteInterval(
            Math.max(...ranges.map((range) => range.min)),
            Math.max(...ranges.map((range) => range.max))
          );
        case "min":
          return finiteInterval(
            Math.min(...ranges.map((range) => range.min)),
            Math.min(...ranges.map((range) => range.max))
          );
        case "pow":
          return powerInterval(ranges[0], ranges[1]);
        case "round":
          return finiteInterval(Math.round(first.min), Math.round(first.max));
        case "sin":
          return trigonometricInterval("sin", first);
        case "sinh":
          return finiteInterval(Math.sinh(first.min), Math.sinh(first.max));
        case "sqrt":
          if (first.min < 0) return null;
          return finiteInterval(Math.sqrt(first.min), Math.sqrt(first.max));
        case "tan":
          if (containsPeriodicPoint(first, Math.PI / 2, Math.PI)) return null;
          return finiteInterval(Math.tan(first.min), Math.tan(first.max));
        case "tanh":
          return finiteInterval(Math.tanh(first.min), Math.tanh(first.max));
      }
      return null;
    }
  }
}

function finiteInterval(min: number, max: number): NumericInterval | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  return min <= max ? { min, max } : { min: max, max: min };
}

function multiplyIntervals(
  left: NumericInterval,
  right: NumericInterval
): NumericInterval | null {
  const products = [
    left.min * right.min,
    left.min * right.max,
    left.max * right.min,
    left.max * right.max
  ];
  if (products.some((value) => !Number.isFinite(value))) {
    return null;
  }
  return { min: Math.min(...products), max: Math.max(...products) };
}

function powerInterval(
  base: NumericInterval,
  exponent: NumericInterval
): NumericInterval | null {
  if (exponent.min !== exponent.max) {
    return null;
  }

  const power = exponent.min;
  if (!Number.isFinite(power)) {
    return null;
  }

  if (power === 0) {
    return { min: 1, max: 1 };
  }

  if (Number.isInteger(power)) {
    if (power < 0 && base.min <= 0 && base.max >= 0) {
      return null;
    }

    const left = base.min ** power;
    const right = base.max ** power;
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      return null;
    }

    if (power % 2 === 0 && base.min <= 0 && base.max >= 0) {
      return { min: 0, max: Math.max(left, right) };
    }

    return { min: Math.min(left, right), max: Math.max(left, right) };
  }

  if (base.min < 0 || (power < 0 && base.min === 0)) {
    return null;
  }

  const left = base.min ** power;
  const right = base.max ** power;
  return finiteInterval(Math.min(left, right), Math.max(left, right));
}

function trigonometricInterval(
  name: "sin" | "cos",
  input: NumericInterval
): NumericInterval | null {
  if (!Number.isFinite(input.min) || !Number.isFinite(input.max)) {
    return null;
  }
  if (input.max - input.min >= 2 * Math.PI) {
    return { min: -1, max: 1 };
  }

  const left = name === "sin" ? Math.sin(input.min) : Math.cos(input.min);
  const right = name === "sin" ? Math.sin(input.max) : Math.cos(input.max);
  let min = Math.min(left, right);
  let max = Math.max(left, right);
  const maximumOffset = name === "sin" ? Math.PI / 2 : 0;
  const minimumOffset = name === "sin" ? -Math.PI / 2 : Math.PI;
  if (containsPeriodicPoint(input, maximumOffset, 2 * Math.PI)) {
    max = 1;
  }
  if (containsPeriodicPoint(input, minimumOffset, 2 * Math.PI)) {
    min = -1;
  }
  return { min, max };
}

function containsPeriodicPoint(
  interval: NumericInterval,
  offset: number,
  period: number
): boolean {
  const firstIndex = Math.ceil((interval.min - offset) / period);
  return offset + firstIndex * period <= interval.max;
}
