import { createCoordinateSystem, type CoordinateSystem } from "./coordinates";
import {
  analyzePhaseFlow,
  type EquilibriumMarker,
  type PhaseFlowBand
} from "./phaseFlow";
import { snapPointToTargets } from "./snap";
import {
  computeNiceTickLayout,
  formatTickLatex,
  type NiceTickLayout
} from "./ticks";
import type { CompiledExpression } from "../math/parser";
import type { CurvePoint, EquilibriumResult, IntegralCurve, PlotLayout } from "../types";
import type { ViewModel } from "../ui/controller";
import katex from "katex";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SLOPE_EVALUATION_OPTIONS = {
  domainTolerance: 1e-8,
  derivativeMagnitudeLimit: 1e6
} as const;
const X_GRID_TARGET = 12;
const Y_GRID_TARGET = 6;
const GRID_MINOR_DIVISIONS = 5;
const ANNOTATION_EDGE_INSET = 8;
const ANNOTATION_COLLISION_GAP = 6;
const CURVE_SEED_HALO_RADIUS = 7;
const CURVE_SEED_RADIUS = 4;
const SINGLE_POINT_SEED_RADIUS = 3.5;
const CURVE_PALETTE = [
  { stroke: "#2f6fdb", seed: "#6d98e5", halo: "rgba(47, 111, 219, 0.22)" },
  { stroke: "#c4454d", seed: "#d8777d", halo: "rgba(196, 69, 77, 0.22)" },
  { stroke: "#1b7f5a", seed: "#4fa27f", halo: "rgba(27, 127, 90, 0.22)" },
  { stroke: "#7b4db3", seed: "#9f79ca", halo: "rgba(123, 77, 179, 0.22)" },
  { stroke: "#c9821f", seed: "#dca656", halo: "rgba(201, 130, 31, 0.22)" },
  { stroke: "#168c88", seed: "#55aaa7", halo: "rgba(22, 140, 136, 0.22)" },
  { stroke: "#b34478", seed: "#ca7398", halo: "rgba(179, 68, 120, 0.22)" },
  { stroke: "#c45a32", seed: "#d68162", halo: "rgba(196, 90, 50, 0.22)" },
  { stroke: "#4d5cc7", seed: "#7b86d8", halo: "rgba(77, 92, 199, 0.22)" },
  { stroke: "#708c2b", seed: "#94aa5c", halo: "rgba(112, 140, 43, 0.22)" },
  { stroke: "#167b9f", seed: "#579db7", halo: "rgba(22, 123, 159, 0.22)" },
  { stroke: "#a83d4f", seed: "#c26f7c", halo: "rgba(168, 61, 79, 0.22)" },
  { stroke: "#a66d13", seed: "#c0924c", halo: "rgba(166, 109, 19, 0.22)" },
  { stroke: "#2a8f68", seed: "#62ad8c", halo: "rgba(42, 143, 104, 0.22)" },
  { stroke: "#8b4aa0", seed: "#aa78b9", halo: "rgba(139, 74, 160, 0.22)" },
  { stroke: "#d16b5f", seed: "#df9188", halo: "rgba(209, 107, 95, 0.22)" },
  { stroke: "#35608a", seed: "#6e89a5", halo: "rgba(53, 96, 138, 0.22)" },
  { stroke: "#8a406a", seed: "#a96f8e", halo: "rgba(138, 64, 106, 0.22)" },
  { stroke: "#b38b18", seed: "#c8aa53", halo: "rgba(179, 139, 24, 0.22)" },
  { stroke: "#268b91", seed: "#62aeb2", halo: "rgba(38, 139, 145, 0.22)" }
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
    offsetX: number;
    offsetY: number;
    alignX: "start" | "center" | "end";
  }> = [];

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    this.layout = {
      width: 1280,
      height: 720,
      padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
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
    this.annotationLayer.setAttribute("aria-hidden", "true");
    const accessibleMetadata = Array.from(this.svg.children).filter(
      (element) => element.tagName === "title" || element.tagName === "desc"
    );

    this.svg.replaceChildren(
      ...accessibleMetadata,
      createSvgElement("rect", {
        x: "0",
        y: "0",
        width: `${this.layout.width}`,
        height: `${this.layout.height}`,
        fill: "var(--plot-surface)"
      }),
      this.gridLayer,
      this.slopeLayer,
      this.axisLayer,
      this.equilibriumLayer,
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

    const slopeKey = `${boundsKey}|${compiledKey}`;
    if (this.slopeKey !== slopeKey) {
      this.renderSlopeField(coordinates, viewModel.state.bounds, viewModel.compiled);
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
    this.refreshCurveSeedScreenGeometry();
    this.refreshPhaseFlowScreenGeometry();
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
    const screenMatrix = this.svg.getScreenCTM();
    const screenScaleX = screenMatrix
      ? coordinates.scaleX * Math.hypot(screenMatrix.a, screenMatrix.b)
      : coordinates.scaleX;
    const screenScaleY = screenMatrix
      ? coordinates.scaleY * Math.hypot(screenMatrix.c, screenMatrix.d)
      : coordinates.scaleY;
    return snapPointToTargets(point, {
      bounds,
      equilibriumLevels: options.equilibriumLevels,
      scaleX: screenScaleX,
      scaleY: screenScaleY,
      axisSnapPixels: options.axisSnapPixels,
      equilibriumSnapPixels: options.equilibriumSnapPixels
    });
  }

  findNearestTrajectoryId(
    clientX: number,
    clientY: number,
    bounds: ViewModel["state"]["bounds"],
    trajectories: IntegralCurve[],
    maxDistancePixels = 18
  ): string | null {
    const screenMatrix = this.svg.getScreenCTM();
    if (!screenMatrix || trajectories.length === 0) {
      return null;
    }

    const coordinates = createCoordinateSystem(this.layout, bounds);
    const projectToClient = (point: CurvePoint) => {
      const svgPoint = coordinates.modelToSvg(point);
      return {
        x: screenMatrix.a * svgPoint.x + screenMatrix.c * svgPoint.y + screenMatrix.e,
        y: screenMatrix.b * svgPoint.x + screenMatrix.d * svgPoint.y + screenMatrix.f
      };
    };
    const target = { x: clientX, y: clientY };
    let nearestId: string | null = null;
    let nearestDistanceSquared = maxDistancePixels * maxDistancePixels;

    trajectories.forEach((trajectory) => {
      const points = trajectory.points.length > 0 ? trajectory.points : [trajectory.seed];
      let previous = projectToClient(points[0]);
      let curveDistanceSquared = squaredDistance(target, previous);

      for (let index = 1; index < points.length; index += 1) {
        const current = projectToClient(points[index]);
        curveDistanceSquared = Math.min(
          curveDistanceSquared,
          squaredDistanceToSegment(target, previous, current)
        );
        previous = current;
      }

      curveDistanceSquared = Math.min(
        curveDistanceSquared,
        squaredDistance(target, projectToClient(trajectory.seed))
      );
      if (curveDistanceSquared <= nearestDistanceSquared) {
        nearestDistanceSquared = curveDistanceSquared;
        nearestId = trajectory.id;
      }
    });

    return nearestId;
  }

  private renderGrid(coordinates: CoordinateSystem, bounds: ViewModel["state"]["bounds"]): void {
    const { t: tTicks, y: yTicks } = computePlotTickLayouts(bounds);
    const majorPath = createSvgElement("path", {
      "data-grid": "major",
      d: createGridPath(coordinates, bounds, tTicks.major, yTicks.major),
      fill: "none",
      stroke: "var(--grid-major-stroke)",
      "stroke-width": "1.15",
      "vector-effect": "non-scaling-stroke"
    });
    const minorPath = createSvgElement("path", {
      "data-grid": "minor",
      d: createGridPath(coordinates, bounds, tTicks.minor, yTicks.minor),
      fill: "none",
      stroke: "var(--grid-minor-stroke)",
      "stroke-width": "0.7",
      "vector-effect": "non-scaling-stroke"
    });

    this.gridLayer.replaceChildren(minorPath, majorPath);
  }

  private renderAxes(coordinates: CoordinateSystem, bounds: ViewModel["state"]["bounds"]): void {
    const nodes: SVGElement[] = [];

    if (bounds.yMin <= 0 && bounds.yMax >= 0) {
      const horizontal = coordinates.modelToSvg({ t: bounds.tMin, y: 0 });
      nodes.push(
        createSvgElement("line", {
          "data-axis": "y-zero",
          x1: `${coordinates.innerLeft}`,
          y1: `${horizontal.y}`,
          x2: `${coordinates.innerLeft + coordinates.innerWidth}`,
          y2: `${horizontal.y}`,
          stroke: "var(--axis-stroke)",
          "stroke-width": "1.6",
          "vector-effect": "non-scaling-stroke"
        })
      );
    }

    if (bounds.tMin <= 0 && bounds.tMax >= 0) {
      const vertical = coordinates.modelToSvg({ t: 0, y: bounds.yMin });
      nodes.push(
        createSvgElement("line", {
          "data-axis": "t-zero",
          x1: `${vertical.x}`,
          y1: `${coordinates.innerTop}`,
          x2: `${vertical.x}`,
          y2: `${coordinates.innerTop + coordinates.innerHeight}`,
          stroke: "var(--axis-stroke)",
          "stroke-width": "1.6",
          "vector-effect": "non-scaling-stroke"
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
            "stroke-width": "2.8",
            "vector-effect": "non-scaling-stroke"
          })
        : null;

    this.equilibriumLayer.replaceChildren(
      ...intervalNodes,
      ...(lineNode ? [lineNode] : [])
    );
  }

  private renderSlopeField(
    coordinates: CoordinateSystem,
    bounds: ViewModel["state"]["bounds"],
    compiled: CompiledExpression | null
  ): void {
    if (!compiled) {
      this.slopeLayer.replaceChildren();
      return;
    }

    const { t: tTicks, y: yTicks } = computePlotTickLayouts(bounds);
    const tSamples = collectInteriorTicks(tTicks, bounds.tMin, bounds.tMax);
    const ySamples = collectInteriorTicks(yTicks, bounds.yMin, bounds.yMax);
    const segmentLength =
      Math.min(
        coordinates.scaleX * (tTicks.majorStep / GRID_MINOR_DIVISIONS),
        coordinates.scaleY * (yTicks.majorStep / GRID_MINOR_DIVISIONS)
      ) * 0.44;
    if (tSamples.length === 0 || ySamples.length === 0 || !Number.isFinite(segmentLength)) {
      this.slopeLayer.replaceChildren();
      return;
    }

    const pathCommands: string[] = [];
    const preparedEvaluation = compiled.prepareEvaluation?.(SLOPE_EVALUATION_OPTIONS);
    const evaluate = (t: number, y: number) =>
      preparedEvaluation
        ? preparedEvaluation.evaluateWithDiagnostics(t, y)
        : compiled.evaluateWithDiagnostics(t, y, SLOPE_EVALUATION_OPTIONS);
    const columnSamples = tSamples.map((t) => {
      const x = coordinates.modelToSvg({ t, y: bounds.yMin }).x;
      return {
        t,
        x
      };
    });

    for (const y of ySamples) {
      const centerY = coordinates.modelToSvg({ t: bounds.tMin, y }).y;
      const autonomousDiagnostics = compiled.isAutonomous ? evaluate(0, y) : null;

      for (const { t, x } of columnSamples) {
        const slopeDiagnostics = autonomousDiagnostics ?? evaluate(t, y);
        if (slopeDiagnostics.status !== "ok" || !Number.isFinite(slopeDiagnostics.value)) {
          continue;
        }
        const slope = slopeDiagnostics.value;

        const pathCommand = createDirectionFieldSegmentPath(
          x,
          centerY,
          segmentLength,
          coordinates.scaleX,
          coordinates.scaleY,
          slope
        );
        if (pathCommand) {
          pathCommands.push(pathCommand);
        }
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
        "stroke-width": "1.4",
        "stroke-linecap": "round",
        "data-slope-columns": `${tSamples.length}`,
        "data-slope-rows": `${ySamples.length}`,
        "vector-effect": "non-scaling-stroke"
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
    const previousById = new Map(
      this.renderedTrajectories.map((trajectory) => [trajectory.id, trajectory])
    );
    const canRetainRemaining =
      sameBounds &&
      trajectories.length < this.renderedTrajectories.length &&
      trajectories.every((trajectory) => previousById.get(trajectory.id) === trajectory);

    if (hasSharedPrefix && trajectories.length >= this.renderedTrajectories.length) {
      for (let index = this.renderedTrajectories.length; index < trajectories.length; index += 1) {
        this.curveLayer.append(createCurveGroup(coordinates, trajectories[index], index));
      }
    } else if (hasSharedPrefix && trajectories.length < this.renderedTrajectories.length) {
      while (this.curveLayer.childElementCount > trajectories.length) {
        this.curveLayer.lastElementChild?.remove();
      }
    } else if (canRetainRemaining) {
      const retainedIds = new Set(trajectories.map(({ id }) => id));
      Array.from(this.curveLayer.children).forEach((child) => {
        const curveId = child.getAttribute("data-curve-id");
        if (curveId && !retainedIds.has(curveId)) {
          child.remove();
        }
      });
    } else {
      this.curveLayer.replaceChildren(
        ...trajectories.map((trajectory, index) => createCurveGroup(coordinates, trajectory, index))
      );
    }

    this.curveBoundsKey = boundsKey;
    this.renderedTrajectories = trajectories;
    this.refreshCurveSeedScreenGeometry();
  }

  private refreshCurveSeedScreenGeometry(): void {
    const screenMatrix = this.svg.getScreenCTM();
    if (!screenMatrix) {
      return;
    }

    const scaleX = Math.hypot(screenMatrix.a, screenMatrix.b);
    const scaleY = Math.hypot(screenMatrix.c, screenMatrix.d);
    if (scaleX <= 0 || scaleY <= 0) {
      return;
    }

    this.curveLayer
      .querySelectorAll<SVGGElement>("[data-curve-seed-marker]")
      .forEach((marker) => {
        const x = Number(marker.dataset.curveSeedX);
        const y = Number(marker.dataset.curveSeedY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return;
        }

        marker.setAttribute(
          "transform",
          `translate(${x} ${y}) scale(${1 / scaleX} ${1 / scaleY})`
        );
      });
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
      equilibria.intervals.length > 0 ||
      bounds.tMin > 0 ||
      bounds.tMax < 0
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

    const phaseX = this.resolvePhaseFlowX(coordinates);
    const nodes: SVGElement[] = [
      createSvgElement("rect", {
        class: "phase-flow-track",
        "data-phase-flow-track": "true",
        "data-phase-x": `${phaseX}`,
        x: `${phaseX - 16}`,
        y: `${coordinates.innerTop}`,
        width: "32",
        height: `${coordinates.innerHeight}`,
        rx: "0",
        fill: "var(--phase-flow-surface)",
        stroke: "var(--phase-flow-border)",
        "stroke-width": "1.2",
        "vector-effect": "non-scaling-stroke"
      }),
      createSvgElement("line", {
        x1: `${phaseX}`,
        y1: `${coordinates.innerTop}`,
        x2: `${phaseX}`,
        y2: `${coordinates.innerTop + coordinates.innerHeight}`,
        stroke: "var(--phase-flow-rail)",
        "stroke-width": "1.6",
        "stroke-linecap": "butt",
        "vector-effect": "non-scaling-stroke"
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
      const arrowCount = Math.max(1, Math.min(6, Math.ceil(intervalHeight / 70)));

      for (let index = 0; index < arrowCount; index += 1) {
        const progress = (index + 1) / (arrowCount + 1);
        const y = yStart + (yEnd - yStart) * progress;
        nodes.push(createPhaseArrow(phaseX, y, band));
      }
    });

    this.phaseFlowLayer.replaceChildren(...nodes);
    this.refreshPhaseFlowScreenGeometry();
  }

  private resolvePhaseFlowX(coordinates: CoordinateSystem): number {
    return coordinates.modelToSvg({ t: 0, y: 0 }).x;
  }

  private refreshPhaseFlowScreenGeometry(): void {
    const screenMatrix = this.svg.getScreenCTM();
    if (!screenMatrix) {
      return;
    }
    const scaleX = Math.hypot(screenMatrix.a, screenMatrix.b);
    const scaleY = Math.hypot(screenMatrix.c, screenMatrix.d);
    if (scaleX <= 0 || scaleY <= 0) {
      return;
    }

    const track = this.phaseFlowLayer.querySelector<SVGRectElement>("[data-phase-flow-track]");
    if (track) {
      const phaseX = Number(track.dataset.phaseX);
      const halfWidth = 16 / scaleX;
      if (Number.isFinite(phaseX)) {
        track.setAttribute("x", `${phaseX - halfWidth}`);
        track.setAttribute("width", `${halfWidth * 2}`);
      }
    }

    this.phaseFlowLayer
      .querySelectorAll<SVGGElement>("[data-phase-symbol]")
      .forEach((symbol) => {
        const x = Number(symbol.dataset.phaseX);
        const y = Number(symbol.dataset.phaseY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return;
        }
        symbol.setAttribute(
          "transform",
          `translate(${x} ${y}) scale(${1 / scaleX} ${1 / scaleY})`
        );
      });
  }

  private renderLatexAnnotations(
    coordinates: CoordinateSystem,
    bounds: ViewModel["state"]["bounds"],
    boundsKey: string
  ): void {
    if (this.annotationKey !== boundsKey) {
      const entries: typeof this.annotationEntries = [];
      const { t: tTicks, y: yTicks } = computePlotTickLayouts(bounds);
      const innerRight = coordinates.innerLeft + coordinates.innerWidth;
      const innerBottom = coordinates.innerTop + coordinates.innerHeight;
      const horizontalAxisY = clamp(
        coordinates.modelToSvg({ t: bounds.tMin, y: 0 }).y,
        coordinates.innerTop,
        innerBottom
      );
      const verticalAxisX = clamp(
        coordinates.modelToSvg({ t: 0, y: bounds.yMin }).x,
        coordinates.innerLeft,
        innerRight
      );
      const xTickOffset = horizontalAxisY > innerBottom - 50 ? -18 : 18;
      const yTicksOnRight = verticalAxisX < coordinates.innerLeft + 64;
      const yTickOffset = yTicksOnRight ? 18 : -18;
      const yTickAlignment = yTicksOnRight ? "start" : "end";
      const axesIntersectInView =
        bounds.tMin <= 0 && bounds.tMax >= 0 && bounds.yMin <= 0 && bounds.yMax >= 0;

      tTicks.major.forEach((tick) => {
        const position = coordinates.modelToSvg({ t: tick, y: bounds.yMin });
        entries.push({
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: formatTickLatex(tick, tTicks.majorStep),
            className: "plot-latex-label tick-label is-x"
          }),
          svgX: position.x,
          svgY: horizontalAxisY,
          offsetX: 0,
          offsetY: xTickOffset,
          alignX: "center"
        });
      });

      yTicks.major.forEach((tick) => {
        if (axesIntersectInView && Math.abs(tick) <= Math.abs(yTicks.majorStep) * 1e-9) {
          return;
        }
        const position = coordinates.modelToSvg({ t: bounds.tMin, y: tick });
        entries.push({
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: formatTickLatex(tick, yTicks.majorStep),
            className: "plot-latex-label tick-label is-y"
          }),
          svgX: verticalAxisX,
          svgY: position.y,
          offsetX: yTickOffset,
          offsetY: 0,
          alignX: yTickAlignment
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
          svgX: innerRight,
          svgY: horizontalAxisY,
          offsetX: -20,
          offsetY: -xTickOffset,
          alignX: "end"
        },
        {
          element: createLatexOverlayLabel({
            x: 0,
            y: 0,
            latex: "y",
            className: "plot-latex-label axis-label vertical"
          }),
          svgX: verticalAxisX,
          svgY: coordinates.innerTop,
          offsetX: -yTickOffset,
          offsetY: 72,
          alignX: yTicksOnRight ? "end" : "start"
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
      const width = entry.element.offsetWidth;
      const height = entry.element.offsetHeight;
      const alignedLeft =
        layerPoint.x +
        entry.offsetX -
        (entry.alignX === "center" ? width / 2 : entry.alignX === "end" ? width : 0);
      const top = layerPoint.y + entry.offsetY - height / 2;
      entry.element.style.left = `${clamp(
        alignedLeft,
        ANNOTATION_EDGE_INSET,
        Math.max(ANNOTATION_EDGE_INSET, layerRect.width - width - ANNOTATION_EDGE_INSET)
      )}px`;
      entry.element.style.top = `${clamp(
        top,
        ANNOTATION_EDGE_INSET,
        Math.max(ANNOTATION_EDGE_INSET, layerRect.height - height - ANNOTATION_EDGE_INSET)
      )}px`;
    });
    this.separateHorizontalAxisTitleFromTicks(layerRect);
  }

  private separateHorizontalAxisTitleFromTicks(layerRect: DOMRect): void {
    const title = this.annotationEntries.find(
      ({ element }) =>
        element.classList.contains("axis-label") && !element.classList.contains("vertical")
    )?.element;
    const ticks = this.annotationEntries
      .map(({ element }) => element)
      .filter(
        (element) =>
          element.classList.contains("tick-label") && element.classList.contains("is-x")
      );
    if (!title || ticks.length === 0) {
      return;
    }

    const titleLeft = Number.parseFloat(title.style.left);
    const titleTop = Number.parseFloat(title.style.top);
    const titleRight = titleLeft + title.offsetWidth;
    const titleBottom = titleTop + title.offsetHeight;
    const collidingTicks = ticks
      .map((tick) => {
        const left = Number.parseFloat(tick.style.left);
        const top = Number.parseFloat(tick.style.top);
        return {
          left,
          right: left + tick.offsetWidth,
          top,
          bottom: top + tick.offsetHeight
        };
      })
      .filter(
        (tick) =>
          titleLeft < tick.right + ANNOTATION_COLLISION_GAP &&
          titleRight + ANNOTATION_COLLISION_GAP > tick.left &&
          titleTop < tick.bottom + ANNOTATION_COLLISION_GAP &&
          titleBottom + ANNOTATION_COLLISION_GAP > tick.top
      );
    if (collidingTicks.length === 0) {
      return;
    }

    const minimumTop = ANNOTATION_EDGE_INSET;
    const maximumTop = Math.max(
      ANNOTATION_EDGE_INSET,
      layerRect.height - title.offsetHeight - ANNOTATION_EDGE_INSET
    );
    const candidates = [
      Math.min(...collidingTicks.map(({ top }) => top)) -
        ANNOTATION_COLLISION_GAP -
        title.offsetHeight,
      Math.max(...collidingTicks.map(({ bottom }) => bottom)) + ANNOTATION_COLLISION_GAP
    ].filter((candidate) => candidate >= minimumTop && candidate <= maximumTop);

    if (candidates.length > 0) {
      const nearestCandidate = candidates.reduce((nearest, candidate) =>
        Math.abs(candidate - titleTop) < Math.abs(nearest - titleTop) ? candidate : nearest
      );
      title.style.top = `${nearestCandidate}px`;
    }
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

function computePlotTickLayouts(bounds: ViewModel["state"]["bounds"]): {
  t: NiceTickLayout;
  y: NiceTickLayout;
} {
  return {
    t: computeNiceTickLayout(
      bounds.tMin,
      bounds.tMax,
      X_GRID_TARGET,
      GRID_MINOR_DIVISIONS
    ),
    y: computeNiceTickLayout(
      bounds.yMin,
      bounds.yMax,
      Y_GRID_TARGET,
      GRID_MINOR_DIVISIONS
    )
  };
}

export function collectInteriorTicks(
  layout: NiceTickLayout,
  min: number,
  max: number
): number[] {
  return [...layout.major, ...layout.minor]
    .filter((tick) => isInteriorTick(tick, min, max))
    .sort((left, right) => left - right);
}

export function createGridPath(
  coordinates: CoordinateSystem,
  bounds: ViewModel["state"]["bounds"],
  tTicks: number[],
  yTicks: number[]
): string {
  const commands: string[] = [];
  const innerRight = coordinates.innerLeft + coordinates.innerWidth;
  const innerBottom = coordinates.innerTop + coordinates.innerHeight;

  tTicks.forEach((tick) => {
    if (!isInteriorTick(tick, bounds.tMin, bounds.tMax)) {
      return;
    }
    const x = coordinates.modelToSvg({ t: tick, y: bounds.yMin }).x;
    commands.push(
      `M ${x.toFixed(2)} ${coordinates.innerTop.toFixed(2)} ` +
        `L ${x.toFixed(2)} ${innerBottom.toFixed(2)}`
    );
  });

  yTicks.forEach((tick) => {
    if (!isInteriorTick(tick, bounds.yMin, bounds.yMax)) {
      return;
    }
    const y = coordinates.modelToSvg({ t: bounds.tMin, y: tick }).y;
    commands.push(
      `M ${coordinates.innerLeft.toFixed(2)} ${y.toFixed(2)} ` +
        `L ${innerRight.toFixed(2)} ${y.toFixed(2)}`
    );
  });

  return commands.join(" ");
}

function isInteriorTick(tick: number, min: number, max: number): boolean {
  if (!Number.isFinite(tick) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return false;
  }

  const span = max - min;
  if (!Number.isFinite(span) || span <= 0 || tick <= min || tick >= max) {
    return false;
  }

  // Scale the edge inset with the visible range. The representability term
  // absorbs round-off at large offsets, while the cap prevents a coarse ULP
  // from consuming a genuinely interior line in a range only a few ULPs wide.
  const relativeTolerance = span * 1e-10;
  const magnitude = Math.max(Math.abs(min), Math.abs(max), Math.abs(tick));
  const representabilityTolerance = Math.max(
    Number.MIN_VALUE,
    magnitude * Number.EPSILON * 4
  );
  const tolerance = Math.min(
    span * 1e-6,
    Math.max(relativeTolerance, representabilityTolerance)
  );

  return tick - min > tolerance && max - tick > tolerance;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
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
  if (!Number.isFinite(vector.x) || !Number.isFinite(vector.y)) {
    return null;
  }

  // Normalize relative to the largest component. This keeps a finite nonzero
  // direction usable even when both screen scales are subnormal, and avoids
  // overflowing the length when both components are close to Number.MAX_VALUE.
  const componentScale = Math.max(Math.abs(vector.x), Math.abs(vector.y));
  if (componentScale === 0) {
    return null;
  }

  const scaledX = vector.x / componentScale;
  const scaledY = vector.y / componentScale;
  const scaledLength = Math.hypot(scaledX, scaledY);

  return {
    x: scaledX / scaledLength,
    y: scaledY / scaledLength
  };
}

/**
 * Creates one direction-field segment in screen coordinates. When the vertical
 * component overflows, normalize from the reciprocal component ratio instead
 * of dividing Infinity by Infinity. The latter would leak `NaN` into the SVG
 * path for finite slopes in extremely narrow, but still renderable, windows.
 */
export function createDirectionFieldSegmentPath(
  centerX: number,
  centerY: number,
  segmentLength: number,
  scaleX: number,
  scaleY: number,
  slope: number
): string | null {
  const screenY = -slope * scaleY;
  let screenVector: { x: number; y: number } | null;

  if (Number.isFinite(screenY)) {
    screenVector = normalizeVector({ x: scaleX, y: screenY });
  } else if (
    Number.isFinite(scaleX) &&
    scaleX > 0 &&
    Number.isFinite(scaleY) &&
    scaleY > 0 &&
    Number.isFinite(slope) &&
    slope !== 0
  ) {
    const horizontalToVerticalRatio = (scaleX / scaleY) / Math.abs(slope);
    const scaledLength = Math.hypot(horizontalToVerticalRatio, 1);
    screenVector = {
      x: horizontalToVerticalRatio / scaledLength,
      y: -Math.sign(slope) / scaledLength
    };
  } else {
    screenVector = null;
  }

  if (!screenVector) {
    return null;
  }

  const halfLength = segmentLength * 0.5;
  const startX = centerX - screenVector.x * halfLength;
  const startY = centerY - screenVector.y * halfLength;
  const endX = centerX + screenVector.x * halfLength;
  const endY = centerY + screenVector.y * halfLength;
  if (![startX, startY, endX, endY].every(Number.isFinite)) {
    return null;
  }

  return (
    `M ${startX.toFixed(2)} ${startY.toFixed(2)} ` +
    `L ${endX.toFixed(2)} ${endY.toFixed(2)}`
  );
}

function squaredDistance(
  left: { x: number; y: number },
  right: { x: number; y: number }
): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function squaredDistanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number }
): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  if (lengthSquared < 1e-12) {
    return squaredDistance(point, start);
  }

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared
    )
  );
  return squaredDistance(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY
  });
}

function createCurveGroup(
  coordinates: CoordinateSystem,
  trajectory: IntegralCurve,
  index: number
): SVGGElement {
  const palette = CURVE_PALETTE[resolveCurvePaletteIndex(trajectory.id, index)];
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
        "stroke-linejoin": "round",
        "vector-effect": "non-scaling-stroke"
      })
    );
  }

  const seedMarker = createSvgElement("g", {
    "data-curve-seed-marker": "true",
    "data-curve-seed-x": `${seedPoint.x}`,
    "data-curve-seed-y": `${seedPoint.y}`
  });
  seedMarker.append(
    createSvgElement("circle", {
      cx: "0",
      cy: "0",
      r: `${CURVE_SEED_HALO_RADIUS}`,
      fill: palette.halo,
      "data-curve-seed-halo": "true"
    }),
    createSvgElement("circle", {
      cx: "0",
      cy: "0",
      r: `${trajectory.points.length < 2 ? SINGLE_POINT_SEED_RADIUS : CURVE_SEED_RADIUS}`,
      fill: palette.seed,
      stroke: "var(--plot-surface)",
      "stroke-width": "1.5",
      "vector-effect": "non-scaling-stroke",
      "data-curve-seed-core": "true"
    })
  );
  group.append(seedMarker);

  return group;
}

function resolveCurvePaletteIndex(curveId: string, fallbackIndex: number): number {
  const numericSuffix = /(?:^|-)\d+$/.exec(curveId)?.[0].replace("-", "");
  const parsedId = numericSuffix === undefined ? Number.NaN : Number(numericSuffix);
  const stableIndex = Number.isInteger(parsedId) && parsedId > 0 ? parsedId - 1 : fallbackIndex;
  return stableIndex % CURVE_PALETTE.length;
}

function createPhaseArrow(
  x: number,
  y: number,
  band: PhaseFlowBand
): SVGGElement {
  const group = createSvgElement("g", {
    "data-phase-symbol": "true",
    "data-phase-arrow": "true",
    "data-phase-x": `${x}`,
    "data-phase-y": `${y}`
  });
  const direction = band.direction === "up" ? -1 : 1;

  group.append(
    createSvgElement("line", {
      x1: "0",
      y1: `${-direction * 15}`,
      x2: "0",
      y2: `${direction * 8}`,
      stroke: "var(--phase-flow-stroke)",
      "stroke-width": "2.2",
      "stroke-linecap": "butt",
      "vector-effect": "non-scaling-stroke"
    }),
    createSvgElement("path", {
      "data-phase-arrow-head": "true",
      d:
        `M -5.5 ${direction * 7} ` +
        `L 0 ${direction * 18} ` +
        `L 5.5 ${direction * 7} Z`,
      fill: "var(--phase-flow-stroke)",
      stroke: "var(--phase-flow-stroke)",
      "stroke-width": "1",
      "stroke-linejoin": "round",
      "vector-effect": "non-scaling-stroke"
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
  const radius = 5.2;
  const group = createSvgElement("g", {
    "data-phase-symbol": "true",
    "data-phase-marker": "true",
    "data-phase-marker-stability": marker.stability,
    "data-phase-x": `${x}`,
    "data-phase-y": `${y}`
  });

  if (marker.stability === "stable") {
    group.append(
      createSvgElement("circle", {
        cx: "0",
        cy: "0",
        r: `${radius}`,
        fill: "var(--phase-flow-stroke)",
        stroke: "var(--phase-flow-stroke)",
        "stroke-width": "1.2",
        "vector-effect": "non-scaling-stroke"
      })
    );
    return group;
  }

  group.append(
    createSvgElement("circle", {
      cx: "0",
      cy: "0",
      r: `${radius}`,
      fill: "var(--phase-flow-surface)",
      stroke: "var(--phase-flow-stroke)",
      "stroke-width": "1.4",
      "vector-effect": "non-scaling-stroke"
    })
  );

  if (marker.stability === "unstable") {
    return group;
  }

  const clipId = `phase-marker-${marker.stability}-${x.toFixed(2)}-${y.toFixed(2)}`.replaceAll(
    ".",
    "_"
  );
  const clipPath = createSvgElement("clipPath", {
    id: clipId,
    clipPathUnits: "userSpaceOnUse"
  });

  clipPath.append(
    createSvgElement("rect", {
      x: `${-radius - 1}`,
      y: marker.stability === "semistable-from-above" ? `${-radius - 1}` : "0",
      width: `${radius * 2 + 2}`,
      height: `${radius + 1}`
    })
  );

  group.append(
    clipPath,
    createSvgElement("circle", {
      cx: "0",
      cy: "0",
      r: `${radius}`,
      fill: "var(--phase-flow-stroke)",
      stroke: "none",
      "clip-path": `url(#${clipId})`
    })
  );

  return group;
}
