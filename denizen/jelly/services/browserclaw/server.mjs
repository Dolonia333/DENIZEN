#!/usr/bin/env node

/**
 * BrowserClaw Server
 *
 * HTTP API server that wraps Stagehand for browser automation.
 * Controls your real local Chrome with natural-language tasks.
 *
 * Usage:
 *   node server.mjs
 *   BROWSERCLAW_PORT=18792 node server.mjs
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserAgent } from "./lib/browser-agent.mjs";

// --- Load .env file if present ---
try {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envFile = readFileSync(resolve(__dirname, ".env"), "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch {
  // No .env file — that's fine
}

// --- Configuration ---

const PORT = parseInt(process.env.BROWSERCLAW_PORT || "18792", 10);

// --- State ---

const agent = new BrowserAgent();
let totalTasks = 0;

// --- Helpers ---

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// --- HTTP Server ---

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- GET routes ---

  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, { ok: true, service: "browserclaw" });
  }

  if (req.method === "GET" && req.url === "/status") {
    const status = await agent.status();
    return sendJson(res, 200, { ok: true, totalTasks, ...status });
  }

  // --- POST routes ---

  if (req.method === "POST" && req.url === "/execute") {
    const body = await readBody(req);
    const task = body.task;
    if (!task) {
      return sendJson(res, 400, { error: "Missing 'task' in request body" });
    }

    totalTasks++;
    console.log(`[browserclaw] Task #${totalTasks}: ${task.slice(0, 120)}${task.length > 120 ? "..." : ""}`);

    try {
      const result = await agent.execute(task, body.url);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      console.error(`[browserclaw] Task failed:`, err.message);
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  if (req.method === "POST" && req.url === "/act") {
    const body = await readBody(req);
    const action = body.action;
    if (!action) {
      return sendJson(res, 400, { error: "Missing 'action' in request body" });
    }

    try {
      const result = await agent.act(action);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  if (req.method === "POST" && req.url === "/navigate") {
    const body = await readBody(req);
    const url = body.url;
    if (!url) {
      return sendJson(res, 400, { error: "Missing 'url' in request body" });
    }

    try {
      const result = await agent.navigate(url);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  if (req.method === "POST" && req.url === "/extract") {
    const body = await readBody(req);
    const instruction = body.instruction;
    if (!instruction) {
      return sendJson(res, 400, { error: "Missing 'instruction' in request body" });
    }

    try {
      const result = await agent.extract(instruction);
      return sendJson(res, 200, { ok: true, ...result });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || String(err) });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

// --- Start ---

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[browserclaw] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`[browserclaw] Browser will launch on first task`);
  console.log(`[browserclaw] Endpoints:`);
  console.log(`[browserclaw]   POST /execute  — run a multi-step browser task`);
  console.log(`[browserclaw]   POST /act      — perform a single action`);
  console.log(`[browserclaw]   POST /navigate — go to a URL`);
  console.log(`[browserclaw]   POST /extract  — extract data from current page`);
  console.log(`[browserclaw]   GET  /health   — health check`);
  console.log(`[browserclaw]   GET  /status   — browser status`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n[browserclaw] Shutting down...");
  await agent.close();
  server.close(() => {
    console.log("[browserclaw] Server stopped.");
    process.exit(0);
  });
});
