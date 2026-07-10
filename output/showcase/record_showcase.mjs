import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const rawTarget = path.join(outputDir, "ode_showcase_cursor.webm");
const finalTarget = path.join(outputDir, "ode_showcase_cursor.mp4");
const systemChromePath = "/usr/bin/google-chrome";
const chromePath =
  process.env.CHROME_PATH ?? (existsSync(systemChromePath) ? systemChromePath : undefined);
const url = process.env.SHOWCASE_URL ?? "http://127.0.0.1:4173/";
const videoSize = { width: 1920, height: 1080 };
const trimStartSeconds = "0.9";

await fs.mkdir(outputDir, { recursive: true });
await removeIfExists(rawTarget);
await removeIfExists(finalTarget);

const browser = await chromium.launch({
  ...(chromePath ? { executablePath: chromePath } : {}),
  headless: true,
  args: ["--mute-audio"]
});

const context = await browser.newContext({
  viewport: videoSize,
  recordVideo: {
    dir: outputDir,
    size: videoSize
  }
});

const page = await context.newPage();
const video = page.video();

await page.goto(url, { waitUntil: "domcontentloaded" });

await page.evaluate(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const existing = document.getElementById("showcase-cursor");
  if (existing) {
    existing.remove();
  }

  const cursor = document.createElement("div");
  cursor.id = "showcase-cursor";
  cursor.style.position = "fixed";
  cursor.style.left = "120px";
  cursor.style.top = "120px";
  cursor.style.width = "20px";
  cursor.style.height = "20px";
  cursor.style.borderRadius = "50%";
  cursor.style.background = "rgba(18, 44, 72, 0.92)";
  cursor.style.border = "2px solid rgba(255,255,255,0.96)";
  cursor.style.boxShadow = "0 7px 20px rgba(0,0,0,0.22)";
  cursor.style.transform = "translate(-50%, -50%) scale(1)";
  cursor.style.zIndex = "999999";
  cursor.style.pointerEvents = "none";
  document.body.append(cursor);

  let cursorX = 120;
  let cursorY = 120;

  const pulse = () => {
    const ring = document.createElement("div");
    ring.style.position = "fixed";
    ring.style.left = `${cursorX}px`;
    ring.style.top = `${cursorY}px`;
    ring.style.width = "20px";
    ring.style.height = "20px";
    ring.style.borderRadius = "50%";
    ring.style.border = "2px solid rgba(18, 44, 72, 0.55)";
    ring.style.transform = "translate(-50%, -50%) scale(0.9)";
    ring.style.transformOrigin = "center";
    ring.style.opacity = "0.86";
    ring.style.zIndex = "999998";
    ring.style.pointerEvents = "none";
    ring.style.transition = "transform 420ms ease, opacity 420ms ease";
    document.body.append(ring);
    requestAnimationFrame(() => {
      ring.style.transform = "translate(-50%, -50%) scale(2.2)";
      ring.style.opacity = "0";
    });
    setTimeout(() => ring.remove(), 460);
  };

  const moveCursorTo = async (x, y, duration = 600) => {
    const startX = cursorX;
    const startY = cursorY;
    const start = performance.now();

    await new Promise((resolve) => {
      const tick = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        cursorX = startX + (x - startX) * eased;
        cursorY = startY + (y - startY) * eased;
        cursor.style.left = `${cursorX}px`;
        cursor.style.top = `${cursorY}px`;

        if (progress < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  };

  const clickAt = async (x, y, target) => {
    await moveCursorTo(x, y, 560);
    cursor.style.transform = "translate(-50%, -50%) scale(0.88)";
    pulse();
    target.dispatchEvent(
      new MouseEvent("click", {
        clientX: x,
        clientY: y,
        bubbles: true
      })
    );
    await sleep(100);
    cursor.style.transform = "translate(-50%, -50%) scale(1)";
    await sleep(220);
  };

  const centerOf = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  };

  const typeInto = async (input, text, delay = 95) => {
    const point = {
      x: input.getBoundingClientRect().left + 56,
      y: input.getBoundingClientRect().top + 30
    };
    await clickAt(point.x, point.y, input);
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(150);
    await moveCursorTo(
      input.getBoundingClientRect().right + 32,
      input.getBoundingClientRect().top + 16,
      260
    );

    for (const character of text) {
      input.value += character;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(delay);
    }
  };

  const clickModelPoint = async (t, y, waitAfter = 720) => {
    const svg = document.getElementById("ode-plot");
    const frame = svg.querySelector('[data-layer="grid"] rect');
    const tMin = Number(document.getElementById("t-min-input").value);
    const tMax = Number(document.getElementById("t-max-input").value);
    const yMin = Number(document.getElementById("y-min-input").value);
    const yMax = Number(document.getElementById("y-max-input").value);
    const innerLeft = Number(frame.getAttribute("x"));
    const innerTop = Number(frame.getAttribute("y"));
    const innerWidth = Number(frame.getAttribute("width"));
    const innerHeight = Number(frame.getAttribute("height"));

    const x = innerLeft + ((t - tMin) / (tMax - tMin)) * innerWidth;
    const yScreen = innerTop + ((yMax - y) / (yMax - yMin)) * innerHeight;
    const point = svg.createSVGPoint();
    point.x = x;
    point.y = yScreen;
    const mapped = point.matrixTransform(svg.getScreenCTM());

    await clickAt(mapped.x, mapped.y, svg);
    await sleep(waitAfter);
  };

  await sleep(650);

  const equationInput = document.getElementById("equation-input");
  await typeInto(equationInput, "y * (1-y^2)", 88);
  await sleep(550);

  await clickModelPoint(-2.7, 1.2, 700);
  await clickModelPoint(-2.35, 0.45, 700);
  await clickModelPoint(-2.15, -0.55, 700);
  await clickModelPoint(-1.95, 1, 700);
  await clickModelPoint(-1.75, 0, 700);
  await clickModelPoint(-1.95, -1, 720);

  const phaseFlowToggle = document.getElementById("phase-flow-toggle");
  const togglePoint = centerOf(phaseFlowToggle.nextElementSibling);
  await clickAt(togglePoint.x, togglePoint.y, phaseFlowToggle);
  phaseFlowToggle.checked = true;
  phaseFlowToggle.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(900);

  const tMaxInput = document.getElementById("t-max-input");
  await clickAt(...Object.values(centerOf(tMaxInput)), tMaxInput);
  tMaxInput.value = "6";
  tMaxInput.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(150);

  const applyButton = document.getElementById("apply-bounds-button");
  const applyPoint = centerOf(applyButton);
  await clickAt(applyPoint.x, applyPoint.y, applyButton);
  await sleep(950);

  await clickModelPoint(1.4, 0.82, 800);
  await clickModelPoint(2.0, -0.72, 900);

  await sleep(700);
  cursor.remove();
});

await context.close();
await browser.close();

const rawPath = await video.path();
if (rawPath !== rawTarget) {
  await removeIfExists(rawTarget);
  await fs.rename(rawPath, rawTarget);
}

await execFileAsync("ffmpeg", [
  "-y",
  "-ss",
  trimStartSeconds,
  "-i",
  rawTarget,
  "-an",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  finalTarget
]);

console.log(`Saved ${rawTarget}`);
console.log(`Saved ${finalTarget}`);

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
