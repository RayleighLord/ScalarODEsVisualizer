import { findEquilibria } from "../math/equilibria";
import { compileExpression, formatExpressionError, type CompiledExpression } from "../math/parser";
import { createSolverSettings, solveIntegralCurve } from "../solver/rk4";
import type {
  AppNotice,
  AppState,
  AxisBounds,
  CurveSeed,
  EquilibriumResult,
  IntegralCurve
} from "../types";

export interface ViewModel {
  state: AppState;
  compiled: CompiledExpression | null;
  equationError: string | null;
  trajectories: IntegralCurve[];
  equilibria: EquilibriumResult;
  notices: AppNotice[];
}

type Listener = (viewModel: ViewModel) => void;

const DEFAULT_BOUNDS: AxisBounds = {
  tMin: -4,
  tMax: 4,
  yMin: -2,
  yMax: 2
};

const DEFAULT_EXPRESSION = "y * (1 - y)";

export class AppController {
  private state: AppState;
  private viewModel: ViewModel;
  private readonly listeners = new Set<Listener>();
  private seedCounter = 1;

  constructor(initialState = createDefaultState()) {
    this.state = initialState;
    this.viewModel = deriveViewModel(this.state);
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
    this.state = {
      ...this.state,
      expression
    };
    this.refresh();
  }

  applyBounds(bounds: AxisBounds): void {
    const error = validateBounds(bounds);

    if (error) {
      this.state = {
        ...this.state,
        boundsError: error
      };
      this.refresh();
      return;
    }

    this.state = {
      ...this.state,
      bounds,
      boundsError: null
    };
    this.refresh();
  }

  clearCurves(): void {
    this.state = {
      ...this.state,
      curveSeeds: []
    };
    this.refresh();
  }

  setShowPhaseFlow(showPhaseFlow: boolean): void {
    this.state = {
      ...this.state,
      showPhaseFlow
    };
    this.refresh();
  }

  reset(): void {
    this.seedCounter = 1;
    this.state = createDefaultState();
    this.refresh();
  }

  addCurveSeed(seed: Pick<CurveSeed, "t" | "y">): void {
    this.state = {
      ...this.state,
      curveSeeds: [
        ...this.state.curveSeeds,
        {
          id: `curve-${this.seedCounter}`,
          t: seed.t,
          y: seed.y
        }
      ]
    };
    this.seedCounter += 1;
    this.refresh();
  }

  private refresh(): void {
    this.viewModel = deriveViewModel(this.state);
    this.listeners.forEach((listener) => listener(this.viewModel));
  }
}

export function createDefaultState(): AppState {
  return {
    expression: DEFAULT_EXPRESSION,
    bounds: { ...DEFAULT_BOUNDS },
    curveSeeds: [],
    slopeDensity: 19,
    showPhaseFlow: false,
    boundsError: null
  };
}

function deriveViewModel(state: AppState): ViewModel {
  let compiled: CompiledExpression | null = null;
  let equationError: string | null = null;

  try {
    compiled = compileExpression(state.expression);
  } catch (error) {
    equationError = formatExpressionError(error);
  }

  const notices: AppNotice[] = [];
  const solverSettings = createSolverSettings(state.bounds);

  if (state.boundsError) {
    notices.push({ tone: "error", text: state.boundsError });
  }

  if (equationError) {
    notices.push({ tone: "error", text: equationError });
  }

  const equilibria =
    compiled && !equationError
      ? findEquilibria(compiled, state.bounds)
      : ({
          mode: "not-autonomous",
          levels: [],
          message: "Enter a valid expression to inspect equilibrium levels."
        } satisfies EquilibriumResult);

  if (!equationError && compiled && equilibria.mode === "all") {
    notices.push({ tone: "warning", text: equilibria.message });
  }

  const trajectories =
    compiled && !equationError
      ? state.curveSeeds.map((seed) =>
          solveIntegralCurve(seed, state.bounds, compiled.evaluate, solverSettings)
        )
      : [];

  return {
    state,
    compiled,
    equationError,
    trajectories,
    equilibria,
    notices
  };
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

  return null;
}
