#!/usr/bin/env node
// pdf-generator.mjs — Generates PDFs from HTML using Playwright headless Chromium
// Usage:
//   node pdf-generator.mjs --html "<h1>Hello</h1>"
//   node pdf-generator.mjs --file input.html
//   node pdf-generator.mjs --url "http://localhost:3000/report"
//   node pdf-generator.mjs --file input.html --output report.pdf --format Letter --landscape

import { chromium } from "playwright-core";
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";

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

function usage() {
  console.error(`
pdf-generator — Generate PDFs from HTML content

Usage:
  node pdf-generator.mjs --html "<h1>Hello</h1>"         Generate from inline HTML
  node pdf-generator.mjs --file page.html                 Generate from HTML file
  node pdf-generator.mjs --url http://localhost/report     Generate from URL

Options:
  --html <string>       Inline HTML content
  --file <path>         Path to an HTML file
  --url <url>           URL to render
  --output <path>       Output PDF file path (default: output.pdf)
  --format <size>       Page format: Letter, A4, Legal, Tabloid (default: Letter)
  --landscape           Landscape orientation (default: portrait)
  --margin <px>         Page margin in CSS units (default: "0.5in")
  --header <html>       Header HTML template
  --footer <html>       Footer HTML template
  --wait <ms>           Wait time after load before PDF (default: 1000)
  --scale <number>      Scale factor 0.1..2 (default: 1)
`);
  process.exit(1);
}

async function generatePdf(options) {
  const {
    html,
    file,
    url,
    output = "output.pdf",
    format = "Letter",
    landscape = false,
    margin = "0.5in",
    headerTemplate,
    footerTemplate,
    wait = 1000,
    scale = 1,
    screenshot: takeScreenshot,
    canvasDir,
  } = options;

  if (!html && !file && !url) {
    throw new Error("Must specify --html, --file, or --url");
  }

  const outputPath = resolve(output);
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    if (url) {
      await page.goto(url, { waitUntil: "networkidle" });
    } else {
      let content = html;
      if (file) {
        const filePath = resolve(file);
        if (!existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        content = readFileSync(filePath, "utf-8");
      }
      await page.setContent(content, { waitUntil: "networkidle" });
    }

    // Extra wait for fonts/images to load
    if (wait > 0) {
      await page.waitForTimeout(Number(wait));
    }

    const pdfOptions = {
      path: outputPath,
      format,
      landscape: landscape === true || landscape === "true",
      printBackground: true,
      scale: Number(scale),
      margin: {
        top: margin,
        right: margin,
        bottom: margin,
        left: margin,
      },
    };

    if (headerTemplate) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = headerTemplate;
    }
    if (footerTemplate) {
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.footerTemplate = footerTemplate;
    }

    await page.pdf(pdfOptions);

    const result = {
      success: true,
      path: outputPath,
      format,
      landscape: pdfOptions.landscape,
    };

    // Capture screenshot of the first page if requested
    if (takeScreenshot === "true" || takeScreenshot === true) {
      // Set viewport to Letter dimensions at 96dpi (8.5x11in)
      await page.setViewportSize({ width: 816, height: 1056 });
      // Small wait for re-render at new size
      await page.waitForTimeout(500);

      const pdfName = basename(outputPath, ".pdf");
      const screenshotName = `${pdfName}.preview.png`;
      const screenshotPath = resolve(dirname(outputPath), screenshotName);

      await page.screenshot({ path: screenshotPath, fullPage: false });
      result.screenshotPath = screenshotPath;

      // Copy to canvas dir if provided
      if (canvasDir) {
        const canvasDirResolved = resolve(canvasDir);
        if (!existsSync(canvasDirResolved)) {
          mkdirSync(canvasDirResolved, { recursive: true });
        }
        const canvasScreenshotPath = join(canvasDirResolved, screenshotName);
        copyFileSync(screenshotPath, canvasScreenshotPath);
        result.canvasScreenshotPath = canvasScreenshotPath;
        result.previewUrl = `/__openclaw__/canvas/${screenshotName}`;
      }
    }

    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}

// Main
const args = parseArgs(process.argv);
if (Object.keys(args).length === 0) {
  usage();
}

generatePdf(args).catch((err) => {
  console.error(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
