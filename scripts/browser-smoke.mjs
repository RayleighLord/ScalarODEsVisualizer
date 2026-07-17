import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const host = "127.0.0.1";
const port = Number(process.env.BROWSER_SMOKE_PORT ?? 30_000 + (process.pid % 20_000));
const baseUrl = `http://${host}:${port}/`;
const artifactDir = new URL("../output/playwright/", import.meta.url);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const requestedChromePath = process.env.CHROME_PATH;
const systemChromePath = "/usr/bin/google-chrome";
const executablePath =
  requestedChromePath ?? (existsSync(systemChromePath) ? systemChromePath : undefined);

await mkdir(artifactDir, { recursive: true });

const preview = spawn(
  process.execPath,
  [
    viteBin,
    "preview",
    "--host",
    host,
    "--port",
    `${port}`,
    "--strictPort"
  ],
  {
    cwd: projectRoot,
    stdio: ["ignore", "inherit", "inherit"]
  }
);

let browser;

try {
  await waitForServer(baseUrl, preview);
  browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {})
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await assertHealthyInitialRender(page);
  await assertIncrementalCurveAndOverlayRendering(page);
  await assertCurveSeedScreenGeometry(page);
  await assertPhaseFlowTrackAlignment(page);
  await assertDebouncedEquationEditing(page);
  await assertContextMenuCurveRemoval(page);
  await assertEquilibriumIntervalRendering(page);
  await assertCanceledDomainDependency(page);
  await assertAnnotationOnlyResize(page);
  await assertEdgeClampedAxisAnnotations(page);
  await assertUiVisibilityAndHelp(page);

  await page.screenshot({
    path: new URL("browser-smoke.png", artifactDir).pathname,
    fullPage: true
  });

  assert.deepEqual(browserErrors, [], `Browser errors:\n${browserErrors.join("\n")}`);
  console.log("Browser smoke checks passed.");
} finally {
  await browser?.close();
  preview.kill("SIGTERM");
  await waitForExit(preview);
}

async function assertHealthyInitialRender(page) {
  await page.locator("#equation-status").waitFor({ state: "visible" });
  assert.equal(await page.title(), "Scalar Differential Equation Explorer");
  assert.equal(await page.locator("#equation-status").textContent(), "Ready");
  assert.equal(await page.getByLabel("ODE right-hand side").inputValue(), "y * (2 - y)");
  assert.equal(await page.locator('[data-layer="slopes"] path').count(), 1);
  assert.equal(await page.locator('[data-layer="grid"]').locator(":scope > *").count(), 2);
  assert.equal(await page.locator('[data-layer="grid"] rect').count(), 0);
  assert.equal(await page.locator('[data-grid="minor"]').count(), 1);
  assert.equal(await page.locator('[data-grid="major"]').count(), 1);
  assert.equal(await page.locator("#t-min-input").inputValue(), "-6");
  assert.equal(await page.locator("#t-max-input").inputValue(), "6");
  assert.equal(await page.locator("#y-min-input").inputValue(), "-3");
  assert.equal(await page.locator("#y-max-input").inputValue(), "3");
  assert.equal(
    await page.locator("#ode-plot > title").count(),
    0,
    "The plot must not expose a native SVG hover tooltip."
  );
  assert.equal(
    await page.locator("#ode-plot").getAttribute("aria-label"),
    "Interactive direction field and integral curves"
  );
  assert.equal(await page.locator("#ode-plot").getAttribute("aria-describedby"), "plot-description");
  assert.equal(
    await page.locator('[data-layer="slopes"] path').getAttribute("data-slope-columns"),
    "59"
  );
  assert.equal(
    await page.locator('[data-layer="slopes"] path').getAttribute("data-slope-rows"),
    "29"
  );
  assert.ok((await page.locator(".plot-latex-label").count()) >= 10);
  assert.ok(
    Number.parseFloat(
      await page.locator(".plot-latex-label.tick-label").first().evaluate(
        (element) => getComputedStyle(element).fontSize
      )
    ) >= 22,
    "Axis numerals should use a comfortably readable font size."
  );
  await assertFullBleedAxisLabels(page);
}

async function assertFullBleedAxisLabels(page) {
  const geometry = await page.evaluate(() => {
    const plot = document.querySelector("#ode-plot");
    const stage = document.querySelector(".plot-stage");
    const horizontalAxis = document.querySelector('[data-axis="y-zero"]');
    const verticalAxis = document.querySelector('[data-axis="t-zero"]');
    if (!(plot instanceof SVGSVGElement) || !(stage instanceof HTMLElement)) {
      throw new Error("The plot and stage must be rendered.");
    }
    if (!(horizontalAxis instanceof SVGLineElement) || !(verticalAxis instanceof SVGLineElement)) {
      throw new Error("Both visible zero axes must be rendered.");
    }
    const matrix = plot.getScreenCTM();
    if (!matrix) {
      throw new Error("The plot must have a screen transform.");
    }
    const project = (x, y) => new DOMPoint(x, y).matrixTransform(matrix);
    const horizontalPoint = project(0, Number(horizontalAxis.getAttribute("y1")));
    const verticalPoint = project(Number(verticalAxis.getAttribute("x1")), 0);

    return {
      plot: plot.getBoundingClientRect().toJSON(),
      stage: stage.getBoundingClientRect().toJSON(),
      horizontalAxisY: horizontalPoint.y,
      verticalAxisX: verticalPoint.x,
      xLabels: Array.from(document.querySelectorAll(".plot-latex-label.tick-label.is-x")).map(
        (element) => element.getBoundingClientRect().toJSON()
      ),
      yLabels: Array.from(document.querySelectorAll(".plot-latex-label.tick-label.is-y")).map(
        (element) => element.getBoundingClientRect().toJSON()
      )
    };
  });

  assert.ok(Math.abs(geometry.plot.x - geometry.stage.x) < 0.5);
  assert.ok(Math.abs(geometry.plot.y - geometry.stage.y) < 0.5);
  assert.ok(Math.abs(geometry.plot.width - geometry.stage.width) < 0.5);
  assert.ok(Math.abs(geometry.plot.height - geometry.stage.height) < 0.5);
  assert.ok(geometry.xLabels.length > 0);
  assert.ok(geometry.yLabels.length > 0);
  assert.ok(
    geometry.xLabels.every(
      (label) => label.y > geometry.horizontalAxisY && label.y + label.height < geometry.plot.height
    ),
    "X-axis tick labels must sit inside and below the visible horizontal axis."
  );
  assert.ok(
    geometry.yLabels.every(
      (label) => label.x + label.width < geometry.verticalAxisX && label.x >= geometry.plot.x
    ),
    "Y-axis tick labels must sit inside and left of the visible vertical axis."
  );
}

async function assertIncrementalCurveAndOverlayRendering(page) {
  await page.evaluate(() => {
    document.querySelector('[data-layer="slopes"] path')?.setAttribute("data-retained", "slope");
    document.querySelector('[data-grid="major"]')?.setAttribute("data-retained", "grid");
    document.querySelector(".plot-latex-label")?.setAttribute("data-retained", "annotation");
    document.querySelector("#plot-ode-preview .katex")?.setAttribute("data-retained", "preview");
    document.querySelector("#equilibrium-solutions > *")?.setAttribute("data-retained", "status");
  });

  const plotBox = await page.locator("#ode-plot").boundingBox();
  assert.ok(plotBox, "The full-page plot must have a browser bounding box.");
  await page.mouse.click(plotBox.x + plotBox.width * 0.64, plotBox.y + plotBox.height * 0.42);
  await expectCurveCount(page, 1);

  assert.equal(
    await page.locator('[data-layer="slopes"] path').getAttribute("data-retained"),
    "slope",
    "Adding a curve must retain the direction-field node."
  );
  assert.equal(
    await page.locator('[data-grid="major"]').getAttribute("data-retained"),
    "grid",
    "Adding a curve must retain the grid node."
  );
  assert.equal(
    await page.locator(".plot-latex-label").first().getAttribute("data-retained"),
    "annotation",
    "Adding a curve must retain the KaTeX annotation nodes."
  );
  assert.equal(
    await page.locator("#plot-ode-preview .katex").getAttribute("data-retained"),
    "preview",
    "Adding a curve must not re-typeset an unchanged equation."
  );
  assert.equal(
    await page.locator("#equilibrium-solutions > *").first().getAttribute("data-retained"),
    "status",
    "Adding a curve must retain unchanged equilibrium status nodes."
  );

  await page.locator('label[for="phase-flow-toggle"]').click();
  await page.locator('[data-layer="phase-flow"] > *').first().waitFor();
  assert.equal(
    await page.locator('[data-layer="slopes"] path').getAttribute("data-retained"),
    "slope",
    "Toggling phase flow must not rebuild the direction field."
  );
}

async function assertCurveSeedScreenGeometry(page) {
  const marker = page.locator("[data-curve-seed-marker]").first();
  await marker.evaluate((node) => node.setAttribute("data-resize-retained", "yes"));

  for (const viewport of [
    { width: 960, height: 720 },
    { width: 1920, height: 730 }
  ]) {
    await page.setViewportSize(viewport);
    await waitForResizeRender(page);

    assert.equal(
      await marker.getAttribute("data-resize-retained"),
      "yes",
      "Resize must retain existing curve seed markers."
    );

    const haloBox = await marker.locator("[data-curve-seed-halo]").boundingBox();
    const coreBox = await marker.locator("[data-curve-seed-core]").boundingBox();
    assert.ok(haloBox);
    assert.ok(coreBox);
    assert.ok(
      Math.abs(haloBox.width - haloBox.height) < 0.5 &&
        Math.abs(coreBox.width - coreBox.height) < 0.5,
      `Curve seed markers must remain circular at ${viewport.width}x${viewport.height}.`
    );
    assert.ok(
      Math.abs(haloBox.width - 14) < 0.75 && Math.abs(coreBox.width - 9.5) < 0.75,
      `Curve seed markers must retain their compact screen-space size (halo ${haloBox.width.toFixed(2)}x${haloBox.height.toFixed(2)}, core ${coreBox.width.toFixed(2)}x${coreBox.height.toFixed(2)}).`
    );
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForResizeRender(page);
}

async function assertDebouncedEquationEditing(page) {
  const input = page.getByLabel("ODE right-hand side");
  const previewSource = page.locator(
    '#plot-ode-preview annotation[encoding="application/x-tex"]'
  );
  await input.fill(await input.inputValue());
  assert.equal(await page.locator("#equation-status").textContent(), "Updating…");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await page.locator("#plot-ode-preview").getAttribute("aria-busy"), null);

  await input.fill(await input.inputValue());
  await page.locator("#t-max-input").fill(await page.locator("#t-max-input").inputValue());
  assert.equal(await page.locator("#equation-status").textContent(), "Ready");
  assert.equal(await page.locator("#plot-ode-preview").getAttribute("aria-busy"), null);

  await input.fill("2/3 * y");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await previewSource.textContent(), "y' = \\frac{2}{3} \\cdot y");

  await input.fill("(2/3) * y");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(
    await previewSource.textContent(),
    "y' = \\left(\\frac{2}{3}\\right) \\cdot y"
  );

  await input.fill("sin(y) + 0.1 * t");
  assert.equal(await page.locator("#equation-status").textContent(), "Updating…");
  await page.locator("#t-max-input").fill("7");
  // A valid live bound edit must consume the pending expression and publish
  // both changes atomically. Crossing the old debounce deadline must not
  // restore the previous bound value or publish a stale expression update.
  await expectText(page.locator("#equation-type"), "Non-autonomous", 1500);
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#t-max-input").inputValue(), "7");
  assert.equal(await page.locator("#equation-status").textContent(), "Ready");
  assert.equal(await page.locator("#plot-ode-preview").getAttribute("aria-busy"), null);
  assert.equal(
    await page.locator('[data-grid="major"]').getAttribute("data-retained"),
    null,
    "A valid bound edit must update the rendered window without an Apply action."
  );
  assert.equal(
    await page.locator('[data-layer="slopes"] path').getAttribute("data-retained"),
    null,
    "A committed equation change must invalidate the direction field."
  );

  await input.fill("cos(y)");
  assert.equal(await page.locator("#equation-status").textContent(), "Updating…");
  await page.locator('label[for="phase-flow-toggle"]').click();
  await expectText(page.locator("#equation-type"), "Autonomous", 1500);
  assert.equal(await page.locator("#phase-flow-toggle").isChecked(), false);

  await input.fill("sin(");
  await expectText(page.locator("#equation-status"), "Needs attention", 1500);
  assert.equal(await page.locator('[data-layer="slopes"] > *').count(), 0);

  await input.fill("y * (2 - y)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
}

async function assertPhaseFlowTrackAlignment(page) {
  const track = page.locator('[data-phase-flow-track="true"]');
  const tZeroAxis = page.locator('[data-axis="t-zero"]');
  await track.waitFor();
  await tZeroAxis.waitFor({ state: "attached" });

  const alignment = await page.evaluate(() => {
    const trackNode = document.querySelector('[data-phase-flow-track="true"]');
    const axisNode = document.querySelector('[data-axis="t-zero"]');
    assertSvgElement(trackNode, "The phase-flow track must be rendered as SVG geometry.");
    assertSvgElement(axisNode, "The t=0 axis must be rendered as SVG geometry.");

    return {
      trackCenter: Number(trackNode.getAttribute("x")) + Number(trackNode.getAttribute("width")) / 2,
      axisX: Number(axisNode.getAttribute("x1"))
    };

    function assertSvgElement(node, message) {
      if (!(node instanceof SVGElement)) {
        throw new Error(message);
      }
    }
  });

  assert.ok(Number.isFinite(alignment.trackCenter));
  assert.ok(Number.isFinite(alignment.axisX));
  assert.ok(
    Math.abs(alignment.trackCenter - alignment.axisX) < 0.01,
    `The phase-flow track (${alignment.trackCenter}) must be centered on the t=0 axis (${alignment.axisX}).`
  );
  await assertPhaseFlowScreenGeometry(page);

  const marker = page.locator("[data-phase-marker]").first();
  await marker.evaluate((node) => node.setAttribute("data-resize-retained", "yes"));
  await page.setViewportSize({ width: 1180, height: 780 });
  await waitForResizeRender(page);
  assert.equal(await marker.getAttribute("data-resize-retained"), "yes");
  await assertPhaseFlowScreenGeometry(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await waitForResizeRender(page);
}

async function assertPhaseFlowScreenGeometry(page) {
  const plotBox = await page.locator("#ode-plot").boundingBox();
  const trackBox = await page.locator('[data-phase-flow-track="true"]').boundingBox();
  assert.ok(plotBox);
  assert.ok(trackBox);
  assert.ok(Math.abs(trackBox.y - plotBox.y) < 1.5, "The phase-flow strip must reach the top edge.");
  assert.ok(
    Math.abs(trackBox.y + trackBox.height - (plotBox.y + plotBox.height)) < 1.5,
    "The phase-flow strip must reach the bottom edge."
  );
  assert.equal(await page.locator('[data-phase-flow-track="true"]').getAttribute("rx"), "0");

  const markerBoxes = await page.locator("[data-phase-marker]").evaluateAll((markers) =>
    markers.map((marker) => marker.getBoundingClientRect().toJSON())
  );
  assert.ok(markerBoxes.length > 0);
  assert.ok(
    markerBoxes.every((box) => Math.abs(box.width - box.height) < 0.75),
    "Phase-flow stationary markers must remain circular on screen."
  );
  assert.ok((await page.locator("[data-phase-arrow-head]").count()) > 0);
  assert.ok(
    (await page.locator("[data-phase-arrow]").count()) >= 10,
    "Phase flow should use enough arrows to make direction immediately visible."
  );
  assert.ok(
    (await page.locator("[data-phase-arrow-head]").first().getAttribute("fill")) !== "none",
    "Phase-flow arrows must use filled heads."
  );
}

async function assertContextMenuCurveRemoval(page) {
  await page.locator("#clear-curves-button").click();
  await expectCurveCount(page, 0);

  const plotBox = await page.locator("#ode-plot").boundingBox();
  assert.ok(plotBox, "The full-page plot must have a browser bounding box.");

  await page.mouse.click(plotBox.x + plotBox.width * 0.28, plotBox.y + plotBox.height * 0.3);
  await expectCurveCount(page, 1);
  await page.mouse.click(plotBox.x + plotBox.width * 0.72, plotBox.y + plotBox.height * 0.7);
  await expectCurveCount(page, 2);

  const curveGroups = page.locator('[data-layer="curves"] > [data-curve-id]');
  const curveIds = await curveGroups.evaluateAll((groups) =>
    groups.map((group) => group.getAttribute("data-curve-id"))
  );
  assert.equal(curveIds.length, 2);
  assert.ok(curveIds.every((curveId) => curveId !== null));
  const [targetId, retainedId] = curveIds;
  assert.ok(targetId);
  assert.ok(retainedId);

  const retainedCurve = page.locator(`[data-curve-id="${retainedId}"]`);
  await retainedCurve.evaluate((node) => node.setAttribute("data-context-retained", "yes"));
  const targetSeed = await page
    .locator(`[data-curve-id="${targetId}"] circle:last-child`)
    .boundingBox();
  assert.ok(targetSeed, "The target trajectory seed must have a browser bounding box.");

  await page.mouse.click(
    targetSeed.x + targetSeed.width / 2,
    targetSeed.y + targetSeed.height / 2,
    { button: "right" }
  );
  await expectCurveCount(page, 1);
  assert.equal(await page.locator(`[data-curve-id="${targetId}"]`).count(), 0);
  assert.equal(
    await retainedCurve.getAttribute("data-context-retained"),
    "yes",
    "Right-clicking a trajectory must remove only the nearest curve and retain the others."
  );

  await page.mouse.click(plotBox.x + plotBox.width * 0.42, plotBox.y + plotBox.height * 0.62);
  await expectCurveCount(page, 2);

  await page.keyboard.down("Shift");
  try {
    await page.mouse.click(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2, {
      button: "right"
    });
  } finally {
    await page.keyboard.up("Shift");
  }
  await expectCurveCount(page, 0);
  assert.equal(
    await curveGroups.count(),
    0,
    "Shift+right-click inside the plot must clear every trajectory."
  );
}

async function assertAnnotationOnlyResize(page) {
  await page.evaluate(() => {
    document.querySelector('[data-layer="slopes"] path')?.setAttribute("data-resize-retained", "yes");
    document.querySelector(".plot-latex-label")?.setAttribute("data-resize-retained", "yes");
  });

  const viewportSizes = [
    { width: 2560, height: 1284 },
    { width: 2304, height: 1284 },
    { width: 760, height: 700 },
    { width: 960, height: 720 },
    { width: 1180, height: 780 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1536, height: 730 },
    { width: 1280, height: 650 }
  ];

  for (const viewport of viewportSizes) {
    await page.setViewportSize(viewport);
    await waitForResizeRender(page);

    assert.equal(
      await page.locator('[data-layer="slopes"] path').getAttribute("data-resize-retained"),
      "yes",
      "Resize must not rebuild SVG geometry."
    );
    assert.equal(
      await page.locator(".plot-latex-label").first().getAttribute("data-resize-retained"),
      "yes",
      "Resize must reposition rather than rebuild annotations."
    );

    const stage = await page.locator(".plot-stage").boundingBox();
    const labels = await page.locator(".plot-latex-label .katex").all();
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(stage);
    assert.ok(
      stage.y + stage.height <= viewport.height + 1,
      `The plot stage must fit inside the ${viewport.width}x${viewport.height} viewport.`
    );
    assert.ok(
      documentHeight <= viewport.height + 1,
      `Desktop layout must not push plot annotations below the ${viewport.width}x${viewport.height} viewport.`
    );

    const equationPanel = await page.locator(".equation-panel").boundingBox();
    const equationBanner = await page.locator(".plot-equation-banner").boundingBox();
    assert.ok(equationPanel);
    assert.ok(equationBanner);
    assert.ok(
      !boxesOverlap(equationPanel, equationBanner),
      `The equation editor and rendered equation must not overlap at ${viewport.width}x${viewport.height}.`
    );

    const expectedControlScale =
      viewport.width <= 760
        ? 1
        : Math.min(1, Math.max(0.8, Math.min(viewport.width / 2560, viewport.height / 1284)));
    const controlScaleState = await page.evaluate(() => ({
      customProperty: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--corner-control-scale")
      ),
      controls: Array.from(
        document.querySelectorAll(".equation-panel, .left-control-stack, .equilibria-panel")
      ).map((element) => Number.parseFloat(getComputedStyle(element).scale))
    }));
    assert.ok(
      Math.abs(controlScaleState.customProperty - expectedControlScale) < 1e-6,
      `The corner-control scale variable must track the viewport at ${viewport.width}x${viewport.height}.`
    );
    controlScaleState.controls.forEach((scale) => {
      assert.ok(
        Math.abs(scale - expectedControlScale) < 1e-6,
        `Corner controls must use the expected fluid scale at ${viewport.width}x${viewport.height}.`
      );
    });
    assert.equal(
      await page.locator(".plot-ode-preview").evaluate((element) => getComputedStyle(element).scale),
      "none",
      `The centered equation must remain full-size at ${viewport.width}x${viewport.height}.`
    );

    for (const label of labels) {
      const box = await label.boundingBox();
      assert.ok(box, "Every plot annotation should remain visible after resize.");
      assert.ok(
        box.x >= stage.x - 4 && box.x + box.width <= stage.x + stage.width + 4,
        `Plot annotation must remain horizontally inside the stage at ${viewport.width}x${viewport.height}.`
      );
      assert.ok(
        box.y >= stage.y - 4 && box.y + box.height <= stage.y + stage.height + 4,
        `Plot annotation must remain vertically inside the stage at ${viewport.width}x${viewport.height}.`
      );
      assert.ok(
        box.y >= -1 && box.y + box.height <= viewport.height + 1,
        `Plot annotation must remain inside the visible viewport at ${viewport.width}x${viewport.height}.`
      );
    }
  }
}

async function assertEdgeClampedAxisAnnotations(page) {
  await page.locator("#y-min-input").fill("1");
  await page.locator("#y-max-input").fill("3");
  await waitForResizeRender(page);

  const geometry = await page.evaluate(() => {
    const stage = document.querySelector(".plot-stage");
    const title = document.querySelector(".plot-latex-label.axis-label:not(.vertical)");
    const xTicks = Array.from(
      document.querySelectorAll(".plot-latex-label.tick-label.is-x")
    );
    if (!(stage instanceof HTMLElement) || !(title instanceof HTMLElement) || xTicks.length === 0) {
      throw new Error("The edge-clamped axis annotations must be rendered.");
    }

    const stageBox = stage.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    const rightmostTickBox = xTicks
      .map((tick) => tick.getBoundingClientRect())
      .sort((left, right) => right.right - left.right)[0];

    return {
      stage: stageBox.toJSON(),
      title: titleBox.toJSON(),
      rightmostTick: rightmostTickBox.toJSON()
    };
  });

  assert.ok(
    geometry.title.bottom <= geometry.rightmostTick.top - 4,
    "A bottom-clamped t-axis title must occupy a separate interior row from the rightmost tick."
  );
  for (const box of [geometry.title, geometry.rightmostTick]) {
    assert.ok(
      box.left >= geometry.stage.left - 1 && box.right <= geometry.stage.right + 1,
      "Edge-clamped x-axis annotations must remain horizontally inside the plot."
    );
    assert.ok(
      box.top >= geometry.stage.top - 1 && box.bottom <= geometry.stage.bottom + 1,
      "Edge-clamped x-axis annotations must remain vertically inside the plot."
    );
  }

  await page.locator("#y-min-input").fill("-3");
  await waitForResizeRender(page);
}

function boxesOverlap(left, right) {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

async function waitForResizeRender(page) {
  // ResizeObserver schedules annotation positioning in an animation frame.
  // Cross one additional frame before reading geometry so CI cannot sample stale coordinates.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );
}

async function assertEquilibriumIntervalRendering(page) {
  const input = page.getByLabel("ODE right-hand side");
  await input.fill("floor(y)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await page.locator('[data-equilibrium-interval="true"]').count(), 1);
  assert.equal(
    await page.locator(".equilibrium-interval-chip").getAttribute("data-equilibrium-latex"),
    "y(t) \\equiv c,\\quad c \\in [0,1)"
  );

  await input.fill("y * (2 - y)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await page.locator('[data-equilibrium-interval="true"]').count(), 0);
}

async function assertCanceledDomainDependency(page) {
  const input = page.getByLabel("ODE right-hand side");
  const clearCurvesButton = page.locator("#clear-curves-button");
  if (await clearCurvesButton.isEnabled()) {
    await clearCurvesButton.click();
  }
  await expectCurveCount(page, 0);
  await input.fill("1 / (1e12*y - 1e12*y + 1)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);

  const plotBox = await page.locator("#ode-plot").boundingBox();
  assert.ok(plotBox, "The full-page plot must have a browser bounding box.");
  await page.mouse.click(plotBox.x + plotBox.width / 2, plotBox.y + plotBox.height / 2);
  await expectCurveCount(page, 1);

  await page.locator("#reset-button").click();
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  await expectCurveCount(page, 0);
}

async function assertUiVisibilityAndHelp(page) {
  const overlays = page.locator("[data-ui-overlay]");
  const equationBanner = page.locator(".plot-equation-banner");
  const renderedEquation = page.locator("#plot-ode-preview .katex");
  const toggle = page.locator("#toggle-ui-button");
  const help = page.locator("#help-button");
  assert.equal(await overlays.count(), 3);
  assert.ok(await equationBanner.isVisible());
  assert.ok(await renderedEquation.isVisible());

  await toggle.click();
  assert.equal(await toggle.textContent(), "Show UI");
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.ok(await help.isVisible());
  assert.ok(await overlays.evaluateAll((nodes) => nodes.every((node) => node.hidden)));
  assert.ok(
    (await equationBanner.isVisible()) && (await renderedEquation.isVisible()),
    "The rendered equation must remain visible when the rest of the UI is hidden."
  );

  await help.click();
  const popover = page.locator("#help-popover");
  await popover.waitFor({ state: "visible" });
  assert.equal(await help.getAttribute("aria-expanded"), "true");
  assert.ok((await popover.textContent()).includes("Shift + Right-click"));
  const popoverBox = await popover.boundingBox();
  const helpBox = await help.boundingBox();
  assert.ok(popoverBox);
  assert.ok(helpBox);
  assert.ok(popoverBox.x < 24, "Help should stay close to the lower-left corner.");
  assert.ok(
    popoverBox.y + popoverBox.height <= helpBox.y - 2,
    "Help should open immediately above the corner controls."
  );
  await page.keyboard.press("Escape");
  await popover.waitFor({ state: "hidden" });
  assert.equal(await help.getAttribute("aria-expanded"), "false");

  await toggle.click();
  assert.equal(await toggle.textContent(), "Hide UI");
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.ok(await overlays.evaluateAll((nodes) => nodes.every((node) => !node.hidden)));
  assert.ok(await equationBanner.isVisible());
  assert.ok(await renderedEquation.isVisible());
}

async function expectCurveCount(page, expected, timeout = 1500) {
  const curves = page.locator('[data-layer="curves"] > [data-curve-id]');
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await curves.count()) === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(await curves.count(), expected);
}

async function expectText(locator, expected, timeout = 1000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ((await locator.textContent()) === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(await locator.textContent(), expected);
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${child.exitCode}.`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

async function waitForExit(child) {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(forceKillTimer);
      resolve();
    });
  });
}
