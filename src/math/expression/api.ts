import type { VariableName } from "./model";

export type EvaluationStatus = "ok" | "near-singular" | "invalid";

export interface EvaluationOptions {
  domainTolerance?: number;
  derivativeMagnitudeLimit?: number;
  segmentSampleCount?: number;
}

export interface EvaluationDiagnostics {
  value: number;
  status: EvaluationStatus;
  reason?: string;
}

export interface SegmentDomainCheck {
  ok: boolean;
  status: EvaluationStatus;
  reason?: string;
}

export interface NormalizedEvaluationOptions {
  domainTolerance: number;
  derivativeMagnitudeLimit?: number;
  segmentSampleCount: number;
}

export interface PreparedExpressionEvaluation {
  evaluateWithDiagnostics: (t: number, y: number) => EvaluationDiagnostics;
  checkSegmentDomain: (
    start: { t: number; y: number },
    end: { t: number; y: number }
  ) => SegmentDomainCheck;
}

export interface CompiledExpression {
  source: string;
  variables: Set<VariableName>;
  isAutonomous: boolean;
  dependsOnY: boolean;
  /** A conservative symbolic proof that the expression is zero everywhere in its domain. */
  isIdenticallyZero?: boolean;
  latex: string;
  evaluate: (t: number, y: number) => number;
  evaluateWithDiagnostics: (
    t: number,
    y: number,
    options?: EvaluationOptions
  ) => EvaluationDiagnostics;
  checkSegmentDomain: (
    start: { t: number; y: number },
    end: { t: number; y: number },
    options?: EvaluationOptions
  ) => SegmentDomainCheck;
  prepareEvaluation?: (options?: EvaluationOptions) => PreparedExpressionEvaluation;
  evaluateAutonomous?: (y: number) => number;
}
