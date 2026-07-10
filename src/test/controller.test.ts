import { describe, expect, it, vi } from "vitest";

import { findEquilibria } from "../math/equilibria";
import { compileExpression } from "../math/parser";
import { createSolverSettings, solveIntegralCurve } from "../solver/rk4";
import type { AxisBounds, CurveSeed, IntegralCurve, SolverSettings } from "../types";
import { AppController, createDefaultState } from "../ui/controller";

function createHarness() {
  const compileSpy = vi.fn(compileExpression);
  const equilibriumSpy = vi.fn(findEquilibria);
  const settingsSpy = vi.fn(createSolverSettings);
  const solveSpy = vi.fn(
    (
      seed: CurveSeed,
      _bounds: AxisBounds,
      _expression: Parameters<typeof solveIntegralCurve>[2],
      _settings: SolverSettings
    ): IntegralCurve => ({
      id: seed.id,
      seed,
      points: [{ t: seed.t, y: seed.y }],
      terminationReason: "domain-limit"
    })
  );
  const controller = new AppController(createDefaultState(), {
    compileExpression: compileSpy,
    findEquilibria: equilibriumSpy,
    createSolverSettings: settingsSpy,
    solveIntegralCurve: solveSpy
  });

  const clearMathCalls = () => {
    compileSpy.mockClear();
    equilibriumSpy.mockClear();
    settingsSpy.mockClear();
    solveSpy.mockClear();
  };

  return {
    controller,
    compileSpy,
    equilibriumSpy,
    settingsSpy,
    solveSpy,
    clearMathCalls
  };
}

describe("AppController dependency invalidation", () => {
  it("solves only a newly added seed and retains existing trajectory references", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();

    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(solveSpy).not.toHaveBeenCalled();

    controller.addCurveSeed({ t: -1, y: 0.25 });
    const firstTrajectory = controller.getViewModel().trajectories[0];
    controller.addCurveSeed({ t: 1, y: 0.75 });

    expect(solveSpy).toHaveBeenCalledTimes(2);
    expect(controller.getViewModel().trajectories).toHaveLength(2);
    expect(controller.getViewModel().trajectories[0]).toBe(firstTrajectory);

    const compiled = controller.getViewModel().compiled;
    const equilibria = controller.getViewModel().equilibria;
    const trajectories = controller.getViewModel().trajectories;
    clearMathCalls();

    controller.setShowPhaseFlow(true);

    expect(controller.getViewModel().compiled).toBe(compiled);
    expect(controller.getViewModel().equilibria).toBe(equilibria);
    expect(controller.getViewModel().trajectories).toBe(trajectories);
    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).not.toHaveBeenCalled();

    controller.clearCurves();

    expect(controller.getViewModel().state.curveSeeds).toEqual([]);
    expect(controller.getViewModel().trajectories).toEqual([]);
    expect(controller.getViewModel().compiled).toBe(compiled);
    expect(controller.getViewModel().equilibria).toBe(equilibria);
    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).not.toHaveBeenCalled();
  });

  it("recompiles only when the expression changes and recomputes every retained seed", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: -1, y: 0.25 });
    controller.addCurveSeed({ t: 1, y: 0.75 });
    const previousTrajectories = controller.getViewModel().trajectories;
    clearMathCalls();

    controller.setExpression(controller.getViewModel().state.expression);

    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).not.toHaveBeenCalled();
    expect(controller.getViewModel().trajectories).toBe(previousTrajectories);

    controller.setExpression("t - y");

    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).toHaveBeenCalledTimes(2);
    expect(controller.getViewModel().trajectories[0]).not.toBe(previousTrajectories[0]);
    expect(controller.getViewModel().trajectories[1]).not.toBe(previousTrajectories[1]);
  });

  it("rescans equilibria only for y-bound changes while resolving all seeds for any bound change", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: -1, y: 0.25 });
    controller.addCurveSeed({ t: 1, y: 0.75 });
    clearMathCalls();

    controller.applyBounds({ ...controller.getViewModel().state.bounds, tMax: 6 });

    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).not.toHaveBeenCalled();
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(solveSpy).toHaveBeenCalledTimes(2);
    clearMathCalls();

    controller.applyBounds({ ...controller.getViewModel().state.bounds, yMin: -3 });

    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(solveSpy).toHaveBeenCalledTimes(2);
    clearMathCalls();

    const currentBounds = controller.getViewModel().state.bounds;
    controller.applyBounds({ ...currentBounds });
    controller.applyBounds({ ...currentBounds, tMin: currentBounds.tMax });

    expect(controller.getViewModel().state.bounds).toEqual(currentBounds);
    expect(controller.getViewModel().state.boundsError).toBeTruthy();
    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).not.toHaveBeenCalled();
  });

  it("preserves seeds through invalid expressions and recomputes them once input is valid", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: -1, y: 0.25 });
    controller.addCurveSeed({ t: 1, y: 0.75 });
    clearMathCalls();

    controller.setExpression("sin(");

    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).not.toHaveBeenCalled();
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).not.toHaveBeenCalled();
    expect(controller.getViewModel().compiled).toBeNull();
    expect(controller.getViewModel().equationError).toBeTruthy();
    expect(controller.getViewModel().state.curveSeeds).toHaveLength(2);
    expect(controller.getViewModel().trajectories).toEqual([]);
    clearMathCalls();

    controller.addCurveSeed({ t: 0, y: 1.25 });

    expect(controller.getViewModel().state.curveSeeds).toHaveLength(3);
    expect(solveSpy).not.toHaveBeenCalled();

    controller.setExpression("y");

    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).toHaveBeenCalledTimes(3);
    expect(controller.getViewModel().equationError).toBeNull();
    expect(controller.getViewModel().trajectories.map((curve) => curve.id)).toEqual([
      "curve-1",
      "curve-2",
      "curve-3"
    ]);
  });

  it("resets cached dependencies selectively and never solves discarded seeds", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: 0, y: 0.5 });
    controller.applyBounds({ tMin: -6, tMax: 6, yMin: -3, yMax: 3 });
    clearMathCalls();

    controller.reset();

    expect(controller.getViewModel().state).toEqual(createDefaultState());
    expect(compileSpy).not.toHaveBeenCalled();
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(solveSpy).not.toHaveBeenCalled();
  });

  it("applies a pending expression and bounds with one final-state recomputation", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: -1, y: 0.25 });
    controller.addCurveSeed({ t: 1, y: 0.75 });
    clearMathCalls();
    const listener = vi.fn();
    controller.subscribe(listener);
    listener.mockClear();
    const finalBounds: AxisBounds = { tMin: -6, tMax: 6, yMin: -3, yMax: 3 };

    controller.applyUpdate({ expression: "t - y", bounds: finalBounds });

    const viewModel = controller.getViewModel();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(solveSpy).toHaveBeenCalledTimes(2);
    expect(viewModel.state.expression).toBe("t - y");
    expect(viewModel.state.bounds).toBe(finalBounds);
    expect(
      solveSpy.mock.calls.every(
        ([, bounds, expression]) => bounds === finalBounds && expression === viewModel.compiled
      )
    ).toBe(true);
  });

  it("combines a pending expression with clearing curves without solving discarded seeds", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: -1, y: 0.25 });
    controller.addCurveSeed({ t: 1, y: 0.75 });
    clearMathCalls();
    const listener = vi.fn();
    controller.subscribe(listener);
    listener.mockClear();

    controller.applyUpdate({ expression: "y^2", clearCurves: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).not.toHaveBeenCalled();
    expect(controller.getViewModel().state.curveSeeds).toEqual([]);
    expect(controller.getViewModel().trajectories).toEqual([]);
  });

  it("combines a pending expression with phase flow and publishes one solved state", () => {
    const { controller, compileSpy, equilibriumSpy, settingsSpy, solveSpy, clearMathCalls } =
      createHarness();
    controller.addCurveSeed({ t: -1, y: 0.25 });
    controller.addCurveSeed({ t: 1, y: 0.75 });
    clearMathCalls();
    const listener = vi.fn();
    controller.subscribe(listener);
    listener.mockClear();

    controller.applyUpdate({ expression: "t + y", showPhaseFlow: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(compileSpy).toHaveBeenCalledTimes(1);
    expect(equilibriumSpy).toHaveBeenCalledTimes(1);
    expect(settingsSpy).not.toHaveBeenCalled();
    expect(solveSpy).toHaveBeenCalledTimes(2);
    expect(controller.getViewModel().state.showPhaseFlow).toBe(true);
    expect(controller.getViewModel().state.expression).toBe("t + y");
  });
});
