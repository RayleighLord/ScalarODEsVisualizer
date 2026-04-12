import { describe, expect, it } from "vitest";

import { classifyEquilibriumMarkers, computePhaseFlowBands } from "../plot/phaseFlow";

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
});
