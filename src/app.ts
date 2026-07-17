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
  const equationInput = getElement<HTMLInputElement>("equation-input");
  const boundsForm = getElement<HTMLFormElement>("bounds-form");
  const tMinInput = getElement<HTMLInputElement>("t-min-input");
  const tMaxInput = getElement<HTMLInputElement>("t-max-input");
  const yMinInput = getElement<HTMLInputElement>("y-min-input");
  const yMaxInput = getElement<HTMLInputElement>("y-max-input");
  const phaseFlowToggle = getElement<HTMLInputElement>("phase-flow-toggle");
  const plotOdePreview = getElement<HTMLElement>("plot-ode-preview");
  const equationFamilyMath = getElement<HTMLElement>("equation-family-math");
  const equationInputPrefix = getElement<HTMLElement>("equation-input-prefix");
  const resetButton = getElement<HTMLButtonElement>("reset-button");
  const clearCurvesButton = getElement<HTMLButtonElement>("clear-curves-button");
  const equationStatus = getElement<HTMLElement>("equation-status");
  const equationType = getElement<HTMLElement>("equation-type");
  const equilibriumSummary = getElement<HTMLElement>("equilibrium-summary");
  const equilibriumSolutions = getElement<HTMLElement>("equilibrium-solutions");
  const noticeList = getElement<HTMLUListElement>("notice-list");
  const toggleUiButton = getElement<HTMLButtonElement>("toggle-ui-button");
  const helpButton = getElement<HTMLButtonElement>("help-button");
  const helpPopover = getElement<HTMLElement>("help-popover");
  const helpCloseButton = getElement<HTMLButtonElement>("help-close-button");
  const plot = getElement<SVGSVGElement>("ode-plot");

  const controller = new AppController();
  const renderer = new ODEPlotRenderer(plot);
  renderLatex(equationFamilyMath, "y' = f(y, t)");
  renderLatex(equationInputPrefix, "y' =");
  document.querySelectorAll<HTMLElement>("[data-static-latex]").forEach((element) => {
    renderLatex(element, element.dataset.staticLatex ?? "");
  });
  const statusElements = {
    equationStatus,
    equationType,
    equilibriumSummary,
    equilibriumSolutions,
    noticeList
  };
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
    clearCurvesButton.disabled = viewModel.state.curveSeeds.length === 0;
    [tMinInput, tMaxInput, yMinInput, yMaxInput].forEach((input) => {
      input.setAttribute("aria-invalid", `${viewModel.state.boundsError !== null}`);
    });
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

  const applyLiveBounds = () => {
    const values = [tMinInput, tMaxInput, yMinInput, yMaxInput].map((input) => ({
      text: input.value.trim(),
      number: input.valueAsNumber
    }));
    if (values.some(({ text, number }) => text === "" || !Number.isFinite(number))) {
      return;
    }

    const nextBounds = {
      tMin: values[0].number,
      tMax: values[1].number,
      yMin: values[2].number,
      yMax: values[3].number
    };
    const expression = consumePendingExpression();
    applyControllerUpdate({
      ...(expression === null ? {} : { expression }),
      bounds: nextBounds
    });
  };

  [tMinInput, tMaxInput, yMinInput, yMaxInput].forEach((input) => {
    input.addEventListener("input", applyLiveBounds);
  });

  boundsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    applyLiveBounds();
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

  const uiOverlays = Array.from(document.querySelectorAll<HTMLElement>("[data-ui-overlay]"));
  const setHelpOpen = (open: boolean) => {
    helpPopover.hidden = !open;
    helpButton.setAttribute("aria-expanded", `${open}`);
  };
  toggleUiButton.addEventListener("click", () => {
    const hideUi = toggleUiButton.getAttribute("aria-pressed") !== "true";
    setHelpOpen(false);
    uiOverlays.forEach((overlay) => {
      overlay.hidden = hideUi;
    });
    toggleUiButton.setAttribute("aria-pressed", `${hideUi}`);
    toggleUiButton.textContent = hideUi ? "Show UI" : "Hide UI";
  });

  helpButton.addEventListener("click", () => {
    setHelpOpen(helpPopover.hidden);
  });
  helpCloseButton.addEventListener("click", () => {
    setHelpOpen(false);
    helpButton.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (
      !helpPopover.hidden &&
      target instanceof Node &&
      !helpPopover.contains(target) &&
      !helpButton.contains(target)
    ) {
      setHelpOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !helpPopover.hidden) {
      setHelpOpen(false);
      helpButton.focus();
    }
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

  plot.addEventListener("contextmenu", (event) => {
    const viewModel = controller.getViewModel();
    const modelPoint = renderer.clientPointToModel(
      event.clientX,
      event.clientY,
      viewModel.state.bounds
    );
    if (!modelPoint) {
      return;
    }

    event.preventDefault();
    const clearAll = event.shiftKey;
    const removeCurveId = clearAll
      ? null
      : renderer.findNearestTrajectoryId(
          event.clientX,
          event.clientY,
          viewModel.state.bounds,
          viewModel.trajectories,
          18
        );

    if (!clearAll && removeCurveId === null) {
      return;
    }

    const expression = consumePendingExpression();
    applyControllerUpdate({
      ...(expression === null ? {} : { expression }),
      ...(clearAll ? { clearCurves: true } : { removeCurveId: removeCurveId ?? undefined })
    });
  });
}

function syncInputs(
  bounds: AxisBounds,
  elements: {
    equationInput: HTMLInputElement;
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
      return "Fixed solutions appear as black lines and shaded bands.";
    }
    if (equilibria.intervals.length > 0) {
      return "Equilibrium families appear as shaded bands.";
    }
    return "Fixed solutions appear as bold black lines.";
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
    equilibria.mode !== "all" &&
    (equilibria.mode !== "roots" ||
      (equilibria.levels.length === 0 && equilibria.intervals.length === 0))
  ) {
    container.replaceChildren();
    container.classList.remove("has-items");
    container.dataset.renderKey = renderKey;
    return;
  }

  container.classList.add("has-items");
  if (equilibria.mode === "all") {
    container.replaceChildren(createEquilibriumChip("y(t) \\equiv c,\\quad c \\in \\mathbb{R}"));
    container.dataset.renderKey = renderKey;
    return;
  }

  container.replaceChildren(
    ...equilibria.levels.map((level) =>
      createEquilibriumChip(`y(t) \\equiv ${formatLatexNumber(level)}`)
    ),
    ...equilibria.intervals.map((interval) =>
      createEquilibriumChip(formatEquilibriumIntervalLatex(interval), true)
    )
  );
  container.dataset.renderKey = renderKey;
}

function createEquilibriumChip(latex: string, isInterval = false): HTMLSpanElement {
  const item = document.createElement("span");
  item.className = `equilibrium-chip${isInterval ? " equilibrium-interval-chip" : ""}`;
  item.dataset.equilibriumLatex = latex;
  renderLatex(item, latex);
  return item;
}

function formatEquilibriumIntervalLatex(interval: EquilibriumInterval): string {
  const leftBracket = interval.minInclusive ? "[" : "(";
  const rightBracket = interval.maxInclusive ? "]" : ")";
  return (
    `y(t) \\equiv c,\\quad c \\in ${leftBracket}` +
    `${formatLatexNumber(interval.min)},${formatLatexNumber(interval.max)}${rightBracket}`
  );
}

function formatLatexNumber(value: number): string {
  if (value === Number.POSITIVE_INFINITY) {
    return "\\infty";
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return "-\\infty";
  }
  return formatCompactNumber(value);
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
