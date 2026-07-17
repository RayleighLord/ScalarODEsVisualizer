import { describe, expect, it } from "vitest";

import { createCoordinateSystem } from "../plot/coordinates";
import {
  collectInteriorTicks,
  createDirectionFieldSegmentPath,
  createGridPath
} from "../plot/renderer";
import { computeNiceTickLayout } from "../plot/ticks";
import type { AxisBounds, PlotLayout } from "../types";

const plotLayout: PlotLayout = {
  width: 1280,
  height: 720,
  padding: { top: 0, right: 0, bottom: 0, left: 0 }
};

describe("renderer grid sampling", () => {
  it("retains interior grid lines and slope samples in very narrow windows", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 1e-12,
      yMin: 0,
      yMax: 1e-12
    };
    const tLayout = computeNiceTickLayout(bounds.tMin, bounds.tMax, 12, 5);
    const yLayout = computeNiceTickLayout(bounds.yMin, bounds.yMax, 6, 5);
    const tSamples = collectInteriorTicks(tLayout, bounds.tMin, bounds.tMax);
    const ySamples = collectInteriorTicks(yLayout, bounds.yMin, bounds.yMax);

    expect(tSamples.length).toBeGreaterThan(0);
    expect(ySamples.length).toBeGreaterThan(0);
    expect(tSamples.every((tick) => tick > bounds.tMin && tick < bounds.tMax)).toBe(true);
    expect(ySamples.every((tick) => tick > bounds.yMin && tick < bounds.yMax)).toBe(true);

    const coordinates = createCoordinateSystem(plotLayout, bounds);
    const gridPath = createGridPath(
      coordinates,
      bounds,
      [...tLayout.major, ...tLayout.minor],
      [...yLayout.major, ...yLayout.minor]
    );

    expect(gridPath.match(/\bM /g)?.length ?? 0).toBe(tSamples.length + ySamples.length);
  });

  it("still omits exact edge ticks from the default grid", () => {
    const bounds: AxisBounds = {
      tMin: -6,
      tMax: 6,
      yMin: -3,
      yMax: 3
    };
    const tLayout = computeNiceTickLayout(bounds.tMin, bounds.tMax, 12, 5);
    const yLayout = computeNiceTickLayout(bounds.yMin, bounds.yMax, 6, 5);
    const tSamples = collectInteriorTicks(tLayout, bounds.tMin, bounds.tMax);
    const ySamples = collectInteriorTicks(yLayout, bounds.yMin, bounds.yMax);

    expect(tSamples).not.toContain(bounds.tMin);
    expect(tSamples).not.toContain(bounds.tMax);
    expect(ySamples).not.toContain(bounds.yMin);
    expect(ySamples).not.toContain(bounds.yMax);
  });
});

describe("direction-field segment geometry", () => {
  it("preserves the ordinary screen-space slope normalization", () => {
    expect(createDirectionFieldSegmentPath(10, 20, 10, 3, 4, 1)).toBe(
      "M 7.00 24.00 L 13.00 16.00"
    );
  });

  it("renders direction segments across very large finite windows", () => {
    const bounds: AxisBounds = {
      tMin: 0,
      tMax: 1e308,
      yMin: 0,
      yMax: 1e308
    };
    const coordinates = createCoordinateSystem(plotLayout, bounds);

    expect(coordinates.scaleX).toBeGreaterThan(0);
    expect(coordinates.scaleX).toBeLessThan(1e-300);
    expect(coordinates.scaleY).toBeGreaterThan(0);
    expect(coordinates.scaleY).toBeLessThan(1e-300);
    expect(
      createDirectionFieldSegmentPath(
        640,
        360,
        24,
        coordinates.scaleX,
        coordinates.scaleY,
        1
      )
    ).toBe("M 629.54 365.88 L 650.46 354.12");
  });

  it("renders a finite vertical segment when slope scaling overflows", () => {
    const bounds: AxisBounds = {
      tMin: -6,
      tMax: 6,
      yMin: 0,
      yMax: 3e-305
    };
    const coordinates = createCoordinateSystem(plotLayout, bounds);
    const slope = 10;

    expect(coordinates.scaleY).toBeTypeOf("number");
    expect(Number.isFinite(coordinates.scaleY)).toBe(true);
    expect(slope * coordinates.scaleY).toBe(Number.POSITIVE_INFINITY);

    const path = createDirectionFieldSegmentPath(
      640,
      360,
      24,
      coordinates.scaleX,
      coordinates.scaleY,
      slope
    );

    expect(path).toBe("M 640.00 372.00 L 640.00 348.00");
    expect(path).not.toMatch(/NaN|Infinity/);
  });
});
