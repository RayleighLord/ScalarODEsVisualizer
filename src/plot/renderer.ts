import { createCoordinateSystem, type CoordinateSystem } from "./coordinates";
import {
  analyzePhaseFlow,
  type EquilibriumMarker,
  type PhaseFlowBand
} from "./phaseFlow";
import { snapPointToTargets } from "./snap";
import { computeNiceTicks, formatTickLatex } from "./ticks";
import type { CompiledExpression } from "../math/parser";
import type { CurvePoint, EquilibriumResult, IntegralCurve, PlotLayout } from "../types";
import type { ViewModel } from "../ui/controller";
import katex from "katex";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SLOPE_EVALUATION_OPTIONS = {
  domainTolerance: 1e-8,
  derivativeMagnitudeLimit: 1e6
} as const;
const CURVE_PALETTE = [
  { stroke: "#2f80ed", seed: "#70aaf5", halo: "rgba(47, 128, 237, 0.24)" },
  { stroke: "#16a085", seed: "#5bc6ae", halo: "rgba(22, 160, 133, 0.24)" },
  { stroke: "#8e44ad", seed: "#b47acb", halo: "rgba(142, 68, 173, 0.24)" },
  { stroke: "#e67e22", seed: "#f0aa64", halo: "rgba(230, 126, 34, 0.24)" },
  { stroke: "#c0392b", seed: "#dd7468", halo: "rgba(192, 57, 43, 0.24)" },
  { stroke: "#27ae60", seed: "#69cb90", halo: "rgba(39, 174, 96, 0.24)" },
  { stroke: "#2980b9", seed: "#68a6cf", halo: "rgba(41, 128, 185, 0.24)" },
  { stroke: "#d35400", seed: "#e58b52", halo: "rgba(211, 84, 0, 0.24)" },
  { stroke: "#6c5ce7", seed: "#998ff0", halo: "rgba(108, 92, 231, 0.24)" },
  { stroke: "#2d98da", seed: "#73b7e4", halo: "rgba(45, 152, 218, 0.24)" },
  { stroke: "#38ada9", seed: "#79cbc8", halo: "rgba(56, 173, 169, 0.24)" },
  { stroke: "#b71540", seed: "#cf5d7d", halo: "rgba(183, 21, 64, 0.24)" },
  { stroke: "#f39c12", seed: "#f7bd58", halo: "rgba(243, 156, 18, 0.24)" },
  { stroke: "#1abc9c", seed: "#62d3be", halo: "rgba(26, 188, 156, 0.24)" },
  { stroke: "#3867d6", seed: "#7492e2", halo: "rgba(56, 103, 214, 0.24)" },
  { stroke: "#6ab04c", seed: "#99c985", halo: "rgba(106, 176, 76, 0.24)" },
  { stroke: "#e056fd", seed: "#ea8bff", halo: "rgba(224, 86, 253, 0.24)" },
  { stroke: "#eb4d4b", seed: "#f08280", halo: "rgba(235, 77, 75, 0.24)" },
  { stroke: "#22a6b3", seed: "#6fc2cb", halo: "rgba(34, 166, 179, 0.24)" },
  { stroke: "#be2edd", seed: "#d678eb", halo: "rgba(190, 46, 221, 0.24)" },
  { stroke: "#e58e26", seed: "#ecb066", halo: "rgba(229, 142, 38, 0.24)" },
  { stroke: "#0097e6", seed: "#5dbbeb", halo: "rgba(0, 151, 230, 0.24)" },
  { stroke: "#44bd32", seed: "#7ed271", halo: "rgba(68, 189, 50, 0.24)" },
  { stroke: "#c23616", seed: "#d86f58", halo: "rgba(194, 54, 22, 0.24)" },
  { stroke: "#40739e", seed: "#7893b1", halo: "rgba(64, 115, 158, 0.24)" },
  { stroke: "#7f8c8d", seed: "#a8b2b3", halo: "rgba(127, 140, 141, 0.24)" },
  { stroke: "#9c27b0", seed: "#bb72c8", halo: "rgba(156, 39, 176, 0.24)" },
  { stroke: "#00897b", seed: "#58b6ad", halo: "rgba(0, 137, 123, 0.24)" }
] as const;

export class ODEPlotRenderer {
  private readonly svg: SVGSVGElement;
  private readonly layout: PlotLayout;
  private readonly gridLayer: SVGGElement;
  private readonly axisLayer: SVGGElement;
  private readonly equilibriumLayer: SVGGElement;
  private readonly slopeLayer: SVGGElement;
  private readonly phaseFlowLayer: SVGGElement;
  private readonly curveLayer: SVGGElement;
  private readonly annotationLayer: HTMLDivElement;
  private lastViewModel: ViewModel | null = null;
  private gridKey: string | null = null;
  private axesKey: string | null = null;
  private equilibriaKey: string | null = null;
  private slopeKey: string | null = null;
  private phaseFlowKey: string | null = null;
  private curveBoundsKey: string | null = null;
  private renderedTrajectories: IntegralCurve[] = [];
  private annotationKey: string | null = null;
  private annotationEntries: Array<{
    element: HTMLDivElement;
    svgX: number;
    svgY: number;
  }> = [];

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    this.layout = {
      width: 960,
      height: 640,
      padding: {
        top: 56,
        right: 26,
        bottom: 56,
        left: 118
      }
    };

    this.svg.setAttribute("viewBox", `0 0 ${this.layout.width} ${this.layout.height}`);

    this.gridLayer = createSvgElement("g", { "data-layer": "grid" });
    this.axisLayer = createSvgElement("g", { "data-layer": "axes" });
    this.equilibriumLayer = createSvgElement("g", { "data-layer": "equilibria" });
    this.slopeLayer = createSvgElement("g", { "data-layer": "slopes" });
    this.phaseFlowLayer = createSvgElement("g", { "data-layer": "phase-flow" });
    this.curveLayer = createSvgElement("g", { "data-layer": "curves" });
    this.annotationLayer = document.createElement("div");
    this.annotationLayer.className = "plot-annotation-layer";

    this.svg.replaceChildren(
      createSvgElement("rect", {
        x: "0",
        y: "0",
        width: `${this.layout.width}`,
        height: `${this.layout.height}`,
        fill: "var(--plot-surface)"
      }),
      this.gridLayer,
      this.axisLayer,
      this.equilibriumLayer,
      this.slopeLayer,
      this.curveLayer,
      this.phaseFlowLayer
    );

    this.svg.parentElement?.append(this.annotationLayer);
  }

  render(viewModel: ViewModel): void {
    this.lastViewModel = viewModel;
    const coordinates = createCoordinateSystem(this.layout, viewModel.state.bounds);
    const boundsKey = serializeBounds(viewModel.state.bounds);
    const compiledKey = viewModel.compiled?.source ?? "invalid";

    if (this.gridKey !== boundsKey) {
      this.renderGrid(coordinates, viewModel.state.bounds);
      this.gridKey = boundsKey;
    }

    if (this.axesKey !== boundsKey) {
      this.renderAxes(coordinates, viewModel.state.bounds);
      this.axesKey = boundsKey;
    }

    const equilibriaKey = `${boundsKey}|${serializeEquilibria(viewModel.equilibria)}`;
    if (this.equilibriaKey !== equilibriaKey) {
      this.renderEquilibria(coordinates, viewModel.equilibria);
      this.equilibriaKey = equilibriaKey;
    }

    const slopeKey = `${boundsKey}|${compiledKey}|${viewModel.state.slopeDensity}`;
    if (this.slopeKey !== slopeKey) {
      this.renderSlopeField(coordinates, viewModel.compiled, viewModel.state.slopeDensity);
      this.slopeKey = slopeKey;
    }

    const phaseFlowKey = `${equilibriaKey}|${compiledKey}|${viewModel.state.showPhaseFlow}`;
    if (this.phaseFlowKey !== phaseFlowKey) {
      this.renderPhaseFlow(
        coordinates,
        viewModel.state.bounds,
        viewModel.compiled,
        viewModel.equilibria,
        viewModel.state.showPhaseFlow
      );
      this.phaseFlowKey = phaseFlowKey;
    }

    if (this.curveBoundsKey !== boundsKey || this.renderedTrajectories !== viewModel.trajectories) {
      this.renderCurves(coordinates, viewModel.trajectories, boundsKey);
    }

    this.renderLatexAnnotations(coordinates, viewModel.state.bounds, boundsKey);
  }

  resize(): void {
    if (!this.lastViewModel) {
      return;
    }

    this.positionLatexAnnotations();
  }

  clientPointToModel(
    clientX: number,
    clientY: number,
    bounds: ViewModel["state"]["bounds"]
  ): CurvePoint | null {
    const screenMatrix = this.svg.getScreenCTM();
    if (!screenMatrix) {
      return null;
    }

    const svgPoint = this.svg.createSVGPoint();
    svgPoint.x = clientX;
    svgPoint.y = clientY;
    const transformedPoint = svgPoint.matrixTransform(screenMatrix.inverse());
    const coordinates = createCoordinateSystem(this.layout, bounds);

    if (!coordinates.containsSvgPoint({ x: transformedPoint.x, y: transformedPoint.y })) {
      return null;
    }

    return coordinates.svgToModel({ x: transformedPoint.x, y: transformedPoint.y });
  }

  snapModelPoint(
    point: CurvePoint,
    bounds: ViewModel["state"]["bounds"],
    options: {
      equilibriumLevels?: number[];
      axisSnapPixels?: number;
      equilibriumSnapPixels?: number;
    }
  ): CurvePoint {
    const coordinates = createCoordinateSystem(this.layout, bounds);
    return snapPointToTargets(point, {
      bounds,
      equilibriumLevels: options.equilibriumLevels,
      scaleX: coordinates.scaleX,
      scaleY: coordinates.scaleY,
      axisSnapPixels: options.axisSnapPixels,
      equilibriumSnapPixels: options.equilibriumSnapPixels
    });
  }

  private renderGrid(coordinates: CoordinateSystem, bounds: ViewModel["state"]["bounds"]): void {
    const tTicks = computeNiceTicks(bounds.tMin, bounds.tMax, 8);
    const yTicks = computeNiceTicks(bounds.yMin, bounds.yMax, 8);
    const pathCommands: string[] = [];

    tTicks.forEach((tick) => {
      const position = coordinates.modelToSvg({ t: tick, y: bounds.yMin });

      pathCommands.push(
        `M ${position.x.toFixed(2)} ${coordinates.innerTop.toFixed(2)} ` +
          `L ${position.x.toFixed(2)} ${(coordinates.innerTop + coordinates.innerHeight).toFixed(2)}`
      );
    });

    yTicks.forEach((tick) => {
      const position = coordinates.modelToSvg({ t: bounds.tMin, y: tick });

      pathCommands.push(
        `M ${coordinates.innerLeft.toFixed(2)} ${position.y.toFixed(2)} ` +
          `L ${(coordinates.innerLeft + coordinates.innerWidth).toFixed(2)} ${position.y.toFixed(2)}`
      );
    });

    const frame = createSvgElement("rect", {
      x: `${coordinates.innerLeft}`,
      y: `${coordinates.innerTop}`,
      width: `${coordinates.innerWidth}`,
      height: `${coordinates.innerHeight}`,
      rx: "18",
      fill: "transparent",
      stroke: "var(--frame-stroke)",
      "stroke-width": "1.4"
    });
    const gridPath = createSvgElement("path", {
      d: pathCommands.join(" "),
      fill: "none",
      stroke: "var(--grid-stroke)",
      "stroke-width": "1"
    });

    this.gridLayer.replaceChildren(frame, gridPath);
  }

  private renderAxes(coordinates: CoordinateSystem, bounds: ViewModel["state"]["bounds"]): void {
    const nodes: SVGElement[] = [];

    if (bounds.yMin <= 0 && bounds.yMax >= 0) {
      const horizontal = coordinates.modelToSvg({ t: bounds.tMin, y: 0 });
      nodes.push(
        createSvgElement("line", {
          x1: `${coordinates.innerLeft}`,
          y1: `${horizontal.y}`,
          x2: `${coordinates.innerLeft + coordinates.innerWidth}`,
          y2: `${horizontal.y}`,
          stroke: "var(--axis-stroke)",
          "stroke-width": "1.6"
        })
      );
    }

    if (bounds.tMin <= 0 && bounds.tMax >= 0) {
      const vertical = coordinates.modelToSvg({ t: 0, y: bounds.yMin });
      nodes.push(
        createSvgElement("line", {
          x1: `${vertical.x}`,
          y1: `${coordinates.innerTop}`,
          x2: `${vertical.x}`,
          y2: `${coordinates.innerTop + coordinates.innerHeight}`,
          stroke: "var(--axis-stroke)",
          "stroke-width": "1.6"
        })
      );
    }

    this.axisLayer.replaceChildren(...nodes);
  }

  private renderEquilibria(
    coordinates: CoordinateSystem,
    equilibria: EquilibriumResult
  ): void {
    const pathCommands = equilibria.levels.map((level) => {
      const point = coordinates.modelToSvg({ t: 0, y: level });
      return (
        `M ${coordinates.innerLeft.toFixed(2)} ${point.y.toFixed(2)} ` +
        `L ${(coordinates.innerLeft + coordinates.innerWidth).toFixed(2)} ${point.y.toFixed(2)}`
      );
    });

    const intervalNodes = equilibria.intervals.map((interval) => {
      const top = coordinates.modelToSvg({ t: 0, y: interval.max }).y;
      const bottom = coordinates.modelToSvg({ t: 0, y: interval.min }).y;
      return createSvgElement("rect", {
        x: `${coordinates.innerLeft}`,
        y: `${Math.min(top, bottom)}`,
        width: `${coordinates.innerWidth}`,
        height: `${Math.abs(bottom - top)}`,
        fill: "var(--equilibrium-band)",
        "data-equilibrium-interval": "true"
      });
    });
    const lineNode =
      pathCommands.length > 0
        ? createSvgElement("path", {
            d: pathCommands.join(" "),
            fill: "none",
            stroke: "var(--equilibrium-stroke)",
            "stroke-width": "2.8"
          })
        : null;

    this.equilibriumLayer.replaceChildren(
      ...intervalNodes,
      ...(lineNode ? [lineNode] : [])
    );
  }

  private renderSlopeField(
    coordinates: CoordinateSystem,
    compiled: CompiledExpression | null,
    density: number
  ): void {
    if (!compiled) {
      this.slopeLayer.replaceChildren();
      return;
    }

    const columns = Math.max(2, Math.round(density));
    const rows = Math.max(10, Math.round((coordinates.innerHeight / coordinates.innerWidth) * density));
    const screenSpacing = Math.min(
      coordinates.innerWidth / Math.max(columns, 2),
      coordinates.innerHeight / Math.max(rows, 2)
    );
    const segmentLength = screenSpacing * 0.68;
    const pathCommands: string[] = [];
    const columnSamples = Array.from({ length: columns }, (_, column) => {
      const x = coordinates.innerLeft + (coordinates.innerWidth * column) / (columns - 1);

      return {
        t: coordinates.svgToModel({ x, y: coordinates.innerTop }).t,
        x
      };
    });

    for (let row = 0; row < rows; row += 1) {
      const centerY = coordinates.innerTop + (coordinates.innerHeight * row) / (rows - 1);
      const y = coordinates.svgToModel({ x: coordinates.innerLeft, y: centerY }).y;
      const autonomousDiagnostics = compiled.isAutonomous
        ? compiled.evaluateWithDiagnostics(0, y, SLOPE_EVALUATION_OPTIONS)
        : null;

      for (let column = 0; column < columns; column += 1) {
        const { t, x } = columnSamples[column];
        const slopeDiagnostics =
          autonomousDiagnostics ??
          compiled.evaluateWithDiagnostics(t, y, SLOPE_EVALUATION_OPTIONS);
        if (slopeDiagnostics.status !== "ok" || !Number.isFinite(slopeDiagnostics.value)) {
          continue;
        }
        const slope = slopeDiagnostics.value;

        const screenVector = normalizeVector({
          x: coordinates.scaleX,
          y: -slope * coordinates.scaleY
        });

        if (!screenVector) {
          continue;
        }

        pathCommands.push(
          `M ${(x - screenVector.x * segmentLength * 0.5).toFixed(2)} ` +
            `${(centerY - screenVector.y * segmentLength * 0.5).toFixed(2)} ` +
            `L ${(x + screenVector.x * segmentLength * 0.5).toFixed(2)} ` +
            `${(centerY + screenVector.y * segmentLength * 0.5).toFixed(2)}`
        );
      }
    }

    if (pathCommands.length === 0) {
      this.slopeLayer.replaceChildren();
      return;
    }

    this.slopeLayer.replaceChildren(
      createSvgElement("path", {
        d: pathCommands.join(" "),
        fill: "none",
        stroke: "var(--slope-stroke)",
        "stroke-width": "1.8",
        "stroke-linecap": "round"
      })
    );
  }

  private renderCurves(
    coordinates: CoordinateSystem,
    trajectories: IntegralCurve[],
    boundsKey: string
  ): void {
    const sameBounds = this.curveBoundsKey === boundsKey;
    const sharedPrefixLength = Math.min(this.renderedTrajectories.length, trajectories.length);
    const hasSharedPrefix =
      sameBounds &&
      this.renderedTrajectories
        .slice(0, sharedPrefixLength)
        .every((trajectory, index) => trajectory === trajectories[index]);

    if (hasSharedPrefix && trajectories.length >= this.renderedTrajectories.length) {
      for (let index = this.renderedTrajectories.length; index < trajectories.length; index += 1) {
        this.curveLayer.append(createCurveGroup(coordinates, trajectories[index], index));
      }
    } else if (hasSharedPrefix && trajectories.length < this.renderedTrajectories.length) {
      while (this.curveLayer.childElementCount > trajectories.length) {
        this.curveLayer.lastElementChild?.remove();
      }
    } else {
      this.curveLayer.replaceChildren(
        ...trajectories.map((trajectory, index) => createCurveGroup(coordinates, trajectory, index))
      );
    }

    this.curveBoundsKey = boundsKey;
    this.renderedTrajectories = trajectories;
  }

  private renderPhaseFlow(
    coordinates: CoordinateSystem,
    bounds: ViewModel["state"]["bounds"],
    compiled: CompiledExpression | null,
    equilibria: EquilibriumResult,
    showPhaseFlow: boolean
  ): void {
    if (
      !showPhaseFlow ||
      !compiled ||
      !compiled.isAutonomous ||
      !compiled.evaluateAutonomous ||
      equilibria.mode !== "roots" ||
      equilibria.levels.length === 0 ||
      equilibria.intervals.length > 0
    ) {
      this.phaseFlowLayer.replaceChildren();
      return;
    }

    const preparedEvaluation = compiled.prepareEvaluation?.(SLOPE_EVALUATION_OPTIONS);
    const evaluatePhaseSlope = (y: number): number => {
      const diagnostics = preparedEvaluation
        ? preparedEvaluation.evaluateWithDiagnostics(0, y)
        : compiled.evaluateWithDiagnostics(0, y, SLOPE_EVALUATION_OPTIONS);
      return diagnostics.status === "ok" ? diagnostics.value : Number.NaN;
    };
    const intervalIsInDomain = (start: number, end: number): boolean =>
      (preparedEvaluation
        ? preparedEvaluation.checkSegmentDomain({ t: 0, y: start }, { t: 0, y: end })
        : compiled.checkSegmentDomain(
            { t: 0, y: start },
            { t: 0, y: end },
            SLOPE_EVALUATION_OPTIONS
          )
      ).ok;
    const { bands, markers } = analyzePhaseFlow(
      bounds,
      equilibria.levels,
      evaluatePhaseSlope,
      1e-6,
      intervalIsInDomain
    );
    if (bands.length === 0) {
      this.phaseFlowLayer.replaceChildren();
      return;
    }

    const phaseX = this.resolvePhaseFlowX(coordinates, bounds);
    const nodes: SVGElement[] = [
      createSvgElement("rect", {
        x: `${phaseX - 14}`,
        y: `${coordinates.innerTop + 14}`,
        width: "28",
        height: `${coordinates.innerHeight - 28}`,
        rx: "14",
        fill: "var(--phase-flow-surface)",
        stroke: "var(--phase-flow-border)",
        "stroke-width": "1"
      }),
      createSvgElement("line", {
        x1: `${phaseX}`,
        y1: `${coordinates.innerTop + 18}`,
        x2: `${phaseX}`,
        y2: `${coordinates.innerTop + coordinates.innerHeight - 18}`,
        stroke: "var(--phase-flow-rail)",
        "stroke-width": "1.5",
        "stroke-linecap": "round"
      })
    ];

    markers.forEach((marker) => {
      const point = coordinates.modelToSvg({ t: bounds.tMin, y: marker.level });
      nodes.push(createEquilibriumMarkerNode(phaseX, point.y, marker));
    });

    bands.forEach((band) => {
      const yStart = coordinates.modelToSvg({ t: bounds.tMin, y: band.yStart }).y;
      const yEnd = coordinates.modelToSvg({ t: bounds.tMin, y: band.yEnd }).y;
      const intervalHeight = Math.abs(yEnd - yStart);
      const arrowCount = intervalHeight > 220 ? 3 : intervalHeight > 120 ? 2 : 1;

      for (let index = 0; index < arrowCount; index += 1) {
        const progress = (index + 1) / (arrowCount + 1);
        const y = yStart + (yEnd - yStart) * progress;
        nodes.push(createPhaseArrow(phaseX, y, band));
      }
    });

    this.phaseFlowLayer.replaceChildren(...nodes);
  }

  private resolvePhaseFlowX(
    coordinates: CoordinateSystem,
    bounds: ViewModel["state"]["bounds"]
  ): number {
    return coordinates.innerLeft;
  }

  private renderLatexAnnotations(
    coordinates: CoordinateSystem,
    bounds: ViewModel["state"]["bounds"],
    boundsKey: string
  ): void {
    if (this.annotationKey !== boundsKey) {
      const entries: typeof this.annotationEntries = [];
      const tTicks = computeNiceTicks(bounds.tMin, bounds.tMax, 8);
      const yTicks = computeNiceTicks(bounds.yMin, bounds.yMax, 8);

      tTicks.forEach((tick) => {
        const position = coordinates.modelToSvg({ t: tick, y: bounds.yMin });
        entries.push({
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: formatTickLatex(tick),
            className: "plot-latex-label tick-label"
          }),
          svgX: position.x,
          svgY: coordinates.innerTop + coordinates.innerHeight + 42
        });
      });

      yTicks.forEach((tick) => {
        const position = coordinates.modelToSvg({ t: bounds.tMin, y: tick });
        entries.push({
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: formatTickLatex(tick),
            className: "plot-latex-label tick-label is-y"
          }),
          svgX: coordinates.innerLeft - 18,
          svgY: position.y
        });
      });

      entries.push(
        {
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: "t",
            className: "plot-latex-label axis-label"
          }),
          svgX: coordinates.innerLeft + coordinates.innerWidth / 2,
          svgY: this.layout.height + 10
        },
        {
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: "y",
            className: "plot-latex-label axis-label vertical"
          }),
          svgX: 28,
          svgY: coordinates.innerTop + coordinates.innerHeight / 2
        }
      );

      this.annotationEntries = entries;
      this.annotationLayer.replaceChildren(...entries.map(({ element }) => element));
      this.annotationKey = boundsKey;
    }

    this.positionLatexAnnotations();
  }

  private positionLatexAnnotations(): void {
    const screenMatrix = this.svg.getScreenCTM();
    const layerRect = this.annotationLayer.getBoundingClientRect();

    if (!screenMatrix || layerRect.width === 0 || layerRect.height === 0) {
      this.annotationLayer.classList.add("is-unpositioned");
      return;
    }

    this.annotationLayer.classList.remove("is-unpositioned");
    this.annotationEntries.forEach((entry) => {
      const layerPoint = this.projectToOverlay(
        entry.svgX,
        entry.svgY,
        screenMatrix,
        layerRect
      );
      entry.element.style.left = `${layerPoint.x}px`;
      entry.element.style.top = `${layerPoint.y}px`;
    });
  }

  private projectToOverlay(
    x: number,
    y: number,
    screenMatrix: DOMMatrix,
    layerRect: DOMRect
  ): { x: number; y: number } {
    const point = this.svg.createSVGPoint();
    point.x = x;
    point.y = y;
    const screenPoint = point.matrixTransform(screenMatrix);

    return {
      x: screenPoint.x - layerRect.left,
      y: screenPoint.y - layerRect.top
    };
  }
}

function createSvgElement<TagName extends keyof SVGElementTagNameMap>(
  tagName: TagName,
  attributes: Record<string, string>,
  textContent?: string
): SVGElementTagNameMap[TagName] {
  const element = document.createElementNS(SVG_NAMESPACE, tagName) as SVGElementTagNameMap[TagName];
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });

  if (textContent) {
    element.textContent = textContent;
  }

  return element;
}

function serializeBounds(bounds: ViewModel["state"]["bounds"]): string {
  return `${bounds.tMin}|${bounds.tMax}|${bounds.yMin}|${bounds.yMax}`;
}

function serializeEquilibria(equilibria: EquilibriumResult): string {
  const intervals = equilibria.intervals
    .map(
      ({ min, max, minInclusive, maxInclusive }) =>
        `${min}:${max}:${Number(minInclusive)}:${Number(maxInclusive)}`
    )
    .join(",");
  return `${equilibria.mode}|${equilibria.levels.join(",")}|${intervals}`;
}

function normalizeVector(vector: { x: number; y: number }): { x: number; y: number } | null {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-12) {
    return null;
  }

  return {
    x: vector.x / length,
    y: vector.y / length
  };
}

function createCurveGroup(
  coordinates: CoordinateSystem,
  trajectory: IntegralCurve,
  index: number
): SVGGElement {
  const palette = CURVE_PALETTE[index % CURVE_PALETTE.length];
  const group = createSvgElement("g", { "data-curve-id": trajectory.id });
  const seedPoint = coordinates.modelToSvg(trajectory.seed);

  if (trajectory.points.length >= 2) {
    const pathData = trajectory.points
      .map((point, pointIndex) => {
        const svgPoint = coordinates.modelToSvg(point);
        return `${pointIndex === 0 ? "M" : "L"} ${svgPoint.x.toFixed(2)} ${svgPoint.y.toFixed(2)}`;
      })
      .join(" ");

    group.append(
      createSvgElement("path", {
        d: pathData,
        fill: "none",
        stroke: palette.stroke,
        "stroke-width": "3.2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );
  }

  group.append(
    createSvgElement("circle", {
      cx: `${seedPoint.x}`,
      cy: `${seedPoint.y}`,
      r: "8",
      fill: palette.halo
    }),
    createSvgElement("circle", {
      cx: `${seedPoint.x}`,
      cy: `${seedPoint.y}`,
      r: trajectory.points.length < 2 ? "4" : "4.5",
      fill: palette.seed,
      stroke: "var(--plot-surface)",
      "stroke-width": "1.5"
    })
  );

  return group;
}

function createPhaseArrow(
  x: number,
  y: number,
  band: PhaseFlowBand
): SVGGElement {
  const group = createSvgElement("g", {});
  const shaftHalfLength = 12.5;
  const arrowTipOffset = band.direction === "up" ? -shaftHalfLength : shaftHalfLength;
  const shaftEndOffset = band.direction === "up" ? shaftHalfLength : -shaftHalfLength;
  const headBaseOffset = band.direction === "up" ? -3.4 : 3.4;

  group.append(
    createSvgElement("line", {
      x1: `${x}`,
      y1: `${y + shaftEndOffset}`,
      x2: `${x}`,
      y2: `${y + arrowTipOffset}`,
      stroke: "var(--phase-flow-stroke)",
      "stroke-width": "2.3",
      "stroke-linecap": "round"
    }),
    createSvgElement("polygon", {
      points:
        band.direction === "up"
          ? `${x},${y - 15} ${x - 5.6},${y + headBaseOffset} ${x + 5.6},${y + headBaseOffset}`
          : `${x},${y + 15} ${x - 5.6},${y + headBaseOffset} ${x + 5.6},${y + headBaseOffset}`,
      fill: "var(--phase-flow-stroke)"
    })
  );

  return group;
}

function createLatexOverlayLabel(options: {
  x: number;
  y: number;
  latex: string;
  className: string;
}): HTMLDivElement {
  const element = document.createElement("div");
  element.className = options.className;
  element.style.left = `${options.x}px`;
  element.style.top = `${options.y}px`;
  element.innerHTML = katex.renderToString(options.latex, {
    throwOnError: false,
    displayMode: false
  });
  return element;
}

function createEquilibriumMarkerNode(
  x: number,
  y: number,
  marker: EquilibriumMarker
): SVGGElement {
  const radius = 4.6;
  const group = createSvgElement("g", {});

  if (marker.stability === "stable") {
    group.append(
      createSvgElement("circle", {
        cx: `${x}`,
        cy: `${y}`,
        r: `${radius}`,
        fill: "var(--phase-flow-stroke)",
        stroke: "var(--phase-flow-stroke)",
        "stroke-width": "1.2"
      })
    );
    return group;
  }

  group.append(
    createSvgElement("circle", {
      cx: `${x}`,
      cy: `${y}`,
      r: `${radius}`,
      fill: "var(--plot-surface)",
      stroke: "var(--phase-flow-stroke)",
      "stroke-width": "1.4"
    })
  );

  if (marker.stability === "unstable") {
    return group;
  }

  const clipId = `phase-marker-${marker.stability}-${x.toFixed(1)}-${y.toFixed(1)}`.replaceAll(".", "_");
  const clipPath = createSvgElement("clipPath", {
    id: clipId,
    clipPathUnits: "userSpaceOnUse"
  });

  clipPath.append(
    createSvgElement("rect", {
      x: `${x - radius - 1}`,
      y: marker.stability === "semistable-from-above" ? `${y - radius - 1}` : `${y}`,
      width: `${radius * 2 + 2}`,
      height: `${radius + 1}`
    })
  );

  group.append(
    clipPath,
    createSvgElement("circle", {
      cx: `${x}`,
      cy: `${y}`,
      r: `${radius}`,
      fill: "var(--phase-flow-stroke)",
      stroke: "none",
      "clip-path": `url(#${clipId})`
    })
  );

  return group;
}
