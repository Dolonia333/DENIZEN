const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DenizenDesktop", {
  version: process.env.npm_package_version || "0.1.0",
  platform: process.platform,
  isDesktop: true,
  openAgentSettings: () => ipcRenderer.invoke("open-agent-settings"),
  getNodeProfile: () => ipcRenderer.invoke("get-node-profile"),
  getMachineProfile: () => ipcRenderer.invoke("get-machine-profile"),
  completeSetupWizard: (opts) => ipcRenderer.invoke("complete-setup-wizard", opts),
  openGame: () => ipcRenderer.invoke("open-game"),
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
  onUpdateStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
  setDiagnosticsOptIn: (optIn) => ipcRenderer.invoke("set-diagnostics-opt-in", optIn),
  onPermissionPending: (callback) => {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("permission-pending", handler);
    return () => ipcRenderer.removeListener("permission-pending", handler);
  }
});
