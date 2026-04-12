import { describe, expect, it } from "vitest";

import { createCoordinateSystem } from "../plot/coordinates";
import type { AxisBounds, PlotLayout } from "../types";

describe("createCoordinateSystem", () => {
  it("round-trips points between model and SVG space", () => {
    const bounds: AxisBounds = {
      tMin: -4,
      tMax: 4,
      yMin: -2,
      yMax: 2
    };
    const layout: PlotLayout = {
      width: 960,
      height: 640,
      padding: {
        top: 32,
        right: 26,
        bottom: 56,
        left: 72
      }
    };

    const coordinates = createCoordinateSystem(layout, bounds);
    const point = { t: 1.25, y: -0.75 };
    const svgPoint = coordinates.modelToSvg(point);
    const roundTrip = coordinates.svgToModel(svgPoint);

    expect(roundTrip.t).toBeCloseTo(point.t, 8);
    expect(roundTrip.y).toBeCloseTo(point.y, 8);
  });
});
