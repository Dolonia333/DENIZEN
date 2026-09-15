'use strict';

const { BrowserWindow, ipcMain, screen, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let overlayWindow = null;
let enabled = false;
let invisible = true;

function overlayEntry() {
  return path.join(__dirname, 'buzz-overlay.html');
}

function destroyOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  overlayWindow = null;
}

function orbBounds() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workArea;
  const { x, y } = display.workArea;
  return { x: x + width - 92, y: y + height - 120, width: 80, height: 100 };
}

function applyMode(mode) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = screen.getPrimaryDisplay();
  if (mode === 'pick') {
    overlayWindow.setBounds(display.bounds);
    overlayWindow.setIgnoreMouseEvents(false);
    return;
  }
  if (mode === 'note') {
    const { x, y, width, height } = display.workArea;
    overlayWindow.setBounds({ x: x + width - 400, y: y + height - 480, width: 380, height: 460 });
    return;
  }
  if (mode === 'ring') {
    const { x, y, width, height } = display.workArea;
    overlayWindow.setBounds({ x: x + width - 250, y: y + height - 270, width: 240, height: 250 });
    return;
  }
  overlayWindow.setBounds(orbBounds());
}

function createOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.show();
    return overlayWindow;
  }
  overlayWindow = new BrowserWindow({
    ...orbBounds(),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  try { overlayWindow.setContentProtection(invisible); } catch (_) {}
  overlayWindow.loadFile(overlayEntry());
  overlayWindow.on('closed', () => { overlayWindow = null; });
  return overlayWindow;
}

function setEnabled(on) {
  enabled = !!on;
  if (enabled) createOverlay();
  else destroyOverlay();
  return enabled;
}

function setInvisible(on) {
  if (typeof on === 'boolean') invisible = on;
  else invisible = !invisible;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    try { overlayWindow.setContentProtection(invisible); } catch (_) {}
  }
  return invisible;
}

function isInvisible() {
  return invisible;
}

function saveCapturePng(pngBase64) {
  const dir = path.join(app.getPath('userData'), 'buzz-captures');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `buzz-${Date.now()}.png`);
  fs.writeFileSync(file, Buffer.from(String(pngBase64 || ''), 'base64'));
  return file;
}

function registerIpc(opts = {}) {
  ipcMain.handle('buzz-overlay-mode', async (_e, mode) => {
    applyMode(String(mode || 'orb'));
    return { ok: true };
  });
  ipcMain.handle('buzz-capture-screen', async () => {
    const capture = opts.captureScreen;
    if (typeof capture !== 'function') throw new Error('no capture');
    const png = await capture();
    return { ok: true, pngBase64: Buffer.from(png).toString('base64') };
  });
  ipcMain.handle('buzz-crop-screen', async (_e, rect = {}) => {
    const capture = opts.captureScreen;
    if (typeof capture !== 'function') throw new Error('no capture');
    const png = await capture();
    const image = nativeImage.createFromBuffer(png);
    const size = image.getSize();
    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor || 1;
    const x = Math.max(0, Math.round(Number(rect.x || 0) * scale));
    const y = Math.max(0, Math.round(Number(rect.y || 0) * scale));
    const width = Math.min(size.width - x, Math.round(Number(rect.width || size.width) * scale));
    const height = Math.min(size.height - y, Math.round(Number(rect.height || size.height) * scale));
    if (width < 4 || height < 4) {
      return { ok: true, pngBase64: png.toString('base64') };
    }
    const cropped = image.crop({ x, y, width, height });
    return { ok: true, pngBase64: cropped.toPNG().toString('base64') };
  });
  ipcMain.handle('buzz-session', async () => {
    const setup = typeof opts.readSetup === 'function' ? opts.readSetup() : {};
    return {
      serverUrl: String(setup.serverUrl || opts.defaultServerUrl || '').replace(/\/+$/, ''),
      sessionId: setup.sessionId || null,
      sessionToken: setup.sessionToken || null,
    };
  });
  ipcMain.handle('buzz-overlay-toggle', async (_e, on) => {
    if (typeof on === 'boolean') return { enabled: setEnabled(on) };
    return { enabled: setEnabled(!isEnabled()) };
  });
  ipcMain.handle('buzz-overlay-invisible', async (_e, on) => {
    return { invisible: setInvisible(on) };
  });
  ipcMain.handle('buzz-save-capture', async (_e, pngBase64) => {
    const file = saveCapturePng(pngBase64);
    return { ok: true, path: file };
  });
}

module.exports = {
  createOverlay,
  destroyOverlay,
  setEnabled,
  isEnabled,
  setInvisible,
  isInvisible,
  saveCapturePng,
  registerIpc,
  applyMode,
};
