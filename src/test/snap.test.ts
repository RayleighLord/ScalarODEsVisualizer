import { describe, expect, it } from "vitest";

import { snapPointToTargets } from "../plot/snap";

const bounds = {
  tMin: -4,
  tMax: 4,
  yMin: -2,
  yMax: 2
};

describe("snapPointToTargets", () => {
  it("snaps to nearby equilibrium levels", () => {
    const snapped = snapPointToTargets(
      { t: 1.2, y: 0.03 },
      {
        bounds,
        equilibriumLevels: [0, 1],
        scaleX: 100,
        scaleY: 120,
        equilibriumSnapPixels: 8
      }
    );

    expect(snapped.y).toBe(0);
    expect(snapped.t).toBe(1.2);
  });

  it("snaps to the visible t-axis when close enough", () => {
    const snapped = snapPointToTargets(
      { t: 0.04, y: 1.1 },
      {
        bounds,
        equilibriumLevels: [],
        scaleX: 150,
        scaleY: 120,
        axisSnapPixels: 8
      }
    );

    expect(snapped.t).toBe(0);
    expect(snapped.y).toBe(1.1);
  });

  it("uses a smaller threshold for equilibrium snapping than for axis snapping", () => {
    const snapped = snapPointToTargets(
      { t: 0.02, y: 0.03 },
      {
        bounds,
        equilibriumLevels: [0],
        scaleX: 150,
        scaleY: 120,
        axisSnapPixels: 10,
        equilibriumSnapPixels: 2
      }
    );

    expect(snapped.t).toBe(0);
    expect(snapped.y).toBe(0.03);
  });
});
