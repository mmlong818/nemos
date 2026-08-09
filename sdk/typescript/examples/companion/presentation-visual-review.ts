import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createCanvas, loadImage } from "@napi-rs/canvas";

export interface PresentationVisualReviewPage {
  slide: number;
  screenshot: string;
  byteLength: number;
  nonUniformRatio: number;
  tonalRange: number;
  passed: boolean;
  detail: string;
}

export interface PresentationVisualReview {
  engine: "chromium-headless";
  checkedAt: string;
  viewport: { width: number; height: number };
  pages: PresentationVisualReviewPage[];
  passed: boolean;
  unavailableReason?: string;
}

const VIEWPORT = { width: 1440, height: 900 };

export async function reviewPresentationPreview(previewFile: string, slideCount: number): Promise<PresentationVisualReview> {
  const browser = findChromiumExecutable();
  const checkedAt = new Date().toISOString();
  if (!browser) {
    return { engine: "chromium-headless", checkedAt, viewport: VIEWPORT, pages: [], passed: false, unavailableReason: "未找到 Chromium 浏览器，无法执行真实关键页渲染" };
  }
  const outputDir = previewFile.replace(/-preview\.html$/i, "-visual-review");
  mkdirSync(outputDir, { recursive: true });
  const pages: PresentationVisualReviewPage[] = [];
  for (const slide of keySlides(slideCount)) {
    const screenshot = join(outputDir, `slide-${slide + 1}.png`);
    const url = pathToFileURL(previewFile);
    url.searchParams.set("slide", String(slide));
    const result = spawnSync(browser, [
      "--headless=new",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--hide-scrollbars",
      "--no-first-run",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=1000",
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      `--screenshot=${screenshot}`,
      url.href,
    ], { encoding: "utf8", timeout: 15_000, windowsHide: true });
    if (result.status !== 0 || !existsSync(screenshot) || statSync(screenshot).size < 1_000) {
      pages.push({ slide, screenshot, byteLength: 0, nonUniformRatio: 0, tonalRange: 0, passed: false, detail: "关键页未能渲染为有效截图" });
      continue;
    }
    pages.push(await inspectScreenshot(slide, screenshot));
  }
  if (pages.length > 0 && pages.every((page) => page.byteLength === 0)) {
    return {
      engine: "chromium-headless",
      checkedAt,
      viewport: VIEWPORT,
      pages,
      passed: false,
      unavailableReason: "浏览器未能完成关键页截图，真实渲染复核未执行",
    };
  }
  return { engine: "chromium-headless", checkedAt, viewport: VIEWPORT, pages, passed: pages.length > 0 && pages.every((page) => page.passed) };
}

export function findChromiumExecutable(): string | null {
  const candidates = [
    process.env.NEMOS_BROWSER_PATH,
    process.env.NEMOS_EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/microsoft-edge",
    "/usr/bin/microsoft-edge-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate))) ?? null;
}

function keySlides(slideCount: number): number[] {
  const last = Math.max(0, slideCount - 1);
  return [...new Set([0, Math.floor(last / 2), last])];
}

async function inspectScreenshot(slide: number, screenshot: string): Promise<PresentationVisualReviewPage> {
  const image = await loadImage(screenshot);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const sample = context.getImageData(0, 0, image.width, image.height).data;
  const stride = Math.max(1, Math.floor(Math.sqrt((image.width * image.height) / 20_000)));
  const tones = new Set<number>();
  const luminances: number[] = [];
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const offset = (y * image.width + x) * 4;
      const red = sample[offset] ?? 0;
      const green = sample[offset + 1] ?? 0;
      const blue = sample[offset + 2] ?? 0;
      const luminance = Math.round(red * .2126 + green * .7152 + blue * .0722);
      luminances.push(luminance);
      tones.add((red >> 5) * 64 + (green >> 5) * 8 + (blue >> 5));
    }
  }
  const ordered = luminances.sort((a, b) => a - b);
  const low = ordered[Math.floor(ordered.length * .05)] ?? 0;
  const high = ordered[Math.floor(ordered.length * .95)] ?? 0;
  const nonUniformRatio = 1 - dominantToneRatio(luminances);
  const tonalRange = high - low;
  const passed = tones.size >= 6 && nonUniformRatio >= .015 && tonalRange >= 12;
  return {
    slide,
    screenshot,
    byteLength: statSync(screenshot).size,
    nonUniformRatio: Number(nonUniformRatio.toFixed(4)),
    tonalRange,
    passed,
    detail: passed
      ? `真实渲染正常，色调范围 ${tonalRange}，非单一画面占比 ${(nonUniformRatio * 100).toFixed(1)}%`
      : `画面可能空白或缺少层次，色调范围 ${tonalRange}，非单一画面占比 ${(nonUniformRatio * 100).toFixed(1)}%`,
  };
}

function dominantToneRatio(values: number[]): number {
  const counts = new Map<number, number>();
  let maximum = 0;
  for (const value of values) {
    const bucket = Math.round(value / 8);
    const count = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, count);
    maximum = Math.max(maximum, count);
  }
  return values.length ? maximum / values.length : 1;
}
