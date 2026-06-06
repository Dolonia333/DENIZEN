/**
 * Assistant Mode — surface orchestration for the AI assistant "Lucy".
 *
 * A single user request ("organize my downloads", "what am I looking at?",
 * "apply to this job for me", "click the blue button") can mean very different
 * things depending on *where* the work happens. This module makes that choice
 * explicit and permission-gated, drawing a hard line between:
 *
 *   HER surface   — Lucy acts in her *own* sandbox:
 *                     • 'her_browser' : drives her own Playwright window
 *                     • 'files'       : reads/writes/organizes files in the background
 *
 *   YOUR surface  — Lucy touches the *user's actual machine*:
 *                     • 'observe'     : looks at the user's real screen (read-only)
 *                     • 'user_screen' : controls the user's real mouse/keyboard
 *
 * `classify()` is a pure, deterministic intent router (keyword heuristics, no
 * I/O). `dispatch()` classifies, then enforces permission checks before it
 * hands off to the matching injected capability module — and refuses clearly
 * when access has not been granted.
 *
 * Design principles:
 *   • "Her screen vs your screen" is never implicit. The surface is named.
 *   • Touching the user's machine (observe/control) requires screen access.
 *   • Touching files requires path access.
 *   • When intent is ambiguous, default to the *safest* surface: 'observe'
 *     (look before acting — never control or write on a guess).
 *
 * All capability modules are dependency-injected so this module is testable
 * standalone with stubs. Built-in Node.js only; CommonJS.
 */

'use strict';

/**
 * @typedef {'her_browser'|'user_screen'|'files'|'observe'} Surface
 *
 * @typedef {Object} Classification
 * @property {Surface}  surface     Where the request should be handled.
 * @property {string}   capability  Coarse capability label (e.g. 'organize', 'control').
 * @property {string}   reason      Human-readable why-this-surface explanation.
 *
 * @typedef {Object} DispatchResult
 * @property {boolean}  ok          Whether the request was carried out.
 * @property {Surface}  surface     The surface it was routed to.
 * @property {*}       [result]     The injected module's return value (on success).
 * @property {string}  [error]      Refusal/failure reason (when ok === false).
 * @property {Classification} [classification]  The routing decision (always present).
 */

/**
 * Ordered keyword rules. First matching rule wins, so more specific /
 * higher-risk intents (control, observe) are checked before broad ones.
 * Each `patterns` entry is matched case-insensitively as a substring against
 * the raw request.
 *
 * @type {Array<{surface: Surface, capability: string, patterns: string[], reason: string}>}
 */
const ROUTING_RULES = [
  // --- YOUR surface: CONTROL the user's real screen (highest risk) ---
  {
    surface: 'user_screen',
    capability: 'control',
    reason: 'Request asks Lucy to act on the user\'s real screen (mouse/keyboard).',
    // CONTROL requires an explicit ACTION verb — never a bare location like
    // "on my screen" (that's observe). "do it on my screen" stays because the
    // action is "do it". This prevents "what am I looking at on my screen"
    // (an observe request) from being mis-routed to control.
    patterns: [
      'click', 'type for me', 'type it', 'type my', 'type the', 'fill in',
      'do it on my screen', 'control my', 'control the', 'take control',
      'press', 'scroll down', 'scroll up', 'drag', 'select the',
      'open the app', 'close the window',
    ],
  },

  // --- HER surface: drive Lucy's own browser ---
  {
    surface: 'her_browser',
    capability: 'web',
    reason: 'Request is web/online work Lucy does in her own browser window.',
    patterns: [
      'search the web', 'look up online', 'look it up online', 'in your browser',
      'on the web', 'apply', 'fill out', 'fill in the form', 'sign up',
      'book a', 'order online', 'google', 'browse', 'research online',
      'find online', 'check the website', 'go to the site',
    ],
  },

  // --- HER surface: background file operations ---
  {
    surface: 'files',
    capability: 'files',
    reason: 'Request is a file/folder operation Lucy performs in the background.',
    patterns: [
      'organize', 'rename', 'folder', 'file', 'files', 'sort', 'read the',
      'write a file', 'save to', 'move the', 'delete the file', 'clean up my',
      'directory', 'document', '.txt', '.pdf', '.csv', '.json', 'downloads',
    ],
  },

  // --- YOUR surface: OBSERVE the user's real screen (read-only) ---
  {
    surface: 'observe',
    capability: 'observe',
    reason: 'Request asks Lucy to look at the user\'s real screen (read-only).',
    patterns: [
      'my screen', 'what am i looking at', 'see my screen', 'watch',
      'help me with this', 'what is this', 'look at this', 'whats on my screen',
      'what\'s on my screen', 'can you see', 'read my screen',
    ],
  },
];

/** The safest surface to fall back to when intent is ambiguous. */
const DEFAULT_SURFACE = 'observe';
const DEFAULT_CAPABILITY = 'observe';
const DEFAULT_REASON =
  'Ambiguous request — defaulting to observe (look before acting) for safety.';

class AssistantMode {
  /**
   * @param {Object}   deps
   * @param {Object}   deps.fileAgent     read/write/organize files.
   * @param {Object}   deps.screenWatch   observe the user's screen.
   * @param {Object}   deps.desktopAgent  control the user's real screen.
   * @param {Object}   deps.browser       drive Lucy's own browser window.
   * @param {Object}   deps.permissions   permission registry.
   */
  constructor({ fileAgent, screenWatch, desktopAgent, browser, permissions } = {}) {
    this.fileAgent = fileAgent;
    this.screenWatch = screenWatch;
    this.desktopAgent = desktopAgent;
    this.browser = browser;
    this.permissions = permissions;
  }

  /**
   * Pure intent router. Deterministic: same string in → same decision out.
   * No I/O, no permission checks, no side effects.
   *
   * Routing table (first match wins, rules ordered by specificity/risk):
   *   user_screen  ← "click", "type for me", "do it on my screen", "control"...
   *   her_browser  ← "search the web", "apply", "fill out", "in your browser"...
   *   files        ← "organize", "rename", "folder", "read/write", "sort"...
   *   observe      ← "my screen", "what am I looking at", "watch", "help with this"...
   *   (default)    ← observe  — safest when ambiguous.
   *
   * @param {string} request  Natural-language user request.
   * @returns {Classification}
   */
  classify(request) {
    const text = String(request == null ? '' : request).toLowerCase();

    for (const rule of ROUTING_RULES) {
      for (const pattern of rule.patterns) {
        if (text.includes(pattern)) {
          return {
            surface: rule.surface,
            capability: rule.capability,
            reason: `${rule.reason} (matched "${pattern}")`,
          };
        }
      }
    }

    return {
      surface: DEFAULT_SURFACE,
      capability: DEFAULT_CAPABILITY,
      reason: DEFAULT_REASON,
    };
  }

  /**
   * Classify a request, enforce the relevant permission gate, then hand off
   * to the matching injected capability module.
   *
   *   files        → permissions.checkPathAccess  → fileAgent
   *   observe      → permissions.checkScreenAccess → screenWatch
   *   user_screen  → permissions.checkScreenAccess → desktopAgent
   *   her_browser  → (no user-machine gate)        → browser
   *
   * @param {string} request          Natural-language user request.
   * @param {Object} [opts]           Optional context.
   * @param {string} [opts.path]      Path hint for file/path permission checks.
   * @returns {Promise<DispatchResult>}
   */
  async dispatch(request, opts = {}) {
    const classification = this.classify(request);
    const { surface } = classification;

    try {
      switch (surface) {
        case 'files': {
          const granted = await this._check(
            this.permissions, 'checkPathAccess', opts.path);
          if (!granted) {
            return this._refuse(surface, classification,
              'File access is not granted. Ask the user to allow path access before Lucy can touch files.');
          }
          const result = await this._call(this.fileAgent, 'organize', request, opts);
          return { ok: true, surface, result, classification };
        }

        case 'observe': {
          const granted = await this._check(
            this.permissions, 'checkScreenAccess');
          if (!granted) {
            return this._refuse(surface, classification,
              'Screen access is not granted. Ask the user to allow screen viewing before Lucy can look at your screen.');
          }
          const result = await this._call(this.screenWatch, 'captureOnce', request, opts);
          return { ok: true, surface, result, classification };
        }

        case 'user_screen': {
          const granted = await this._check(
            this.permissions, 'checkScreenAccess');
          if (!granted) {
            return this._refuse(surface, classification,
              'Screen access is not granted. Ask the user to allow screen control before Lucy can act on your screen.');
          }
          const result = await this._call(this.desktopAgent, 'run', request, opts);
          return { ok: true, surface, result, classification };
        }

        case 'her_browser': {
          // Lucy's own browser is her sandbox — no user-machine permission gate.
          const result = await this._call(this.browser, 'run', request, opts);
          return { ok: true, surface, result, classification };
        }

        default:
          return this._refuse(surface, classification,
            `No handler for surface "${surface}".`);
      }
    } catch (err) {
      return {
        ok: false,
        surface,
        error: `Dispatch failed on ${surface}: ${err && err.message ? err.message : String(err)}`,
        classification,
      };
    }
  }

  /**
   * Human-readable summary of which kinds of requests go where, for surfacing
   * to the user so the "her surface vs your surface" split stays transparent.
   * @returns {string}
   */
  explain() {
    return [
      'Lucy routes each request to one of four surfaces:',
      '',
      'HER surface (Lucy\'s own sandbox):',
      '  • her_browser — web tasks in her own browser: "search the web", "apply",',
      '    "fill out the form", "look it up online", "in your browser".',
      '  • files — background file work: "organize my downloads", "rename these",',
      '    "sort this folder", "read/write a file". (needs path access)',
      '',
      'YOUR surface (your actual machine):',
      '  • observe — looks at your real screen, read-only: "what am I looking at?",',
      '    "see my screen", "watch", "help me with this". (needs screen access)',
      '  • user_screen — controls your real mouse/keyboard: "click", "type for me",',
      '    "do it on my screen", "control". (needs screen access)',
      '',
      'When a request is ambiguous, Lucy defaults to "observe" — she looks',
      'before she acts, and never controls or writes on a guess.',
    ].join('\n');
  }

  // --- internals ---------------------------------------------------------

  /**
   * Invoke a permission check method if present. Missing module/method is
   * treated as "denied" (fail closed) for the user-machine/file gates.
   * @private
   */
  async _check(mod, method, arg) {
    if (!mod || typeof mod[method] !== 'function') return false;
    return await mod[method](arg);
  }

  /**
   * Invoke a capability module method, tolerating either a single-arg or
   * (request, opts) signature on the stub/real module.
   * @private
   */
  async _call(mod, method, request, opts) {
    if (!mod || typeof mod[method] !== 'function') {
      throw new Error(`capability module is missing method "${method}"`);
    }
    return await mod[method](request, opts);
  }

  /** @private */
  _refuse(surface, classification, message) {
    return { ok: false, surface, error: message, classification };
  }
}

module.exports = { AssistantMode, ROUTING_RULES, DEFAULT_SURFACE };
