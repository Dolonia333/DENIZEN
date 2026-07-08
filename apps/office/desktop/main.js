const { app, BrowserWindow, ipcMain, Tray, shell, Menu, nativeImage, desktopCapturer, screen } = require("electron");

const path = require("path");

const fs = require("fs");

const os = require("os");

const pkg = require("./package.json");

const { pathToFileURL } = require("url");

const { spawn } = require("child_process");

const http = require("http");

const { collectMachineProfile } = require("./node-profiler");
const ollamaManager = require("./ollama-manager");
const llamaServerManager = require("./llama-server-manager");
const llamaBrainPull = require("./llama-brain-pull");

const { startWorkerLoop, stopWorkerLoop, clearLastPendingId, syncCapabilities } = require("./node-worker-loop");
const { startStationTaskLoop, stopStationTaskLoop } = require("./station-task-runner");
const stationAgent = require("./station-agent");
const {
  initAutoUpdater,
  getUpdateStatus,
  checkForUpdates,
  installDownloadedUpdate,
  setMainWindow
} = require("./auto-updater");
const {
  initCrashReporter,
  readCrashLogTail,
  readRecentCrashes
} = require("./crash-reporter");



const PORT = Number(process.env.PORT || process.env.DENIZEN_PORT || 8081);

const HOST = "127.0.0.1";

const DEFAULT_SERVER_URL = String(
  process.env.DENIZEN_SERVER_URL || `http://127.0.0.1:${PORT}`
).replace(/\/+$/, "");

const PUBLIC_DENIZEN_URL = String(
  process.env.DENIZEN_PUBLIC_URL
  || process.env.DENIZEN_SERVER_URL
  || "https://denizen.dolonia.cloud"
).replace(/\/+$/, "");

const SERVER_ENTRY = path.resolve(__dirname, "..", "server.js");

const GAME_ENTRY = path.resolve(__dirname, "..", "index.html");

const WIZARD_ENTRY = path.join(__dirname, "setup-wizard.html");

const AGENT_SETTINGS_ENTRY = path.join(__dirname, "agent-settings.html");

const PERMISSION_PROMPT = path.join(__dirname, "permission-prompt.html");

const FEEDBACK_DIALOG = path.join(__dirname, "feedback-dialog.html");

const SETUP_FILE = path.join(app.getPath("userData"), "denizen-desktop-setup.json");

const PROTOCOL = "denizen";

const APP_VERSION = pkg.version || "0.1.0";

const UPDATE_CHANNEL = process.env.DENIZEN_UPDATE_CHANNEL || pkg.updateChannel || "stable";



let mainWindow = null;

let permissionWindow = null;

let feedbackWindow = null;

let denizenServerProcess = null;

let tray = null;

let restartUpdateMenuItem = null;

let pendingPairToken = null;

let pendingPairServerUrl = null;

let shownPermissionId = null;

let pairingClaimState = {
  claimed: false,
  sessionId: null,
  sessionToken: null,
  serverUrl: null,
  error: null
};



const gotSingleInstanceLock = app.requestSingleInstanceLock();



if (!gotSingleInstanceLock) {

  app.quit();

}



function readSetupState() {

  try {

    return JSON.parse(fs.readFileSync(SETUP_FILE, "utf8"));

  } catch (_) {

    return { completed: false };

  }

}



function writeSetupState(next) {

  fs.mkdirSync(path.dirname(SETUP_FILE), { recursive: true });

  fs.writeFileSync(SETUP_FILE, JSON.stringify(next, null, 2), "utf8");

}



function probeDenizenHealth(port) {

  return new Promise((resolve) => {

    const req = http.request(

      {

        host: HOST,

        port,

        method: "GET",

        path: "/api/health",

        timeout: 1200

      },

      (res) => {

        let body = "";

        res.on("data", (chunk) => {

          body += chunk;

        });

        res.on("end", () => {

          try {

            resolve(JSON.parse(body).ok === true);

          } catch (_) {

            resolve(false);

          }

        });

      }

    );



    req.on("error", () => resolve(false));

    req.on("timeout", () => {

      req.destroy();

      resolve(false);

    });

    req.end();

  });

}



async function findDenizenServerPort() {

  const candidates = [PORT, 8081, 8080]

    .map((value) => Number(value))

    .filter((value, index, all) => value > 0 && all.indexOf(value) === index);

  for (const port of candidates) {

    if (await probeDenizenHealth(port)) return port;

  }

  return PORT;

}



async function waitForServer(port, attempts = 15) {

  for (let i = 0; i < attempts; i += 1) {

    if (await probeDenizenHealth(port)) {

      return true;

    }

    await new Promise((r) => setTimeout(r, 300));

  }

  return false;

}



async function resolvePairingServerUrl() {
  const configured = getConfiguredRemoteServerUrl();
  if (configured) return configured;

  const activePort = await findDenizenServerPort();
  if (await probeDenizenHealth(activePort)) {
    return `http://127.0.0.1:${activePort}`;
  }

  if (app.isPackaged) {
    return PUBLIC_DENIZEN_URL;
  }

  const target = await ensureDenizenServer();
  const base = String(target?.url || DEFAULT_SERVER_URL).replace(/\/+$/, "");
  if (base.startsWith("file:")) return PUBLIC_DENIZEN_URL;
  return base;
}

async function ensureDenizenServer() {

  const configuredServerUrl = getConfiguredRemoteServerUrl();

  if (configuredServerUrl) {

    return { url: configuredServerUrl };

  }

  const activePort = await findDenizenServerPort();

  if (await probeDenizenHealth(activePort)) {

    return { url: `http://localhost:${activePort}` };

  }



  denizenServerProcess = spawn(process.execPath, [SERVER_ENTRY], {

    cwd: path.resolve(__dirname, ".."),

    env: { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: "1" },

    stdio: "inherit"

  });



  denizenServerProcess.on("exit", (code) => {

    if (code !== 0) {

      console.warn(`[denizen-desktop] Embedded server exited with code ${code}`);

    }

    denizenServerProcess = null;

  });



  const ready = await waitForServer(activePort);

  if (ready) {

    return { url: `http://localhost:${activePort}` };

  }



  return { url: `${pathToFileURL(GAME_ENTRY).toString()}?layout=openplan` };

}



function normalizeSetup(setupOrToken) {

  if (typeof setupOrToken === "string") {

    return { sessionToken: setupOrToken };

  }

  return setupOrToken || {};

}



function buildDesktopHeaders(setup = {}, payload = {}) {

  const headers = {

    "Content-Type": "application/json",

    "X-Denizen-Client": "desktop"

  };



  const sessionId = setup.sessionId || payload.session_id || payload.sessionId;

  const sessionToken = setup.sessionToken || payload.session_token || payload.sessionToken;



  if (sessionId) headers["X-Session-Id"] = String(sessionId);

  if (sessionToken) headers["X-Session-Token"] = String(sessionToken);

  if (setup.desktopInstallId || payload.desktop_install_id) {

    headers["X-Desktop-Install-Id"] = String(

      setup.desktopInstallId || payload.desktop_install_id

    );

  }



  return headers;

}



function payloadToTunnelHeaders(payload = {}) {

  const headers = {};

  const map = {

    session_id: "X-Session-Id",

    sessionId: "X-Session-Id",

    session_token: "X-Session-Token",

    sessionToken: "X-Session-Token",

    desktop_install_id: "X-Desktop-Install-Id",

    installId: "X-Desktop-Install-Id",

    agent_permission_level: "X-Agent-Permission-Level",

    permission: "X-Agent-Permission-Level",

    opt_in: "X-Opt-In",

    request_id: "X-Request-Id",

    approved: "X-Approved"

  };



  for (const [key, header] of Object.entries(map)) {

    if (payload[key] != null && payload[key] !== "") {

      headers[header] = String(payload[key]);

    }

  }



  return headers;

}



function isTransientDesktopError(err) {

  const msg = String(err?.message || err || "").toLowerCase();

  return (

    err?.name === "TypeError"

    || msg.includes("fetch failed")

    || msg.includes("network")

    || msg.includes("econnreset")

    || msg.includes("etimedout")

    || msg.includes("socket hang up")

  );

}



async function parseDesktopResponse(res) {

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {

    throw new Error(data.error || `Request failed (${res.status})`);

  }

  return data;

}



async function postDesktopApi(serverUrl, route, payload = {}, setupOrToken = {}, opts = {}) {

  const setup = normalizeSetup(setupOrToken);

  const method = String(opts.method || "POST").toUpperCase();

  const base = `${String(serverUrl || "").replace(/\/+$/, "")}${route}`;



  if (method === "GET") {

    const headers = {

      ...buildDesktopHeaders(setup, payload),

      ...payloadToTunnelHeaders(payload)

    };

    delete headers["Content-Type"];

    const res = await fetch(base, { method: "GET", headers });

    return parseDesktopResponse(res);

  }



  const headers = buildDesktopHeaders(setup, payload);



  try {

    const res = await fetch(base, {

      method: "POST",

      headers,

      body: JSON.stringify(payload)

    });

    return await parseDesktopResponse(res);

  } catch (err) {

    if (!isTransientDesktopError(err)) throw err;

  }



  const getHeaders = {

    ...buildDesktopHeaders(setup, payload),

    ...payloadToTunnelHeaders(payload)

  };

  delete getHeaders["Content-Type"];



  const res = await fetch(base, { method: "GET", headers: getHeaders });

  return parseDesktopResponse(res);

}



function buildFeedbackPayload(opts = {}) {

  const setup = readSetupState();

  const detail = opts.detail != null
    ? String(opts.detail)
    : String(opts.message || "");

  const recentCrashes = opts.attachRecentCrashes
    ? readRecentCrashes(opts.recentCrashLimit || 5)
    : null;

  return {

    session_id: setup.sessionId,

    install_id: setup.desktopInstallId || null,

    app_version: APP_VERSION,

    platform: process.platform,

    arch: process.arch,

    os_version: os.release(),

    channel: setup.updateChannel || UPDATE_CHANNEL,

    event: opts.event || "other",

    detail,

    crash_log_tail: readCrashLogTail(),

    logs_tail: opts.logs_tail || opts.logsTail
      || (recentCrashes?.length
        ? JSON.stringify(recentCrashes)
        : null)

  };

}



async function submitDesktopFeedback(opts = {}) {

  const setup = readSetupState();

  const serverUrl = String(setup.serverUrl || DEFAULT_SERVER_URL).trim();

  if (!setup.sessionId) {

    throw new Error("Sign in and complete setup before sending feedback");

  }



  const payload = buildFeedbackPayload(opts);

  const data = await postDesktopApi(

    serverUrl,

    "/api/desktop/feedback",

    payload,

    setup

  );

  return { ok: true, ...data };

}



initCrashReporter({

  userDataDir: app.getPath("userData"),

  getSetupState: readSetupState,

  submitFeedbackFn: (opts) => submitDesktopFeedback(opts).catch((err) => {

    console.warn("[denizen-desktop] crash feedback submit failed:", err?.message || err);

  })

});



function derivePermissionFromCapabilities(caps = {}) {
  const core = [
    !!caps.read_files,
    !!caps.write_files,
    !!caps.run_code,
    !!caps.screen_access
  ];
  if (core.every((v) => !v)) return "off";
  return "ask";
}



function getConfiguredRemoteServerUrl() {

  const raw = String(readSetupState().serverUrl || "").trim();

  if (!raw) return null;

  try {

    const parsed = new URL(raw);

    const host = parsed.hostname.toLowerCase();

    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";

    if (!isLocal && (parsed.protocol === "https:" || parsed.protocol === "http:")) {

      return raw.replace(/\/+$/, "");

    }

  } catch (_) {

    return null;

  }

  return null;

}

async function claimPairingToken(serverUrl, token, setup = {}) {

  const trimmed = String(token || "").trim();

  if (!trimmed) throw new Error("pairing token required");



  const base = `${String(serverUrl || "").replace(/\/+$/, "")}/api/desktop/pairing/claim`;

  const headers = buildDesktopHeaders(setup, {});

  delete headers["Content-Type"];



  const res = await fetch(`${base}?token=${encodeURIComponent(trimmed)}`, {

    method: "GET",

    headers

  });

  return parseDesktopResponse(res);

}



function parsePairingUrl(rawUrl) {

  try {

    const parsed = new URL(String(rawUrl || ""));

    if (parsed.protocol !== `${PROTOCOL}:`) return null;



    const host = String(parsed.hostname || parsed.host || "").toLowerCase();

    if (host !== "pair") return null;



    const fromQuery = parsed.searchParams.get("token");

    const pathToken = String(parsed.pathname || "")

      .replace(/^\/+/, "")

      .trim();

    const token = (fromQuery || pathToken || "").trim();

    if (!token) return null;



    const serverUrl = parsed.searchParams.get("server")

      || parsed.searchParams.get("server_url")

      || null;



    return {

      token,

      serverUrl: serverUrl ? String(serverUrl).trim() : null

    };

  } catch (_) {

    return null;

  }

}



function extractPairTokenFromUrl(rawUrl) {

  return parsePairingUrl(rawUrl)?.token || null;

}



function isHttpUrl(value) {

  return /^https?:\/\//i.test(String(value || ""));

}



function wizardLoadWithPair(token, serverUrl) {

  const query = {};

  if (token) query.pair = String(token);

  if (serverUrl) query.server = String(serverUrl);

  return { file: WIZARD_ENTRY, query };

}



function isWizardVisible() {

  const url = mainWindow?.webContents?.getURL?.() || "";

  return url.includes("setup-wizard.html");

}



async function openPermissionPrompt(pending) {

  if (!pending?.id || shownPermissionId === pending.id) return;

  shownPermissionId = pending.id;



  if (isWizardVisible()) {

    mainWindow?.webContents?.send("permission-pending", pending);

    return;

  }



  if (permissionWindow && !permissionWindow.isDestroyed()) {

    permissionWindow.focus();

    permissionWindow.webContents.send("permission-pending", pending);

    return;

  }



  permissionWindow = new BrowserWindow({

    width: 420,

    height: 300,

    resizable: false,

    minimizable: false,

    maximizable: false,

    show: false,

    parent: mainWindow || undefined,

    modal: !!mainWindow,

    webPreferences: {

      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,

      nodeIntegration: false

    }

  });



  permissionWindow.on("closed", () => {

    permissionWindow = null;

  });



  await permissionWindow.loadFile(PERMISSION_PROMPT);

  permissionWindow.webContents.send("permission-pending", pending);

  permissionWindow.show();

}



function maybeStartWorkerLoop() {

  const setup = readSetupState();

  if (!setup.completed) return;



  startWorkerLoop({

    getSetup: readSetupState,

    desktopApi: postDesktopApi,

    onSetupPatch: (patch) => {

      writeSetupState({ ...readSetupState(), ...patch });

    },

    onPermissionPending: (pending) => {

      void openPermissionPrompt(pending);

    },

    onSyncResult: (data) => {
      if (!data?.update_required || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send("update-status", {
        status: "required",
        message: `Update required — install Denizen Desktop ${data.min_desktop_version || ""} or newer.`,
        minVersion: data.min_desktop_version || null,
      });
    },

  });

  startStationTaskLoop({
    getSetup: readSetupState,
    desktopApi: postDesktopApi,
    onProgress: (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("station-task-progress", progress);
      }
    },
  });

}



async function handleDenizenProtocolUrl(rawUrl) {

  const pairing = parsePairingUrl(rawUrl);

  if (!pairing?.token) return;



  pendingPairToken = pairing.token;

  pendingPairServerUrl = pairing.serverUrl || null;



  if (mainWindow && !mainWindow.isDestroyed()) {

    await mainWindow.loadFile(WIZARD_ENTRY, { query: wizardLoadWithPair(pairing.token, pairing.serverUrl).query });

    mainWindow.focus();

    return;

  }



  await createWindow(wizardLoadWithPair(pairing.token, pairing.serverUrl));

}



function registerProtocolHandler() {

  if (process.defaultApp) {

    if (process.argv.length >= 2) {

      app.setAsDefaultProtocolClient(

        PROTOCOL,

        process.execPath,

        [path.resolve(process.argv[1])]

      );

    }

  } else {

    app.setAsDefaultProtocolClient(PROTOCOL);

  }

}



function setupIpc() {

  ipcMain.handle("get-machine-profile", async () => collectMachineProfile());

  ipcMain.handle("get-inference-status", async () => {
    try {
      const { probeInferenceRuntime } = require("../src/compute/denizen-inference-runtime");
      return await probeInferenceRuntime({ timeoutMs: 4000 });
    } catch (err) {
      return { reachable: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle("get-brain-catalog", async () => {
    const catalogPath = path.join(__dirname, "data", "brain-catalog.json");
    try {
      return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    } catch (_) {
      return { version: 1, models: [] };
    }
  });

  ipcMain.handle("ensure-ollama", async () => ollamaManager.ensureOllamaRunning());

  ipcMain.handle("ensure-llamacpp", async () => llamaServerManager.ensureLlamaServerRunning());

  ipcMain.handle("pull-brain-model", async (event, opts = {}) => {
    const { BrowserWindow } = require("electron");
    const win = BrowserWindow.fromWebContents(event.sender);
    const emit = (payload) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send("brain-pull-progress", payload);
      }
    };

    const catalogPath = path.join(__dirname, "data", "brain-catalog.json");
    let catalog = { models: [] };
    try {
      catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
    } catch (_) {}

    const model = String(opts?.model || process.env.OLLAMA_MODEL || "llama3.2").trim();
    if (!model) return { ok: false, error: "model name required" };

    const entry = llamaBrainPull.resolveCatalogEntry(catalog, model);
    const useLlamaCpp = opts?.backend === "llamacpp"
      || entry?.backend === "llamacpp"
      || /\.gguf$/i.test(entry?.filename || "");

    if (useLlamaCpp) {
      emit({ model, phase: "starting", percent: 0, backend: "llamacpp" });
      const bundled = llamaServerManager.bundledLlamaServerPath();
      if (!bundled && !process.env.LLAMACPP_BIN) {
        const err = "llama-server not bundled — rebuild with fetch-llama-server or set LLAMACPP_BIN";
        emit({ model, phase: "error", error: err });
        return { ok: false, error: err, model, backend: "llamacpp" };
      }
      const pulled = await llamaBrainPull.pullGgufModel({
        model,
        catalog,
        onProgress: ({ percent }) => emit({ model, phase: "downloading", percent, backend: "llamacpp" }),
      });
      if (!pulled.ok) {
        emit({ model, phase: "error", error: pulled.error });
        return { ok: false, ...pulled, backend: "llamacpp" };
      }
      process.env.LLAMACPP_MODEL = pulled.path;
      emit({ model, phase: "finishing", percent: 99, backend: "llamacpp" });
      const started = await llamaServerManager.ensureLlamaServerRunning({ model: pulled.path });
      if (!started.ok) {
        emit({ model, phase: "error", error: started.error });
        return { ok: false, error: started.error, model, backend: "llamacpp" };
      }
      emit({ model, phase: "done", percent: 100, backend: "llamacpp" });
      const setup = readSetupState();
      writeSetupState({
        ...setup,
        brainModel: model,
        brainBackend: "llamacpp",
        llamaCppModelPath: pulled.path,
      });
      return { ok: true, model, backend: "llamacpp", path: pulled.path };
    }

    await ollamaManager.ensureOllamaRunning().catch(() => null);

    const cmd = ollamaManager.ollamaCommand();
    emit({ model, phase: "starting", percent: 0 });

    return new Promise((resolve) => {
      const child = spawn(cmd, ["pull", model], {
        shell: cmd === "ollama",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";

      const onChunk = (chunk) => {
        output += String(chunk || "");
        const lines = output.split(/\r?\n/).slice(-6);
        for (const line of lines) {
          const pct = line.match(/(\d{1,3})%/);
          if (pct) {
            emit({ model, phase: "downloading", percent: Number(pct[1]), line: line.trim() });
          } else if (/verifying|success|complete/i.test(line)) {
            emit({ model, phase: "finishing", percent: 99, line: line.trim() });
          }
        }
      };

      child.stdout?.on("data", onChunk);
      child.stderr?.on("data", onChunk);
      child.on("error", (err) => {
        emit({ model, phase: "error", error: err?.message || String(err) });
        resolve({ ok: false, error: err?.message || String(err), model });
      });
      child.on("close", (code) => {
        if (code === 0) {
          emit({ model, phase: "done", percent: 100 });
          const setup = readSetupState();
          writeSetupState({ ...setup, brainModel: model, brainBackend: "ollama" });
          resolve({ ok: true, model, output: output.slice(-400) });
          return;
        }
        const errText = output.trim() || `ollama pull exited ${code}`;
        emit({ model, phase: "error", error: errText });
        resolve({ ok: false, model, error: errText });
      });
    });
  });



  ipcMain.handle("claim-pairing-token", async (_evt, opts = {}) => {
    const normalized = typeof opts === "string" ? { token: opts } : (opts || {});
    const setup = readSetupState();
    const serverUrl = String(
      normalized.serverUrl
      || pendingPairServerUrl
      || setup.serverUrl
      || DEFAULT_SERVER_URL
    ).trim();
    const token = String(normalized.token || pendingPairToken || "").trim();

    if (!token) {
      pairingClaimState.error = "pairing token required";
      return { ok: false, error: pairingClaimState.error };
    }

    try {
      const data = await claimPairingToken(serverUrl, token, setup);
      pendingPairToken = null;
      pendingPairServerUrl = null;
      pairingClaimState = {
        claimed: true,
        sessionId: data.session_id || data.sessionId || null,
        sessionToken: data.session_token || data.sessionToken || null,
        serverUrl: data.server_url || data.serverUrl || serverUrl,
        error: null
      };
      return {
        ok: true,
        ...pairingClaimState,
        profile: data.profile || null
      };
    } catch (err) {
      pairingClaimState.error = err?.message || String(err);
      return { ok: false, error: pairingClaimState.error };
    }
  });

  ipcMain.handle("get-pairing-status", async () => {
    if (pairingClaimState.claimed) {
      return { claimed: true, ...pairingClaimState };
    }
    const setup = readSetupState();
    if (setup.sessionId) {
      return {
        claimed: true,
        sessionId: setup.sessionId,
        sessionToken: setup.sessionToken || null,
        serverUrl: setup.serverUrl || null,
        error: null
      };
    }
    return { claimed: false, error: pairingClaimState.error };
  });

  ipcMain.handle("get-pending-permission", async () => {

    const setup = readSetupState();

    if (!setup.completed || !setup.sessionId) {

      return { ok: true, pending: null };

    }



    const data = await postDesktopApi(

      setup.serverUrl,

      "/api/desktop/permission/pending",

      { session_id: setup.sessionId },

      setup,

      { method: "GET" }

    );

    return { ok: true, pending: data.pending || null };

  });



  ipcMain.handle("respond-permission", async (_evt, opts = {}) => {

    const setup = readSetupState();

    if (!setup.completed || !setup.sessionId) {

      throw new Error("Desktop setup not complete");

    }



    const requestId = String(opts.requestId || opts.id || "").trim();

    if (!requestId) throw new Error("request_id required");



    const data = await postDesktopApi(

      setup.serverUrl,

      "/api/desktop/permission/respond",

      {

        session_id: setup.sessionId,

        request_id: requestId,

        approved: !!opts.approved

      },

      setup

    );



    shownPermissionId = null;

    clearLastPendingId();



    if (permissionWindow && !permissionWindow.isDestroyed()) {

      permissionWindow.close();

    }



    return { ok: true, ...data };

  });



  ipcMain.handle("complete-setup-wizard", async (_evt, opts = {}) => {
    const caps = opts.capabilities && typeof opts.capabilities === "object" ? opts.capabilities : {};
    const serverUrl = String(
      opts.serverUrl || pairingClaimState.serverUrl || DEFAULT_SERVER_URL
    ).trim();
    const sessionId = String(
      opts.sessionId || pairingClaimState.sessionId || ""
    ).trim();
    const sessionToken = String(
      opts.sessionToken || pairingClaimState.sessionToken || ""
    ).trim();
    const permission = String(
      opts.permission || derivePermissionFromCapabilities(caps) || "ask"
    );
    const optIn = opts.optIn != null ? !!opts.optIn : !!caps.contribute_compute;
    const prior = readSetupState();
    const diagnosticsOptIn = opts.diagnosticsOptIn != null
      ? !!opts.diagnosticsOptIn
      : !!prior.diagnosticsOptIn;

    if (optIn) {
      await ollamaManager.ensureOllamaRunning().catch(() => null);
      const setupBrain = readSetupState();
      if (setupBrain.brainBackend === "llamacpp" || setupBrain.llamaCppModelPath) {
        await llamaServerManager.ensureLlamaServerRunning({
          model: setupBrain.llamaCppModelPath || undefined,
        }).catch(() => null);
      } else if (llamaServerManager.bundledLlamaServerPath()) {
        await llamaServerManager.ensureLlamaServerRunning().catch(() => null);
      }
    }

    if (!sessionId) {
      throw new Error("Pair your account first — use Link this computer in the browser");
    }

    const machine = collectMachineProfile();
    machine.capabilities = {
      read_files: !!caps.read_files,
      write_files: !!caps.write_files,
      run_code: !!caps.run_code,
      screen_access: !!caps.screen_access,
      contribute_compute: !!caps.contribute_compute
    };

    const data = await postDesktopApi(
      serverUrl,
      "/api/desktop/wizard/complete",
      {
        session_id: sessionId,
        agent_permission_level: permission,
        opt_in: optIn,
        setup_wizard_completed: true,
        machine,
        home_server_url: serverUrl,
        desktop_capabilities: machine.capabilities
      },
      { sessionId, sessionToken }
    );

    writeSetupState({
      completed: true,
      serverUrl,
      sessionId,
      sessionToken: sessionToken || null,
      permission,
      optIn,
      capabilities: machine.capabilities,
      hasSessionToken: !!sessionToken,
      desktopInstallId: data.profile?.desktop_install_id || null,
      identityId: data.identity?.id || null,
      nodeId: data.node?.id || null,
      nodeToken: data.node?.endpoint_token || null,
      diagnosticsOptIn,
      brainModel: opts.brainModel || opts.brain_model || prior.brainModel || null,
      brainBackend: opts.brainBackend || opts.brain_backend || prior.brainBackend || null,
      updateChannel: UPDATE_CHANNEL,
      completedAt: Date.now()
    });

    pairingClaimState = {
      claimed: false,
      sessionId: null,
      sessionToken: null,
      serverUrl: null,
      error: null
    };

    maybeStartWorkerLoop();

    if (app.isPackaged) {
      initAutoUpdater({
        mainWindow,
        channel: UPDATE_CHANNEL,
        onStatusChange: updateTrayUpdateStatus
      });
    }



    return {

      ok: true,

      message: "Your station is connected. Step into the city and meet your team.",

      profile: data.profile || null

    };

  });



  ipcMain.handle("open-game", async () => {

    const target = await ensureDenizenServer();

    if (mainWindow) {

      await mainWindow.loadURL(`${target.url}?layout=openplan&desktop=1`);

      return true;

    }

    return false;

  });

  ipcMain.handle("open-pairing-browser", async () => {
    const base = await resolvePairingServerUrl();
    const pairUrl = `${base}/?pair_desktop=1`;
    await shell.openExternal(pairUrl);
    return { ok: true, url: pairUrl, serverUrl: base };
  });

  ipcMain.handle("get-pairing-browser-url", async () => {
    const base = await resolvePairingServerUrl();
    return { ok: true, url: `${base}/?pair_desktop=1`, serverUrl: base };
  });



  ipcMain.handle("open-os-permission-settings", async () => {
    if (process.platform === "darwin") {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      );
      return true;
    }
    if (process.platform === "win32") {
      await shell.openExternal("ms-settings:privacy");
      return true;
    }
    return false;
  });

  ipcMain.handle("open-agent-settings", async () => {

    const setup = readSetupState();

    if (!setup.completed) {

      await mainWindow?.loadFile(WIZARD_ENTRY);

      return true;

    }

    await mainWindow?.loadFile(AGENT_SETTINGS_ENTRY);

    return true;

  });

  ipcMain.handle("get-setup-state", async () => readSetupState());

  ipcMain.handle("save-agent-settings", async (_evt, opts = {}) => {
    const prior = readSetupState();
    const capabilities = {
      ...(prior.capabilities || {}),
      ...(opts.capabilities && typeof opts.capabilities === "object" ? opts.capabilities : {}),
    };
    const next = {
      ...prior,
      capabilities,
      permission: opts.permission || prior.permission || "ask",
      optIn: opts.optIn !== undefined ? !!opts.optIn : prior.optIn,
    };
    writeSetupState(next);
    try {
      await syncCapabilities(
        () => readSetupState(),
        postDesktopApi,
        (patch) => writeSetupState({ ...readSetupState(), ...patch }),
      );
    } catch (err) {
      console.warn("[denizen-desktop] save-agent-settings sync failed:", err?.message || err);
    }
    return { ok: true, capabilities };
  });



  ipcMain.handle("get-node-profile", async () => {

    const setup = readSetupState();

    return {

      enabled: !!setup.completed,

      mode: "desktop",

      permission: setup.permission || "ask",

      serverUrl: setup.serverUrl || null

    };

  });

  ipcMain.handle("get-update-status", async () => getUpdateStatus());

  ipcMain.handle("check-for-updates", async () => checkForUpdates());

  ipcMain.handle("install-update", async () => installDownloadedUpdate());

  ipcMain.handle("get-app-info", async () => getAppInfo());

  ipcMain.handle("set-diagnostics-opt-in", async (_evt, optIn) => {
    const setup = readSetupState();
    writeSetupState({ ...setup, diagnosticsOptIn: !!optIn });
    return { ok: true, diagnosticsOptIn: !!optIn };
  });

  ipcMain.handle("get-recent-crashes", async (_evt, limit) => ({

    ok: true,

    crashes: readRecentCrashes(limit)

  }));

  ipcMain.handle("send-feedback", async (_evt, opts = {}) => {

    const message = String(opts.message || opts.detail || "").trim();

    if (!message) {

      return { ok: false, error: "Message required" };

    }

    try {

      return await submitDesktopFeedback({

        event: opts.event,

        message,

        attachRecentCrashes: !!opts.attachRecentCrashes,

        recentCrashLimit: opts.recentCrashLimit

      });

    } catch (err) {

      return { ok: false, error: err?.message || String(err) };

    }

  });

}



function getAppInfo() {

  return {

    version: APP_VERSION,

    platform: process.platform,

    channel: UPDATE_CHANNEL,

    arch: process.arch

  };

}



function createTrayIcon() {

  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVQ4T2NkYGAQYcAP3uCTZhw1gGGYhAGBZIIynGgNAF8U8kW+Eo1B9AAAAABJRU5ErkJggg==";

  const img = nativeImage.createFromDataURL(dataUrl);

  if (img.isEmpty()) return nativeImage.createEmpty();

  return img.resize({ width: 16, height: 16 });

}



async function openDenizenWindow() {

  if (mainWindow && !mainWindow.isDestroyed()) {

    if (mainWindow.isMinimized()) mainWindow.restore();

    mainWindow.show();

    mainWindow.focus();

    return;

  }



  const setup = readSetupState();

  if (!setup.completed) {

    await createWindow(WIZARD_ENTRY);

    return;

  }



  const target = await ensureDenizenServer();

  await createWindow(`${target.url}?layout=openplan&desktop=1`);

}



async function openFeedbackDialog() {

  if (feedbackWindow && !feedbackWindow.isDestroyed()) {

    feedbackWindow.focus();

    return;

  }



  feedbackWindow = new BrowserWindow({

    width: 440,

    height: 400,

    resizable: false,

    minimizable: false,

    maximizable: false,

    show: false,

    parent: mainWindow || undefined,

    modal: !!mainWindow,

    webPreferences: {

      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,

      nodeIntegration: false

    }

  });



  feedbackWindow.on("closed", () => {

    feedbackWindow = null;

  });



  await feedbackWindow.loadFile(FEEDBACK_DIALOG);

  feedbackWindow.show();

}



function setupTray() {

  if (tray instanceof Tray) {

    tray.destroy();

  }



  tray = new Tray(createTrayIcon());

  tray.setToolTip("Denizen");



  const menu = Menu.buildFromTemplate([

    {

      label: "Open Denizen",

      click: () => {

        void openDenizenWindow();

      }

    },

    {

      label: "Check for updates",

      click: () => {

        void triggerUpdateCheck();

      }

    },

    {

      id: "restart-update",

      label: "Restart to finish update",

      visible: false,

      click: () => {

        installDownloadedUpdate();

      }

    },

    {

      label: "Send feedback",

      click: () => {

        void openFeedbackDialog();

      }

    },

    { type: "separator" },

    {

      label: `Version ${APP_VERSION}`,

      enabled: false

    },

    { type: "separator" },

    {

      label: "Quit",

      click: () => {

        app.quit();

      }

    }

  ]);



  tray.setContextMenu(menu);

  restartUpdateMenuItem = menu.getMenuItemById("restart-update");

  tray.on("double-click", () => {

    void openDenizenWindow();

  });

}

function updateTrayUpdateStatus(status) {

  if (!restartUpdateMenuItem) return;

  restartUpdateMenuItem.visible = status?.status === "downloaded";

}



async function triggerUpdateCheck() {

  return checkForUpdates();

}



function setupTrayStub() {

  setupTray();

}



async function createWindow(start) {

  mainWindow = new BrowserWindow({

    width: 1280,

    height: 800,

    minWidth: 760,

    minHeight: 640,

    backgroundColor: "#071113",

    title: "Denizen",

    webPreferences: {

      preload: path.join(__dirname, "preload.js"),

      contextIsolation: true,

      nodeIntegration: false

    }

  });



  if (isHttpUrl(start)) {

    await mainWindow.loadURL(String(start));

  } else if (start && typeof start === "object" && start.file) {

    await mainWindow.loadFile(start.file, { query: start.query || {} });

  } else {

    await mainWindow.loadFile(String(start || WIZARD_ENTRY));

  }

  setMainWindow(mainWindow);

}



async function capturePrimaryScreenPng() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.size || { width: 1920, height: 1080 };
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });
  const primary = sources[0];
  if (!primary?.thumbnail) {
    throw new Error("No screen source available");
  }
  return primary.thumbnail.toPNG();
}

stationAgent.setCaptureScreen(capturePrimaryScreenPng);

app.whenReady().then(async () => {

  registerProtocolHandler();

  setupIpc();

  setupTrayStub();



  const protocolArg = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));

  if (protocolArg) {

    await handleDenizenProtocolUrl(protocolArg);

    return;

  }



  const setup = readSetupState();

  if (!setup.completed) {

    await createWindow(WIZARD_ENTRY);

  } else {

    const target = await ensureDenizenServer();

    await createWindow(`${target.url}?layout=openplan&desktop=1`);

    maybeStartWorkerLoop();

  }

  if (app.isPackaged) {
    const setup = readSetupState();
    if (setup.completed) {
      initAutoUpdater({
        mainWindow,
        channel: setup.updateChannel,
        onStatusChange: updateTrayUpdateStatus
      });
    }
  }

  app.on("activate", () => {

    if (BrowserWindow.getAllWindows().length === 0) {

      void createWindow(WIZARD_ENTRY);

    }

  });

});



app.on("open-url", (event, url) => {

  event.preventDefault();

  void handleDenizenProtocolUrl(url);

});



app.on("second-instance", (_event, argv) => {

  const protocolArg = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));

  if (protocolArg) {

    void handleDenizenProtocolUrl(protocolArg);

  }

  if (mainWindow && !mainWindow.isDestroyed()) {

    if (mainWindow.isMinimized()) mainWindow.restore();

    mainWindow.focus();

  }

});



app.on("window-all-closed", () => {

  if (process.platform !== "darwin") {

    app.quit();

  }

});



app.on("before-quit", () => {

  stopWorkerLoop();
  stopStationTaskLoop();
  ollamaManager.stopOllama();
  llamaServerManager.stopLlamaServer();

  if (denizenServerProcess && !denizenServerProcess.killed) {

    denizenServerProcess.kill();

  }

  if (tray instanceof Tray) {

    tray.destroy();

  }

});

