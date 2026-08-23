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
  collectSyntacticVariables,
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

/**
 * Parses a standalone real-valued constant expression for compact numeric UI
 * fields. It shares the ODE grammar while rejecting coordinate-dependent
 * variables and values outside the expression's real, finite domain.
 */
export function evaluateConstantExpression(source: string): number {
  const normalizedSource = source.trim();
  if (!normalizedSource) {
    throw new ExpressionError("Enter a coordinate expression.");
  }

  let ast: ReturnType<typeof parseExpression>;
  try {
    ast = parseExpression(normalizedSource);
  } catch (error) {
    const unknownIdentifier =
      error instanceof ExpressionError
        ? /^Unknown identifier "([^"]+)"\./.exec(error.message)
        : null;
    if (unknownIdentifier) {
      throw new ExpressionError(
        `Unknown identifier "${unknownIdentifier[1]}". Use lowercase constants such as "pi" and "e", or a supported function.`
      );
    }
    throw error;
  }
  if (collectSyntacticVariables(ast).size > 0) {
    throw new ExpressionError("Coordinate expressions cannot use t or y.");
  }

  const diagnostics = evaluateCompiledWithDiagnostics(
    compileNodeEvaluator(ast),
    analyzeDomain(ast),
    0,
    0,
    DEFAULT_NORMALIZED_EVALUATION_OPTIONS
  );
  if (diagnostics.status === "invalid" || !Number.isFinite(diagnostics.value)) {
    throw new ExpressionError("Coordinate expression must have a finite real value.");
  }

  return diagnostics.value;
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
