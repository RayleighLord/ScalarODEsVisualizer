import type {
  CompiledExpression,
  EvaluationDiagnostics,
  EvaluationOptions,
  NormalizedEvaluationOptions,
  PreparedExpressionEvaluation
} from "./expression/api";
import {
  DEFAULT_NORMALIZED_EVALUATION_OPTIONS,
  finalizeDiagnostics,
  normalizeEvaluationOptions
} from "./expression/diagnostics";
import { analyzeDomain, type DomainAnalysis } from "./expression/domain";
import {
  collectSemanticVariables,
  compileNodeEvaluator,
  isStaticallyZero,
  type NodeEvaluator
} from "./expression/evaluator";
import { renderNodeAsLatex } from "./expression/latex";
import { ExpressionError } from "./expression/model";
import { parseExpression } from "./expression/syntax";

export type {
  CompiledExpression,
  EvaluationDiagnostics,
  EvaluationOptions,
  EvaluationStatus,
  PreparedExpressionEvaluation,
  SegmentDomainCheck
} from "./expression/api";

/**
 * Parses and prepares an ODE right-hand side. The specialized expression
 * modules own syntax, evaluation, domain analysis, and presentation; this file
 * intentionally remains the stable public façade used by the rest of the app.
 */
export function compileExpression(source: string): CompiledExpression {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    throw new ExpressionError("Enter an expression for the ODE right-hand side.");
  }

  const ast = parseExpression(normalizedSource);
  const variables = collectSemanticVariables(ast);
  const evaluator = compileNodeEvaluator(ast);
  const domain = analyzeDomain(ast);
  const normalizedOptionsCache = createEvaluationOptionsCache();

  const resolveOptions = (options?: EvaluationOptions): NormalizedEvaluationOptions => {
    if (options === undefined) {
      return DEFAULT_NORMALIZED_EVALUATION_OPTIONS;
    }

    const cached = normalizedOptionsCache.get(options);
    if (
      cached &&
      cached.domainTolerance === options.domainTolerance &&
      cached.derivativeMagnitudeLimit === options.derivativeMagnitudeLimit &&
      cached.segmentSampleCount === options.segmentSampleCount
    ) {
      return cached.normalized;
    }

    const normalized = normalizeEvaluationOptions(options);
    normalizedOptionsCache.set(options, {
      domainTolerance: options.domainTolerance,
      derivativeMagnitudeLimit: options.derivativeMagnitudeLimit,
      segmentSampleCount: options.segmentSampleCount,
      normalized
    });
    return normalized;
  };

  const createPreparedEvaluation = (
    normalizedOptions: NormalizedEvaluationOptions
  ): PreparedExpressionEvaluation => ({
    evaluateWithDiagnostics: (t, y) =>
      evaluateCompiledWithDiagnostics(evaluator, domain, t, y, normalizedOptions),
    checkSegmentDomain: (start, end) => domain.checkSegment(start, end, normalizedOptions)
  });

  const evaluateWithDiagnostics = (
    t: number,
    y: number,
    options?: EvaluationOptions
  ): EvaluationDiagnostics =>
    evaluateCompiledWithDiagnostics(evaluator, domain, t, y, resolveOptions(options));
  const isAutonomous = !variables.has("t");

  return {
    source: normalizedSource,
    variables,
    isAutonomous,
    dependsOnY: variables.has("y"),
    isIdenticallyZero: !domain.hasRestrictions && isStaticallyZero(ast),
    latex: renderNodeAsLatex(ast),
    evaluate: evaluator,
    evaluateWithDiagnostics,
    checkSegmentDomain: (start, end, options) =>
      domain.checkSegment(start, end, resolveOptions(options)),
    prepareEvaluation: (options) => createPreparedEvaluation(resolveOptions(options)),
    evaluateAutonomous: isAutonomous ? (value: number) => evaluator(0, value) : undefined
  };
}

interface EvaluationOptionsCacheEntry {
  domainTolerance: number | undefined;
  derivativeMagnitudeLimit: number | undefined;
  segmentSampleCount: number | undefined;
  normalized: NormalizedEvaluationOptions;
}

function createEvaluationOptionsCache(): WeakMap<
  EvaluationOptions,
  EvaluationOptionsCacheEntry
> {
  return new WeakMap<EvaluationOptions, EvaluationOptionsCacheEntry>();
}

function evaluateCompiledWithDiagnostics(
  evaluator: NodeEvaluator,
  domain: DomainAnalysis,
  t: number,
  y: number,
  options: NormalizedEvaluationOptions
): EvaluationDiagnostics {
  const domainDiagnostics = domain.evaluate(t, y, options);
  if (domainDiagnostics.status === "invalid") {
    return domainDiagnostics;
  }

  return finalizeDiagnostics(
    evaluator(t, y),
    domainDiagnostics.status,
    options,
    domainDiagnostics.reason
  );
}

export function formatExpressionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "The expression could not be parsed.";
}
