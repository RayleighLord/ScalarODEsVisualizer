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
  slopeDensity: number;
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
  maxSteps: number;
  blowUpThreshold: number;
}

export type NoticeTone = "info" | "warning" | "error";

export interface AppNotice {
  tone: NoticeTone;
  text: string;
}

export interface EquilibriumResult {
  mode: "not-autonomous" | "roots" | "none" | "all";
  levels: number[];
  message: string;
}
