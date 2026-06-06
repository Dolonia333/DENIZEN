#!/usr/bin/env node
// screen-capture.mjs — OS-level screenshot capture using ffmpeg gdigrab
// Returns PNG with base64 previewUrl for inline chat display.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";

const CANVAS_DIR = join(homedir(), ".openclaw", "canvas");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key.slice(2)] = next;
        i++;
      } else {
        args[key.slice(2)] = "true";
      }
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const title = args.title;
  const region = args.region;
  const customOutput = args.output ? resolve(args.output) : null;

  // Determine output path
  const timestamp = Date.now();
  let outputPath;
  if (customOutput) {
    outputPath = customOutput;
  } else {
    if (!existsSync(CANVAS_DIR)) mkdirSync(CANVAS_DIR, { recursive: true });
    outputPath = join(CANVAS_DIR, `screenshot-${timestamp}.png`);
  }

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Build ffmpeg command
  const ffmpegArgs = ["-f", "gdigrab"];

  if (region) {
    // Region format: "x,y,width,height"
    const parts = region.split(",").map((s) => s.trim());
    if (parts.length !== 4) {
      console.log(JSON.stringify({
        success: false,
        error: 'Invalid --region format. Use "x,y,width,height" (e.g., "100,100,800,600")',
      }));
      process.exit(1);
    }
    const [x, y, w, h] = parts;
    ffmpegArgs.push("-offset_x", x, "-offset_y", y, "-video_size", `${w}x${h}`);
    ffmpegArgs.push("-i", "desktop");
  } else if (title) {
    ffmpegArgs.push("-i", `title=${title}`);
  } else {
    ffmpegArgs.push("-i", "desktop");
  }

  ffmpegArgs.push("-frames:v", "1", "-y", outputPath);

  try {
    execFileSync("ffmpeg", ffmpegArgs, {
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message;
    // ffmpeg writes info to stderr even on success; check if file was created
    if (!existsSync(outputPath)) {
      console.log(JSON.stringify({
        success: false,
        error: `Screenshot capture failed: ${stderr.slice(0, 500)}`,
      }));
      process.exit(1);
    }
  }

  if (!existsSync(outputPath)) {
    console.log(JSON.stringify({ success: false, error: "Screenshot file was not created" }));
    process.exit(1);
  }

  // Build result with base64 preview
  const filename = outputPath.split(/[/\\]/).pop();
  const canvasUrl = `/__openclaw__/canvas/${filename}`;
  let previewUrl = canvasUrl;
  try {
    const pngBytes = readFileSync(outputPath);
    previewUrl = `data:image/png;base64,${pngBytes.toString("base64")}`;
  } catch {
    // Fallback to canvas URL
  }

  console.log(JSON.stringify({
    success: true,
    filePath: outputPath,
    canvasUrl,
    previewUrl,
    capture: title ? `window: ${title}` : region ? `region: ${region}` : "full desktop",
  }));
}

main().catch((err) => {
  console.log(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
