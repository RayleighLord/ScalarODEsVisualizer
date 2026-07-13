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
  await assertDebouncedEquationEditing(page);
  await assertEquilibriumIntervalRendering(page);
  await assertCanceledDomainDependency(page);
  await assertAnnotationOnlyResize(page);

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
  assert.equal(await page.title(), "Integral Curve Explorer");
  assert.equal(await page.locator("#equation-status").textContent(), "Ready");
  assert.equal(await page.locator('[data-layer="slopes"] path').count(), 1);
  assert.equal(await page.locator('[data-layer="grid"]').locator(":scope > *").count(), 2);
  assert.ok((await page.locator(".plot-latex-label").count()) >= 10);
}

async function assertIncrementalCurveAndOverlayRendering(page) {
  await page.evaluate(() => {
    document.querySelector('[data-layer="slopes"] path')?.setAttribute("data-retained", "slope");
    document.querySelector('[data-layer="grid"] path')?.setAttribute("data-retained", "grid");
    document.querySelector(".plot-latex-label")?.setAttribute("data-retained", "annotation");
    document.querySelector("#plot-ode-preview .katex")?.setAttribute("data-retained", "preview");
    document.querySelector("#equilibrium-solutions > *")?.setAttribute("data-retained", "status");
  });

  const frame = await page.locator('[data-layer="grid"] rect').boundingBox();
  assert.ok(frame, "The plot frame must have a browser bounding box.");
  await page.mouse.click(frame.x + frame.width * 0.64, frame.y + frame.height * 0.42);
  await expectText(page.locator("#curve-count"), "1");

  assert.equal(
    await page.locator('[data-layer="slopes"] path').getAttribute("data-retained"),
    "slope",
    "Adding a curve must retain the direction-field node."
  );
  assert.equal(
    await page.locator('[data-layer="grid"] path').getAttribute("data-retained"),
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

async function assertDebouncedEquationEditing(page) {
  const input = page.getByLabel("ODE right-hand side");
  await input.fill(await input.inputValue());
  assert.equal(await page.locator("#equation-status").textContent(), "Updating…");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await page.locator("#plot-ode-preview").getAttribute("aria-busy"), null);

  await input.fill(await input.inputValue());
  await page.locator("#apply-bounds-button").click();
  assert.equal(await page.locator("#equation-status").textContent(), "Ready");
  assert.equal(await page.locator("#plot-ode-preview").getAttribute("aria-busy"), null);

  await input.fill("sin(y) + 0.1 * t");
  assert.equal(await page.locator("#equation-status").textContent(), "Updating…");
  await page.locator("#t-max-input").fill("6");
  // Let the expression-only debounce commit first. It must not overwrite the
  // user's unsubmitted bound edit while rendering the new direction field.
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#t-max-input").inputValue(), "6");
  await page.locator("#apply-bounds-button").click();
  await expectText(page.locator("#equation-type"), "Non-autonomous", 1500);
  assert.equal(await page.locator("#t-max-input").inputValue(), "6");
  assert.equal(await page.locator("#equation-status").textContent(), "Ready");
  assert.equal(await page.locator("#plot-ode-preview").getAttribute("aria-busy"), null);
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

  await input.fill("y * (1 - y)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
}

async function assertAnnotationOnlyResize(page) {
  await page.evaluate(() => {
    document.querySelector('[data-layer="slopes"] path')?.setAttribute("data-resize-retained", "yes");
    document.querySelector(".plot-latex-label")?.setAttribute("data-resize-retained", "yes");
  });

  const viewportSizes = [
    { width: 1180, height: 780 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 1536, height: 730 },
    { width: 1280, height: 650 }
  ];

  for (const viewport of viewportSizes) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);

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

async function assertEquilibriumIntervalRendering(page) {
  const input = page.getByLabel("ODE right-hand side");
  await input.fill("floor(y)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await page.locator('[data-equilibrium-interval="true"]').count(), 1);
  assert.equal(
    await page.locator(".equilibrium-interval-chip").textContent(),
    "0 ≤ y < 1"
  );

  await input.fill("y * (1 - y)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  assert.equal(await page.locator('[data-equilibrium-interval="true"]').count(), 0);
}

async function assertCanceledDomainDependency(page) {
  const input = page.getByLabel("ODE right-hand side");
  await page.locator("#clear-curves-button").click();
  await expectText(page.locator("#curve-count"), "0", 1500);
  await input.fill("1 / (1e12*y - 1e12*y + 1)");
  await expectText(page.locator("#equation-status"), "Ready", 1500);

  const frame = await page.locator('[data-layer="grid"] rect').boundingBox();
  assert.ok(frame, "The plot frame must have a browser bounding box.");
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await expectText(page.locator("#curve-count"), "1", 1500);

  await page.locator("#reset-button").click();
  await expectText(page.locator("#equation-status"), "Ready", 1500);
  await expectText(page.locator("#curve-count"), "0", 1500);
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
