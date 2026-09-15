# Visitor UI — compute, credits, and mobile panels

Browser-side overlays for visitor sessions: account profile, compute contribution, credits HUD, desktop pairing, and mesh job monitoring. All modules are IIFE scripts with no ES imports; they attach globals and load from `index.html` (core) or `denizen-lazy-scripts.js` (deferred panels).

## Script load order

```
device-profile.js          → html classes + CSS vars (first)
mobile-sidebar.js          → touch drawer shell
visitor-session.js         → session auth
visitor-account-panel.js   → top-right Me panel
visitor-node-ui.js         → bottom-left compute panel
denizen-phone-ui.js        → Buzz phone — the only toolbar
denizen-lazy-scripts.js    → mesh-jobs-panel, visitor-desktop-pairing, visitor-credits-chip, …
```

## Module map

| File | Global | DOM root | Role |
|------|--------|----------|------|
| `visitor-node-ui.js` | `DenizenNodeUI` | `#denizen-node-ui-chip` | Credits, tier, fleet metrics, compute opt-in, contribution level, desktop pairing CTA |
| `visitor-account-panel.js` | `DenizenAccountPanel` | `#denizen-account-panel` | Display name, email, logout, contribution summary |
| `visitor-credits-chip.js` | `DenizenVisitorCreditsChip` | `#denizen-visitor-credits-chip` | Compact credits + super-node badge (bottom-left) |
| `visitor-desktop-pairing.js` | `DenizenDesktopPairing` | `#denizen-desktop-pairing-modal` | Browser modal → `denizen://pair` deep link |
| `mesh-jobs-panel.js` | `DenizenMeshJobs` | `#denizen-mesh-jobs-chip` / `#denizen-mesh-jobs-panel` | Fleet nodes, pending/running jobs, recent completions |
| `mobile-sidebar.js` | `DenizenMobileSidebar` | `#denizen-mobile-drawer` | Full-screen drawer on touch devices |
| `device-profile.js` | `DenizenDeviceProfile` | `<html>` classes | Phone / tablet / desktop detection + panel sizing |
| `denizen-phone-ui.js` | `DenizenPhoneUi` | `#denizen-phone-shell` | Phone HUD; opens every tool through its module API |

## visitor-node-ui.js

Primary compute / credits / fleet UI. Fixed panel bottom-left, collapsible with a restore tab.

**Data sources:** `/api/compute/node/status`, `/api/desktop/capabilities/sync`, visitor session APIs.

**State highlights** (`DenizenNodeUI.getState()`):

- `credits`, `tier`, `isSuperNode`
- `optedIn`, `contributing`, `contributorState` (`browser_only`, `desktop_linked`, `contributing`, …)
- `needsDesktopDownload`, `desktopLinked`, `canContribute`
- `fleet[]` — live CPU/RAM/GPU per machine
- `contributionLevel` — `off` / `ask` / `trusted`

**Public API:** `init`, `refresh`, `setOptIn`, `setContributionLevel`, `hidePanel`, `showPanel`, `togglePanel`, `expandForDrawer` (used by mobile drawer).

Polls every 30s; live fleet metrics every 10s when expanded.

## visitor-account-panel.js

Top-right **Me** chip. Shows identity, expandable stats (credits, jobs completed from `DenizenNodeUI`), and logout via `DenizenVisitorSession.logout()`.

On desktop: fixed overlay. On mobile drawer mode: relocated into the drawer **Profile** tab.

## visitor-credits-chip.js

Lightweight HUD: `Credits: N` plus optional **Super Node** badge. Subscribes to `DenizenNodeUI` state; lazy-loaded. Hidden when `denizen-mobile-drawer-mode` is active (credits shown in drawer subtitle instead).

## visitor-desktop-pairing.js

Modal workflow to link Denizen Desktop:

1. `GET /api/desktop/pairing/create` (session auth)
2. Builds `denizen://pair?token=…&server=…`
3. Opens deep link (or shows copy instructions)
4. Polls pairing status until desktop claims token

Invoked from `DenizenNodeUI` when `needsDesktopDownload` / link-desktop CTA is shown.

## mesh-jobs-panel.js

Operational view of the compute mesh. Polls `/api/compute/node/status` (public) and enriches fleet from `/api/health`.

**Open the panel:**

| Method | Example |
|--------|---------|
| URL query | `?mesh=1` or `?mesh=open` (auto-opens on init) |
| Phone | **Power Grid** app (badge = waiting + running jobs) |
| Console | `DenizenMeshJobs.show()` / `.toggle()` / `.hide()` |

Panel lists pending/running jobs, recent completions, and fleet CPU/RAM. Chip color reflects idle vs busy.

## device-profile.js — phone panel shell

Detects touch vs desktop and sets `<html>` classes:

| Class | When |
|-------|------|
| `denizen-touch` | Coarse pointer or touch device |
| `denizen-phone` | Touch + short edge &lt; 520px |
| `denizen-tablet` | Touch, not phone |
| `denizen-desktop` | No touch |
| `denizen-compact-phone` | Phone + short edge &lt; 376px |

Sets CSS variables: `--denizen-short-edge`, `--denizen-long-edge`, `--denizen-panel-max-width`.

**Phone panel shell:** on `denizen-touch.denizen-phone`, full-screen panels (`#denizen-mesh-jobs-panel`, LLM telemetry, proposals, diag, browser mirror) get inset safe-area positioning.

Dispatches `denizen-device-profile-change` on resize/orientation change.

## mobile-sidebar.js

Touch-only drawer (`denizen-mobile-drawer-mode` on `<html>`):

- **Menu button** — bottom-left hamburger (`#denizen-mobile-menu-btn`)
- **Tabs** — Profile | Compute
- **Relocates** `#denizen-account-panel` and `#denizen-node-ui-chip` into the drawer body
- Hides floating credits chip and node-ui restore tab while drawer mode is active

## denizen-phone-ui.js — apps

The phone is the only toolbar (the old `bottom-dock.js` is gone). Each app in
`APPS` calls its tool module's public API — nothing clicks hidden chips:

| App | Module API |
|-----|------------|
| Chat | `__DenizenPlayerChat.open()` / `.close()` |
| Voice | `DenizenVoiceSession` / `DenizenVoiceCallUi` / `DenizenVoiceInput` |
| Walk-up | `DenizenTogglePresence()` |
| Listen-in | `DenizenProximityAudio.cycleFromUi()` / `.getAudioMode()` |
| Health | `DenizenDiag.show()` / `.hide()` |
| LM Stats | `DenizenLlmTelemetry.show()` / `.hide()` |
| Power Grid | `DenizenMeshJobs.show()` / `.hide()` / `.badgeCount()` |
| Approvals | `DenizenProposals.show()` / `.hide()` / `.pendingCount()` |
| Newsroom | `DenizenContentPipelinePanel.show()` / `.hide()` / `.activeCount()` |
| Browser | `DenizenBrowserMirror.show()` / `.hide()` |
| Security | `DenizenSecurityFeed.show()` / `.hide()` |
| Office Tour | `DenizenVisitorOnboarding.replay()` |

The tool modules still create their toggle chips (`#player-chat-fab`,
`#denizen-mic-button`, `#denizen-diag-chip`, …); phone mode hides them. With
`?phonemode=0` (debug only) the phone is skipped and those chips show at their
own fallback positions.

## Mobile vs desktop behavior

| Feature | Desktop | Mobile (touch) |
|---------|---------|----------------|
| Account panel | Fixed top-right | Inside drawer **Profile** tab |
| Compute panel (`DenizenNodeUI`) | Fixed bottom-left | Inside drawer **Compute** tab |
| Credits chip | Bottom-left pill | Hidden; credits in drawer subtitle |
| Mesh jobs | Phone **Power Grid** → panel inside the phone | Same, inside the phone screen |
| Pairing modal | Centered modal | Same modal; safe-area aware |
| Panel max width | ~580px | Phone: up to ~440px; tablet: ~540px |

## Related docs

- [COMPUTE_MESH.md](COMPUTE_MESH.md) — mesh queue, fleet agents, APIs
- [desktop/README.md](../desktop/README.md) — Electron contributor node
- [VISITOR_ONBOARDING.md](VISITOR_ONBOARDING.md) — first-run visitor flow
