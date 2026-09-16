const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DenizenDesktop", {
  version: process.env.npm_package_version || "0.1.0",
  platform: process.platform,
  isDesktop: true,
  openAgentSettings: () => ipcRenderer.invoke("open-agent-settings"),
  getNodeProfile: () => ipcRenderer.invoke("get-node-profile"),
  getMachineProfile: () => ipcRenderer.invoke("get-machine-profile"),
  getInferenceStatus: () => ipcRenderer.invoke("get-inference-status"),
  getBrainCatalog: () => ipcRenderer.invoke("get-brain-catalog"),
  ensureOllama: () => ipcRenderer.invoke("ensure-ollama"),
  ensureLlamaCpp: () => ipcRenderer.invoke("ensure-llamacpp"),
  pullBrainModel: (opts) => ipcRenderer.invoke("pull-brain-model", opts),
  onBrainPullProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("brain-pull-progress", handler);
    return () => ipcRenderer.removeListener("brain-pull-progress", handler);
  },
  completeSetupWizard: (opts) => ipcRenderer.invoke("complete-setup-wizard", opts),
  openGame: () => ipcRenderer.invoke("open-game"),
  openPairingBrowser: () => ipcRenderer.invoke("open-pairing-browser"),
  getPairingBrowserUrl: () => ipcRenderer.invoke("get-pairing-browser-url"),
  claimPairingToken: (tokenOrOpts) => ipcRenderer.invoke("claim-pairing-token", tokenOrOpts),
  getPairingStatus: () => ipcRenderer.invoke("get-pairing-status"),
  getPendingPermission: () => ipcRenderer.invoke("get-pending-permission"),
  openOsPermissionSettings: () => ipcRenderer.invoke("open-os-permission-settings"),
  respondPermission: (opts) => ipcRenderer.invoke("respond-permission", opts),
  sendFeedback: (opts) => ipcRenderer.invoke("send-feedback", opts),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  getAppInfo: () => ipcRenderer.invoke("get-app-info"),
  getSetupState: () => ipcRenderer.invoke("get-setup-state"),
  saveAgentSettings: (opts) => ipcRenderer.invoke("save-agent-settings", opts),
  onStationTaskProgress: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("station-task-progress", handler);
    return () => ipcRenderer.removeListener("station-task-progress", handler);
  },
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
  setDiagnosticsOptIn: (optIn) => ipcRenderer.invoke("set-diagnostics-opt-in", optIn),
  buzzOverlayToggle: (on) => ipcRenderer.invoke("buzz-overlay-toggle", on),
  buzzOverlayMode: (mode) => ipcRenderer.invoke("buzz-overlay-mode", mode),
  buzzCaptureScreen: () => ipcRenderer.invoke("buzz-capture-screen"),
  buzzCropScreen: (rect) => ipcRenderer.invoke("buzz-crop-screen", rect),
  buzzSaveCapture: (pngBase64) => ipcRenderer.invoke("buzz-save-capture", pngBase64),
  buzzOverlayInvisible: (on) => ipcRenderer.invoke("buzz-overlay-invisible", on),
  buzzSession: () => ipcRenderer.invoke("buzz-session"),
  detectSeatAi: () => ipcRenderer.invoke("detect-seat-ai"),
  onPermissionPending: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("permission-pending", handler);
    return () => ipcRenderer.removeListener("permission-pending", handler);
  }
});
