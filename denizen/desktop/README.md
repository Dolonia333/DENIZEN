# Denizen Desktop

Local Denizen app with a setup wizard that links your machine to your Denizen account.

## What the desktop app does

1. **Profiles real hardware** — CPU, RAM, platform (not browser guesses).
2. **Setup wizard** — server URL, session link, permission level (`off` / `ask` / `trusted`).
3. **Syncs to server** — `POST /api/desktop/wizard/complete` stores capabilities on your identity.
4. **Contributor node** — optional compute opt-in after approvals.

## Browser vs desktop

| Client | Can profile machine? | Can contribute compute? |
|--------|----------------------|-------------------------|
| Browser only | No | No — shows download CTA |
| Denizen Desktop | Yes | Yes, after wizard + opt-in |
| Host (local server + LM Studio) | Server-side | Yes, as host node |

## Run

```bash
cd desktop
npm install
npm start
```

First launch opens the setup wizard. Paste your `session_id` from browser login (`localStorage` → `denizen-visitor-session`).

## Build Windows installer

Requires Node.js and npm on Windows (or cross-compile from another OS with Wine/NSIS for full NSIS builds).

```bash
cd desktop
npm install
npm run build:win
```

Output: `desktop/dist-build/Denizen-Setup.exe` (NSIS installer, `appId` `com.dolonia.denizen`).

Other targets:

```bash
npm run build          # all configured targets for current platform
```

Serve the installer from the Denizen web root so the download page can link to `/desktop/dist-build/Denizen-Setup.exe`.

## Architecture

Electron main process, preload bridge, and background workers. The renderer (wizard or game) talks to the OS only through `window.DenizenDesktop` IPC.

```
┌─────────────────────────────────────────────────────────────────┐
│  main.js (Electron main)                                        │
│  · spawn embedded Denizen server if none on :8081               │
│  · system tray + auto-updater (packaged builds)                 │
│  · denizen:// deep-link handler (pairing)                       │
│  · permission-prompt.html + feedback-dialog windows             │
│  · node-worker-loop (capabilities sync + compute + permissions) │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ preload.js (contextBridge)      │ child process
                ▼                                 ▼
        window.DenizenDesktop              ../server.js (optional)
                │
        setup-wizard.html / index.html?desktop=1
```

### main.js

Entry point (`package.json` → `"main": "main.js"`). Responsibilities:

| Concern | Behavior |
|---------|----------|
| **Single instance** | `app.requestSingleInstanceLock()` — second launch focuses existing window and forwards `denizen://` URLs via `second-instance`. |
| **Embedded server** | `ensureDenizenServer()` probes `GET /api/health` on ports from `PORT` / `DENIZEN_PORT` / `8081` / `8080`. If none respond, spawns `../server.js` with `stdio: "inherit"`. Falls back to `file://` game HTML if the server never becomes healthy. |
| **Setup vs game** | First run loads `setup-wizard.html`. After `completed: true` in setup state, loads `{serverUrl}?layout=openplan&desktop=1` and starts the worker loop. |
| **System tray** | `setupTray()` — Open Denizen, Check for updates, Send feedback, version label, Quit. Double-click opens the main window. |
| **`denizen://` deep links** | Registered via `app.setAsDefaultProtocolClient("denizen")` and `build.protocols` in `package.json`. `handleDenizenProtocolUrl()` parses `denizen://pair?token=…&server=…`, stores pending token, and opens the wizard with pairing pre-filled. macOS uses `open-url`; Windows/Linux use argv on cold start or `second-instance`. |
| **Permission UI** | `openPermissionPrompt()` — dedicated `permission-prompt.html` window, or forwards to wizard if setup is incomplete. |
| **IPC** | `setupIpc()` registers all `ipcMain.handle` channels consumed by `preload.js`. |

### preload.js — `window.DenizenDesktop` IPC API

Context-isolated bridge (`contextBridge.exposeInMainWorld`). All methods return Promises unless noted.

| Method | IPC channel | Purpose |
|--------|-------------|---------|
| `version` | — (sync) | npm package version string |
| `platform` | — (sync) | `process.platform` |
| `isDesktop` | — (sync) | always `true` |
| `openAgentSettings()` | `open-agent-settings` | Open OS agent / permission settings |
| `getNodeProfile()` | `get-node-profile` | Contributor node profile from server |
| `getMachineProfile()` | `get-machine-profile` | Local CPU/RAM/GPU profile (`node-profiler.js`) |
| `completeSetupWizard(opts)` | `complete-setup-wizard` | Finish wizard → `POST /api/desktop/wizard/complete`, write setup state |
| `openGame()` | `open-game` | Navigate main window to game after wizard |
| `claimPairingToken(tokenOrOpts)` | `claim-pairing-token` | Claim browser pairing token → session id/token |
| `getPairingStatus()` | `get-pairing-status` | Current pairing claim state |
| `getPendingPermission()` | `get-pending-permission` | Poll server for outstanding permission request |
| `openOsPermissionSettings()` | `open-os-permission-settings` | Open OS privacy/security settings |
| `respondPermission(opts)` | `respond-permission` | Approve/deny `{ requestId, approved }` |
| `sendFeedback(opts)` | `send-feedback` | `POST /api/desktop/feedback` |
| `checkForUpdates()` | `check-for-updates` | Trigger `electron-updater` check |
| `installUpdate()` | `install-update` | Restart and install a downloaded update |
| `getAppInfo()` | `get-app-info` | Version, channel, platform metadata |
| `setDiagnosticsOptIn(optIn)` | `set-diagnostics-opt-in` | Toggle crash auto-submit in setup state |
| `onPermissionPending(callback)` | `permission-pending` (event) | Subscribe to permission pushes; returns unsubscribe fn |

### node-worker-loop.js

Background loop started by `maybeStartWorkerLoop()` after wizard completion:

1. **Capabilities sync** (every 60s) — `POST /api/desktop/capabilities/sync` with live metrics from `node-profiler.js`. Patches `nodeId` / `nodeToken` into setup state when the server returns a compute node.
2. **Compute bootstrap** — if `optIn` and tokens present, registers via `compute-worker.js` and starts claim/complete polling.
3. **Permission poll** (every 5s) — `GET /api/desktop/permission/pending`; new requests invoke `onPermissionPending` → `openPermissionPrompt()`.

`stopWorkerLoop()` runs on `before-quit`.

### denizen-src.js — dev vs packaged

`scripts/copy-denizen-src.js` runs on `prestart` / `prebuild` and copies shared modules from `denizen/src/` into `desktop/src/`:

- `denizen-hardware-monitor.js`
- `denizen-node-client.js`
- `denizen-mesh-job-runner.js`

| Mode | Module resolution |
|------|-------------------|
| **Dev** (`npm start`) | Prestart copies fresh files; `compute-worker.js` requires `./src/denizen-*`. |
| **Packaged** (`electron-builder`) | Prebuild copies into the asar; same `./src/` paths inside the bundle. |

If you see `Cannot find module '../src/denizen-hardware-monitor'`, rebuild the installer — the copy step did not run or the asar is stale.

### Persistent state — `%APPDATA%/Denizen/denizen-desktop-setup.json`

Path: `app.getPath("userData")` + `denizen-desktop-setup.json` (Windows: `%APPDATA%\Denizen\denizen-desktop-setup.json`).

Written by `writeSetupState()` on wizard complete and patched by the worker loop / diagnostics IPC.

| Field | Purpose |
|-------|---------|
| `completed` | Wizard finished |
| `serverUrl` | Denizen server base URL |
| `sessionId` / `sessionToken` | Linked visitor session |
| `permission` | `off` / `ask` / `trusted` |
| `optIn` | Compute contribution enabled |
| `capabilities` | `{ read_files, write_files, run_code, screen_access, contribute_compute }` |
| `desktopInstallId` | Server-assigned install id |
| `identityId` | Linked identity |
| `nodeId` / `nodeToken` | Compute mesh node credentials |
| `diagnosticsOptIn` | Auto-submit crash reports |
| `updateChannel` | `stable` or `beta` |
| `completedAt` | Unix ms timestamp |

### permission-prompt.html flow

When the server enqueues a permission request and `agent_permission_level` is `ask`:

1. `node-worker-loop.js` polls `/api/desktop/permission/pending`.
2. `main.js` → `openPermissionPrompt(pending)` opens a small frameless `BrowserWindow` loading `permission-prompt.html` (or forwards to wizard if setup incomplete).
3. The page calls `getPendingPermission()` on load and listens via `onPermissionPending`.
4. User clicks **Yes** / **No** → `respondPermission({ requestId, approved })` → `POST /api/desktop/permission/respond` → window closes.

If permission level is `trusted`, the server auto-approves; the desktop loop never surfaces a prompt.

### Build output — `dist-build/` not `dist/`

`package.json` → `build.directories.output` is **`dist-build`**. Older docs or local folders may still reference `dist/`; CI and `publish-update-manifest.ps1` use `dist-build/`.

```
desktop/dist-build/
  Denizen-Setup.exe          # NSIS installer (Windows)
  latest.yml                 # electron-updater manifest (stable)
  win-unpacked/              # unpacked app for testing
```

### Desktop smoke tests

Run from `denizen/` with the server up (`DENIZEN_URL`, default `http://127.0.0.1:8081`):

```powershell
node scripts/smoke-desktop-onboarding.js   # pairing, wizard, permission ask/trusted, capabilities sync
node scripts/smoke-desktop-feedback.js     # POST /api/desktop/feedback
node scripts/smoke-desktop-release.js      # package.json + workflow + files sanity; runs feedback smoke
```

| Script | Checks |
|--------|--------|
| `smoke-desktop-onboarding.js` | Demo session, `denizen://pair` token create/claim/replay-403, permission enqueue/respond/clear, wizard complete, capabilities sync, trusted auto-approve |
| `smoke-desktop-feedback.js` | Feedback POST with session + install metadata |
| `smoke-desktop-release.js` | `electron-updater` dependency, GitHub Releases provider, all platform jobs, workflow + auto-updater + crash-reporter files; delegates to feedback smoke |

## Release

Desktop builds and updater manifests are published together through GitHub Actions (`.github/workflows/desktop-release.yml`) and GitHub Releases.

### Tag a release

Stable:

```bash
git tag v0.1.4
git push origin v0.1.4
```

Beta:

```bash
git tag v0.1.5-beta.1
git push origin v0.1.5-beta.1
```

Tag pushes build Windows, macOS, and Linux installers in parallel, upload per-OS artifacts, and create a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github) with all installers attached.

The desktop workflow listens to `v0.*` tags so it does not run for the main platform's `v1.*` releases.

You can also run the workflow manually from **Actions -> Desktop Release -> Run workflow** to verify all three platform builds. Manual runs create build artifacts but do not create a GitHub Release.

### CI secrets

No repository secrets are required for the default workflow. GitHub Actions provides `GITHUB_TOKEN` automatically for creating releases.

If you publish to GitHub from a local machine with `electron-builder --publish always`, set a personal access token in the environment as `GH_TOKEN` (repo scope). Do not commit tokens to the repo.

The release must include `latest.yml`, `latest-linux.yml`, and `latest-mac.yml` beside the platform installers. `electron-updater` reads those assets directly from the public GitHub Release. Stable uses the latest non-prerelease release; beta users follow prerelease manifests.

## Diagnostics

Lightweight crash reporting with **no Sentry account required** (Sentry can be added later).

| Piece | Location | Behavior |
|-------|----------|----------|
| Crash log | `%APPDATA%/Denizen/crash-log.jsonl` (or platform `userData`) | Append-only JSONL for `uncaughtException` and `unhandledRejection` |
| Auto-submit | `crash-reporter.js` | If `diagnosticsOptIn` is true in setup state, crashes are sent as feedback `event: crash` |
| Manual feedback | Tray → **Send feedback** | `POST /api/desktop/feedback` includes `crash_log_tail` (last 2 KB of crash log) |
| Opt-in | `set-diagnostics-opt-in` IPC / setup state field `diagnosticsOptIn` | Off by default; user must enable automatic crash reports |

Inspect local crashes:

```bash
node -e "const {readRecentCrashes}=require('./crash-reporter'); console.log(readRecentCrashes(5))"
```

## Compute mesh worker

After the setup wizard and compute opt-in, the desktop app runs `compute-worker.js`:

1. Registers a compute node via `POST /api/compute/node/register`
2. Polls `POST /api/compute/node/claim` for jobs
3. Executes via `denizen-mesh-job-runner.js` (LM Studio on GPU hosts)
4. Completes via `POST /api/compute/node/complete` → credits awarded

Packaged builds bundle `denizen-src` modules (`denizen-hardware-monitor`, `denizen-node-client`, `denizen-mesh-job-runner`) via `scripts/copy-denizen-src.js` prebuild hook.

**Server URL:** the wizard discovers the Denizen port dynamically (default `8081` in the Dolonia lab). Reinstall from latest `Denizen-Setup.exe` if you see `Cannot find module '../src/denizen-hardware-monitor'`.

See [docs/COMPUTE_MESH.md](../docs/COMPUTE_MESH.md).

## API routes (server)

- `POST /api/desktop/register` — link install
- `POST /api/desktop/wizard/complete` — finish wizard
- `POST /api/desktop/capabilities/sync` — heartbeat capabilities
- `POST /api/desktop/feedback` — user feedback and optional `crash_log_tail`
- `POST /api/compute/node/*` — compute mesh (register, claim, complete)

All desktop requests send `X-Denizen-Client: desktop`.
