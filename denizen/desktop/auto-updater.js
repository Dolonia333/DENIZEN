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
let statusListener = null;

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
  const payload = {
    status,
    version: extras.version ?? updateState.version,
    message: extras.message ?? updateState.message
  };
  sendUpdateStatus(payload);
  statusListener?.(payload);
}

function logUpdate(event, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`[denizen-desktop:auto-updater] ${event}${suffix}`);
}

function canCheckForUpdates() {
  return app.isPackaged
    && ["win32", "darwin", "linux"].includes(process.platform)
    && fs.existsSync(path.join(process.resourcesPath, "app-update.yml"));
}

function parseSemverParts(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isRemoteVersionNewer(remoteVersion, currentVersion = app.getVersion()) {
  const remote = parseSemverParts(remoteVersion);
  const current = parseSemverParts(currentVersion);
  if (!remote || !current) return false;
  for (let i = 0; i < 3; i += 1) {
    if (remote[i] > current[i]) return true;
    if (remote[i] < current[i]) return false;
  }
  return false;
}

function friendlyUpdateError(err) {
  const raw = err?.message || String(err);
  if (
    err?.code === "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND"
    || /cannot find channel/i.test(raw)
    || /latest(?:-linux|-mac)?[^\s]*\.ya?ml[^\n]*404/i.test(raw)
  ) {
    return "Updates are temporarily unavailable for this platform. Please try again later.";
  }
  if (/net::ERR_|ENOTFOUND|ETIMEDOUT|network/i.test(raw)) {
    return "Denizen could not reach the update service. Check your connection and try again.";
  }
  return "Denizen could not check for updates. Please try again later.";
}

async function runUpdateCheck() {
  if (!canCheckForUpdates()) {
    return;
  }

  emitUpdateStatus("checking", { message: "Checking for updates..." });

  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    logUpdate("error", err?.message || String(err));
    emitUpdateStatus("error", { message: friendlyUpdateError(err) });
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
    if (!isRemoteVersionNewer(version)) {
      logUpdate("skip-older-release", version ? `v${version} <= v${app.getVersion()}` : "(unknown)");
      emitUpdateStatus("not-available", {
        version: app.getVersion(),
        message: "You are on the latest version"
      });
      return;
    }
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
        ? `Update v${version} is ready. Restart Denizen to finish.`
        : "Your update is ready. Restart Denizen to finish."
    });
  });

  autoUpdater.on("error", (err) => {
    logUpdate("error", err?.message || String(err));
    emitUpdateStatus("error", { message: friendlyUpdateError(err) });
  });
}

function initAutoUpdater({ mainWindow, channel, onStatusChange } = {}) {
  if (!canCheckForUpdates()) {
    logUpdate("skipped", app.isPackaged ? "(release metadata unavailable)" : "(development mode)");
    return;
  }

  mainWindowRef = mainWindow || null;
  statusListener = typeof onStatusChange === "function" ? onStatusChange : null;

  const resolvedChannel = resolveChannel(channel);
  autoUpdater.allowDowngrade = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
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
  if (!canCheckForUpdates()) {
    return Promise.resolve({
      status: "idle",
      version: null,
      message: null
    });
  }

  return runUpdateCheck().then(() => getUpdateStatus());
}

function installDownloadedUpdate() {
  if (updateState.status !== "downloaded") {
    return { ok: false, error: "No downloaded update is ready to install." };
  }

  setTimeout(() => {
    autoUpdater.quitAndInstall(false, true);
  }, 150);
  return { ok: true };
}

function setMainWindow(mainWindow) {
  mainWindowRef = mainWindow || null;
}

module.exports = {
  initAutoUpdater,
  getUpdateStatus,
  checkForUpdates,
  installDownloadedUpdate,
  setMainWindow
};
