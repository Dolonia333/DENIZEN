const { app } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");

const SETUP_FILE = path.join(app.getPath("userData"), "denizen-desktop-setup.json");
const STARTUP_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let mainWindowRef = null;
let checkTimer = null;
let startupTimer = null;

const updateState = {
  status: "idle",
  version: null,
  message: null
};

function readSetupChannel() {
  try {
    const setup = JSON.parse(fs.readFileSync(SETUP_FILE, "utf8"));
    const channel = String(setup.updateChannel || "").trim().toLowerCase();
    if (channel === "stable" || channel === "beta") {
      return channel;
    }
  } catch (_) {
    // ignore missing or invalid setup file
  }
  return null;
}

function resolveChannel(explicitChannel) {
  const fromEnv = String(process.env.DENIZEN_UPDATE_CHANNEL || "").trim().toLowerCase();
  if (fromEnv === "stable" || fromEnv === "beta") {
    return fromEnv;
  }

  const fromSetup = readSetupChannel();
  if (fromSetup) {
    return fromSetup;
  }

  const normalized = String(explicitChannel || "").trim().toLowerCase();
  if (normalized === "stable" || normalized === "beta") {
    return normalized;
  }

  return "stable";
}

function setUpdateState(status, { version = null, message = null } = {}) {
  updateState.status = status;
  updateState.version = version;
  updateState.message = message;
}

function sendUpdateStatus(payload) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return;
  }

  mainWindowRef.webContents.send("update-status", {
    status: payload.status,
    version: payload.version ?? null,
    message: payload.message ?? null
  });
}

function emitUpdateStatus(status, extras = {}) {
  setUpdateState(status, extras);
  sendUpdateStatus({
    status,
    version: extras.version ?? updateState.version,
    message: extras.message ?? updateState.message
  });
}

function logUpdate(event, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[denizen-desktop:auto-updater] ${event}${suffix}`);
}

async function runUpdateCheck() {
  if (!app.isPackaged) {
    return;
  }

  emitUpdateStatus("checking", { message: "Checking for updates..." });

  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    const message = err?.message || String(err);
    logUpdate("error", message);
    emitUpdateStatus("error", { message });
  }
}

function schedulePeriodicChecks() {
  if (checkTimer) {
    clearInterval(checkTimer);
  }

  checkTimer = setInterval(() => {
    void runUpdateCheck();
  }, CHECK_INTERVAL_MS);
}

function bindAutoUpdaterEvents() {
  autoUpdater.on("checking-for-update", () => {
    emitUpdateStatus("checking", { message: "Checking for updates..." });
  });

  autoUpdater.on("update-available", (info) => {
    const version = info?.version || null;
    logUpdate("update-available", version ? `v${version}` : "");
    emitUpdateStatus("available", {
      version,
      message: version ? `Update v${version} available` : "Update available"
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    const version = info?.version || null;
    emitUpdateStatus("not-available", {
      version,
      message: "You are on the latest version"
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress?.percent || 0);
    emitUpdateStatus("downloading", {
      version: updateState.version,
      message: `Downloading update (${percent}%)`
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    const version = info?.version || null;
    logUpdate("update-downloaded", version ? `v${version}` : "");
    emitUpdateStatus("downloaded", {
      version,
      message: version
        ? `Update v${version} downloaded. It will install on quit.`
        : "Update downloaded. It will install on quit."
    });
  });

  autoUpdater.on("error", (err) => {
    const message = err?.message || String(err);
    logUpdate("error", message);
    emitUpdateStatus("error", { message });
  });
}

function initAutoUpdater({ mainWindow, channel } = {}) {
  if (!app.isPackaged) {
    logUpdate("skipped", "(development mode)");
    return;
  }

  mainWindowRef = mainWindow || null;

  const resolvedChannel = resolveChannel(channel);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.channel = resolvedChannel === "beta" ? "beta" : null;

  logUpdate("channel", resolvedChannel);

  bindAutoUpdaterEvents();

  if (startupTimer) {
    clearTimeout(startupTimer);
  }

  startupTimer = setTimeout(() => {
    void runUpdateCheck();
  }, STARTUP_DELAY_MS);

  schedulePeriodicChecks();
}

function getUpdateStatus() {
  return {
    status: updateState.status,
    version: updateState.version,
    message: updateState.message
  };
}

function checkForUpdates() {
  if (!app.isPackaged) {
    return Promise.resolve({
      status: "idle",
      version: null,
      message: "Updates are disabled in development"
    });
  }

  return runUpdateCheck().then(() => getUpdateStatus());
}

function setMainWindow(mainWindow) {
  mainWindowRef = mainWindow || null;
}

module.exports = {
  initAutoUpdater,
  getUpdateStatus,
  checkForUpdates,
  setMainWindow
};
