import { findEquilibria } from "../math/equilibria";
import { compileExpression, formatExpressionError, type CompiledExpression } from "../math/parser";
import { createSolverSettings, solveIntegralCurve } from "../solver/rk4";
import type {
  AppNotice,
  AppState,
  AxisBounds,
  CurveSeed,
  EquilibriumResult,
  IntegralCurve,
  SolverSettings
} from "../types";

export interface ViewModel {
  state: AppState;
  compiled: CompiledExpression | null;
  equationError: string | null;
  trajectories: IntegralCurve[];
  equilibria: EquilibriumResult;
  notices: AppNotice[];
}

export interface AppControllerDependencies {
  compileExpression: typeof compileExpression;
  formatExpressionError: typeof formatExpressionError;
  findEquilibria: typeof findEquilibria;
  createSolverSettings: typeof createSolverSettings;
  solveIntegralCurve: typeof solveIntegralCurve;
}

export interface AppControllerUpdate {
  expression?: string;
  bounds?: AxisBounds;
  clearCurves?: boolean;
  removeCurveId?: string;
  showPhaseFlow?: boolean;
}

type Listener = (viewModel: ViewModel) => void;

const DEFAULT_BOUNDS: AxisBounds = {
  tMin: -6,
  tMax: 6,
  yMin: -3,
  yMax: 3
};

const DEFAULT_EXPRESSION = "y * (2 - y)";
// Keep a generous margin above the smallest span that could overflow the
// fixed-size SVG coordinate scales. Such microscopic windows are not useful
// interactively and would otherwise produce NaN/Infinity geometry.
const RENDER_SCALE_SAFETY_EXTENT = 4096;

const DEFAULT_DEPENDENCIES: AppControllerDependencies = {
  compileExpression,
  formatExpressionError,
  findEquilibria,
  createSolverSettings,
  solveIntegralCurve
};

export class AppController {
  private state: AppState;
  private viewModel: ViewModel;
  private compiled: CompiledExpression | null = null;
  private equationError: string | null = null;
  private equilibria: EquilibriumResult = createInvalidEquilibriumResult();
  private trajectories: IntegralCurve[] = [];
  private solverSettings: SolverSettings;
  private readonly listeners = new Set<Listener>();
  private readonly dependencies: AppControllerDependencies;
  private seedCounter: number;

  constructor(
    initialState = createDefaultState(),
    dependencies: Partial<AppControllerDependencies> = {}
  ) {
    this.state = initialState;
    this.dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencies };
    this.seedCounter = findNextSeedCounter(initialState.curveSeeds);
    this.solverSettings = this.dependencies.createSolverSettings(initialState.bounds);

    this.compileCurrentExpression();
    this.recomputeEquilibria();
    this.recomputeAllTrajectories();
    this.viewModel = this.createViewModel();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.viewModel);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getViewModel(): ViewModel {
    return this.viewModel;
  }

  setExpression(expression: string): void {
    this.applyUpdate({ expression });
  }

  applyBounds(bounds: AxisBounds): void {
    this.applyUpdate({ bounds });
  }

  clearCurves(): void {
    this.applyUpdate({ clearCurves: true });
  }

  removeCurve(curveId: string): void {
    this.applyUpdate({ removeCurveId: curveId });
  }

  setShowPhaseFlow(showPhaseFlow: boolean): void {
    this.applyUpdate({ showPhaseFlow });
  }

  /**
   * Applies related UI intents as one state transition. Expensive dependencies
   * are derived from the final state and listeners observe exactly one update.
   */
  applyUpdate(update: AppControllerUpdate): void {
    const previousState = this.state;
    const expression = update.expression ?? previousState.expression;
    const expressionChanged = expression !== previousState.expression;

    let bounds = previousState.bounds;
    let boundsError = previousState.boundsError;
    let boundsChanged = false;
    let equilibriumBoundsChanged = false;

    if (update.bounds !== undefined) {
      const error = validateBounds(update.bounds);
      if (error) {
        boundsError = error;
      } else {
        boundsChanged = !sameBounds(previousState.bounds, update.bounds);
        equilibriumBoundsChanged =
          previousState.bounds.yMin !== update.bounds.yMin ||
          previousState.bounds.yMax !== update.bounds.yMax;
        bounds = boundsChanged ? update.bounds : previousState.bounds;
        boundsError = null;
      }
    }

    const clearCurves = update.clearCurves === true;
    const removeCurveId = clearCurves ? undefined : update.removeCurveId;
    let curveSeeds = previousState.curveSeeds;
    if (clearCurves && previousState.curveSeeds.length > 0) {
      curveSeeds = [];
    } else if (
      removeCurveId !== undefined &&
      previousState.curveSeeds.some(({ id }) => id === removeCurveId)
    ) {
      curveSeeds = previousState.curveSeeds.filter(({ id }) => id !== removeCurveId);
    }
    const showPhaseFlow = update.showPhaseFlow ?? previousState.showPhaseFlow;
    const curvesChanged = curveSeeds !== previousState.curveSeeds;
    const phaseFlowChanged = showPhaseFlow !== previousState.showPhaseFlow;
    const boundsErrorChanged = boundsError !== previousState.boundsError;

    if (
      !expressionChanged &&
      !boundsChanged &&
      !curvesChanged &&
      !phaseFlowChanged &&
      !boundsErrorChanged
    ) {
      return;
    }

    this.state = {
      ...previousState,
      expression,
      bounds,
      boundsError,
      curveSeeds,
      showPhaseFlow
    };

    if (boundsChanged) {
      this.solverSettings = this.dependencies.createSolverSettings(bounds);
    }
    if (expressionChanged) {
      this.compileCurrentExpression();
    }
    if (expressionChanged || equilibriumBoundsChanged) {
      this.recomputeEquilibria();
    }

    if (clearCurves) {
      this.trajectories = [];
    } else if (expressionChanged || boundsChanged) {
      this.recomputeAllTrajectories();
    } else if (removeCurveId !== undefined && curvesChanged) {
      this.trajectories = this.trajectories.filter(({ id }) => id !== removeCurveId);
    }

    this.publish();
  }

  reset(): void {
    const previousState = this.state;
    const nextState = createDefaultState();
    const expressionChanged = previousState.expression !== nextState.expression;
    const boundsChanged = !sameBounds(previousState.bounds, nextState.bounds);
    const equilibriumBoundsChanged =
      previousState.bounds.yMin !== nextState.bounds.yMin ||
      previousState.bounds.yMax !== nextState.bounds.yMax;

    this.seedCounter = 1;
    this.state = nextState;

    if (boundsChanged) {
      this.solverSettings = this.dependencies.createSolverSettings(nextState.bounds);
    }
    if (expressionChanged) {
      this.compileCurrentExpression();
    }
    if (expressionChanged || equilibriumBoundsChanged) {
      this.recomputeEquilibria();
    }

    // Reset always removes every seed, so there is no trajectory work to repeat.
    this.trajectories = [];
    this.publish();
  }

  addCurveSeed(seed: Pick<CurveSeed, "t" | "y">): void {
    const curveSeed: CurveSeed = {
      id: `curve-${this.seedCounter}`,
      t: seed.t,
      y: seed.y
    };

    this.state = {
      ...this.state,
      curveSeeds: [...this.state.curveSeeds, curveSeed]
    };
    this.seedCounter += 1;

    if (this.compiled && !this.equationError) {
      const trajectory = this.dependencies.solveIntegralCurve(
        curveSeed,
        this.state.bounds,
        this.compiled,
        this.solverSettings
      );
      this.trajectories = [...this.trajectories, trajectory];
    }

    this.publish();
  }

  private compileCurrentExpression(): void {
    try {
      this.compiled = this.dependencies.compileExpression(this.state.expression);
      this.equationError = null;
    } catch (error) {
      this.compiled = null;
      this.equationError = this.dependencies.formatExpressionError(error);
    }
  }

  private recomputeEquilibria(): void {
    this.equilibria =
      this.compiled && !this.equationError
        ? this.dependencies.findEquilibria(this.compiled, this.state.bounds)
        : createInvalidEquilibriumResult();
  }

  private recomputeAllTrajectories(): void {
    const compiled = this.compiled;
    if (!compiled || this.equationError) {
      this.trajectories = [];
      return;
    }

    this.trajectories = this.state.curveSeeds.map((seed) =>
      this.dependencies.solveIntegralCurve(
        seed,
        this.state.bounds,
        compiled,
        this.solverSettings
      )
    );
  }

  private createViewModel(): ViewModel {
    const notices: AppNotice[] = [];

    if (this.state.boundsError) {
      notices.push({ tone: "error", text: this.state.boundsError });
    }

    if (this.equationError) {
      notices.push({ tone: "error", text: this.equationError });
    }

    if (!this.equationError && this.compiled && this.equilibria.mode === "all") {
      notices.push({ tone: "warning", text: this.equilibria.message });
    }

    return {
      state: this.state,
      compiled: this.compiled,
      equationError: this.equationError,
      trajectories: this.trajectories,
      equilibria: this.equilibria,
      notices
    };
  }

  private publish(): void {
    this.viewModel = this.createViewModel();
    this.listeners.forEach((listener) => listener(this.viewModel));
  }
}

export function createDefaultState(): AppState {
  return {
    expression: DEFAULT_EXPRESSION,
    bounds: { ...DEFAULT_BOUNDS },
    curveSeeds: [],
    showPhaseFlow: false,
    boundsError: null
  };
}

function createInvalidEquilibriumResult(): EquilibriumResult {
  return {
    mode: "not-autonomous",
    levels: [],
    intervals: [],
    message: "Enter a valid expression to inspect equilibrium levels."
  };
}

function sameBounds(left: AxisBounds, right: AxisBounds): boolean {
  return (
    left.tMin === right.tMin &&
    left.tMax === right.tMax &&
    left.yMin === right.yMin &&
    left.yMax === right.yMax
  );
}

function findNextSeedCounter(seeds: CurveSeed[]): number {
  let nextCounter = 1;

  for (const seed of seeds) {
    const match = /^curve-(\d+)$/.exec(seed.id);
    if (match) {
      nextCounter = Math.max(nextCounter, Number(match[1]) + 1);
    }
  }

  return nextCounter;
}

function validateBounds(bounds: AxisBounds): string | null {
  const values = Object.values(bounds);

  if (values.some((value) => !Number.isFinite(value))) {
    return "Axis limits must be finite numbers.";
  }

  if (bounds.tMin >= bounds.tMax) {
    return "The t-range must satisfy t min < t max.";
  }

  if (bounds.yMin >= bounds.yMax) {
    return "The y-range must satisfy y min < y max.";
  }

  const tSpan = bounds.tMax - bounds.tMin;
  const ySpan = bounds.yMax - bounds.yMin;

  if (!Number.isFinite(tSpan)) {
    return "The t-range must have a finite span.";
  }

  if (!Number.isFinite(ySpan)) {
    return "The y-range must have a finite span.";
  }

  if (!Number.isFinite(RENDER_SCALE_SAFETY_EXTENT / tSpan)) {
    return "The t-range is too narrow to render.";
  }

  if (!Number.isFinite(RENDER_SCALE_SAFETY_EXTENT / ySpan)) {
    return "The y-range is too narrow to render.";
  }

  return null;
}
