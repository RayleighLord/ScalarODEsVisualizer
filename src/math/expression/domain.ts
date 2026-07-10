import type {
  EvaluationDiagnostics,
  NormalizedEvaluationOptions,
  SegmentDomainCheck
} from "./api";
import { compileNodeEvaluator, evaluateConstantNode } from "./evaluator";
import { evaluateNodeInterval } from "./intervals";
import type { ExpressionNode, NumericInterval } from "./model";

type DomainBoundaryKind = "nonzero" | "lower";

interface DomainSignal {
  key: string;
  boundaryKind: DomainBoundaryKind;
  evaluate: (t: number, y: number) => number;
  interval: (
    tRange: NumericInterval,
    yRange: NumericInterval
  ) => NumericInterval | null;
  classify: (value: number, tolerance: number) => EvaluationDiagnostics;
}

export interface DomainAnalysis {
  hasRestrictions: boolean;
  evaluate: (
    t: number,
    y: number,
    options: NormalizedEvaluationOptions
  ) => EvaluationDiagnostics;
  checkSegment: (
    start: { t: number; y: number },
    end: { t: number; y: number },
    options: NormalizedEvaluationOptions
  ) => SegmentDomainCheck;
}

const MAX_DOMAIN_INTERVAL_DEPTH = 18;
const MAX_DOMAIN_INTERVAL_INSPECTIONS = 256;

/** Builds reusable domain-boundary evaluators for one parsed expression. */
export function analyzeDomain(node: ExpressionNode): DomainAnalysis {
  const signals = collectDomainSignals(node);

  return {
    hasRestrictions: signals.length > 0,
    evaluate: (t, y, options) => evaluateDomainSignals(signals, t, y, options),
    checkSegment: (start, end, options) =>
      checkSegmentDomain(signals, start, end, options)
  };
}

function collectDomainSignals(
  node: ExpressionNode,
  path = "root",
  signals: DomainSignal[] = []
): DomainSignal[] {
  switch (node.type) {
    case "unary":
      return collectDomainSignals(node.argument, `${path}.arg`, signals);
    case "binary":
      collectDomainSignals(node.left, `${path}.left`, signals);
      collectDomainSignals(node.right, `${path}.right`, signals);
      if (node.operator === "/") {
        signals.push(
          createDomainSignal(
            `${path}.denominator`,
            node.right,
            "nonzero",
            (value, tolerance) => classifyNonzeroBoundary(value, tolerance)
          )
        );
      } else if (node.operator === "^") {
        collectPowerDomainSignal(
          node.left,
          node.right,
          `${path}.power-base`,
          signals
        );
      }
      return signals;
    case "function":
      node.arguments.forEach((argument, index) => {
        collectDomainSignals(argument, `${path}.argument${index}`, signals);
      });
      collectFunctionDomainSignals(node, path, signals);
      return signals;
    default:
      return signals;
  }
}

function collectFunctionDomainSignals(
  node: Extract<ExpressionNode, { type: "function" }>,
  path: string,
  signals: DomainSignal[]
): void {
  const argument = node.arguments[0];

  switch (node.name) {
    case "log":
      signals.push(
        createDomainSignal(
          `${path}.log-argument`,
          argument,
          "lower",
          (value, tolerance) =>
            classifyLowerBoundary(
              value,
              true,
              tolerance,
              "log is undefined for non-positive values."
            )
        )
      );
      break;
    case "sqrt":
      signals.push(
        createDomainSignal(
          `${path}.sqrt-argument`,
          argument,
          "lower",
          (value, tolerance) =>
            classifyLowerBoundary(
              value,
              false,
              tolerance,
              "sqrt is undefined for negative values."
            )
        )
      );
      break;
    case "asin":
    case "acos": {
      const lowerBoundary: ExpressionNode = {
        type: "binary",
        operator: "+",
        left: argument,
        right: { type: "number", value: 1 }
      };
      const upperBoundary: ExpressionNode = {
        type: "binary",
        operator: "-",
        left: { type: "number", value: 1 },
        right: argument
      };
      signals.push(
        createDomainSignal(
          `${path}.${node.name}-lower-bound`,
          lowerBoundary,
          "lower",
          (value, tolerance) =>
            classifyLowerBoundary(
              value,
              false,
              tolerance,
              `${node.name} is undefined outside [-1, 1].`
            )
        ),
        createDomainSignal(
          `${path}.${node.name}-upper-bound`,
          upperBoundary,
          "lower",
          (value, tolerance) =>
            classifyLowerBoundary(
              value,
              false,
              tolerance,
              `${node.name} is undefined outside [-1, 1].`
            )
        )
      );
      break;
    }
    case "tan": {
      const cosine: ExpressionNode = {
        type: "function",
        name: "cos",
        arguments: [argument]
      };
      signals.push(
        createDomainSignal(
          `${path}.tan-cosine`,
          cosine,
          "nonzero",
          (value, tolerance) =>
            classifyNonzeroBoundary(
              value,
              tolerance,
              "tan is singular where cos is zero."
            )
        )
      );
      break;
    }
    case "pow":
      collectPowerDomainSignal(
        node.arguments[0],
        node.arguments[1],
        `${path}.power-base`,
        signals
      );
      break;
  }
}

function collectPowerDomainSignal(
  base: ExpressionNode,
  exponentNode: ExpressionNode,
  key: string,
  signals: DomainSignal[]
): void {
  const exponent = evaluateConstantNode(exponentNode);
  if (exponent === null || exponent === 0) {
    return;
  }

  if (Number.isInteger(exponent)) {
    if (exponent < 0) {
      signals.push(
        createDomainSignal(key, base, "nonzero", (value, tolerance) =>
          classifyNonzeroBoundary(
            value,
            tolerance,
            "A negative power is singular where its base is zero."
          )
        )
      );
    }
    return;
  }

  signals.push(
    createDomainSignal(key, base, "lower", (value, tolerance) =>
      classifyLowerBoundary(
        value,
        exponent < 0,
        tolerance,
        exponent < 0
          ? "This real-valued power requires a positive base."
          : "This real-valued power requires a non-negative base."
      )
    )
  );
}

function createDomainSignal(
  key: string,
  boundaryNode: ExpressionNode,
  boundaryKind: DomainBoundaryKind,
  classify: DomainSignal["classify"]
): DomainSignal {
  return {
    key,
    boundaryKind,
    evaluate: compileNodeEvaluator(boundaryNode),
    interval: (tRange, yRange) => evaluateNodeInterval(boundaryNode, tRange, yRange),
    classify
  };
}

function evaluateDomainSignals(
  signals: DomainSignal[],
  t: number,
  y: number,
  options: NormalizedEvaluationOptions
): EvaluationDiagnostics {
  for (const signal of signals) {
    const diagnostics = signal.classify(signal.evaluate(t, y), options.domainTolerance);
    if (diagnostics.status !== "ok") {
      return diagnostics;
    }
  }

  return { value: Number.NaN, status: "ok" };
}

function checkSegmentDomain(
  signals: DomainSignal[],
  start: { t: number; y: number },
  end: { t: number; y: number },
  options: NormalizedEvaluationOptions
): SegmentDomainCheck {
  if (signals.length === 0) {
    return { ok: true, status: "ok" };
  }

  let previousValues: number[] | null = null;

  for (let index = 0; index <= options.segmentSampleCount; index += 1) {
    const progress = index / options.segmentSampleCount;
    const t = start.t + (end.t - start.t) * progress;
    const y = start.y + (end.y - start.y) * progress;
    const currentValues: number[] = [];

    for (let signalIndex = 0; signalIndex < signals.length; signalIndex += 1) {
      const signal = signals[signalIndex];
      const value = signal.evaluate(t, y);
      const diagnostics = signal.classify(value, options.domainTolerance);

      if (diagnostics.status !== "ok") {
        return {
          ok: false,
          status: diagnostics.status,
          reason:
            diagnostics.reason ??
            "The step approaches a point where the ODE is undefined."
        };
      }

      if (
        previousValues &&
        crossesBoundary(previousValues[signalIndex], value, options.domainTolerance)
      ) {
        return {
          ok: false,
          status: "near-singular",
          reason: "The step crosses a point where the ODE is undefined."
        };
      }

      currentValues.push(value);
    }

    previousValues = currentValues;
  }

  for (const signal of signals) {
    if (segmentMayReachDomainBoundary(signal, start, end, options.domainTolerance)) {
      return {
        ok: false,
        status: "near-singular",
        reason: "The step crosses or touches a point where the ODE is undefined."
      };
    }
  }

  return { ok: true, status: "ok" };
}

function segmentMayReachDomainBoundary(
  signal: DomainSignal,
  start: { t: number; y: number },
  end: { t: number; y: number },
  tolerance: number
): boolean {
  const startValue = signal.evaluate(start.t, start.y);
  const endValue = signal.evaluate(end.t, end.y);

  return inspectSegmentInterval(
    signal,
    start,
    end,
    startValue,
    endValue,
    tolerance,
    0,
    { remaining: MAX_DOMAIN_INTERVAL_INSPECTIONS }
  );
}

interface IntervalInspectionBudget {
  remaining: number;
}

function inspectSegmentInterval(
  signal: DomainSignal,
  start: { t: number; y: number },
  end: { t: number; y: number },
  startValue: number,
  endValue: number,
  tolerance: number,
  depth: number,
  budget: IntervalInspectionBudget
): boolean {
  // Dependency-heavy interval expressions can remain inconclusive under
  // subdivision. Keep the conservative proof bounded so a domain check can
  // never monopolize an adaptive solve. Exhaustion means "not proven here";
  // deterministic samples and endpoint diagnostics have already run.
  if (budget.remaining <= 0) {
    return false;
  }
  budget.remaining -= 1;

  if (
    signal.classify(startValue, tolerance).status !== "ok" ||
    signal.classify(endValue, tolerance).status !== "ok" ||
    crossesBoundary(startValue, endValue, tolerance)
  ) {
    return true;
  }

  const tRange = {
    min: Math.min(start.t, end.t),
    max: Math.max(start.t, end.t)
  };
  const yRange = {
    min: Math.min(start.y, end.y),
    max: Math.max(start.y, end.y)
  };
  const range = signal.interval(tRange, yRange);

  // Unsupported interval operations keep the existing deterministic point
  // sampling behavior; a computed interval can additionally prove that a
  // same-sign segment hides an even-order or paired boundary.
  if (!range || domainRangeIsSafe(range, signal.boundaryKind, tolerance)) {
    return false;
  }

  const midpoint = {
    t: (start.t + end.t) / 2,
    y: (start.y + end.y) / 2
  };
  const midpointValue = signal.evaluate(midpoint.t, midpoint.y);
  if (
    signal.classify(midpointValue, tolerance).status !== "ok" ||
    crossesBoundary(startValue, midpointValue, tolerance) ||
    crossesBoundary(midpointValue, endValue, tolerance)
  ) {
    return true;
  }

  if (depth >= MAX_DOMAIN_INTERVAL_DEPTH) {
    return true;
  }

  return (
    inspectSegmentInterval(
      signal,
      start,
      midpoint,
      startValue,
      midpointValue,
      tolerance,
      depth + 1,
      budget
    ) ||
    inspectSegmentInterval(
      signal,
      midpoint,
      end,
      midpointValue,
      endValue,
      tolerance,
      depth + 1,
      budget
    )
  );
}

function domainRangeIsSafe(
  range: NumericInterval,
  boundaryKind: DomainBoundaryKind,
  tolerance: number
): boolean {
  if (boundaryKind === "nonzero") {
    return range.min > tolerance || range.max < -tolerance;
  }

  return range.min > tolerance;
}

function classifyNonzeroBoundary(
  value: number,
  tolerance: number,
  nearReason = "A denominator is close to zero."
): EvaluationDiagnostics {
  if (!Number.isFinite(value)) {
    return {
      value,
      status: "invalid",
      reason: "A domain boundary evaluated to a non-finite value."
    };
  }

  if (value === 0) {
    return {
      value,
      status: "invalid",
      reason: nearReason
    };
  }

  if (Math.abs(value) <= tolerance) {
    return {
      value,
      status: "near-singular",
      reason: nearReason
    };
  }

  return { value, status: "ok" };
}

function classifyLowerBoundary(
  value: number,
  isStrict: boolean,
  tolerance: number,
  invalidReason: string
): EvaluationDiagnostics {
  if (!Number.isFinite(value)) {
    return {
      value,
      status: "invalid",
      reason: "A domain boundary evaluated to a non-finite value."
    };
  }

  if (isStrict ? value <= 0 : value < 0) {
    return {
      value,
      status: "invalid",
      reason: invalidReason
    };
  }

  if (value <= tolerance) {
    return {
      value,
      status: "near-singular",
      reason: invalidReason
    };
  }

  return { value, status: "ok" };
}

function crossesBoundary(left: number, right: number, tolerance: number): boolean {
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return true;
  }

  if (Math.abs(left) <= tolerance || Math.abs(right) <= tolerance) {
    return true;
  }

  return (left < 0 && right > 0) || (left > 0 && right < 0);
}
