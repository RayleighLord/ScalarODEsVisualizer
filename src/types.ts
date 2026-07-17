export interface AxisBounds {
  tMin: number;
  tMax: number;
  yMin: number;
  yMax: number;
}

export interface CurveSeed {
  id: string;
  t: number;
  y: number;
}

export interface PlotPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PlotLayout {
  width: number;
  height: number;
  padding: PlotPadding;
}

export interface AppState {
  expression: string;
  bounds: AxisBounds;
  curveSeeds: CurveSeed[];
  showPhaseFlow: boolean;
  boundsError: string | null;
}

export interface CurvePoint {
  t: number;
  y: number;
}

export type TerminationReason =
  | "domain-limit"
  | "vertical-boundary"
  | "singularity"
  | "step-underflow"
  | "max-steps"
  | "invalid-value"
  | "solver-error";

export interface IntegralCurve {
  id: string;
  seed: CurveSeed;
  points: CurvePoint[];
  terminationReason: TerminationReason;
}

export interface SolverSettings {
  stepSize: number;
  minStepSize: number;
  maxSteps: number;
  absoluteTolerance: number;
  relativeTolerance: number;
  domainTolerance: number;
}

export type NoticeTone = "info" | "warning" | "error";

export interface AppNotice {
  tone: NoticeTone;
  text: string;
}

export interface EquilibriumInterval {
  min: number;
  max: number;
  minInclusive: boolean;
  maxInclusive: boolean;
}

export interface EquilibriumResult {
  mode: "not-autonomous" | "roots" | "none" | "all";
  levels: number[];
  intervals: EquilibriumInterval[];
  message: string;
}
