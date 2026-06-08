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

Output: `desktop/dist/Denizen-Setup.exe` (NSIS installer, `appId` `com.dolonia.denizen`).

Other targets:

```bash
npm run build          # all configured targets for current platform
```

Serve the installer from the Denizen web root so the download page can link to `/desktop/dist/Denizen-Setup.exe`.

## Release

Desktop builds are published via GitHub Actions (`.github/workflows/desktop-release.yml`) and manual upload to the update server.

### Tag a release

Stable:

```bash
git tag desktop-v0.1.1
git push origin desktop-v0.1.1
```

Beta (uses `-beta` suffix and `DENIZEN_UPDATE_CHANNEL=beta` in CI):

```bash
git tag desktop-v0.1.1-beta
git push origin desktop-v0.1.1-beta
```

Tag pushes build Windows, macOS, and Linux installers in parallel, upload per-OS artifacts, and create a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github) with all installers attached.

You can also run the workflow manually from **Actions → Desktop Release → Run workflow** and choose `stable` or `beta` (build only; no GitHub Release unless triggered by a tag).

### CI secrets

No repository secrets are required for the default workflow. GitHub Actions provides `GITHUB_TOKEN` automatically for creating releases.

If you publish to GitHub from a local machine with `electron-builder --publish always`, set a personal access token in the environment as `GH_TOKEN` (repo scope). Do not commit tokens to the repo.

### Upload to the update server

After a local or CI build, stage files for the generic update feed:

```powershell
cd denizen/desktop
npm run build:win   # or build:mac / build:linux on each platform
.\scripts\publish-update-manifest.ps1 -Channel stable
```

This copies `dist/*` and `latest*.yml` manifests into `updates-publish/<channel>/`. Upload the **contents** of that folder (flat) to:

`https://denizen.dolonia.cloud/desktop/updates/`

The desktop app checks that URL for auto-updates (`electron-updater`). Stable uses `latest.yml`; beta uses `latest-beta.yml`.

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
