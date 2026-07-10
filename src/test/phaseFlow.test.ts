import { describe, expect, it } from "vitest";

import {
  analyzePhaseFlow,
  classifyEquilibriumMarkers,
  computePhaseFlowBands
} from "../plot/phaseFlow";

const bounds = {
  tMin: -2,
  tMax: 2,
  yMin: -2,
  yMax: 2
};

describe("computePhaseFlowBands", () => {
  it("builds up and down flow intervals between equilibrium levels", () => {
    const bands = computePhaseFlowBands(bounds, [0, 1], (y) => y * (1 - y));

    expect(bands).toEqual([
      { yStart: -2, yEnd: 0, direction: "down" },
      { yStart: 0, yEnd: 1, direction: "up" },
      { yStart: 1, yEnd: 2, direction: "down" }
    ]);
  });

  it("returns no bands when there are no visible equilibrium levels", () => {
    const bands = computePhaseFlowBands(bounds, [], (y) => y - 1);

    expect(bands).toEqual([]);
  });

  it("classifies equilibrium stability from adjacent flow directions", () => {
    const markers = classifyEquilibriumMarkers(bounds, [0, 1], (y) => y * (1 - y));

    expect(markers).toEqual([
      { level: 0, stability: "unstable" },
      { level: 1, stability: "stable" }
    ]);
  });

  it("recognizes semistable equilibria", () => {
    const markers = classifyEquilibriumMarkers(bounds, [0], (y) => y * y);

    expect(markers).toEqual([{ level: 0, stability: "semistable-from-below" }]);
  });

  it("suppresses flow bands that cross an autonomous singularity", () => {
    const pole = 1.23;
    const analysis = analyzePhaseFlow(
      bounds,
      [0],
      (y) => y / (y - pole),
      1e-6,
      (start, end) => !(start <= pole && end >= pole)
    );

    expect(analysis.bands).toHaveLength(3);
    expect(analysis.bands[0]).toEqual({ yStart: -2, yEnd: 0, direction: "up" });
    expect(analysis.bands[1].yStart).toBe(0);
    expect(analysis.bands[1].yEnd).toBeLessThan(pole);
    expect(analysis.bands[1].direction).toBe("down");
    expect(analysis.bands[2].yStart).toBeGreaterThan(pole);
    expect(analysis.bands[2].yEnd).toBe(2);
    expect(analysis.bands[2].direction).toBe("up");
    expect(analysis.markers).toEqual([{ level: 0, stability: "stable" }]);
  });
});
