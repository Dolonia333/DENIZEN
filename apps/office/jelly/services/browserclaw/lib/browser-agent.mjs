/**
 * BrowserClaw — Stagehand browser agent wrapper.
 *
 * Manages a persistent local Chrome session controlled by Stagehand.
 * Exposes simple methods that the HTTP server calls.
 */

import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

// --- Provider config based on BROWSERCLAW_PROVIDER env var ---

const PROVIDER = (process.env.BROWSERCLAW_PROVIDER || "gemini").toLowerCase();

function resolveModelConfig() {
  switch (PROVIDER) {
    case "local":
      return {
        model: process.env.BROWSERCLAW_LLM_MODEL || "local-model",
        clientOptions: {
          apiKey: "sk-not-needed-for-local",
          baseURL: process.env.BROWSERCLAW_LLM_URL || "http://127.0.0.1:1234/v1",
        },
      };
    case "openai":
      return {
        model: process.env.BROWSERCLAW_OPENAI_MODEL || "gpt-4o",
        clientOptions: process.env.OPENAI_API_KEY
          ? { apiKey: process.env.OPENAI_API_KEY }
          : undefined,
      };
    case "gemini":
    default:
      return {
        model: "google/gemini-2.5-flash",
        clientOptions: undefined,
      };
  }
}

const MODEL_CONFIG = resolveModelConfig();
console.log(`[browserclaw] Provider: ${PROVIDER}, Model: ${MODEL_CONFIG.model}`);

export class BrowserAgent {
  /** @type {Stagehand | null} */
  #stagehand = null;
  #ready = false;
  #initializing = false;

  /**
   * Lazy-init: creates the Stagehand instance and launches Chrome on first use.
   */
  async #ensureReady() {
    if (this.#ready) return;
    if (this.#initializing) {
      // Wait for in-progress init
      while (this.#initializing) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (this.#ready) return;
      throw new Error("Browser failed to initialize");
    }

    this.#initializing = true;
    try {
      this.#stagehand = new Stagehand({
        env: "LOCAL",
        model: MODEL_CONFIG.model,
        ...(MODEL_CONFIG.clientOptions ? { modelClientOptions: MODEL_CONFIG.clientOptions } : {}),
        localBrowserLaunchOptions: {
          headless: false,
        },
      });

      await this.#stagehand.init();
      this.#ready = true;
      console.log("[browserclaw] Browser launched and ready");
    } catch (err) {
      this.#stagehand = null;
      throw err;
    } finally {
      this.#initializing = false;
    }
  }

  /**
   * Execute a natural-language browser task using Stagehand's agent.
   * This handles multi-step workflows (navigate, click, fill forms, etc.).
   *
   * @param {string} task - Natural language description of what to do
   * @param {string} [url] - Optional URL to navigate to first
   * @returns {Promise<{result: string, currentUrl: string, title: string}>}
   */
  async execute(task, url) {
    await this.#ensureReady();
    const page = this.#stagehand.context.pages()[0];

    if (url) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    const agent = this.#stagehand.agent({
      model: MODEL_CONFIG.model,
    });

    const agentResult = await agent.execute(task);

    const currentUrl = page.url();
    const title = await page.title();

    return {
      result: agentResult?.message || agentResult?.text || "Task completed",
      currentUrl,
      title,
    };
  }

  /**
   * Execute a single action on the current page.
   *
   * @param {string} action - Natural language action (e.g., "click the submit button")
   * @returns {Promise<{result: string, currentUrl: string}>}
   */
  async act(action) {
    await this.#ensureReady();
    const page = this.#stagehand.context.pages()[0];

    await this.#stagehand.act(action);

    return {
      result: `Performed: ${action}`,
      currentUrl: page.url(),
    };
  }

  /**
   * Navigate to a URL.
   *
   * @param {string} url
   * @returns {Promise<{currentUrl: string, title: string}>}
   */
  async navigate(url) {
    await this.#ensureReady();
    const page = this.#stagehand.context.pages()[0];

    await page.goto(url, { waitUntil: "domcontentloaded" });

    return {
      currentUrl: page.url(),
      title: await page.title(),
    };
  }

  /**
   * Extract structured data from the current page.
   *
   * @param {string} instruction - What to extract
   * @returns {Promise<{data: any, currentUrl: string}>}
   */
  async extract(instruction) {
    await this.#ensureReady();
    const page = this.#stagehand.context.pages()[0];

    const data = await this.#stagehand.extract(instruction, z.string());

    return {
      data,
      currentUrl: page.url(),
    };
  }

  /**
   * Get current browser status.
   */
  async status() {
    if (!this.#ready || !this.#stagehand) {
      return { ready: false, currentUrl: null, title: null };
    }

    try {
      const page = this.#stagehand.context.pages()[0];
      return {
        ready: true,
        currentUrl: page.url(),
        title: await page.title(),
      };
    } catch {
      return { ready: true, currentUrl: "unknown", title: "unknown" };
    }
  }

  /**
   * Close the browser and clean up.
   */
  async close() {
    if (this.#stagehand) {
      try {
        await this.#stagehand.close();
      } catch {
        // ignore
      }
      this.#stagehand = null;
      this.#ready = false;
      console.log("[browserclaw] Browser closed");
    }
  }
}
