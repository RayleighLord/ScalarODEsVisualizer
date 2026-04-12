import katex from "katex";

import { ODEPlotRenderer } from "./plot/renderer";
import { AppController, type ViewModel } from "./ui/controller";
import type { AppNotice, AxisBounds } from "./types";

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
  renderLatex(heroEquation, "y' = f(t, y)");
  let pendingResizeFrame = 0;
  const schedulePlotRender = () => {
    if (pendingResizeFrame !== 0) {
      return;
    }

    pendingResizeFrame = window.requestAnimationFrame(() => {
      pendingResizeFrame = 0;
      renderer.render(controller.getViewModel());
    });
  };

  controller.subscribe((viewModel) => {
    renderer.render(viewModel);
    renderOdePreview(viewModel, plotOdePreview);
    syncInputs(viewModel.state.bounds, {
      equationInput,
      tMinInput,
      tMaxInput,
      yMinInput,
      yMaxInput,
      phaseFlowToggle
    }, viewModel.state.expression, viewModel.state.showPhaseFlow);
    renderStatus(viewModel, {
      equationStatus,
      equationType,
      equilibriumSummary,
      equilibriumSolutions,
      curveCount,
      noticeList
    });
  });

  const resizeObserver = new ResizeObserver(() => {
    schedulePlotRender();
  });
  resizeObserver.observe(plot);
  if (plot.parentElement) {
    resizeObserver.observe(plot.parentElement);
  }
  window.addEventListener("resize", schedulePlotRender);

  equationInput.addEventListener("input", () => {
    controller.setExpression(equationInput.value);
  });

  boundsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    controller.applyBounds({
      tMin: Number(tMinInput.value),
      tMax: Number(tMaxInput.value),
      yMin: Number(yMinInput.value),
      yMax: Number(yMaxInput.value)
    });
  });

  resetButton.addEventListener("click", () => {
    controller.reset();
  });

  clearCurvesButton.addEventListener("click", () => {
    controller.clearCurves();
  });

  phaseFlowToggle.addEventListener("change", () => {
    controller.setShowPhaseFlow(phaseFlowToggle.checked);
  });

  plot.addEventListener("click", (event) => {
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

    controller.addCurveSeed(snappedPoint);
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
  showPhaseFlow: boolean
): void {
  if (elements.equationInput.value !== expression) {
    elements.equationInput.value = expression;
  }

  syncNumberInput(elements.tMinInput, bounds.tMin);
  syncNumberInput(elements.tMaxInput, bounds.tMax);
  syncNumberInput(elements.yMinInput, bounds.yMin);
  syncNumberInput(elements.yMaxInput, bounds.yMax);
  elements.phaseFlowToggle.checked = showPhaseFlow;
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
  elements.equationStatus.textContent = isValid ? "Ready" : "Needs attention";
  elements.equationStatus.className = `status-chip ${isValid ? "is-valid" : "is-invalid"}`;

  if (!viewModel.compiled || viewModel.equationError) {
    elements.equationType.textContent = "Unavailable";
  } else if (viewModel.compiled.isAutonomous) {
    elements.equationType.textContent = "Autonomous";
  } else {
    elements.equationType.textContent = "Non-autonomous";
  }

  elements.equilibriumSummary.textContent = formatEquilibriumSummary(viewModel);
  renderEquilibriumSolutions(viewModel, elements.equilibriumSolutions);
  elements.curveCount.textContent = `${viewModel.trajectories.length}`;

  elements.noticeList.classList.toggle("is-empty", viewModel.notices.length === 0);
  elements.noticeList.replaceChildren(
    ...viewModel.notices.map((notice) => {
      const item = document.createElement("li");
      item.className = `notice-item tone-${notice.tone}`;
      item.textContent = notice.text;
      return item;
    })
  );
}

function renderOdePreview(viewModel: ViewModel, element: HTMLElement): void {
  if (viewModel.compiled && !viewModel.equationError) {
    element.classList.remove("is-invalid");
    renderLatex(element, `y' = ${viewModel.compiled.latex}`);
    return;
  }

  element.classList.add("is-invalid");
  element.textContent = viewModel.equationError ?? "Unable to render the current ODE.";
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

  if (equilibria.mode !== "roots" || equilibria.levels.length === 0) {
    container.replaceChildren();
    container.classList.remove("has-items");
    return;
  }

  container.classList.add("has-items");
  container.replaceChildren(
    ...equilibria.levels.map((level) => {
      const item = document.createElement("span");
      item.className = "equilibrium-chip";
      item.textContent = `y = ${formatCompactNumber(level)}`;
      return item;
    })
  );
}

function getElement<T extends Element>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element with id "${id}".`);
  }
  return element as unknown as T;
}
