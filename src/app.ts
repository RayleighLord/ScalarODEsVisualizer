import katex from "katex";

import { ODEPlotRenderer } from "./plot/renderer";
import { chooseSafeSnapPoint } from "./plot/snap";
import { AppController, type ViewModel } from "./ui/controller";
import type { AppNotice, AxisBounds, EquilibriumInterval } from "./types";

const SEED_EVALUATION_OPTIONS = {
  domainTolerance: 1e-8
} as const;
const EXPRESSION_DEBOUNCE_MS = 150;

export function startApp(): void {
  const equationInput = getElement<HTMLTextAreaElement>("equation-input");
  const boundsForm = getElement<HTMLFormElement>("bounds-form");
  const tMinInput = getElement<HTMLInputElement>("t-min-input");
  const tMaxInput = getElement<HTMLInputElement>("t-max-input");
  const yMinInput = getElement<HTMLInputElement>("y-min-input");
  const yMaxInput = getElement<HTMLInputElement>("y-max-input");
  const phaseFlowToggle = getElement<HTMLInputElement>("phase-flow-toggle");
  const heroEquation = getElement<HTMLElement>("hero-equation");
  const plotOdePreview = getElement<HTMLElement>("plot-ode-preview");
  const resetButton = getElement<HTMLButtonElement>("reset-button");
  const clearCurvesButton = getElement<HTMLButtonElement>("clear-curves-button");
  const equationStatus = getElement<HTMLElement>("equation-status");
  const equationType = getElement<HTMLElement>("equation-type");
  const equilibriumSummary = getElement<HTMLElement>("equilibrium-summary");
  const equilibriumSolutions = getElement<HTMLElement>("equilibrium-solutions");
  const curveCount = getElement<HTMLElement>("curve-count");
  const noticeList = getElement<HTMLUListElement>("notice-list");
  const plot = getElement<SVGSVGElement>("ode-plot");

  const controller = new AppController();
  const renderer = new ODEPlotRenderer(plot);
  const statusElements = {
    equationStatus,
    equationType,
    equilibriumSummary,
    equilibriumSolutions,
    curveCount,
    noticeList
  };
  renderLatex(heroEquation, "y' = f(t, y)");
  let pendingResizeFrame = 0;
  let pendingExpressionTimer = 0;
  let pendingExpression: string | null = null;
  let syncedBounds: AxisBounds | null = null;

  const scheduleAnnotationResize = () => {
    if (pendingResizeFrame !== 0) {
      return;
    }

    pendingResizeFrame = window.requestAnimationFrame(() => {
      pendingResizeFrame = 0;
      renderer.resize();
    });
  };

  controller.subscribe((viewModel) => {
    const shouldSyncBounds = syncedBounds !== viewModel.state.bounds;
    renderOdePreview(viewModel, plotOdePreview);
    syncInputs(
      viewModel.state.bounds,
      {
        equationInput,
        tMinInput,
        tMaxInput,
        yMinInput,
        yMaxInput,
        phaseFlowToggle
      },
      viewModel.state.expression,
      viewModel.state.showPhaseFlow,
      pendingExpression === null,
      shouldSyncBounds
    );
    if (shouldSyncBounds) {
      syncedBounds = viewModel.state.bounds;
    }
    renderStatus(viewModel, statusElements);
    if (pendingResizeFrame !== 0) {
      window.cancelAnimationFrame(pendingResizeFrame);
      pendingResizeFrame = 0;
    }
    renderer.render(viewModel);
  });

  const resizeObserver = new ResizeObserver(() => {
    scheduleAnnotationResize();
  });
  if (plot.parentElement) {
    resizeObserver.observe(plot.parentElement);
  }

  const cancelPendingExpression = () => {
    if (pendingExpressionTimer !== 0) {
      window.clearTimeout(pendingExpressionTimer);
      pendingExpressionTimer = 0;
    }
    pendingExpression = null;
    plotOdePreview.removeAttribute("aria-busy");
  };

  const consumePendingExpression = (): string | null => {
    const expression = pendingExpression;
    cancelPendingExpression();
    return expression;
  };

  const applyControllerUpdate = (update: Parameters<AppController["applyUpdate"]>[0]) => {
    const previousViewModel = controller.getViewModel();
    controller.applyUpdate(update);
    if (controller.getViewModel() === previousViewModel) {
      renderOdePreview(previousViewModel, plotOdePreview);
      renderStatus(previousViewModel, statusElements);
    }
  };

  const commitPendingExpression = () => {
    const expression = consumePendingExpression();
    if (expression !== null) {
      applyControllerUpdate({ expression });
    }
  };

  equationInput.addEventListener("input", () => {
    pendingExpression = equationInput.value;
    if (pendingExpressionTimer !== 0) {
      window.clearTimeout(pendingExpressionTimer);
    }
    plotOdePreview.setAttribute("aria-busy", "true");
    setTextContent(equationStatus, "Updating…");
    setClassName(equationStatus, "status-chip is-pending");
    pendingExpressionTimer = window.setTimeout(commitPendingExpression, EXPRESSION_DEBOUNCE_MS);
  });

  boundsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextBounds = {
      tMin: Number(tMinInput.value),
      tMax: Number(tMaxInput.value),
      yMin: Number(yMinInput.value),
      yMax: Number(yMaxInput.value)
    };
    const expression = consumePendingExpression();
    applyControllerUpdate({
      ...(expression === null ? {} : { expression }),
      bounds: nextBounds
    });
  });

  resetButton.addEventListener("click", () => {
    cancelPendingExpression();
    controller.reset();
  });

  clearCurvesButton.addEventListener("click", () => {
    const expression = consumePendingExpression();
    applyControllerUpdate({
      ...(expression === null ? {} : { expression }),
      clearCurves: true
    });
  });

  phaseFlowToggle.addEventListener("change", () => {
    const showPhaseFlow = phaseFlowToggle.checked;
    const expression = consumePendingExpression();
    applyControllerUpdate({
      ...(expression === null ? {} : { expression }),
      showPhaseFlow
    });
  });

  plot.addEventListener("click", (event) => {
    commitPendingExpression();
    const viewModel = controller.getViewModel();
    if (!viewModel.compiled || viewModel.equationError) {
      return;
    }

    const modelPoint = renderer.clientPointToModel(
      event.clientX,
      event.clientY,
      viewModel.state.bounds
    );

    if (!modelPoint) {
      return;
    }

    const snappedPoint = renderer.snapModelPoint(modelPoint, viewModel.state.bounds, {
      equilibriumLevels: viewModel.equilibria.mode === "roots" ? viewModel.equilibria.levels : [],
      axisSnapPixels: 18,
      equilibriumSnapPixels: 9
    });

    const seedPoint = chooseSafeSnapPoint(modelPoint, snappedPoint, (point) => {
      const diagnostics = viewModel.compiled?.evaluateWithDiagnostics(
        point.t,
        point.y,
        SEED_EVALUATION_OPTIONS
      );
      return diagnostics?.status === "ok";
    });

    if (!seedPoint) {
      return;
    }

    controller.addCurveSeed(seedPoint);
  });
}

function syncInputs(
  bounds: AxisBounds,
  elements: {
    equationInput: HTMLTextAreaElement;
    tMinInput: HTMLInputElement;
    tMaxInput: HTMLInputElement;
    yMinInput: HTMLInputElement;
    yMaxInput: HTMLInputElement;
    phaseFlowToggle: HTMLInputElement;
  },
  expression: string,
  showPhaseFlow: boolean,
  syncExpression: boolean,
  syncBounds: boolean
): void {
  if (syncExpression && elements.equationInput.value !== expression) {
    elements.equationInput.value = expression;
  }

  if (syncBounds) {
    syncNumberInput(elements.tMinInput, bounds.tMin);
    syncNumberInput(elements.tMaxInput, bounds.tMax);
    syncNumberInput(elements.yMinInput, bounds.yMin);
    syncNumberInput(elements.yMaxInput, bounds.yMax);
  }
  if (elements.phaseFlowToggle.checked !== showPhaseFlow) {
    elements.phaseFlowToggle.checked = showPhaseFlow;
  }
}

function syncNumberInput(input: HTMLInputElement, value: number): void {
  const serialized = `${value}`;
  if (input.value !== serialized) {
    input.value = serialized;
  }
}

function renderStatus(
  viewModel: ViewModel,
  elements: {
    equationStatus: HTMLElement;
    equationType: HTMLElement;
    equilibriumSummary: HTMLElement;
    equilibriumSolutions: HTMLElement;
    curveCount: HTMLElement;
    noticeList: HTMLUListElement;
  }
): void {
  const isValid = !viewModel.equationError;
  setTextContent(elements.equationStatus, isValid ? "Ready" : "Needs attention");
  setClassName(
    elements.equationStatus,
    `status-chip ${isValid ? "is-valid" : "is-invalid"}`
  );

  if (!viewModel.compiled || viewModel.equationError) {
    setTextContent(elements.equationType, "Unavailable");
  } else if (viewModel.compiled.isAutonomous) {
    setTextContent(elements.equationType, "Autonomous");
  } else {
    setTextContent(elements.equationType, "Non-autonomous");
  }

  setTextContent(elements.equilibriumSummary, formatEquilibriumSummary(viewModel));
  renderEquilibriumSolutions(viewModel, elements.equilibriumSolutions);
  setTextContent(elements.curveCount, `${viewModel.trajectories.length}`);

  elements.noticeList.classList.toggle("is-empty", viewModel.notices.length === 0);
  const noticeKey = serializeNotices(viewModel.notices);
  if (elements.noticeList.dataset.renderKey === noticeKey) {
    return;
  }

  elements.noticeList.replaceChildren(
    ...viewModel.notices.map((notice) => {
      const item = document.createElement("li");
      item.className = `notice-item tone-${notice.tone}`;
      item.textContent = notice.text;
      return item;
    })
  );
  elements.noticeList.dataset.renderKey = noticeKey;
}

function renderOdePreview(viewModel: ViewModel, element: HTMLElement): void {
  if (viewModel.compiled && !viewModel.equationError) {
    const renderKey = `valid:${viewModel.compiled.latex}`;
    if (element.dataset.renderKey === renderKey) {
      element.removeAttribute("aria-busy");
      return;
    }

    element.classList.remove("is-invalid");
    renderLatex(element, `y' = ${viewModel.compiled.latex}`);
    element.dataset.renderKey = renderKey;
    element.removeAttribute("aria-busy");
    return;
  }

  const message = viewModel.equationError ?? "Unable to render the current ODE.";
  const renderKey = `invalid:${message}`;
  if (element.dataset.renderKey === renderKey) {
    element.removeAttribute("aria-busy");
    return;
  }

  element.classList.add("is-invalid");
  element.textContent = message;
  element.dataset.renderKey = renderKey;
  element.removeAttribute("aria-busy");
}

function renderLatex(element: HTMLElement, latex: string): void {
  katex.render(latex, element, {
    throwOnError: false,
    displayMode: false
  });
}

function formatEquilibriumSummary(viewModel: ViewModel): string {
  const { equilibria } = viewModel;

  if (equilibria.mode === "roots") {
    if (equilibria.intervals.length > 0 && equilibria.levels.length > 0) {
      return "Black lines and shaded bands mark equilibrium solutions.";
    }
    if (equilibria.intervals.length > 0) {
      return "Shaded horizontal bands mark equilibrium solutions.";
    }
    return "Black horizontal solution lines.";
  }

  if (equilibria.mode === "all") {
    return "Every horizontal line y = c is an equilibrium solution.";
  }

  return equilibria.message;
}

function formatCompactNumber(value: number): string {
  return `${Number(value.toFixed(4))}`;
}

function renderEquilibriumSolutions(viewModel: ViewModel, container: HTMLElement): void {
  const { equilibria } = viewModel;
  const renderKey = `${equilibria.mode}:${equilibria.levels.join(",")}:${equilibria.intervals
    .map(({ min, max, minInclusive, maxInclusive }) =>
      [min, max, minInclusive, maxInclusive].join(":")
    )
    .join(",")}`;
  if (container.dataset.renderKey === renderKey) {
    return;
  }

  if (
    equilibria.mode !== "roots" ||
    (equilibria.levels.length === 0 && equilibria.intervals.length === 0)
  ) {
    container.replaceChildren();
    container.classList.remove("has-items");
    container.dataset.renderKey = renderKey;
    return;
  }

  container.classList.add("has-items");
  container.replaceChildren(
    ...equilibria.levels.map((level) => {
      const item = document.createElement("span");
      item.className = "equilibrium-chip";
      item.textContent = `y = ${formatCompactNumber(level)}`;
      return item;
    }),
    ...equilibria.intervals.map((interval) => {
      const item = document.createElement("span");
      item.className = "equilibrium-chip equilibrium-interval-chip";
      item.textContent = formatEquilibriumInterval(interval);
      return item;
    })
  );
  container.dataset.renderKey = renderKey;
}

function formatEquilibriumInterval(interval: EquilibriumInterval): string {
  const lowerRelation = interval.minInclusive ? "≤" : "<";
  const upperRelation = interval.maxInclusive ? "≤" : "<";
  return (
    `${formatCompactNumber(interval.min)} ${lowerRelation} y ` +
    `${upperRelation} ${formatCompactNumber(interval.max)}`
  );
}

function serializeNotices(notices: AppNotice[]): string {
  return notices.map(({ tone, text }) => `${tone}:${text}`).join("\u0000");
}

function setTextContent(element: HTMLElement, value: string): void {
  if (element.textContent !== value) {
    element.textContent = value;
  }
}

function setClassName(element: HTMLElement, value: string): void {
  if (element.className !== value) {
    element.className = value;
  }
}

function getElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element with id "${id}".`);
  }
  return element as unknown as T;
}
