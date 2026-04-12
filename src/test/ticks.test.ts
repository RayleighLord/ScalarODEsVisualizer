import { describe, expect, it } from "vitest";

import { formatTickLatex } from "../plot/ticks";

describe("formatTickLatex", () => {
  it("formats ordinary numeric ticks as plain LaTeX text", () => {
    expect(formatTickLatex(-1.5)).toBe("-1.5");
    expect(formatTickLatex(2)).toBe("2");
  });

  it("formats scientific-notation ticks as LaTeX powers of ten", () => {
    expect(formatTickLatex(0.0012)).toBe("1.2 \\times 10^{-3}");
    expect(formatTickLatex(12000)).toBe("1.2 \\times 10^{4}");
  });
});
