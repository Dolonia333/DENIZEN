#!/usr/bin/env node
// canvas-render.mjs — Render canvas HTML to screenshot without needing a physical device
// Follows the same pattern as pdf-generator.mjs but focused on screenshots + JS eval.

import { chromium } from "playwright-core";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { homedir } from "node:os";

const CANVAS_DIR = join(homedir(), ".openclaw", "canvas");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--") && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const { url, file, output, eval: evalJs, width, height, wait, fullpage } = args;

  if (!url && !file) {
    console.log(JSON.stringify({
      success: false,
      error: "Usage: node canvas-render.mjs --url <url> | --file <html_path> [--output <png_path>] [--eval <js>] [--width <px>] [--height <px>] [--wait <ms>]",
    }));
    process.exit(1);
  }

  const viewportWidth = parseInt(width || "1366", 10);
  const viewportHeight = parseInt(height || "768", 10);
  const waitMs = parseInt(wait || "2000", 10);

  // Determine output path
  let outputPath;
  if (output) {
    outputPath = resolve(output);
  } else {
    if (!existsSync(CANVAS_DIR)) mkdirSync(CANVAS_DIR, { recursive: true });
    let name;
    if (url && url.startsWith("data:")) {
      name = "canvas";
    } else if (url) {
      name = new URL(url).pathname.split("/").pop() || "canvas";
    } else {
      name = basename(file, ".html");
    }
    outputPath = join(CANVAS_DIR, `${name}-render.png`);
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight } });

  try {
    if (url) {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    } else {
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        console.log(JSON.stringify({ success: false, error: `File not found: ${filePath}` }));
        process.exit(1);
      }
      const content = readFileSync(filePath, "utf-8");
      await page.setContent(content, { waitUntil: "networkidle" });
    }

    // Wait for rendering
    if (waitMs > 0) {
      await page.waitForTimeout(waitMs);
    }

    // Take screenshot
    const fullPage = fullpage === "true";
    await page.screenshot({ path: outputPath, fullPage });

    const result = {
      success: true,
      screenshot_path: outputPath,
    };

    // Read file for base64 preview
    try {
      const pngBytes = readFileSync(outputPath);
      const base64 = pngBytes.toString("base64");
      result.previewUrl = `data:image/png;base64,${base64}`;
    } catch {
      // Preview generation failed
    }

    // Optional JS evaluation
    if (evalJs) {
      try {
        const evalResult = await page.evaluate(evalJs);
        result.eval_result = evalResult;
      } catch (err) {
        result.eval_error = err.message;
      }
    }

    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
