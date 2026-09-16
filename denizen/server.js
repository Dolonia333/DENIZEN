require('./src/load-env');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const SecurityMonitorServer = require('./security-monitor-server');
const CofounderAgent = require('./src/cofounder-agent');
const NpcBrainManager = require('./src/npc-brains');
const ambientDialogue = require('./src/ambient-dialogue');
const npcPeerWorkStatus = require('./src/npc-peer-work-status');
const promptTuning = require('./src/prompt-tuning');
const worldState = require('./src/world-state');
const agentBus = require('./src/agent-bus');
const ExternalSink = require('./src/external-sink');
const elevenLabs = require('./src/elevenlabs-tts');
const voiceBridge = require('./src/denizen-voice-bridge.js');
const { createSentenceStream } = require('./src/voice-sentence.js');
const animationForge = require('./src/animation-forge');
const soulReflection = require('./src/soul-reflection');
const npcRoster = require('./src/npc-roster');
const npcCapabilities = require('./src/npc-capabilities');
const voiceResolve = require('./src/voice-resolve');
const capabilityProposal = require('./src/capability-proposal');
const emailHandler = require('./src/email-handler');
const gmailClient = require('./src/gmail-client');
const llmTelemetry = require('./src/llm-telemetry');
const denizenDb = require('./src/denizen-db');
const denizenNpcStats = require('./src/office-hq/denizen-npc-stats');
const denizenOfficeProgress = require('./src/office-hq/denizen-office-progress');
const denizenQuests = require('./src/office-hq/denizen-quests');
const denizenAchievements = require('./src/office-hq/denizen-achievements');
const orgPolicy = require('./src/denizen-org-policy');
const denizenVisitor = require('./src/denizen-visitor');
const visitorAccess = require('./src/visitor-access');
const sessionAuth = require('./src/visitor-session-auth');
const sessionCookie = require('./src/visitor-session-cookie');
const teamAuth = require('./src/denizen-team-auth');
const guildOrg = require('./src/denizen-guild-org');
const mapAccess = require('./src/denizen-map-access');
const userIdentity = require('./src/denizen-user-identity');
const userPosition = require('./src/denizen-user-position.js');
const invitePlatform = require('./src/denizen-invite-platform.js');
const visitorOfficeContext = require('./src/visitor-office-context');
const officeRegistry = require('./src/visitor-office-registry');
const officeLayout = require('./src/visitor-office-layout');
const officeBus = require('./src/office-bus');
const visitorConnections = require('./src/visitor-connections');

function npcFolderToDisplay(folder) {
  const key = String(folder || '').toLowerCase();
  const entry = (npcRoster.entries || []).find((e) => e.folder === key);
  return entry?.display || key;
}

function npcDisplayToFolder(name) {
  const raw = String(name || '').trim();
  const entry = (npcRoster.entries || []).find(
    (e) => e.display === raw || e.folder === raw.toLowerCase(),
  );
  return entry?.folder || raw.toLowerCase();
}

function rosterDisplayNameFromChat(msg) {
  const name = String(msg?.npcName || '').trim();
  if (name) {
    const entry = (npcRoster.entries || []).find(
      (e) => e.display.toLowerCase() === name.toLowerCase(),
    );
    if (entry) return entry.display;
  }
  const key = String(msg?.npcKey || '').trim();
  if (key && npcRoster.keyToDisplay?.[key]) return npcRoster.keyToDisplay[key];
  const folder = key.replace(/^xp_/, '').toLowerCase();
  if (folder) return npcFolderToDisplay(folder);
  return name || 'Unknown';
}

function resolvePlayerChatNpc(msg) {
  const brains = npcBrains?.brains || {};
  const hasBrain = (candidate) => {
    const n = String(candidate || '').trim();
    if (!n) return null;
    if (brains[n]) return n;
    return Object.keys(brains).find((k) => k.toLowerCase() === n.toLowerCase()) || null;
  };
  const candidates = [
    msg?.npcName,
    npcRoster.keyToDisplay?.[msg?.npcKey],
    npcFolderToDisplay(String(msg?.npcKey || '').replace(/^xp_/, '')),
  ];
  for (const candidate of candidates) {
    const hit = hasBrain(candidate);
    if (hit) return { npcName: hit, displayName: hit, hasBrain: true };
  }
  return {
    npcName: null,
    displayName: rosterDisplayNameFromChat(msg),
    hasBrain: false,
  };
}

function _persistChatTurn({ identityId, sessionId, npcName, role, content }) {
  if (!identityId || !npcName || !content) return;
  const npcKey = npcDisplayToFolder(npcName);
  if (!npcKey) return;
  userIdentity.saveNpcChatTurn({
    identityId,
    npcKey,
    role,
    content,
    sessionId: sessionId || null,
  });
}

function pickGroupResponders(text, memberKeys, assistant) {
  const keys = [...new Set((memberKeys || []).map((k) => String(k || '').toLowerCase()).filter(Boolean))];
  if (!keys.length) return [];
  const lower = String(text || '').toLowerCase();
  const mentioned = keys.filter((key) => {
    const name = npcFolderToDisplay(key).toLowerCase();
    return name && lower.includes(name);
  });
  if (mentioned.length) return mentioned.slice(0, 3);
  const assistantKey = String(assistant?.npc_key || '').toLowerCase();
  if (assistantKey && keys.includes(assistantKey)) {
    return [assistantKey, ...keys.filter((k) => k !== assistantKey)].slice(0, 2);
  }
  if (/\b(everyone|team|all|y'all|you all)\b/i.test(text)) return keys.slice(0, 3);
  return keys.slice(0, 2);
}
const visitorNotify = require('./src/visitor-notify');
const visitorIntel = require('./src/denizen-visitor-intelligence');
const { startVisitorIntelligenceLoop } = require('./src/visitor-briefing-loop');
const slackChannel = require('./src/denizen-slack-channel');
const mcpConnector = require('./src/denizen-mcp-connector');
const citedResearch = require('./src/visitor-cited-research');
const { runPredictionMaintenance, getPredictionSummary, runMiroFishMaintenance } = require('./src/denizen-prediction-loop');
const { getRfpPipelineSummary } = require('./src/federal-pipeline');
const mirofishPrediction = require('./src/mirofish-prediction');
const pcActivity = require('./src/pc-activity-tracker');
const jobApplication = require('./src/job-application');
const jobCrm         = require('./src/job-crm');
const desktopAgent = require('./src/desktop-agent');
const desktopPermissionBridge = require('./src/desktop-permission-bridge');
const stationRouter = require('./src/denizen-station-router');
const linuxAgent = require('./src/linux-agent');
const bouncerInvestigation = require('./src/bouncer-investigation');
const bouncerPatrolAggregate = require('./src/denizen-bouncer-patrol-aggregate');
const securityIp = require('./src/security-ip');
const linuxAgentBridge = bouncerInvestigation.createLinuxAgentBridge();
const npcTools         = require('./src/npc-tools');
const log              = require('./src/logger');
const codingTaskRunner = require('./src/coding-task-runner');
const dossierSystem    = require('./src/dossier-system');
const approvalsScope   = require('./src/denizen-approvals-scope');
const taskChain        = require('./src/task-chain');
const contentPipeline  = require('./src/content-pipeline');
const { startContentPipelineScheduler } = require('./src/content-pipeline-scheduler');
const npcThinkRunner   = require('./src/npc-think-runner');
const { ensureBrowserclawRunning } = require('./jelly/services/browserclaw/ensure.cjs');
const robinhoodMcp     = require('./src/robinhood-mcp');
const rokiPaper        = require('./src/roki-paper-broker');
const marketScheduler  = require('./src/denizen-market-scheduler');
const npcMcpGateway    = require('./src/denizen-npc-mcp-gateway');
const teamMcpGateway   = require('./src/denizen-mcp-team-gateway');
const mcpScopes        = require('./src/denizen-mcp-scopes');
const mcpOauth         = require('./src/denizen-mcp-oauth');
const mcpHealth        = require('./src/denizen-mcp-health');
const routeRegistry    = require('./src/route-registry');
const competencyMap    = require('./src/competency-map');
const platformBridge   = require('./src/platform-bridge');
const denizenCredits   = require('./src/denizen-credits');
const { mountComputeRoutes } = require('./src/denizen-compute-routes');
const { mountCrmRoutes } = require('./src/denizen-crm-routes');
const { mountStudioBoardRoutes } = require('./src/denizen-studio-board-routes');
const { mountBusinessStudioRoutes } = require('./src/denizen-business-studio-routes');
const { mountN8nRoutes } = require('./src/n8n-routes');
const { startCrmScheduler } = require('./src/denizen-crm-scheduler');
const { startJennyDurableLoop } = require('./src/npc-jenny-durable-loop');
const mcpTeamTools = require('./src/denizen-mcp-team-tools');
const hostCompute      = require('./src/denizen-host-compute');
const hardwareMonitor  = require('./src/denizen-hardware-monitor');
const fleetRegistry    = require('./src/denizen-fleet-registry');
const lmStudioRouter   = require('./src/lm-studio-router');
const inferenceMetrics = require('./src/denizen-inference-metrics');
const usageTracker      = require('./src/inference-usage-tracker');
const selfAdjust        = require('./src/denizen-self-adjust');
const denizenFederation = require('./src/denizen-federation');
const { createWorldPubsub } = require('./src/denizen-world-pubsub');
const agentWsRelay = require('./src/denizen-agent-ws-relay');
const securityRelay = require('./src/denizen-security-relay');
const IS_RELAY_ONLY = agentWsRelay.isRelayOnlyRole();
const contributionTracker = require('./src/denizen-contribution-tracker');
const computeSettlement = require('./src/denizen-compute-settlement');
const computeProducer = require('./src/denizen-compute-producer');
const nodeProfiler     = require('./src/denizen-node-profiler');
const costProjector    = require('./src/cost-projector');
const skillBuilder     = require('./src/skill-builder');
const computeQueue     = require('./src/denizen-compute-queue');
const playerChatSkills = require('./src/player-chat-skill-bridge');
const chatAttachments = require('./src/chat-attachments');
const contextDrop = require('./src/context-drop');
const seatAiCatalog = require('./src/seat-ai-catalog');
const memoryRetrieve = require('./src/denizen-memory-retrieve');
const localMetrics = require('./src/npc-local-metrics');
const officeStatusBrief = require('./src/office-status-brief');
const denizenDailyPlan = require('./src/denizen-daily-plan');
let denizenImpactGates = null;
try { denizenImpactGates = require('./src/denizen-impact-gates'); } catch (_) {}
const crmNpcPersonas = require('./src/denizen-crm-npc-personas');
const taskResourceAdvisor = require('./src/task-resource-advisor');
const skillGapOrchestrator = require('./src/skill-gap-orchestrator');
const skillDiscovery = require('./src/skill-discovery');
const healthRunbook = require('./src/health-runbook');
const meshWatchdog = require('./src/mesh-worker-watchdog');
const meshTelemetryWorker = require('./src/denizen-mesh-telemetry-worker');
const resourcePressure = require('./src/resource-pressure');
const meshScaleAdvisor = require('./src/mesh-scale-advisor');
const webResearch      = require('./src/web-research');
const screenObserve    = require('./src/screen-observe');
const meetingRunner    = require('./src/meeting-runner');
const conflictDetector = require('./src/conflict-detector');
const {
  extractSearchQuery,
  extractBareSearchTopic,
  extractScreenObserveIntent,
  extractScreenControlIntent,
  extractJobBoardSearchIntent,
  extractBrowserStatusIntent,
  extractOpenBrowserIntent,
  extractBrowserRetryIntent,
  extractBrowserReadIntent,
  isCancelUtterance,
  wantsLucyBrowserOpen,
  extractOpenBraveIntent,
  extractCloseBrowserIntent,
  extractJobBoardHelpIntent,
  isDenizenNativeIntent,
  fixVoiceMishearings,
  normalizePlayerUtterance,
  isTunnelHost,
  resolveStaffIntentNpc,
} = require('./src/openclaw-dispatch');
const { buildLucySearchBrief, isJunkSearchQuery } = require('./src/lucy-search-brief');
const jellyPaths = require('./jelly/paths');
const { normalizeNpcKey, getNpcBrowserPaths } = require('./src/npc-browser-paths');

global._activeBrowserNpc = global._activeBrowserNpc || 'lucy';

const LUCY_CLOSE_FLAG = jellyPaths.lucyCloseFlag();
const SEARCH_CMD_FILE = path.join(jellyPaths.browserDir(), 'search-command.json');
const SEARCH_RESULT_FILE = path.join(jellyPaths.browserDir(), 'search-result.json');
const SEARCH_CMD_FLAG = path.join(jellyPaths.browserDir(), 'search-command.flag');
const INPUT_CMD_FILE = path.join(jellyPaths.browserDir(), 'input-command.json');
const INPUT_CMD_FLAG = path.join(jellyPaths.browserDir(), 'input-command.flag');
const LUCY_LIVE_HEARTBEAT_FILE = path.join(jellyPaths.browserDir(), 'live-heartbeat.json');
const lucyBrowserStream = require('./src/lucy-browser-stream');
const LUCY_MIRROR_STATE_FILE = path.join(jellyPaths.browserDir(), 'mirror-state.json');
const LUCY_MIRROR_FRAME_FILE = path.join(jellyPaths.canvasDir(), 'lucy-mirror-live.png');
const LUCY_MIRROR_STREAM_FILE = path.join(jellyPaths.canvasDir(), 'lucy-mirror-live.jpg');

function _writeSearchCommand(cmd) {
  try {
    fs.mkdirSync(jellyPaths.browserDir(), { recursive: true });
    fs.writeFileSync(SEARCH_CMD_FILE, JSON.stringify(cmd));
    fs.writeFileSync(SEARCH_CMD_FLAG, String(Date.now()));
    return true;
  } catch (_) {
    return false;
  }
}

function _writeBrowserInputCommand(cmd) {
  try {
    jellyPaths.ensureJellyDirs();
    fs.writeFileSync(INPUT_CMD_FILE, JSON.stringify(cmd));
    fs.writeFileSync(INPUT_CMD_FLAG, String(Date.now()));
    return true;
  } catch (_) {
    return false;
  }
}

function _readSearchResult(id, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      try {
        if (fs.existsSync(SEARCH_RESULT_FILE)) {
          const r = JSON.parse(fs.readFileSync(SEARCH_RESULT_FILE, 'utf8'));
          if (r && r.id === id) {
            try { fs.unlinkSync(SEARCH_RESULT_FILE); } catch (_) {}
            resolve(r);
            return;
          }
        }
      } catch (_) {}
      if (Date.now() - start >= timeoutMs) {
        resolve({ ok: false, error: 'Timed out waiting for open browser to run search' });
        return;
      }
      setTimeout(poll, 400);
    };
    poll();
  });
}

function lucyBrowserUntilClose() {
  return String(process.env.LUCY_BROWSER_UNTIL_CLOSE || 'false').toLowerCase() !== 'false';
}

/** Headed browser only when this machine has a display (local Windows/Mac). NAS Docker uses headless + mirror panel. */
function resolveLucyBrowserHeadless(opts = {}) {
  if (opts.headless === true) return true;
  if (opts.headless === false) {
    if (process.platform === 'linux' && !process.env.DISPLAY) return true;
    return false;
  }
  const env = String(process.env.DENIZEN_LUCY_BROWSER_HEADLESS || '').toLowerCase();
  if (env === 'true' || env === '1') return true;
  if (env === 'false' || env === '0') return false;
  if (process.platform === 'linux' && !process.env.DISPLAY) return true;
  return false;
}

let _playwrightBrowsersOk = null;
function probePlaywrightBrowsers() {
  if (_playwrightBrowsersOk != null) return _playwrightBrowsersOk;
  try {
    const { chromium } = require('playwright');
    const exe = chromium.executablePath();
    _playwrightBrowsersOk = !!(exe && fs.existsSync(exe));
  } catch (_) {
    _playwrightBrowsersOk = false;
  }
  if (!_playwrightBrowsersOk) {
    console.warn('[LucyBrowser] Playwright Chromium not installed — web search will use background API only. Run: npx playwright install chromium');
  }
  return _playwrightBrowsersOk;
}

function signalCloseLucyBrowser() {
  try {
    fs.mkdirSync(path.dirname(LUCY_CLOSE_FLAG), { recursive: true });
    fs.writeFileSync(LUCY_CLOSE_FLAG, String(Date.now()));
    global._lucyBrowserOpen = false;
    return true;
  } catch (_) {
    return false;
  }
}

function clearLucyCloseFlag() {
  try { if (fs.existsSync(LUCY_CLOSE_FLAG)) fs.unlinkSync(LUCY_CLOSE_FLAG); } catch (_) {}
}

function _readMirrorState(npcKey) {
  const paths = getNpcBrowserPaths(npcKey);
  try {
    if (fs.existsSync(paths.stateFile)) {
      return JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
    }
  } catch (_) {}
  if (normalizeNpcKey(npcKey) === 'lucy') {
    try {
      if (fs.existsSync(LUCY_MIRROR_STATE_FILE)) {
        return JSON.parse(fs.readFileSync(LUCY_MIRROR_STATE_FILE, 'utf8'));
      }
    } catch (_) {}
  }
  return null;
}

function _readLucyMirrorState() {
  return _readMirrorState('lucy');
}

function _markMirrorClosed(npcKey) {
  try {
    jellyPaths.ensureJellyDirs();
    const paths = getNpcBrowserPaths(npcKey);
    const prev = _readMirrorState(npcKey) || {};
    fs.writeFileSync(
      paths.stateFile,
      JSON.stringify({ ...prev, status: 'closed', streaming: false, updatedAt: Date.now() }),
      'utf8',
    );
  } catch (_) {}
}

function _markLucyMirrorClosed() {
  _markMirrorClosed('lucy');
}

const LUCY_MIRROR_FRAME_LIVE_MS = 6000;

function _syncMirrorStateWithChild(childAlive) {
  if (childAlive) return;
  const state = _readLucyMirrorState() || {};
  if (state.status === 'open' || state.status === 'searching' || state.streaming) {
    _markLucyMirrorClosed();
  }
  if (global._lucyBrowserOpen) global._lucyBrowserOpen = false;
}

function _latestMirrorFrameFileForNpc(npcKey) {
  const paths = getNpcBrowserPaths(npcKey);
  let best = null;
  let bestMtime = 0;
  for (const p of [paths.streamFile, paths.frameFile]) {
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        best = { path: p, mtimeMs: st.mtimeMs, format: p.endsWith('.png') ? 'png' : 'jpeg' };
      }
    } catch (_) {}
  }
  if (!best && normalizeNpcKey(npcKey) === 'lucy') {
    return _latestMirrorFrameFile();
  }
  return best;
}

function _buildNpcMirrorResponse(npcKey) {
  const key = normalizeNpcKey(npcKey);
  const paths = getNpcBrowserPaths(key);
  _syncLucyBrowserOpenState();
  const state = _readMirrorState(key) || {};
  const last = global._lucyLastBrowser || {};
  const childAlive = _lucyBrowserChildAlive();
  const activeKey = normalizeNpcKey(global._activeBrowserNpc || 'lucy');
  const ownsBrowser = childAlive && activeKey === key;
  _syncMirrorStateWithChild(childAlive);
  const stateAfter = ownsBrowser ? state : (_readMirrorState(key) || {});

  let frameStat = null;
  try {
    if (fs.existsSync(paths.frameFile)) frameStat = fs.statSync(paths.frameFile);
    else if (normalizeNpcKey(key) === 'lucy' && fs.existsSync(LUCY_MIRROR_FRAME_FILE)) {
      frameStat = fs.statSync(LUCY_MIRROR_FRAME_FILE);
    }
  } catch (_) {}
  const frameMtime = frameStat ? frameStat.mtimeMs : null;
  const frameAgeMs = frameStat ? Date.now() - frameStat.mtimeMs : Infinity;
  const frameFresh = frameAgeMs < LUCY_MIRROR_FRAME_LIVE_MS;

  const open = ownsBrowser;
  const streaming = !!(ownsBrowser && (frameFresh || stateAfter.status === 'searching' || !frameStat));
  const staleFrame = !ownsBrowser && !!frameStat;
  const status = ownsBrowser
    ? (stateAfter.status || 'open')
    : (staleFrame ? 'snapshot' : (childAlive && activeKey !== key ? 'busy' : 'idle'));

  const apiBase = `/api/npc-browser/${encodeURIComponent(key)}`;
  return {
    ok: true,
    npcKey: key,
    activeNpcKey: activeKey,
    open,
    streaming,
    staleFrame,
    frameAgeMs: frameStat ? Math.round(frameAgeMs) : null,
    searching: ownsBrowser && (stateAfter.status === 'searching' || !frameStat),
    status,
    query: stateAfter.query || (ownsBrowser ? last.query : null) || null,
    url: stateAfter.url || (ownsBrowser ? last.url : null) || null,
    title: stateAfter.title || null,
    browserLabel: ownsBrowser ? (last.label || stateAfter.browserEngine || null) : null,
    readExcerpt: stateAfter.readExcerpt || null,
    results: Array.isArray(stateAfter.results) ? stateAfter.results.slice(0, 8) : null,
    lastActivity: stateAfter.lastActivity || null,
    activityLog: Array.isArray(stateAfter.activityLog) ? stateAfter.activityLog.slice(-12) : [],
    viewportWidth: stateAfter.viewportWidth || null,
    viewportHeight: stateAfter.viewportHeight || null,
    frameUrl: frameStat ? `${apiBase}/frame?v=${Math.floor(frameMtime)}` : null,
    streamUrl: streaming ? `${apiBase}/live-frame` : null,
    updatedAt: stateAfter.updatedAt || frameMtime || null,
    busyWithOtherNpc: childAlive && activeKey !== key,
  };
}

function _buildLucyMirrorResponse() {
  return _buildNpcMirrorResponse('lucy');
}

function _broadcastNpcMirrorUpdate(broadcast, npcKey) {
  if (typeof broadcast !== 'function') return;
  const key = normalizeNpcKey(npcKey || global._activeBrowserNpc || 'lucy');
  const payload = { type: 'npc_browser_mirror', ..._buildNpcMirrorResponse(key), ts: Date.now() };
  broadcast(payload);
  if (key === 'lucy') {
    broadcast({ type: 'lucy_browser_mirror', ...payload, ts: Date.now() });
  }
}

function _broadcastLucyMirrorUpdate(broadcast) {
  _broadcastNpcMirrorUpdate(broadcast, 'lucy');
}

let _relayPublishAgentFrame = null;

function _broadcastAgentWs(msg) {
  const raw = JSON.stringify(msg);
  if (!agentWss) return;
  agentWss.clients.forEach((c) => { if (c.readyState === 1) c.send(raw); });
  if (_relayPublishAgentFrame && msg && typeof msg === 'object') {
    _relayPublishAgentFrame(msg);
  }
}

function _broadcastProposalQueueChanged(kind, action, id) {
  _broadcastAgentWs({
    type: 'proposal_queue_changed',
    kind: kind || null,
    action: action || 'updated',
    id: id || null,
    ts: Date.now(),
  });
}

let _mirrorFrameMtime = 0;
function _latestMirrorFrameFile() {
  let best = null;
  let bestMtime = 0;
  for (const p of [LUCY_MIRROR_STREAM_FILE, LUCY_MIRROR_FRAME_FILE]) {
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        best = { path: p, mtimeMs: st.mtimeMs, format: p.endsWith('.png') ? 'png' : 'jpeg' };
      }
    } catch (_) {}
  }
  return best;
}

function _pushLucyBrowserFrame() {
  try {
    const activeKey = normalizeNpcKey(global._activeBrowserNpc || 'lucy');
    const latest = _latestMirrorFrameFileForNpc(activeKey);
    if (!latest) return;
    if (latest.mtimeMs <= _mirrorFrameMtime) return;
    _mirrorFrameMtime = latest.mtimeMs;
    const buf = fs.readFileSync(latest.path);
    if (!buf || buf.length < 80) return;
    const frameMsg = {
      type: 'npc_browser_frame',
      npcKey: activeKey,
      format: latest.format,
      data: buf.toString('base64'),
      ts: Date.now(),
    };
    _broadcastAgentWs(frameMsg);
    if (activeKey === 'lucy') {
      _broadcastAgentWs({ type: 'lucy_browser_frame', ...frameMsg, ts: Date.now() });
    }
  } catch (_) {}
}

function _startLucyMirrorFrameWatcher() {
  jellyPaths.ensureJellyDirs();
  const watchDir = jellyPaths.canvasDir();
  try {
    const mirrorWatcher = fs.watch(
      watchDir,
      { persistent: false },
      () => _pushLucyBrowserFrame(),
    );
    // Synology's shared inotify pool can be exhausted by other containers.
    // Polling below remains the fallback, so a watcher error must not become
    // an uncaught process-level exception.
    mirrorWatcher.on('error', () => {});
  } catch (_) {}
  setInterval(_pushLucyBrowserFrame, 120);
}

function closeLucyBrowser() {
  signalCloseLucyBrowser();
  _clearLucyBrowserIpc();
  _killLucyWebSearchChildren();
  _killOrphanLucyChromium();
  global._lucyBrowserOpen = false;
  _markLucyMirrorClosed();
  return { ok: true, message: 'Closing browser…' };
}

function _clearLucyBrowserIpc() {
  for (const f of [SEARCH_CMD_FILE, SEARCH_CMD_FLAG, SEARCH_RESULT_FILE, INPUT_CMD_FILE, INPUT_CMD_FLAG, LUCY_LIVE_HEARTBEAT_FILE]) {
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  }
}

/** Kill orphan web-search.mjs children (profile lock blocks new launches). */
function _killLucyWebSearchChildren() {
  const { execSync } = require('node:child_process');
  try {
    if (process.platform === 'win32') {
      execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name=\'node.exe\'\\" | Where-Object { $_.CommandLine -like \'*web-search.mjs*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
        { timeout: 8000, stdio: 'pipe' },
      );
    } else {
      execSync('pkill -f "web-search.mjs" 2>/dev/null || true', { timeout: 5000, stdio: 'pipe' });
    }
  } catch (_) {}
}

/** Orphan Playwright Chromium processes keep the Lucy profile locked after node exits. */
function _killOrphanLucyChromium() {
  const { execSync } = require('node:child_process');
  const profileNeedle = process.platform === 'win32'
    ? '.denizen\\\\browser\\\\job-apply'
    : '.denizen/browser/job-apply';
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profileNeedle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
        { timeout: 12000, stdio: 'pipe' },
      );
    } else {
      execSync(`pkill -f "${profileNeedle}" 2>/dev/null || true`, { timeout: 5000, stdio: 'pipe' });
    }
  } catch (_) {}
}

/** Full reset before launching a fresh headed browser (not IPC reuse). */
async function _prepareLucyBrowserForLaunch() {
  global._lucyBrowserOpen = false;
  signalCloseLucyBrowser();
  _killLucyWebSearchChildren();
  _killOrphanLucyChromium();
  _clearLucyBrowserIpc();
  await new Promise((r) => setTimeout(r, 2500));
  clearLucyCloseFlag();
}

/** Fresh mirror frames / heartbeat mean Lucy's browser child is alive. */
function _lucyMirrorSignalsLive() {
  try {
    if (fs.existsSync(LUCY_LIVE_HEARTBEAT_FILE)) {
      const hb = JSON.parse(fs.readFileSync(LUCY_LIVE_HEARTBEAT_FILE, 'utf8'));
      if (Date.now() - (hb.at || 0) < 3000) return true;
    }
  } catch (_) {}
  try {
    const latest = _latestMirrorFrameFile();
    if (!latest) return false;
    return Date.now() - latest.mtimeMs < LUCY_MIRROR_FRAME_LIVE_MS;
  } catch (_) {}
  return false;
}

/** True when a keep-open web-search.mjs child is still running. */
function _lucyBrowserChildAlive() {
  if (_lucyMirrorSignalsLive()) return true;
  try {
    const { execSync } = require('node:child_process');
    if (process.platform === 'win32') {
      const ps = "$ProgressPreference='SilentlyContinue';(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\") | Where-Object { $_.CommandLine -like '*web-search.mjs*' } | Measure-Object | Select-Object -ExpandProperty Count";
      const b64 = Buffer.from(ps, 'utf16le').toString('base64');
      const out = execSync(`powershell -NoProfile -EncodedCommand ${b64}`, { encoding: 'utf8', timeout: 8000 }).trim();
      return Number(out) > 0;
    }
  } catch (_) {}
  return false;
}

/** After server restart, a keep-open browser child may still be running. */
function _syncLucyBrowserOpenState() {
  if (global._lucyBrowserOpen && _lucyBrowserChildAlive()) return true;
  if (global._lucyBrowserOpen && !_lucyBrowserChildAlive()) {
    global._lucyBrowserOpen = false;
  }
  if (_lucyBrowserChildAlive()) {
    global._lucyBrowserOpen = true;
    return true;
  }
  return false;
}

function _resetLucyBrowserOnStartup() {
  global._lucyBrowserOpen = false;
  signalCloseLucyBrowser();
  _clearLucyBrowserIpc();
  _killLucyWebSearchChildren();
  _killOrphanLucyChromium();
  _markLucyMirrorClosed();
  console.log('[Lucy] Browser state reset on startup');
}
const researchQueue    = require('./src/research-queue');
const researchSessions = require('./src/research-sessions');
const researchBrief    = require('./src/research-brief');
const awayNotify       = require('./src/away-notify');
const { startAll: startResearchScheduler } = require('./src/research-scheduler');

function findLatestResearchBrief() {
  try {
    // Use the same dir logic as research-brief.js for consistency
    const dir = process.env.RESEARCH_REPORTS_DIR
      ? path.resolve(process.env.RESEARCH_REPORTS_DIR)
      : path.join(__dirname, 'reports', 'research');
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') || f.endsWith('.txt'))
      .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (!files.length) return null;
    const latest = path.join(dir, files[0].f);
    const content = fs.readFileSync(latest, 'utf8');
    // Extract a clean summary
    const lines = content.split('\n').filter(l => l.trim());
    const execSummary = lines.find(l => /executive|summary|key facts/i.test(l)) || '';
    return {
      path: latest,
      summary: execSummary ? content.split(execSummary)[1]?.slice(0, 800) || content.slice(0, 1200) : content.slice(0, 1200),
      content: content.slice(0, 4000)
    };
  } catch (_) { return null; }
}

/** Per threat category+source — avoid duplicate Kali/Zenmap runs (client + server). */
function _bouncerInvTake(threat = {}, opts = {}) {
  return bouncerInvestigation.takeInvestigationSlot(threat, opts);
}

// Voice map (per-NPC ElevenLabs voice IDs). Loaded once at startup;
// edit data/voice-map.json + restart to change. Missing file → empty map
// → every NPC uses the default voice.
let _voiceMap = { default: {}, npcs: {} };
try {
  const rawMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'voice-map.json'), 'utf8'));
  _voiceMap = voiceResolve.applyRosterToVoiceMap(rawMap, npcRoster, { assignMissingVoices: true });
} catch (_) { /* optional */ }

function _resolveVoiceForNpc(npcName, payload = {}) {
  const rosterEntry = (npcRoster.entries || []).find(e => e.display === npcName) || null;
  const resolved = voiceResolve.resolveNpcVoice(npcName, _voiceMap, rosterEntry);
  return {
    voiceId: payload.voiceId || resolved.voiceId,
    modelId: payload.modelId || resolved.modelId,
    gender: resolved.gender,
    source: payload.voiceId ? 'override' : resolved.source,
  };
}

const PORT = process.env.PORT || 8080;
const STT_MAX_AUDIO_BYTES = 12 * 1024 * 1024; // 12MB hard cap

function _resolveSttConfig() {
  const apiKey = process.env.OPENAI_WHISPER_API_KEY || process.env.OPENAI_API_KEY || '';
  const model = process.env.OPENAI_WHISPER_MODEL || 'whisper-1';
  const baseUrl = (process.env.OPENAI_WHISPER_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const source = process.env.OPENAI_WHISPER_API_KEY
    ? 'OPENAI_WHISPER_API_KEY'
    : (process.env.OPENAI_API_KEY ? 'OPENAI_API_KEY' : null);
  return {
    configured: !!apiKey,
    apiKey,
    model,
    baseUrl,
    source,
  };
}

function _readJsonBody(req, limitBytes = 1024 * 1024, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let total = 0;
    const chunks = [];
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      try { req.destroy(); } catch (_) {}
      finish(new Error('request body timeout — POST body may not reach the server through the tunnel'));
    }, timeoutMs);
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        finish(new Error(`payload too large (>${limitBytes} bytes)`));
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        finish(null, raw ? JSON.parse(raw) : {});
      } catch (err) {
        finish(new Error(`invalid JSON: ${err.message}`));
      }
    });
    req.on('error', (err) => finish(err));
  });
}

function _buildMultipartForm(parts) {
  const boundary = `----denizen-${crypto.randomBytes(12).toString('hex')}`;
  const bodyParts = [];

  for (const part of parts) {
    const header = [];
    header.push(`--${boundary}`);
    if (part.filename) {
      header.push(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"`);
      header.push(`Content-Type: ${part.contentType || 'application/octet-stream'}`);
      bodyParts.push(Buffer.from(`${header.join('\r\n')}\r\n\r\n`, 'utf8'));
      bodyParts.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(String(part.value || ''), 'utf8'));
      bodyParts.push(Buffer.from('\r\n', 'utf8'));
    } else {
      header.push(`Content-Disposition: form-data; name="${part.name}"`);
      bodyParts.push(Buffer.from(`${header.join('\r\n')}\r\n\r\n${String(part.value || '')}\r\n`, 'utf8'));
    }
  }

  bodyParts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    body: Buffer.concat(bodyParts),
  };
}

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message);
});
process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled rejection (kept alive):', err?.message || err);
});
// Serve from the project directory — all assets are now in assets/
const ROOT = __dirname;
const CRM_DIST = path.join(ROOT, 'crm', 'dist');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
};

const OPENCLAW_HOST = '127.0.0.1';
const OPENCLAW_PORT = 18792;

// --- Security Monitor ---
const securityMonitor = new SecurityMonitorServer({
  watchDirs: [
    path.resolve(__dirname),  // watch the game directory
  ],
  // Production/NAS: avoid recursive inotify (pool exhaustion on Synology).
  recursiveFileWatch: process.env.NODE_ENV !== 'production',
  failedLoginThreshold: 3,
  portScanThreshold: 10,
  apiRateLimit: 100,
});
// Mirror threat events into the live WorldState so NPC brains and the UI
// share a single source of truth for "what's currently bad in the office".
if (typeof securityMonitor.setWorldState === 'function') {
  securityMonitor.setWorldState(worldState);
}
if (IS_RELAY_ONLY) {
  console.log('[SecurityMonitor] Relay-only node — local threat polling disabled (pubsub relay only)');
} else {
  securityMonitor.start();
}

function _onContentBrandBlocked(meta = {}) {
  if (typeof securityMonitor._emitThreat !== 'function') return;
  securityMonitor._emitThreat({
    category: 'api_abuse',
    severity: 'medium',
    source: 'content-pipeline',
    target: meta.topic || meta.chainId || 'content',
    detail: String(meta.detail || 'brand moderation blocked').slice(0, 240),
    force: true,
  });
}

// --- Cofounder Agent (CTO AI brain) ---
const npcBrains = new NpcBrainManager();
if (promptTuning.economyMode) {
  console.log(
    `[Denizen] Economy mode ON — think ${promptTuning.thinkMinMs / 1000}-${promptTuning.thinkMaxMs / 1000}s, ` +
    `run_skill max ${promptTuning.runSkillMaxPerWindow}/${promptTuning.runSkillCooldownMs / 60000}min per NPC`
  );
}
const cofounderAgent = new CofounderAgent();
cofounderAgent.npcBrains = npcBrains; // Give the director access to individual NPC brains

/** Broadcast to game WS + notify Discord/Slack when configured. */
function _ceoBroadcast(msg) {
  const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
  try {
    // agentWss.clients === cofounderAgent.wsClients (same sockets) — do not double-send.
    (agentWss ? agentWss.clients : cofounderAgent.wsClients).forEach((c) => {
      if (c.readyState === 1) c.send(raw);
    });
  } catch (_) {}
  if (typeof msg === 'object' && msg && (msg.type === 'npc_report_to_ceo' || msg.type === 'research_brief_done' || msg.type === 'daily_digest_sent')) {
    const text = msg.text || msg.summary || msg.report || '';
    if (text) {
      awayNotify.notifyCeo({
        title: msg.npcName ? `${msg.npcName} — Denizen` : 'Denizen',
        source: msg.type,
        text: String(text).slice(0, 1800),
      }).catch(() => {});
    }
  }
}

/** Connected visitor sessions (WS presence) — sessionId → { displayName, lastSeenAt } */
global._denizenOnlineSessions = global._denizenOnlineSessions || new Map();
const _notifiedCeoHandoffIds = new Set();

function listOnlineSessionIds() {
  return new Set(global._denizenOnlineSessions?.keys() || []);
}

function _setVisitorOnline(sessionId, displayName) {
  if (!sessionId) return;
  global._denizenOnlineSessions.set(sessionId, {
    displayName: displayName || 'Guest',
    lastSeenAt: Date.now(),
  });
}

function _touchVisitorOnline(sessionId) {
  if (!sessionId) return;
  const entry = global._denizenOnlineSessions.get(sessionId);
  if (entry) entry.lastSeenAt = Date.now();
}

function _clearVisitorOnline(sessionId) {
  if (!sessionId || !global._denizenOnlineSessions?.size) return;
  const clients = _agentClients();
  for (const c of clients) {
    if (c.readyState === 1 && c._denizenSessionId === sessionId) return;
  }
  global._denizenOnlineSessions.delete(sessionId);
}

function _agentClients() {
  return agentWss ? agentWss.clients : cofounderAgent.wsClients;
}

async function _applyOfficeToSocket(ws, { sessionId, displayName, isCeo } = {}) {
  ws._denizenSessionId = sessionId || null;
  ws._denizenIsCeo = !!isCeo;
  ws._denizenDisplayName = displayName || null;
  if (isCeo && !sessionId) {
    const o = officeRegistry.resolveOfficeFromSession(null, { isCeoWs: true });
    ws._denizenOfficeId = o.officeId;
    ws._denizenIdentityId = o.identityId;
    ws._denizenIsOperatorOffice = true;
    ws._denizenOrgId = denizenDb.orgId || worldState.getDefaultOrgId?.() || null;
    return o;
  }
  const session = sessionId ? await denizenVisitor.getSession(sessionId).catch(() => null) : null;
  const o = officeRegistry.resolveOfficeFromSession(session, { isCeoWs: isCeo });
  ws._denizenOfficeId = o.officeId;
  ws._denizenIdentityId = o.identityId || null;
  ws._denizenIsOperatorOffice = !!o.isOperatorOffice;
  ws._denizenOrgId = session?.org_id || denizenDb.orgId || worldState.getDefaultOrgId?.() || null;
  return o;
}

function _broadcastToVisitorSession(sessionId, payload) {
  if (!sessionId || !payload) return;
  const clients = _agentClients();
  const msg = JSON.stringify(payload);
  for (const ws of clients) {
    if (ws.readyState === 1 && ws._denizenSessionId === sessionId) {
      ws.send(msg);
    }
  }
}

function _broadcastConnectionUpdate(connection, { event, sessionIds = [] } = {}) {
  if (!connection) return;
  const payload = {
    type: 'visitor_connection_update',
    event: event || 'update',
    connection,
    ts: Date.now(),
  };
  const targets = new Set((sessionIds || []).filter(Boolean));
  if (connection.target_session_id) targets.add(connection.target_session_id);
  for (const sid of targets) {
    _broadcastToVisitorSession(sid, payload);
  }
}

function _broadcastToOffice(officeId, payload, opts = {}) {
  if (!officeId || !payload) return;
  officeRegistry.broadcastAgent(_agentClients(), payload, { officeId, ...opts });
}

function _mpPresenceKey(ws) {
  return officeRegistry.ensurePresenceKey(ws);
}

function _mpIsSpectator(msg) {
  if (msg?.spectator === true || msg?.interactive === false) return true;
  if (msg?.demo === true || msg?.mode === 'demo') return true;
  return false;
}

function _mpSendOfficeSync(ws, office) {
  if (!ws || ws.readyState !== 1 || !office?.officeId) return;
  const officeId = office.officeId;
  const presenceKey = _mpPresenceKey(ws);
  // If we just upgraded anon → sess, tell the office to drop the ghost.
  const migrated = ws._denizenPresenceKeyMigrated;
  if (migrated?.from) {
    _broadcastToOffice(officeId, {
      type: 'player_left',
      office_id: officeId,
      sessionId: migrated.from,
      displayName: migrated.removed?.displayName || null,
      ts: Date.now(),
    });
    ws._denizenPresenceKeyMigrated = null;
  }
  const players = officeRegistry.listPlayersInOffice(officeId)
    .filter((p) => {
      if (p.sessionId === presenceKey) return false;
      const ghosts = ws._denizenPresenceGhosts;
      if (Array.isArray(ghosts) && ghosts.includes(p.sessionId)) return false;
      return true;
    });
  const hostResult = officeRegistry.ensureSimHost(officeId, _agentClients(), presenceKey);
  try {
    ws.send(JSON.stringify({
      type: 'players_snapshot',
      office_id: officeId,
      players,
      selfSessionId: presenceKey,
      ts: Date.now(),
    }));
  } catch (_) {}
  if (hostResult.message) {
    _broadcastToOffice(officeId, hostResult.message);
  }
}

function _mpHandleDisconnect(ws) {
  const officeId = ws?._denizenOfficeId;
  const key = ws?._denizenPresenceKey || (ws?._denizenSessionId ? `sess:${ws._denizenSessionId}` : null);
  if (!officeId || !key) return;
  const removed = officeRegistry.removePlayerFromOffice(officeId, key);
  if (removed) {
    _broadcastToOffice(officeId, {
      type: 'player_left',
      office_id: officeId,
      sessionId: key,
      displayName: removed.displayName || null,
      ts: Date.now(),
    });
  }
  const hostResult = officeRegistry.clearSimHostIf(key, officeId, _agentClients());
  if (hostResult?.message) {
    _broadcastToOffice(officeId, hostResult.message);
  }
}

function _notifyCeoHandoff(handoff) {
  if (!handoff?.id || _notifiedCeoHandoffIds.has(handoff.id)) return;
  _notifiedCeoHandoffIds.add(handoff.id);
  const from = handoff.from_display_name || 'Someone';
  const slice = String(handoff.message || '').slice(0, 120);
  try {
    worldState.pushEvent('handoff', `Assistant handoff from ${from}: ${slice}`);
  } catch (_) {}
  _ceoBroadcast(denizenVisitor.buildLucyHandoffAlertBroadcast(handoff));
}

function _deliverHandoffWs(ws, handoff, { ceoBridge = false, officeId = null } = {}) {
  if (!ws || ws.readyState !== 1 || !handoff?.id) return;
  ws._deliveredHandoffIds = ws._deliveredHandoffIds || new Set();
  if (ws._deliveredHandoffIds.has(handoff.id)) return;
  ws._deliveredHandoffIds.add(handoff.id);
  if (ceoBridge) _notifyCeoHandoff(handoff);
  const meta = handoff.metadata && typeof handoff.metadata === 'object' ? handoff.metadata : {};
  const targetOffice = officeId || meta.to_office_id || ws._denizenOfficeId || null;
  const payload = {
    type: meta.office_bus ? 'office_bus_message' : 'assistant_handoff',
    handoff,
    office_id: targetOffice,
    intent: meta.intent || null,
  };
  if (officeRegistry.shouldDeliverToSocket(payload, ws)) {
    ws.send(JSON.stringify(payload));
  }
}

function _writeVisitorAccessError(res, err) {
  const status = visitorAccess.visitorAccessErrorStatus(err);
  const body = {
    ok: false,
    error: err?.message || String(err),
    code: err?.code || 'ERROR',
  };
  if (err?.feature) body.feature = err.feature;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function _guardVisitorFeature(req, sessionId, feature, body = {}) {
  const access = await _verifyVisitorSession(req, sessionId, body);
  visitorAccess.assertTeamFeature(access, feature);
  return access;
}

async function _withIdentityTimeout(promise, ms = 3000) {
  let timer;
  try {
    return await Promise.race([
      promise.catch(() => null),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function _parseVisitorAccessKind(raw) {
  const kind = String(raw || '').trim().toLowerCase();
  return kind === 'ceo' ? 'ceo' : kind === 'team' ? 'team' : null;
}

async function _respondVisitorAccessVerify(res, code, accessKind) {
  let result = visitorAccess.verifyAccessCode(code, accessKind);
  if (!result.ok && accessKind === 'team') {
    const org = await teamAuth.resolveOrgByTeamCode(code).catch(() => null);
    if (org?.slug) {
      result = {
        ok: true,
        org_slug: org.slug,
        tier: 'team',
        access_grant: sessionAuth.createAccessGrant({
          tier: 'team',
          orgSlug: org.slug,
          accessMethod: 'team_code',
        }),
      };
    }
  }
  if (!result.ok) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

function _visitorSessionBodyFromHeaders(req) {
  const h = req.headers || {};
  const header = (name) => String(h[name] || h[name.toLowerCase()] || '').trim() || null;
  const metadata = {};
  const accessMethod = header('x-access-method');
  if (accessMethod) metadata.access_method = accessMethod;
  return {
    session_id: header('x-session-id'),
    session_token: header('x-session-token'),
    access_grant: header('x-access-grant'),
    ceo_grant: header('x-denizen-ceo-grant'),
    display_name: header('x-display-name'),
    org_slug: header('x-org-slug'),
    email: header('x-email'),
    demo: /^(1|true|yes)$/i.test(header('x-demo') || ''),
    metadata: Object.keys(metadata).length ? metadata : undefined,
  };
}

function _sessionIdFromRequest(req, body = {}, url = null) {
  const parsed = url || new URL(req?.url || '/', 'http://x');
  return String(
    body.session_id
    || body.sessionId
    || parsed.searchParams.get('session_id')
    || parsed.searchParams.get('sessionId')
    || _visitorSessionBodyFromHeaders(req).session_id
    || sessionCookie.sessionIdFromCookies(req)
    || '',
  ).trim() || null;
}

function _mergeSessionAuthBody(req, body = {}) {
  const headerSession = _visitorSessionBodyFromHeaders(req);
  const merged = { ...headerSession, ...body };
  if (!merged.session_token) {
    const fromCookie = sessionCookie.sessionTokenFromCookies(req);
    if (fromCookie) merged.session_token = fromCookie;
  }
  return merged;
}

async function _resolveApprovalsAccess(req, body = {}) {
  const headerSession = _visitorSessionBodyFromHeaders(req);
  const url = new URL(req.url || '/', 'http://x');
  const sessionId = _sessionIdFromRequest(req, { ...headerSession, ...body }, url);
  const ceoRequest = hostCompute.isCeoPrincipalRequest(req)
    || hostCompute.isLocalOperatorRequest(req);
  if (!sessionId) {
    if (ceoRequest) {
      const operator = approvalsScope.isSystemOperatorReviewer({
        isCeo: true,
        canApproveSkills: true,
      });
      return {
        sessionId: null,
        identityId: null,
        operator,
        profile: {
          display_name: headerSession.display_name || body.display_name || 'Dolonia',
          email: headerSession.email || body.email || null,
        },
        session: null,
      };
    }
    const err = new Error('session_id required');
    err.status = 401;
    throw err;
  }
  await _verifyVisitorSession(req, sessionId, _mergeSessionAuthBody(req, body));
  const session = await denizenVisitor.getSession(sessionId);
  const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
    isCeoPrincipal: ceoRequest,
  });
  const operator = approvalsScope.isSystemOperatorReviewer({
    isCeo: ceoRequest || approval.role === 'ceo',
    canApproveSkills: approval.allowed,
  });
  const identityId = session?.identity_id || null;
  if (!identityId && !operator) {
    const err = new Error('Citizen identity required for approvals');
    err.status = 403;
    throw err;
  }
  let profile = {
    display_name: session?.display_name || headerSession.display_name || null,
    email: headerSession.email || body.email || null,
  };
  if (userIdentity?.getIdentityById && identityId) {
    const idRow = await userIdentity.getIdentityById(identityId).catch(() => null);
    if (idRow) {
      profile = {
        ...profile,
        ...idRow,
        display_name: profile.display_name || idRow.display_name || null,
      };
    }
  }
  const account = await teamAuth.getTeamAccountForSession(sessionId).catch(() => null);
  if (account?.email) profile.email = account.email;
  return { sessionId, identityId, operator, profile, session };
}

function _teamAuthBodyFromHeaders(req) {
  const h = req.headers || {};
  const header = (name) => String(h[name] || h[name.toLowerCase()] || '').trim();
  return {
    username: header('x-username') || header('x-denizen-username') || undefined,
    password: header('x-password') || header('x-denizen-password') || undefined,
    email: header('x-email') || undefined,
    team_code: header('x-team-code') || header('x-denizen-team-code') || undefined,
    teamCode: header('x-team-code') || header('x-denizen-team-code') || undefined,
    team_name: header('x-team-name') || header('x-denizen-team-name') || undefined,
    teamName: header('x-team-name') || header('x-denizen-team-name') || undefined,
    display_name: header('x-display-name') || undefined,
    displayName: header('x-display-name') || undefined,
  };
}

async function _readTeamAuthBody(req, maxBytes = 32 * 1024) {
  if (req.method === 'GET') {
    return _teamAuthBodyFromHeaders(req);
  }
  const body = await _readJsonBody(req, maxBytes);
  if (body && typeof body === 'object' && Object.keys(body).length) {
    return body;
  }
  const headers = _teamAuthBodyFromHeaders(req);
  if (headers.username || headers.email || headers.password) {
    return { ...headers, ...body };
  }
  return body;
}

/** Team/demo login routes — registered early so login never waits behind heavy handlers. */
function _handleVisitorAuthRoutes(req, res, urlPath) {
  if (urlPath === '/api/visitor/auth/register-demo' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const sessionToken = sessionAuth.extractSessionAuth(req, body);
      const demoAuth = require('./src/denizen-demo-auth.js');
      const result = await demoAuth.registerDemoAccount({
        sessionId,
        sessionToken,
        username: body.username,
        password: body.password,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      const demoAuth = require('./src/denizen-demo-auth.js');
      const status = demoAuth.demoAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err), code: err?.code }));
    });
    return true;
  }

  if (urlPath === '/api/visitor/auth/login-demo' && (req.method === 'POST' || req.method === 'GET')) {
    (async () => {
      const body = await _readTeamAuthBody(req, 32 * 1024);
      const demoAuth = require('./src/denizen-demo-auth.js');
      const result = await demoAuth.loginDemoAccount({
        username: body.username,
        password: body.password,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      const demoAuth = require('./src/denizen-demo-auth.js');
      const status = demoAuth.demoAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err), code: err?.code }));
    });
    return true;
  }

  if (urlPath === '/api/visitor/auth/create-team' && (req.method === 'POST' || req.method === 'GET')) {
    (async () => {
      const body = await _readTeamAuthBody(req, 32 * 1024);
      const result = await teamAuth.createTeam({
        teamName: body.team_name ?? body.teamName,
        username: body.username,
        email: body.email,
        password: body.password,
        displayName: body.display_name ?? body.displayName,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      const status = teamAuth.teamAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err), code: err?.code }));
    });
    return true;
  }

  if (urlPath === '/api/visitor/auth/register' && (req.method === 'POST' || req.method === 'GET')) {
    (async () => {
      const body = await _readTeamAuthBody(req, 32 * 1024);
      const result = await teamAuth.registerTeamAccount({
        email: body.email,
        displayName: body.display_name ?? body.displayName,
        username: body.username,
        password: body.password,
        teamCode: body.team_code ?? body.teamCode,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      const status = teamAuth.teamAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err), code: err?.code }));
    });
    return true;
  }

  if (urlPath === '/api/visitor/auth/login' && (req.method === 'POST' || req.method === 'GET')) {
    (async () => {
      const body = await _readTeamAuthBody(req, 32 * 1024);
      const result = await teamAuth.loginTeamAccount({
        email: body.email,
        username: body.username,
        password: body.password,
        teamCode: body.team_code ?? body.teamCode,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      const status = teamAuth.teamAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err), code: err?.code }));
    });
    return true;
  }

  if (urlPath === '/api/visitor/auth/discord/connect' && req.method === 'GET') {
    (async () => {
      const discordAuth = require('./src/denizen-discord-auth.js');
      const u = new URL(req.url, 'http://localhost');
      const mode = u.searchParams.get('mode') || 'signup';
      const returnTo = u.searchParams.get('return') || '/discord-map/';
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const sessionToken = sessionAuth.extractSessionAuth(req, {
        session_token: u.searchParams.get('session_token') || u.searchParams.get('sessionToken'),
      });
      // Link mode requires a verified Denizen session. Never trust a
      // caller-supplied identity_id query param (account takeover risk).
      let identityId = null;
      if (mode === 'link') {
        if (!sessionId || !sessionToken) {
          throw new discordAuth.DiscordAuthError(
            'Authenticated session required for Discord linking',
            'DENIED',
          );
        }
        try {
          await visitorAccess.assertSessionToken(sessionId, sessionToken);
        } catch (err) {
          throw new discordAuth.DiscordAuthError(err?.message || 'Invalid session', 'DENIED');
        }
        const identity = await userIdentity.getIdentityBySession(sessionId).catch(() => null);
        identityId = identity?.id || null;
        if (!identityId) {
          throw new discordAuth.DiscordAuthError(
            'No Denizen identity for this session',
            'DENIED',
          );
        }
      }
      const url = discordAuth.buildConnectUrl({
        mode,
        returnTo,
        identityId,
        sessionId,
        sessionToken,
      });
      res.writeHead(302, { Location: url });
      res.end();
    })().catch((err) => {
      const discordAuth = require('./src/denizen-discord-auth.js');
      const status = discordAuth.discordAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(discordAuth.errorHtml(err?.message || String(err)));
    });
    return true;
  }

  if (urlPath.startsWith('/api/visitor/auth/discord/callback') && req.method === 'GET') {
    (async () => {
      const discordAuth = require('./src/denizen-discord-auth.js');
      const u = new URL(req.url, 'http://localhost');
      const code = u.searchParams.get('code');
      const state = u.searchParams.get('state');
      const error = u.searchParams.get('error');
      if (error || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(discordAuth.errorHtml(error || 'No authorization code received'));
        return;
      }
      const result = await discordAuth.completeOAuth({ code, stateToken: state });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(discordAuth.successHtml(result));
    })().catch((err) => {
      const discordAuth = require('./src/denizen-discord-auth.js');
      const status = discordAuth.discordAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(discordAuth.errorHtml(err?.message || String(err)));
    });
    return true;
  }

  if (urlPath === '/api/visitor/auth/discord/status' && req.method === 'GET') {
    (async () => {
      const discordAuth = require('./src/denizen-discord-auth.js');
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const sessionToken = sessionAuth.extractSessionAuth(req, {
        session_token: u.searchParams.get('session_token') || u.searchParams.get('sessionToken'),
      });
      const status = await discordAuth.getLinkStatusForSession(sessionId, sessionToken);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...status }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      const discordAuth = require('./src/denizen-discord-auth.js');
      const status = discordAuth.discordAuthErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return true;
  }

  return false;
}

async function _createVisitorSession(req, res, body) {
  const existingId = body.session_id || body.sessionId || null;
  const existingToken = sessionAuth.extractSessionAuth(req, body);
  const accessGrant = body.access_grant || body.accessGrant || null;
  const grantPayload = accessGrant ? sessionAuth.verifyAccessGrant(accessGrant) : null;

  let orgSlug = body.org_slug ?? body.orgSlug ?? null;
  let tier = null;
  let metadata = body.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {};

  // Principal status comes from verified grants only — never from
  // client-asserted metadata or headers.
  delete metadata.is_ceo_principal;
  if (/^ceo/i.test(String(metadata.access_method || ''))) delete metadata.access_method;
  const ceoGrantToken = String(
    body.ceo_grant || req.headers['x-denizen-ceo-grant'] || '',
  ).trim() || null;
  let ceoVerified = !!(ceoGrantToken && sessionAuth.verifyCeoGrant(ceoGrantToken));

  if (grantPayload) {
    orgSlug = grantPayload.org_slug;
    tier = grantPayload.tier;
    metadata = { ...visitorAccess.metadataFromAccessGrant(grantPayload), ...metadata };
  } else if (existingId && ceoVerified) {
    const access = await visitorAccess.resolveSessionAccess(existingId);
    if (access.isDemo) {
      orgSlug = access.orgSlug;
      tier = 'demo';
      ceoVerified = false;
      metadata = { ...(access.session?.metadata || {}), ...metadata, tier: 'demo' };
      delete metadata.is_ceo_principal;
    } else {
      orgSlug = access.orgSlug;
      tier = access.tier;
      metadata = { ...(access.session?.metadata || {}), ...metadata };
    }
  } else if (ceoVerified && (body.org_slug || body.orgSlug || metadata.org_slug)) {
    orgSlug = body.org_slug || body.orgSlug || metadata.org_slug || promptTuning.teamOrgSlug;
    tier = 'team';
    metadata = { ...metadata, access_method: metadata.access_method || 'ceo' };
  } else if (existingId && existingToken) {
    await visitorAccess.assertSessionToken(existingId, existingToken);
    const access = await visitorAccess.resolveSessionAccess(existingId);
    orgSlug = access.orgSlug;
    tier = access.tier;
  } else if (body.demo === true || metadata.access_method === 'demo' || orgSlug === promptTuning.demoOrgSlug) {
    orgSlug = promptTuning.demoOrgSlug;
    tier = 'demo';
    metadata = {
      tier: 'demo',
      org_slug: orgSlug,
      access_method: 'demo',
      ...metadata,
    };
  } else {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'access_grant or valid session_token required for team sessions',
      code: 'DENIED',
    }));
    return;
  }

  if (tier === 'team' && !grantPayload && !(existingId && (existingToken || ceoVerified)) && !(ceoVerified && orgSlug)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'team tier requires access_grant', code: 'DENIED' }));
    return;
  }

  const resolvedOrg = await denizenVisitor.resolveOrgBySlug(orgSlug);
  if (!resolvedOrg) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `Organization "${orgSlug}" not found` }));
    return;
  }

  const isDemoOrg = resolvedOrg.slug === promptTuning.demoOrgSlug
    || tier === 'demo'
    || body.demo === true
    || metadata.access_method === 'demo'
    || metadata.access_method === 'demo_login'
    || metadata.access_method === 'discord';
  if (isDemoOrg) {
    ceoVerified = false;
    tier = 'demo';
    orgSlug = promptTuning.demoOrgSlug;
    metadata.tier = 'demo';
    metadata.access_method = metadata.access_method || 'demo';
    delete metadata.is_ceo_principal;
  }

  metadata.tier = tier || metadata.tier || (resolvedOrg.slug === promptTuning.demoOrgSlug ? 'demo' : 'team');
  metadata.org_slug = resolvedOrg.slug;

  // A CEO-code or team-owner login grant is signed by us — it counts as verification.
  if (grantPayload?.access_method === 'ceo_code') ceoVerified = true;
  if (grantPayload?.access_method === 'owner_login') ceoVerified = true;
  if (ceoVerified) {
    metadata.is_ceo_principal = true;
    metadata.tier = 'ceo';
    tier = 'ceo';
    if (!metadata.access_method || metadata.access_method === 'owner_login') {
      metadata.access_method = 'ceo';
    }
  }

  // Keep the login email on the session so team-account lookups by session work.
  const emailForMeta = grantPayload?.email || body.email || body.identity_email || null;
  if (emailForMeta && !metadata.email) {
    metadata.email = String(emailForMeta).trim().toLowerCase();
  }

  let sessionToken = null;
  let sessionTokenHash = null;
  const isRefresh = !!(existingId && existingToken);
  const issueToken = tier !== 'demo';
  const mintToken = issueToken && (!isRefresh || (existingId && !existingToken && ceoVerified));
  if (mintToken) {
    const created = sessionAuth.createSessionToken();
    sessionToken = created.token;
    sessionTokenHash = created.hash;
  }

  const session = await denizenVisitor.createOrUpdateSession({
    sessionId: existingId,
    displayName: body.display_name ?? body.displayName,
    metadata,
    orgId: resolvedOrg.id,
    sessionTokenHash: sessionTokenHash || undefined,
    forceNewId: !existingId,
  });

  let linkedIdentity = null;
  if (session?.identity_id) {
    linkedIdentity = await userIdentity.getIdentityById(session.identity_id).catch(() => null);
  }
  if (grantPayload?.email && session?.id) {
    linkedIdentity = await teamAuth.linkAccountToSession(
      grantPayload.email,
      session.id,
      body.display_name ?? body.displayName,
    );
  }

  const sessionEmail = grantPayload?.email
    || body.email
    || body.identity_email
    || null;
  if (sessionEmail && session?.id) {
    // Team-code visitors typed their work email — link their team account
    // (and through it their real identity) instead of minting a guest one.
    if (!grantPayload?.email && (metadata.tier || tier) === 'team' && !metadata.is_ceo_principal) {
      linkedIdentity = await _withIdentityTimeout(
        teamAuth.linkAccountToSession(
          sessionEmail,
          session.id,
          body.display_name ?? body.displayName,
        ),
      ) || linkedIdentity;
    }
    if (!linkedIdentity?.id) {
      linkedIdentity = await _withIdentityTimeout(
        userIdentity.resolveIdentityForSession({
          email: sessionEmail,
          displayName: body.display_name ?? body.displayName,
          tier: metadata.tier || tier,
          orgId: resolvedOrg.id,
          orgSlug: resolvedOrg.slug,
          source: metadata.access_method || (tier === 'demo' ? 'demo' : 'session'),
          sessionId: session.id,
        }),
      ) || linkedIdentity;
    }
  }

  if (!linkedIdentity?.id && metadata.is_ceo_principal && session?.id) {
    let ceoEmail = sessionEmail || metadata.email || teamAuth.configuredOwnerEmail();
    if (!ceoEmail) {
      const account = await teamAuth.getTeamAccountForSession(session.id).catch(() => null);
      ceoEmail = account?.email || null;
    }
    if (!ceoEmail) {
      ceoEmail = process.env.DENIZEN_CEO_IDENTITY_EMAIL
        || `ceo@${resolvedOrg.slug}.denizen.local`;
    }
    linkedIdentity = await _withIdentityTimeout(
      userIdentity.resolveIdentityForSession({
        email: ceoEmail,
        displayName: body.display_name ?? body.displayName ?? 'CEO',
        tier: metadata.tier || tier || 'team',
        orgId: resolvedOrg.id,
        orgSlug: resolvedOrg.slug,
        source: 'ceo',
        sessionId: session.id,
      }),
    );
    if (linkedIdentity?.id) {
      // Stamp the CEO's own identity row so identity-based principal checks
      // hold even when a request carries no grant (e.g. background jobs).
      userIdentity.markCeoPrincipal(linkedIdentity.id);
    }
  }

  if (!linkedIdentity?.id && session?.id) {
    linkedIdentity = await _withIdentityTimeout(
      userIdentity.ensureIdentityForSession(session.id, {
        session,
        email: sessionEmail || metadata.email || null,
        displayName: body.display_name ?? body.displayName,
        tier: metadata.tier || tier,
        orgId: resolvedOrg.id,
        orgSlug: resolvedOrg.slug,
        source: metadata.access_method || (tier === 'demo' ? 'demo' : 'session'),
      }),
    ) || linkedIdentity;
  }

  if (linkedIdentity?.id) {
    const identityForNotify = linkedIdentity;
    const notifyTier = metadata.tier || tier;
    if (ceoVerified) {
      userIdentity.markCeoPrincipal(linkedIdentity.id);
    }
    denizenDb.enqueue(async () => {
      if (hostCompute.isLocalOperatorRequest(req)) {
        await hostCompute.markHostOperatorIfLocal(identityForNotify.id, req).catch(() => null);
      }
      await visitorNotify.notifyWelcomeLogin(identityForNotify, {
        tier: notifyTier,
        returning: (identityForNotify.login_count || 0) > 1,
      });
      await visitorNotify.notifyDiscordNewUser(identityForNotify, {
        tier: notifyTier,
      });
    });
  }

  const payload = {
    ok: true,
    session,
    org: { slug: resolvedOrg.slug, id: resolvedOrg.id },
  };
  if (sessionToken) payload.session_token = sessionToken;
  if (linkedIdentity) payload.identity = userIdentity.toClientIdentity(linkedIdentity);
  // Rolling refresh: every verified CEO touch gets a fresh grant so the
  // stored one never expires under an active CEO.
  if (ceoVerified) payload.ceo_grant = sessionAuth.createCeoGrant();
  try {
    sessionCookie.setSessionCookies(res, {
      sessionId: session?.id || existingId || null,
      sessionToken: sessionToken || existingToken || null,
    });
  } catch (_) {}
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function _verifyVisitorSession(req, sessionId, body = {}) {
  if (!sessionId) {
    throw new visitorAccess.VisitorAccessError('session_id required', 'BAD_INPUT');
  }
  const token = sessionAuth.extractSessionAuth(req, body);
  await visitorAccess.assertSessionToken(sessionId, token);
  return visitorAccess.resolveSessionAccess(sessionId);
}

async function _resolveChatIdentityId(session, sessionId) {
  let identityId = session?.identity_id || null;
  if (!identityId && sessionId) {
    const identity = await userIdentity.getIdentityBySession(sessionId).catch(() => null);
    identityId = identity?.id || null;
    if (identityId) {
      await userIdentity.linkSessionToIdentity(identityId, sessionId).catch(() => null);
    }
  }
  if (!identityId && session) {
    const meta = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    const email = String(meta.email || '').trim().toLowerCase();
    if (email && email.includes('@')) {
      const identity = await userIdentity.upsertIdentity({
        email,
        displayName: session.display_name,
        tier: meta.tier || 'team',
        orgId: session.org_id || null,
        updateDisplayName: false,
      }).catch(() => null);
      if (identity?.id) {
        identityId = identity.id;
        await userIdentity.linkSessionToIdentity(identityId, sessionId).catch(() => null);
      }
    }
  }
  if (!identityId && sessionId) {
    identityId = `session:${sessionId}`;
  }
  return identityId;
}

async function _batchAddNpcTeamMembers(session, body = {}) {
  const keys = Array.isArray(body.npc_keys) ? body.npc_keys : (Array.isArray(body.npcKeys) ? body.npcKeys : []);
  if (!keys.length) {
    return { status: 400, payload: { ok: false, error: 'npc_keys[] required' } };
  }
  if (!session?.identity_id) {
    return { status: 409, payload: { ok: false, error: 'This session is not linked to a user profile yet' } };
  }
  const npcRoster = require('./src/npc-roster');
  const rosterLabel = (key) => {
    const entry = (npcRoster.entries || []).find((e) => e.folder === key);
    return entry?.display || key;
  };
  const added = [];
  const errors = [];
  for (const rawKey of keys) {
    const npcKey = String(rawKey || '').trim().toLowerCase();
    if (!npcKey) continue;
    try {
      const eligible = denizenVisitor.isNpcTeamEligible(npcKey);
      if (!eligible?.eligible) {
        errors.push({ npc_key: npcKey, error: eligible?.reason || 'ineligible' });
        continue;
      }
      const saved = await userIdentity.upsertNpcTeamMember(session.identity_id, {
        orgId: session.org_id || null,
        npcKey,
        displayName: body.display_name ?? body.displayName ?? rosterLabel(npcKey),
        role: body.role || 'assistant',
      });
      if (!saved) {
        errors.push({ npc_key: npcKey, error: 'save_failed' });
        continue;
      }
      added.push(npcKey);
    } catch (err) {
      errors.push({ npc_key: npcKey, error: err?.message || String(err) });
    }
  }
  const team = await userIdentity.getNpcTeam(session.identity_id);
  return { status: 200, payload: { ok: true, added, errors, team: team || null } };
}

async function _resolveVisitorToolGate(sessionId) {
  if (!sessionId) return { canUseRealWork: true, sessionTier: null };
  try {
    const access = await visitorAccess.resolveSessionAccess(sessionId);
    return {
      sessionTier: access.tier,
      canUseRealWork: visitorAccess.canUseRealWork(access.session?.metadata, access.org?.settings),
      sessionMetadata: access.session?.metadata || null,
      orgSettings: access.org?.settings || null,
    };
  } catch (_) {
    return { canUseRealWork: false, sessionTier: 'demo', sessionMetadata: null, orgSettings: null };
  }
}

const handleCrmRoutes = mountCrmRoutes({
  verifyVisitorSession: _verifyVisitorSession,
  readJsonBody: _readJsonBody,
  npcBrains,
  broadcastToOffice: _broadcastToOffice,
});

const handleStudioBoardRoutes = mountStudioBoardRoutes({
  verifyVisitorSession: _verifyVisitorSession,
  readJsonBody: _readJsonBody,
});

const handleBusinessStudioRoutes = mountBusinessStudioRoutes({
  verifyVisitorSession: _verifyVisitorSession,
  readJsonBody: _readJsonBody,
});

const handleN8nRoutes = mountN8nRoutes();
const handleOfficeProgressRoutes = require('./src/office-progress-routes').createOfficeProgressRouteHandler();

const handleComputeRoutes = mountComputeRoutes({
  internalToken: process.env.DENIZEN_INTERNAL_API_TOKEN || '',
  fleetAgentToken: process.env.DENIZEN_FLEET_AGENT_TOKEN || '',
  denizenCredits,
  userIdentity,
  verifyVisitorSession: _verifyVisitorSession,
  get npcBrains() {
    return npcBrains;
  },
  onBouncerPatrolComplete({ nodeId, patrol } = {}) {
    const agg = bouncerPatrolAggregate.applyMeshPatrolResult(worldState, nodeId, patrol);
    if (!agg) return;
    const msg = JSON.stringify({
      type: 'bouncer_patrol_result',
      summary: agg.summary,
      openPorts: agg.openPorts || [],
      mesh: true,
      totalNodes: agg.totalNodes,
      healthyNodes: agg.healthyNodes,
      ts: agg.ts,
    });
    (agentWss ? agentWss.clients : new Set()).forEach((c) => {
      if (c.readyState === 1) c.send(msg);
    });
  },
});

lmStudioRouter.startProbeLoop(
  Number(process.env.LM_STUDIO_PROBE_INTERVAL_MS) || 45000,
);

hardwareMonitor.startHostSampler({
  intervalMs: 5000,
  onSample: (snap) => {
    fleetRegistry.setGlobalHostSnapshot(snap);
    lmStudioRouter.ingestFromMachine(snap);
    const hostIdentityId = process.env.DENIZEN_FLEET_IDENTITY_ID || null;
    if (hostIdentityId) {
      const scored = nodeProfiler.scoreHardware({
        cpuCores: snap.cpu_cores ?? null,
        ramMb: snap.ram?.total_mb ?? null,
        vramMb: snap.gpu?.vram_total_mb ?? null,
        gpu: snap.gpu?.model ?? null,
      });
      contributionTracker.recordSample({
        identityId: hostIdentityId,
        machineId: snap.machine_id || `host-${snap.hostname || 'denizen'}`,
        hardwareScore: scored.score,
        contributionLevel: 'max',
        contributing: true,
        lmStudioActive: true,
        liveMetrics: snap,
        role: 'host',
      });
    }
  },
});
fleetRegistry.startAuxiliaryProbeLoop(60000);

computeSettlement.startSettlementLoop({
  intervalMs: Number(process.env.DENIZEN_SETTLEMENT_INTERVAL_MS) || undefined,
  creditsApi: denizenCredits,
  async countContributingMachines(identityId) {
    const summary = fleetRegistry.buildFleetSummary(identityId);
    return summary.totals?.contributing_machines || summary.fleet?.length || 1;
  },
});

if (!IS_RELAY_ONLY) {
  computeProducer.startMeshJobProducer({
    getNpcBrains: () => npcBrains,
  });
  meshTelemetryWorker.startServerTelemetryWorker({ computeQueue, log });
} else {
  console.log('[compute-producer] skipped — relay-only node');
}

const MESH_MAINTAIN_MS = Number(process.env.DENIZEN_MESH_MAINTAIN_MS) || 5 * 60 * 1000;
const MESH_STALE_MS = Number(process.env.DENIZEN_MESH_STALE_JOB_MS) || 30 * 60 * 1000;
setInterval(() => {
  computeQueue.reclaimStaleJobs(MESH_STALE_MS)
    .then((r) => {
      if (r.reclaimed > 0) log.info('ComputeQueue', `reclaimed ${r.reclaimed} stale assigned job(s)`);
    })
    .catch((err) => console.warn('[ComputeQueue] reclaim failed:', err?.message || err));
  computeQueue.expireOldQueuedJobs()
    .then((r) => {
      if (r.expired > 0) log.info('ComputeQueue', `expired ${r.expired} stale queued job(s)`);
    })
    .catch((err) => console.warn('[ComputeQueue] expire failed:', err?.message || err));
}, MESH_MAINTAIN_MS);
computeQueue.reclaimStaleJobs(MESH_STALE_MS).catch(() => {});
computeQueue.expireOldQueuedJobs().catch(() => {});

async function _buildMeshContextForAdvice() {
  const [pending, assigned] = await Promise.all([
    computeQueue.listPendingJobs(50).catch(() => []),
    computeQueue.listAssignedJobs(50).catch(() => []),
  ]);
  const fleetSummary = fleetRegistry.buildFleetSummary(null);
  const fleet = fleetSummary?.fleet || [];
  const staleAssigned = assigned.filter((j) => {
    const started = j.started_at ? new Date(j.started_at).getTime() : 0;
    return started && (Date.now() - started) > MESH_STALE_MS;
  }).length;
  let lmReachable = lmStudioRouter.anyReachable();
  if (!lmReachable) {
    try {
      const h = await new Promise((resolve) => {
        const req = http.get('http://127.0.0.1:1234/v1/models', { timeout: 2000 }, (res) => {
          resolve(res.statusCode >= 200 && res.statusCode < 300);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });
      lmReachable = !!h;
    } catch (_) {
      lmReachable = false;
    }
  }
  const base = {
    taskText: '',
    queuePending: pending.length,
    assignedStuck: staleAssigned,
    fleet,
    lmStudioReachable: lmReachable,
    denizenRoot: __dirname,
  };
  const signals = resourcePressure.gatherSignals(base);
  return {
    ...base,
    resourcePressure: signals,
    resource_pressure_block: resourcePressure.buildResourcePressureBlock(signals),
  };
}

let _lastResourceAlertSeverity = 'low';

function _broadcastOps(m) {
  const raw = JSON.stringify(m);
  if (agentWss) {
    agentWss.clients.forEach((c) => { if (c.readyState === 1) c.send(raw); });
  }
}

async function _maybeBroadcastResourcePressure(meshCtx) {
  const signals = meshCtx?.resourcePressure;
  if (!signals || !resourcePressure.shouldBroadcastAlert(signals, _lastResourceAlertSeverity)) return;
  _lastResourceAlertSeverity = signals.severity;
  _broadcastOps({
    type: 'resource_pressure_alert',
    severity: signals.severity,
    pressures: signals.pressures,
    queue_pending: signals.queue_pending,
    ts: Date.now(),
  });
}

async function _handleMeshOpsComputeRoutes(req, res, urlPath) {
  if (urlPath === '/api/compute/resource-pressure' && req.method === 'GET') {
    const meshCtx = await _buildMeshContextForAdvice();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      signals: meshCtx.resourcePressure,
      block: meshCtx.resource_pressure_block,
    }));
    return true;
  }

  if (urlPath === '/api/compute/scale-advice' && (req.method === 'GET' || req.method === 'POST')) {
    const meshCtx = await _buildMeshContextForAdvice();
    const signals = meshCtx.resourcePressure || {};
    const plan = meshScaleAdvisor.adviseScale(signals);
    let autoScale = null;
    if (req.method === 'POST') {
      const body = await _readJsonBody(req, 16 * 1024).catch(() => ({}));
      if (body.execute === true || body.auto === true) {
        autoScale = await meshScaleAdvisor.executeAutoScale({
          signals,
          deps: { computeQueue, probeLmStudio: healthRunbook.probeLmStudio },
          broadcast: _broadcastOps,
        });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, signals, plan, auto_scale: autoScale }));
    return true;
  }

  if (urlPath === '/api/compute/task-advice' && (req.method === 'GET' || req.method === 'POST')) {
    let taskText = '';
    let sessionId = null;
    if (req.method === 'POST') {
      const body = await _readJsonBody(req, 64 * 1024);
      taskText = body.task || body.task_text || body.text || '';
      sessionId = body.session_id || body.sessionId || null;
    } else {
      const u = new URL(req.url, 'http://localhost');
      taskText = u.searchParams.get('task') || u.searchParams.get('text') || '';
      sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
    }
    const meshCtx = await _buildMeshContextForAdvice();
    meshCtx.taskText = taskText;
    if (sessionId) {
      const keys = await denizenVisitor.getSessionProviderKeys(sessionId).catch(() => ({}));
      meshCtx.hasVisitorAnthropicKey = !!keys.anthropic;
      meshCtx.hasVisitorOpenaiKey = !!keys.openai;
    }
    const advice = taskResourceAdvisor.advise(meshCtx);
    await _maybeBroadcastResourcePressure(meshCtx).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...advice }));
    return true;
  }

  return false;
}

function _skillGapBroadcast(m) {
  const raw = JSON.stringify(m);
  if (agentWss) {
    agentWss.clients.forEach((c) => { if (c.readyState === 1) c.send(raw); });
  }
}

async function _notifyCeoSkillProposal({ proposal, requestedBy, purpose, npcName }) {
  if (!proposal?.id) return;
  try {
    worldState.pushEvent(
      'skill-proposal',
      `Skill proposal ${proposal.slug} from ${npcName} for ${requestedBy || 'teammate'}: ${String(purpose || '').slice(0, 80)}`,
    );
  } catch (_) {}
  _skillGapBroadcast({
    type: 'skill_proposal_pending',
    proposal: {
      id: proposal.id,
      slug: proposal.slug,
      status: proposal.status,
      npc: npcName,
      scanFlags: proposal.scanFlags || [],
    },
    requestedBy: requestedBy || null,
    purpose: String(purpose || '').slice(0, 200),
    ts: Date.now(),
  });
}

async function _buildSkillGapDeps(sessionId, meshContext = {}) {
  const providerKeys = sessionId
    ? await denizenVisitor.getSessionProviderKeys(sessionId).catch(() => ({}))
    : {};
  return {
    webResearch,
    skillBuilder,
    registry: jelly.registry,
    approvedMap: _approvedSkillScripts(),
    denizenRoot: __dirname,
    npcBrains,
    providerKeys,
    meshContext,
    broadcast: _skillGapBroadcast,
    runBuildSkill: async (npc, params) => {
      const r = await runNpcSkill(npc, 'build-skill', params);
      return {
        ok: r?.ok !== false,
        proposal: r?.proposal || null,
        output: r?.output,
        error: r?.ok === false ? r?.output : null,
      };
    },
    notifyCeo: _notifyCeoSkillProposal,
  };
}

async function _runSkillGapFromChat({
  ws,
  npcName,
  sessionId,
  message,
  visitorCtx,
  visitorToolGate,
  meshContext,
}) {
  const assistantKey = String(visitorCtx?.assistant?.npc_key || '').toLowerCase();
  const isAssistant = assistantKey && assistantKey === String(npcName || '').toLowerCase();
  if (!isAssistant && npcName !== 'Lucy') return null;

  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'player_chat_response',
      npcName,
      text: 'Figuring out how to do that — checking existing skills, researching the web, scanning GitHub, and drafting a proposal for Dolonia…',
      delegation: null,
      actions: [{ action: 'skill_gap_pipeline', phase: 'start' }],
    }));
  }

  const deps = await _buildSkillGapDeps(sessionId, meshContext);
  const pipeline = await skillGapOrchestrator.runGapPipeline({
    npcName,
    message,
    requestedBy: visitorCtx?.displayName || null,
    deps,
  });

  if (pipeline?.output) {
    try { npcBrains.injectSkillResult(npcName, 'skill-gap', pipeline.output); } catch (_) {}
  }

  if (ws?.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'player_chat_response',
      npcName,
      text: String(pipeline?.output || 'Skill pipeline finished.').slice(0, 2000),
      delegation: null,
      actions: [],
      skill_gap: {
        ok: !!pipeline?.ok,
        phase: pipeline?.phase || null,
        proposal: pipeline?.proposal
          ? { id: pipeline.proposal.id, slug: pipeline.proposal.slug, status: pipeline.proposal.status }
          : null,
      },
    }));
  }
  return pipeline;
}

function _canManageOrgNpcTeam(session) {
  if (!session) return false;
  if (session.is_ceo_principal || session.tier === 'ceo') return true;
  const role = String(session.team_role || '').toLowerCase();
  return role === 'owner' || role === 'admin' || role === 'ceo';
}

function _mcpScopesFromBody(body = {}) {
  if (Array.isArray(body.scopes) && body.scopes.length) {
    return mcpScopes.normalizeScopes(body.scopes);
  }
  const preset = body.scope_preset || body.scopePreset;
  if (preset) return mcpScopes.normalizeScopes(preset);
  return mcpScopes.normalizeScopes(null);
}

function _hasOrgNpcTeamAccess(session) {
  if (!session?.org_id) return false;
  if (_canManageOrgNpcTeam(session)) return true;
  return session.tier === 'team' || session.tier === 'ceo';
}

async function _executePlayerChatSkillFollowup({
  ws,
  npcName,
  sessionId,
  message,
  responseText,
  visitorCtx,
  visitorToolGate,
  meshContext = null,
  gapAlreadyHandled = false,
  ceoLookup = false,
  ceoDirectOrder = false,
  forceInfer = false,
}) {
  let extraSkills = [];
  if (visitorCtx?.identityId) {
    try {
      extraSkills = await userIdentity.getNpcTeamMemberExtraSkills(
        visitorCtx.identityId,
        visitorCtx.orgId || null,
        npcName,
      );
    } catch (_) {}
  }
  const plan = playerChatSkills.planSkillExecution({
    npcName,
    message,
    responseText,
    isAssistant: String(visitorCtx?.assistant?.npc_key || '').toLowerCase()
      === String(npcName || '').toLowerCase(),
    canUseRealWork: visitorToolGate.canUseRealWork,
    ceoLookup,
    ceoDirectOrder,
    forceInfer,
    extraSkills,
  });

  if (!visitorToolGate?.canUseRealWork && !plan?.skill?.startsWith('crm-')) return;

  const assistantKey = String(visitorCtx?.assistant?.npc_key || '').toLowerCase();
  const isAssistant = assistantKey && assistantKey === String(npcName || '').toLowerCase();
  const approvedMap = _approvedSkillScripts();

  const gapCtx = meshContext || await _buildMeshContextForAdvice().catch(() => ({}));

  if (!plan?.skill) {
    if (!gapAlreadyHandled && skillGapOrchestrator.shouldOrchestrate({
      message,
      plan,
      registry: jelly.registry,
      approvedMap,
      isAssistant,
      canUseRealWork: visitorToolGate.canUseRealWork,
    })) {
      await _runSkillGapFromChat({
        ws, npcName, sessionId, message, visitorCtx, visitorToolGate, meshContext: gapCtx,
      });
    }
    return;
  }

  if (!gapAlreadyHandled && plan.skill === 'build-skill' && isAssistant) {
    await _runSkillGapFromChat({
      ws, npcName, sessionId, message, visitorCtx, visitorToolGate, meshContext: gapCtx,
    });
    return;
  }

  const skillGate = npcBrains.allowPlayerSkillRun(npcName, {
    sessionId,
    sessionTier: visitorToolGate.sessionTier,
    canUseRealWork: visitorToolGate.canUseRealWork,
    sessionMetadata: visitorToolGate.sessionMetadata,
    orgSettings: visitorToolGate.orgSettings,
  });
  if (!skillGate.allowed) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'player_chat_response',
        npcName,
        text: `I can't run ${plan.skill} yet — ${skillGate.reason || 'tool cooldown'}.`,
        delegation: null,
        actions: [],
      }));
    }
    return;
  }

  if (ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'player_chat_response',
      npcName,
      text: `Running ${plan.skill}…`,
      delegation: null,
      actions: [{ action: 'run_skill', skill: plan.skill }],
    }));
  }

  try {
    const skillParams = plan.skill === 'coding-agent'
      ? playerChatSkills.enrichCodingAgentParams(message, { ...(plan.params || {}) })
      : { ...(plan.params || {}) };
    if (/^crm-/.test(String(plan.skill || '')) && visitorCtx) {
      skillParams.profile = {
        ...(skillParams.profile || {}),
        ...(visitorCtx.displayName ? { name: visitorCtx.displayName } : {}),
        ...(visitorCtx.workPosition?.title ? { title: visitorCtx.workPosition.title } : {}),
      };
      if (visitorCtx.displayName) skillParams.displayName = visitorCtx.displayName;
      if (visitorCtx.workPosition) skillParams.workPosition = visitorCtx.workPosition;
      if (visitorCtx.orgSlug) skillParams.orgSlug = visitorCtx.orgSlug;
      if (visitorCtx.identityId) skillParams.identityId = visitorCtx.identityId;
      if (sessionId) skillParams.sessionId = sessionId;
      skillParams.task = skillParams.task || message;
      skillParams.inviterName = visitorCtx.displayName || npcName;
    }

    const result = await runNpcSkill(npcName, plan.skill, skillParams, {
      sessionId,
      identityId: visitorCtx?.identityId || null,
      ownerProfile: visitorCtx ? {
        display_name: visitorCtx.displayName || null,
        email: visitorCtx.email || null,
      } : null,
    });
    const data = result?.data && typeof result.data === 'object' ? result.data : null;
    const chatActions = require('./src/denizen-crm-chat-actions');
    const autoOpen = chatActions.shouldAutoOpenCrm(message)
      && !crmNpcPersonas?.isWriteSkill?.(plan.skill);
    const crmActions = Array.isArray(data?.crm_actions)
      ? chatActions.normalizeCrmActions(data.crm_actions, { autoOpen })
      : null;
    const output = data?.summary
      || (typeof result?.output === 'string'
        ? result.output
        : (result?.ok === false ? (result.error || 'Skill failed') : JSON.stringify(result?.output ?? result ?? '').slice(0, 1500)));
    const actions = crmActions
      ? crmActions.map((a) => ({ action: 'open_crm', ...a }))
      : [];

    if (!gapAlreadyHandled && skillGapOrchestrator.shouldOrchestrate({
      message,
      skillResult: result,
      plan,
      registry: jelly.registry,
      approvedMap,
      isAssistant,
      canUseRealWork: visitorToolGate.canUseRealWork,
    })) {
      await _runSkillGapFromChat({
        ws, npcName, sessionId, message, visitorCtx, visitorToolGate, meshContext: gapCtx,
      });
      return;
    }

    npcBrains.injectSkillResult(npcName, plan.skill, output);
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'player_chat_response',
        npcName,
        text: String(output || 'Done.').slice(0, 2000),
        delegation: null,
        actions,
        crm_actions: crmActions,
        crm_auto_open: autoOpen,
        skill_result: { skill: plan.skill, ok: result?.ok !== false },
      }));
    }
  } catch (err) {
    if (!gapAlreadyHandled && skillGapOrchestrator.shouldOrchestrate({
      message,
      skillResult: { ok: false, output: String(err?.message || err) },
      plan,
      registry: jelly.registry,
      approvedMap,
      isAssistant,
      canUseRealWork: visitorToolGate.canUseRealWork,
    })) {
      await _runSkillGapFromChat({
        ws, npcName, sessionId, message, visitorCtx, visitorToolGate, meshContext: gapCtx,
      });
      return;
    }
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'player_chat_response',
        npcName,
        text: `${plan.skill} failed: ${err?.message || err}`,
        delegation: null,
        actions: [],
        error: String(err?.message || err),
      }));
    }
  }
}

function _denyVisitorRealTools(ws, npcName) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'player_chat_response',
      npcName,
      text: 'Demo mode — chat and the office tour work here, but CRM writes (contacts, deals, setup) need team access. Ask me for CRM setup status and I\'ll guide you with links.',
      delegation: null,
      actions: [],
    }));
  }
  global._npcStats.playerChatSucceeded++;
}

async function _handleVisitorHandoffPost(req, res) {
  const body = await _readJsonBody(req, 64 * 1024);
  let fromSessionId = body.from_session_id || body.fromSessionId;
  const message = body.message;
  if ((body.is_ceo || body.isCeo) && !fromSessionId) {
    fromSessionId = await denizenVisitor.getOrCreateCeoBridgeSession();
  }
  if (!fromSessionId || !message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'from_session_id (or is_ceo) and message required' }));
    return;
  }
  const handoffAccess = await visitorAccess.resolveSessionAccess(fromSessionId);
  if (!handoffAccess.isDemo && !(body.is_ceo || body.isCeo)) {
    await _verifyVisitorSession(req, fromSessionId, body);
  }
  const toNpcKey = String(body.to_npc ?? body.toNpc ?? '').trim().toLowerCase();
  const routesToLucy = toNpcKey === 'lucy';
  const routesToCeo = Boolean((body.to_ceo ?? body.toCeo) || routesToLucy);
  if (routesToCeo) {
    visitorAccess.assertTeamFeature(handoffAccess, 'to_ceo');
  }
  const target = await denizenVisitor.resolveHandoffTarget({
    toSessionId: body.to_session_id || body.toSessionId,
    toCeo: routesToCeo,
    toDisplayName: body.to_display_name ?? body.toDisplayName,
  });
  if (!(body.is_ceo || body.isCeo) && !target.is_ceo_bridge) {
    await visitorConnections.assertCanMessage({ fromSessionId, toSessionId: target.session_id });
  }
  const handoff = await denizenVisitor.sendHandoff({
    fromSessionId,
    toSessionId: target.session_id,
    fromNpc: body.from_npc ?? body.fromNpc ?? ((body.is_ceo || body.isCeo) ? 'ceo' : undefined),
    toNpc: body.to_npc ?? body.toNpc,
    message,
    metadata: body.metadata,
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, handoff, target }));
}

function _writeVisitorConnectionError(res, err) {
  const status = visitorConnections.connectionErrorStatus(err);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
}

function _mapResearchPriority(p) {
  const s = String(p || '').toLowerCase();
  if (s === 'urgent' || s === 'high') return 8;
  if (s === 'low') return 3;
  return 5;
}

// Wire broadcast into npc-brains so task-chain advancement can send WS events
const _agentBroadcast = (msg, opts = {}) => {
  officeRegistry.broadcastAgent(_agentClients(), msg, opts);
  if (_relayPublishAgentFrame && msg && typeof msg === 'object') {
    _relayPublishAgentFrame(msg);
  }
};

npcBrains.setBroadcast(_agentBroadcast);
npcBrains.setRunNpcSkill((npcName, skill, params) => runNpcSkill(npcName, skill, params));

npcBrains.setThinkWake((npcName, reason, opts) => npcThinkRunner.wake(npcName, reason, opts));

// Same broadcaster, wired into the PC activity tracker. Every started /
// done / failed PC task fans out to the browser as `pc_activity` events
// so the telemetry panel's "PC activity" section refreshes instantly
// without polling.
pcActivity.setBroadcast((msg) => {
  const raw = typeof msg === 'string' ? msg : JSON.stringify(msg);
  (agentWss ? agentWss.clients : new Set()).forEach((c) => {
    if (c.readyState === 1) c.send(raw);
  });
  if (_relayPublishAgentFrame) {
    let payload = msg;
    if (typeof msg === 'string') {
      try { payload = JSON.parse(msg); } catch (_) { payload = null; }
    }
    if (payload && typeof payload === 'object') _relayPublishAgentFrame(payload);
  }
});

// --- Jelly 🪼 — Denizen skill runtime (your tech; OpenClaw optional fallback) ---
const { createJelly, JELLY } = require('./jelly');
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || path.join(__dirname, '..', 'openclaw');
const SKILL_SCRIPTS = jellyPaths.resolveSkillScripts();
const JELLY_ENABLE_OPENCLAW_GATEWAY = String(process.env.JELLY_ENABLE_OPENCLAW_GATEWAY || 'false').toLowerCase() === 'true';
const GITHUB_REPO = 'Dolonia333/DENIZEN';

// Approved NPC-authored skills (slug → script path), cached for 5s so we don't
// re-read the proposals file on every skill dispatch. Refreshed on approval.
let _approvedSkillCache = { at: 0, map: {} };
function _approvedSkillScripts() {
  const now = Date.now();
  if (now - _approvedSkillCache.at > 5000) {
    try { _approvedSkillCache = { at: now, map: skillBuilder.getApprovedSkillScripts() }; }
    catch (_) { _approvedSkillCache = { at: now, map: {} }; }
  }
  return _approvedSkillCache.map;
}

/**
 * Convene a dynamic, multi-turn meeting. Wires the meeting-runner to the NPC
 * brains (each participant speaks in their own voice/model), the WS broadcast
 * (so they visibly talk in the conference room), and the directive system (so
 * action items become real follow-up work).
 */
function startMeeting({ topic, facilitator, participants } = {}) {
  const broadcast = (m) => (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
  // Sensible cross-functional default roster if the CEO didn't name people.
  const roster = (Array.isArray(participants) && participants.length)
    ? participants
    : ['Abby', 'Marcus', 'Sarah', 'Alex'];
  const lead = facilitator || (roster.includes('Abby') ? 'Abby' : roster[0]);
  return meetingRunner.run({
    topic,
    facilitator: lead,
    participants: roster,
    meetingTurnFn: (npc, opts) => npcBrains.meetingTurn(npc, opts),
    broadcastFn: broadcast,
    assignDirectiveFn: (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, urgent),
  });
}

/** Serialize browser searches — one persistent profile cannot launch twice. */
let _browserSearchChain = Promise.resolve();

/**
 * Any NPC opens a VISIBLE browser, searches DuckDuckGo, and surfaces results in chat.
 * Shared by /api/lucy-search, player_chat, and runNpcSkill('web-search').
 */
function runNpcWebSearch(npcName, query, opts = {}) {
  const npc = String(npcName || 'Lucy');
  const { spawn } = require('node:child_process');
  const q = String(query || '').trim();
  const openOnly = opts.openOnly === true;
  if (!q && !openOnly && !opts.directUrl) {
    return Promise.resolve({ ok: false, error: 'query required', query: '', results: [], summary: '' });
  }

  const headless = resolveLucyBrowserHeadless(opts);
  const quiet = opts.quiet === true;
  const showBrowserUi = true;
  const broadcast = opts.broadcast || ((m) => {
    const raw = JSON.stringify(m);
    (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(raw); });
  });

  const runOnce = async () => {
  if (!probePlaywrightBrowsers()) {
    const act = pcActivity.record({
      npc, kind: 'web-search',
      task: openOnly ? 'open browser' : `search: ${q.slice(0, 120)}`,
      mode: 'background', status: 'started',
    });
    if (showBrowserUi || !quiet) {
      broadcast({
        type: 'npc_skill_start', npcName: npc, skill: 'web-search',
        skillParams: openOnly ? { openOnly: true } : { query: q }, ts: Date.now(),
      });
    }
    try {
      const wr = await webResearch.research(q || 'news', { count: 5, read: 1 });
      const summary = wr.results?.length
        ? `Playwright isn't installed on this server — used background search:\n\n${webResearch.formatForNpc(wr).slice(0, 2000)}`
        : `Playwright isn't installed on this server. Ask ops to run: npx playwright install chromium`;
      pcActivity.record({
        id: act.id, npc, kind: 'web-search', task: act.task, mode: 'background',
        status: wr.results?.length ? 'done' : 'failed', durationMs: 0,
        detail: 'playwright-missing',
      });
      if (summary) _ceoBroadcast({ type: 'npc_report_to_ceo', npcName: npc, text: summary, ts: Date.now() });
      return { ok: !!wr.results?.length, query: q, results: wr.results || [], summary };
    } catch (err) {
      pcActivity.record({
        id: act.id, npc, kind: 'web-search', task: act.task, mode: 'background',
        status: 'failed', durationMs: 0, detail: String(err?.message || err).slice(0, 200),
      });
      const summary = `Browser search unavailable (Playwright not installed on server).`;
      _ceoBroadcast({ type: 'npc_report_to_ceo', npcName: npc, text: summary, ts: Date.now() });
      return { ok: false, query: q, results: [], summary, error: err?.message };
    }
  }

  const mirrorKey = normalizeNpcKey(npc);
  global._activeBrowserNpc = mirrorKey;
  if (q) global._lucyLastSearchQuery = q;
  if (openOnly && global._lucyBrowserOpen && _lucyBrowserChildAlive()) {
    const browserLabel = global._lucyLastBrowser?.label || 'Playwright Chromium';
    const summary = `${npc} browser is already open (${browserLabel}). Say what to search, or "close the browser".`;
    if (!quiet) {
      _ceoBroadcast({ type: 'npc_report_to_ceo', npcName: npc, text: summary, ts: Date.now() });
    }
    return Promise.resolve({ ok: true, query: q, results: [], summary, alreadyOpen: true });
  }

  // Reuse keep-open browser for follow-up searches (no kill/relaunch delay).
  if (!headless && !openOnly && q && _lucyBrowserChildAlive() && global._lucyBrowserOpen) {
    const cmdId = `search-${Date.now()}`;
    _writeSearchCommand({ id: cmdId, query: q });
    const result = await _readSearchResult(cmdId, 120000);
    if (result?.ok) {
      const brief = await buildLucySearchBrief(npcBrains, q, result.results || [], {
        staysOpenMsg: '\n\nBrowser stays open until you say "close the browser".',
        readPages: [],
      });
      _ceoBroadcast({ type: 'npc_report_to_ceo', npcName: npc, text: brief, ts: Date.now() });
      return { ok: true, query: q, results: result.results || [], summary: brief, keepOpen: true };
    }
  }

  // Always launch a fresh headed browser — IPC reuse caused zombie context errors.
  if (!headless) {
    await _prepareLucyBrowserForLaunch();
  }
  const untilClose = !headless && lucyBrowserUntilClose() && opts.keepOpen !== false;
  const act = pcActivity.record({
    npc, kind: 'web-search',
    task: openOnly ? 'open browser' : `search: ${q.slice(0, 120)}`,
    mode: 'visible', status: 'started',
  });
  if (showBrowserUi || !quiet) {
    broadcast({
      type: 'npc_skill_start', npcName: npc, skill: 'web-search',
      skillParams: openOnly ? { openOnly: true } : { query: q }, ts: Date.now(),
    });
    try {
      jellyPaths.ensureJellyDirs();
      const paths = getNpcBrowserPaths(mirrorKey);
      const prev = _readMirrorState(mirrorKey) || {};
      fs.writeFileSync(
        paths.stateFile,
        JSON.stringify({
          ...prev,
          status: 'searching',
          streaming: true,
          npcKey: mirrorKey,
          query: openOnly ? '' : q,
          lastActivity: openOnly ? 'Launching browser…' : `Searching: ${q}`,
          activityLog: [
            ...(Array.isArray(prev.activityLog) ? prev.activityLog.slice(-19) : []),
            { line: openOnly ? 'Launching browser…' : `Searching: ${q}`, at: Date.now() },
          ],
          updatedAt: Date.now(),
        }),
        'utf8',
      );
    } catch (_) {}
    _broadcastNpcMirrorUpdate(broadcast, mirrorKey);
  }

  const script = SKILL_SCRIPTS['web-search'];
  const startMs = Date.now();
  const lingerMs = untilClose ? 0 : Number(opts.lingerMs || process.env.LUCY_SEARCH_LINGER_MS || 4 * 60 * 1000);

  const browserMode = String(opts.browserMode || process.env.LUCY_BROWSER_MODE || 'auto').toLowerCase();
  const spawnArgs = ['--query', q || 'browser', '--headless', headless ? 'true' : 'false', '--browser-mode', browserMode];
  if (openOnly) spawnArgs.push('--open-only', 'true');
  if (opts.directUrl) spawnArgs.push('--direct-url', String(opts.directUrl));
  if (opts.jobBoard) spawnArgs.push('--job-board', String(opts.jobBoard));
  if (untilClose) {
    clearLucyCloseFlag();
    spawnArgs.push('--keep-open', 'true');
  } else if (!headless && lingerMs > 0) {
    spawnArgs.push('--linger-ms', String(lingerMs));
  }

  const finishSearch = async (parsed, errOut, resolve) => {
    const ok = !!(parsed && parsed.ok);
    const results = ok ? (parsed.results || []) : [];
    const lingerSec = parsed?.lingerMs ? Math.round(parsed.lingerMs / 1000) : 0;
    pcActivity.record({
      id: act.id, npc, kind: 'web-search', task: act.task, mode: 'visible',
      status: ok ? 'done' : 'failed',
      durationMs: Date.now() - startMs,
      detail: ok
        ? `${results.length} results${lingerSec ? ` · browser open ${lingerSec}s` : ''}`
        : (parsed?.error || errOut).slice(0, 240),
    });
    const browserLabel = parsed?.browserEngine === 'chrome'
      ? 'Playwright + Chrome'
      : parsed?.browserEngine === 'msedge'
        ? 'Playwright + Edge'
        : 'Playwright Chromium';
    const staysOpenMsg = parsed?.keepOpen
      ? '\n\nBrowser stays open until you say "close the browser".'
      : lingerSec ? `\n\n(Browser stays open ~${Math.round(lingerSec / 60)} min so you can browse.)` : '';

    // Always check for research briefs first if the query is about findings (Bob research etc.)
    let summary;
    const lowerQ = String(q || '').toLowerCase();
    if (lowerQ.includes('what did you find') || lowerQ.includes('research findings') || lowerQ.includes('bob research') || lowerQ.includes('what did bob find')) {
      try {
        const latestBrief = findLatestResearchBrief();
        if (latestBrief) {
          summary = `Bob's latest research brief:\n${latestBrief.summary || latestBrief.content.slice(0, 1500)}\n\nFile: ${latestBrief.path}`;
          // Treat as success
          resolve({ ok: true, summary });
          return;
        }
      } catch (_) {}
    }

    // Clean error output — ignore normal browser selection logs
    let cleanErr = (parsed?.error || errOut || '').trim();
    cleanErr = cleanErr
      .split('\n')
      .filter(line => !/\[browser-helpers\]/.test(line))
      .join('\n')
      .trim() || 'no results';

    summary = parsed?.openOnly && ok
      ? `Browser's open (${browserLabel}). What should I look up for you?${staysOpenMsg}`
      : ok && (results.length || (parsed?.readPages || []).length)
        ? await buildLucySearchBrief(npcBrains, q, results, {
          staysOpenMsg,
          readPages: parsed?.readPages || [],
        })
        : `I tried searching "${q}" but hit an error: ${cleanErr}`;
    if (!ok && q) {
      try {
        const wr = await webResearch.research(q, { count: 5, read: 1 });
        if (wr.results?.length) {
          results = wr.results;
          ok = true;
          summary = `Couldn't open the visible browser on this machine — used background search instead:\n\n${webResearch.formatForNpc(wr).slice(0, 2000)}${staysOpenMsg}`;
        }
      } catch (_) {}
    }
    if (parsed?.keepOpen && ok) global._lucyBrowserOpen = true;
    if (!ok) {
      const errText = String(parsed?.error || errOut || '');
      if (/closed|browser has been closed|profile|existing browser/i.test(errText)) {
        global._lucyBrowserOpen = false;
        _killLucyWebSearchChildren();
        _killOrphanLucyChromium();
      }
    }
    if (parsed?.browserSwitched) {
      summary += `\n\nI switched to ${browserLabel} — job sites like Indeed/LinkedIn often block automation browsers.`;
    }
    if (parsed?.visitedUrls?.length) {
      const vUrl = parsed.visitedUrls[0].url;
      const host = (() => { try { return new URL(vUrl).hostname; } catch { return vUrl; } })();
      if (isTunnelHost(vUrl)) {
        summary += `\n\nOpened ${host} via ${browserLabel} — sign in to Cloudflare Access there if prompted.`;
      } else if (parsed?.jobBoard) {
        summary += `\n\nOpened ${parsed.jobBoard} job search via ${browserLabel}. Complete any verification checkbox in the browser window if you see one.`;
      } else if (parsed?.browserEngine === 'chrome' || parsed?.browserEngine === 'msedge') {
        summary += `\n\nOpened ${host} via ${browserLabel}.`;
      }
    }
    if (parsed?.skippedTunnel?.length) {
      const hosts = [...new Set(parsed.skippedTunnel.map((r) => {
        try { return new URL(r.url).hostname; } catch { return r.url; }
      }))].slice(0, 3);
      summary += `\n\nTunnel links (${hosts.join(', ')}) are on the results page — say the hostname and I'll open them in Chrome.`;
    }
    if (parsed?.cloudflareChallenge?.blocked) {
      const ray = parsed.cloudflareChallenge.rayId ? ` Ray ID ${parsed.cloudflareChallenge.rayId}.` : '';
      const retried = parsed.cloudflareChallenge.retriedWith
        ? ` I already retried via Playwright + ${parsed.cloudflareChallenge.retriedWith === 'msedge' ? 'Edge' : 'Chrome'}.`
        : '';
      summary += `\n\nCloudflare blocked this page ("Additional Verification Required").${ray}${retried} Click through the checkbox in my browser window, or open the link in your everyday browser.`;
    }
    try {
      global._lucyLastBrowser = {
        engine: parsed?.browserEngine || 'chromium',
        label: browserLabel,
        url: parsed?.visitedUrls?.[0]?.url || parsed?.directUrl || null,
        at: Date.now(),
        query: q,
      };
      if (q) global._lucyLastSearchQuery = q;
    } catch (_) {}
    try { npcBrains.injectSkillResult && npcBrains.injectSkillResult(npc, 'web-search', summary); } catch (_) {}
    if (ok && summary) {
      _ceoBroadcast({ type: 'npc_report_to_ceo', npcName: npc, text: summary, ts: Date.now() });
    }
    if (!quiet) {
      broadcast({ type: 'npc_skill_result', npcName: npc, skill: 'web-search', ok, output: summary.slice(0, 200), ts: Date.now() });
    }
    if (showBrowserUi) {
      _broadcastNpcMirrorUpdate(broadcast, mirrorKey);
    }
    try {
      const session = researchSessions.startSession({ topic: q, npcName: npc });
      if (ok && results.length) {
        results.slice(0, 3).forEach((r) => {
          researchSessions.appendFinding(session.id, { source: 'web-search', text: r.title, url: r.url });
        });
      }
      if (ok && parsed?.readPages?.length) {
        parsed.readPages.slice(0, 2).forEach((p) => {
          researchSessions.appendFinding(session.id, {
            source: 'page-read',
            text: String(p.text || '').slice(0, 500),
            url: p.url,
          });
        });
      }
    } catch (_) {}
    if (opts.writeBrief && ok && results.length) {
      researchBrief.writeBrief({
        topic: q,
        searchResults: results,
        pages: [],
        npcBrains,
      }).then((brief) => {
        _ceoBroadcast({
          type: 'research_brief_done',
          npcName: npc,
          topic: q,
          path: brief.filePath,
          summary: brief.summary || summary.slice(0, 300),
          ts: Date.now(),
        });
      }).catch(() => {});
    }
    resolve({ ok, query: q, results, summary, screenshot: parsed?.screenshot || null, lingerMs: parsed?.lingerMs || lingerMs });
  };

  return new Promise((resolve) => {
    const child = spawn('node', [script, ...spawnArgs], {
      cwd: path.dirname(script),
      env: {
        ...process.env,
        JELLY_HOME: jellyPaths.jellyHome(),
        NPC_MIRROR_KEY: mirrorKey,
      },
    });
    let out = '', errOut = '';
    let settled = false;

    const tryParse = () => {
      if (settled) return;
      for (const line of out.split('\n').filter(Boolean)) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && (parsed.ok === true || parsed.ok === false || parsed.error)) {
            settled = true;
            finishSearch(parsed, errOut, resolve);
            return;
          }
        } catch (_) {}
      }
    };

    child.stdout.on('data', d => { out += d; tryParse(); });
    child.stderr.on('data', d => { errOut += d; });
    child.on('close', () => {
      if (settled) return;
      let parsed = null;
      try { parsed = JSON.parse(out.trim().split('\n').filter(Boolean).pop()); } catch (_) {}
      finishSearch(parsed, errOut, resolve);
    });
  });
  };

  const job = _browserSearchChain.then(runOnce);
  _browserSearchChain = job.catch(() => {});
  return job;
}

/** Back-compat alias — Lucy search API still uses this name internally. */
function runLucyWebSearch(query, opts = {}) {
  return runNpcWebSearch(opts.npcName || 'Lucy', query, opts);
}

/** Build desktop-agent instruction with profile hints for form fill. */
function buildScreenControlInstruction(playerText) {
  let instruction = String(playerText || '').trim();
  const isForm = /\b(?:fill|form|application|apply|type for me|enter for me)\b/i.test(instruction);
  instruction += '\n\nYou are on the CEO\'s REAL screen (Brave/browser/apps) — use mouse and keyboard.';
  if (isForm) {
    instruction += '\nFill every visible field. Do NOT click final Submit/Send unless the CEO explicitly said to submit.';
    try {
      const profilePath = path.join(__dirname, 'data', 'user-profile.json');
      const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      const bits = [
        profile.name && `name: ${profile.name}`,
        profile.email && `email: ${profile.email}`,
        profile.phone && `phone: ${profile.phone}`,
        profile.location && `location: ${profile.location}`,
        profile.linkedin && `linkedin: ${profile.linkedin}`,
        profile.title && `title: ${profile.title}`,
      ].filter(Boolean);
      if (bits.length) instruction += `\nCEO autofill data: ${bits.join('; ')}`;
    } catch (_) {}
  }
  return instruction;
}

async function triggerNpcScreenControl(npcName, playerText, broadcast, opts = {}) {
  const sessionId = opts.sessionId || opts.session_id || null;
  const instruction = buildScreenControlInstruction(playerText);
  const taskPreview = String(playerText || '').slice(0, 240);

  const act = pcActivity.record({
    npc: npcName, kind: 'desktop-agent',
    task: instruction.slice(0, 240),
    mode: 'visible', status: 'started',
  });
  const t0 = Date.now();

  const routed = await stationRouter.routeOrRunHost({
    sessionId,
    npcName,
    kind: 'desktop_agent',
    skill: 'desktop-agent',
    instruction,
    permissionLevel: opts.permissionLevel || opts.agent_permission_level || null,
    broadcast,
    waitTimeoutMs: 12 * 60 * 1000,
    hostRunner: async () => desktopAgent.runDesktopTask({ instruction, broadcast, npcName })
      .then((result) => {
        const summary = result?.summary || (result?.ok ? 'Done — check your screen.' : result?.error || 'Task failed.');
        return { ok: !!result?.ok, summary, result, routed: false };
      }),
  });

  const summary = routed.summary || routed.error || 'Task finished.';
  pcActivity.record({
    id: act.id, npc: npcName, kind: 'desktop-agent',
    task: act.task, mode: 'visible',
    status: routed.ok ? 'done' : 'failed',
    durationMs: Date.now() - t0,
    detail: String(summary).slice(0, 240),
  });
  try { npcBrains.injectSkillResult(npcName, 'desktop-agent', summary); } catch (_) {}
  broadcast({
    type: 'npc_skill_result',
    npcName, skill: 'desktop-agent', ok: !!routed.ok,
    output: String(summary).slice(0, 200), ts: Date.now(),
  });
  if (routed.ok) {
    broadcast({
      type: 'npc_report_to_ceo',
      npcName,
      text: String(summary).slice(0, 2000),
      ts: Date.now(),
    });
  }
  return routed;
}

/** Screenshot + vision describe + optional web research (any NPC). */
async function triggerNpcScreenObserve(npcName, instruction, broadcast, opts = {}) {
  const sessionId = opts.sessionId || opts.session_id || null;

  const routed = await stationRouter.routeOrRunHost({
    sessionId,
    npcName,
    kind: 'screen_observe',
    skill: 'screen-observe',
    instruction,
    permissionLevel: opts.permissionLevel || null,
    broadcast,
    waitTimeoutMs: 5 * 60 * 1000,
    hostRunner: async () => {
      const result = await screenObserve.runScreenObserve({
        npcName,
        instruction,
        broadcast,
        injectSkillResult: (n, skill, text) => {
          try { npcBrains.injectSkillResult(n, skill, text); } catch (_) {}
        },
        runWebSearch: (n, q) => runNpcWebSearch(n, q, { broadcast, quiet: false, headless: false })
          .then((r) => ({ ok: r.ok, summary: r.summary })),
        queueResearch: (topic, priority) => {
          try {
            researchQueue.addTopic({ topic, priority: priority || 'normal', requestedBy: npcName });
          } catch (_) {}
        },
      });
      return {
        ok: !!result.ok,
        summary: result.summary,
        screenshot: result.screenshot,
        topics: result.topics,
        searchQuery: result.searchQuery,
        routed: false,
      };
    },
  });

  if (routed.routed && routed.ok) {
    let summary = routed.summary || 'Screen observed.';
    const topics = Array.isArray(routed.topics) ? routed.topics.filter(Boolean).slice(0, 3) : [];
    const searchQuery = String(routed.searchQuery || '').trim()
      || (topics[0] ? `${topics[0]} overview` : '');

    if (screenObserve.autoResearchEnabled() && searchQuery) {
      try {
        const wr = await webResearch.research(searchQuery, { count: 4, read: 1 });
        if (wr.results.length) {
          summary += `\n\nWeb research for "${searchQuery}":\n${webResearch.formatForNpc(wr).slice(0, 1500)}`;
        }
      } catch (_) {}
    }

    try { npcBrains.injectSkillResult(npcName, 'screen-observe', summary); } catch (_) {}
    broadcast({
      type: 'npc_skill_result',
      npcName,
      skill: 'screen-observe',
      ok: true,
      output: summary.slice(0, 300),
      screenshot: routed.screenshot || null,
      ts: Date.now(),
    });
    broadcast({
      type: 'npc_report_to_ceo',
      npcName,
      text: summary.slice(0, 2000),
      ts: Date.now(),
    });
    return {
      ok: true,
      summary,
      screenshot: routed.screenshot || null,
      topics,
      searchQuery: searchQuery || null,
    };
  }

  if (routed.routed) {
    const msg = routed.summary || routed.error || 'Could not read the screen.';
    try { npcBrains.injectSkillResult(npcName, 'screen-observe', msg); } catch (_) {}
    broadcast({
      type: 'npc_skill_result',
      npcName,
      skill: 'screen-observe',
      ok: false,
      output: msg,
      ts: Date.now(),
    });
    return { ok: false, summary: msg, screenshot: null };
  }

  return {
    ok: !!routed.ok,
    summary: routed.summary,
    screenshot: routed.screenshot || null,
    topics: routed.topics || [],
    searchQuery: routed.searchQuery || null,
  };
}

const jelly = createJelly({
  denizenRoot: __dirname,
  openclawRoot: OPENCLAW_ROOT,
  approvedSkillScripts: _approvedSkillScripts,
  deps: {
    npcBrains,
    pcActivity,
    log,
    jobApplication,
    webResearch,
    skillBuilder,
    robinhoodMcp,
    rokiPaper,
    codingTaskRunner,
    linuxAgent: linuxAgentBridge,
    worldState,
    bouncerInvTake: _bouncerInvTake,
    githubRepo: GITHUB_REPO,
    runWebSearch: runNpcWebSearch,
    runResearch: runNpcWebSearch,
    runCitedResearch: (q, o) => require('./src/visitor-cited-research').runCitedResearch(q, o),
    healthRunbook,
    computeQueue,
    fleetRegistry,
    denizenDb,
    denizenRoot: __dirname,
    canRemediate: (npc) => healthRunbook.canRemediate(npc),
    approvedSkillScripts: _approvedSkillScripts,
  },
});
console.log(`[${JELLY.logTag}] ${jelly.listSkills().length} skills loaded — ${JELLY.tagline}`);

/**
 * Run a Jelly skill on behalf of an NPC. Fires async; result is injected
 * back into the NPC's next think() cycle via npcBrains.injectSkillResult().
 */
async function runNpcSkill(npcName, skill, skillParams = {}, opts = {}) {
  const broadcast = opts.broadcast || ((m) => {
    const raw = JSON.stringify(m);
    (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(raw); });
  });
  const sessionId = opts.sessionId || opts.session_id || null;
  const normalized = String(skill || '').trim().toLowerCase();
  const stationBridge = require('./src/denizen-station-skill-bridge');
  const stationRoute = sessionId
    ? stationBridge.resolveStationRoute(normalized, skillParams, {
      fallbackMessage: skillParams.task || skillParams.message || '',
    })
    : null;
  if (stationRoute && sessionId) {
    const { kind, instruction, payload } = stationRoute;
    log.info(JELLY.logTag, `${npcName} → station:${kind} (${normalized}) ${String(instruction).slice(0, 120)}`);
    const routed = await stationRouter.routeOrRunHost({
      sessionId,
      npcName,
      kind,
      skill: stationRoute.skill || normalized,
      instruction: String(instruction || '').slice(0, 4000),
      payload: payload || {},
      broadcast,
      waitTimeoutMs: 12 * 60 * 1000,
      hostRunner: async () => {
        if (kind === 'desktop_agent') {
          const result = await desktopAgent.runDesktopTask({
            instruction,
            broadcast,
            npcName,
          });
          const summary = result?.summary || (result?.ok ? 'Done.' : result?.error || 'Task failed.');
          return { ok: !!result?.ok, summary, result, routed: false };
        }
        if (kind === 'web_search') {
          const researchRouter = require('./src/research-router');
          const query = String(payload?.query || instruction || '').trim();
          const mesh = await researchRouter.runMeshWebSearch({
            computeQueue,
            npcName,
            query,
          });
          if (mesh.routed) {
            return { ok: !!mesh.ok, summary: mesh.summary || mesh.output, routed: false, mesh: true, job_id: mesh.job_id };
          }
          const r = await runNpcWebSearch(npcName, query, { broadcast, headless: false, quiet: false });
          return { ok: !!r.ok, summary: r.summary || r.error || 'Search finished.', routed: false };
        }
        if (kind === 'screen_observe') {
          return triggerNpcScreenObserve(npcName, instruction, broadcast, { sessionId });
        }
        return {
          ok: false,
          summary: 'No paired Denizen Desktop station — complete setup wizard on your computer.',
          routed: false,
        };
      },
    });
    const summary = routed.summary || routed.error || (routed.ok ? 'Done.' : 'Station task failed.');
    try { npcBrains.injectSkillResult(npcName, normalized, summary); } catch (_) {}
    broadcast({
      type: 'npc_skill_result',
      npcName,
      skill: normalized,
      ok: !!routed.ok,
      output: String(summary).slice(0, 2000),
      ts: Date.now(),
    });
    return { ok: !!routed.ok, output: summary, routed: !!routed.routed };
  }
  log.info(JELLY.logTag, `${npcName} → ${skill} ${JSON.stringify(skillParams)}`);
  let identityId = opts.identityId || skillParams.identityId || null;
  let ownerProfile = opts.ownerProfile || null;
  if (sessionId && (!identityId || !ownerProfile?.email)) {
    try {
      const session = await denizenVisitor.getSession(sessionId);
      identityId = identityId || session?.identity_id || null;
      if (!ownerProfile && session) {
        ownerProfile = { display_name: session.display_name || null };
      } else if (ownerProfile && session?.display_name && !ownerProfile.display_name) {
        ownerProfile.display_name = session.display_name;
      }
      const account = await teamAuth.getTeamAccountForSession(sessionId).catch(() => null);
      if (account?.email) {
        ownerProfile = { ...(ownerProfile || {}), email: account.email };
      }
    } catch (_) {}
  }
  return jelly.runSkill(npcName, skill, skillParams, { broadcast, identityId, ownerProfile });
}

// ── Denizen Harness: single control plane (inference + loops + Jelly tools + learning)
const { createDenizenHarness } = require('./src/denizen-harness');
const denizenHarness = createDenizenHarness({
  denizenRoot: __dirname,
  npcBrains,
  jelly,
  runNpcSkill,
  cofounderAgent,
  worldState,
  lmStudioRouter,
  log,
});
// Hot paths: brains queue + cofounder director → harness.complete()
try { npcBrains.setDenizenHarness?.(denizenHarness); } catch (_) {}
try { cofounderAgent.denizenHarness = denizenHarness; } catch (_) {}
console.log(
  `[denizen-harness] ${denizenHarness.version} ready — `
  + `${denizenHarness.listSkills().length} skills, `
  + `${denizenHarness.listNpcs().length} NPCs bound, `
  + 'brains+cofounder wired',
);

npcMcpGateway.configure({
  runNpcSkill,
  npcBrains,
  // Use the office agent bus (WS + pubsub relay) so announce/skills show live.
  broadcast: _agentBroadcast,
  robinhoodMcp,
  denizenVisitor,
  visitorConnections,
  listOnlineSessionIds,
  notifyCeoHandoff: _notifyCeoHandoff,
  computeQueue,
  lmStudioRouter,
  denizenDb,
  getInferenceHealth: async () => {
    const queueDepth = npcBrains?.getQueueDepth?.() || 0;
    const status = lmStudioRouter.buildStatus(queueDepth);
    return {
      reachable: status?.any_reachable ?? status?.lmStudio?.reachable ?? false,
      pool: status?.pool || null,
      queue_depth: queueDepth,
    };
  },
});
teamMcpGateway.configure({
  runNpcSkill,
  npcBrains,
  broadcast: _agentBroadcast,
  robinhoodMcp,
  denizenVisitor,
  visitorConnections,
  listOnlineSessionIds,
  notifyCeoHandoff: _notifyCeoHandoff,
  computeQueue,
  lmStudioRouter,
  denizenDb,
  getInferenceHealth: async () => {
    const queueDepth = npcBrains?.getQueueDepth?.() || 0;
    const status = lmStudioRouter.buildStatus(queueDepth);
    return {
      reachable: status?.any_reachable ?? status?.lmStudio?.reachable ?? false,
      pool: status?.pool || null,
      queue_depth: queueDepth,
    };
  },
});

npcThinkRunner.configure({
  npcBrains,
  denizenDb,
  broadcast: _agentBroadcast,
  runNpcSkill,
  enrichThinkContext: (npcName, ctx) => visitorOfficeContext.enrichThinkContext(npcName, ctx, {
    listOnlineSessionIds,
    denizenVisitor,
    visitorAccess,
    userIdentity,
  }),
});

// --- Furniture-placement whitelist + per-NPC daily budget ---
// The whitelist is shared between /api/place-furniture and the prompt
// hint in src/npc-brains.js. Edit both together if you ever expand it.
// Daily budget keeps a chatty NPC from spamming the office with couches.
const ALLOWED_PREFABS = new Set([
  'desk_small', 'desk_2x2', 'office_chair', 'monitor',
  'plant_small', 'plant_large', 'whiteboard', 'bookshelf',
  'coffee_machine', 'water_cooler', 'couch', 'rug',
  'standing_desk', 'phone_booth', 'meeting_table',
]);
const PLACEMENT_BUDGET_PER_DAY = 3;
const _placementBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _budgetKey(by) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${by}|${ymd}`;
}
function _checkPlacementBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, placedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const placedToday = _placementBudget.get(k) || 0;
  return {
    allowed: placedToday < PLACEMENT_BUDGET_PER_DAY,
    placedToday,
    cap: PLACEMENT_BUDGET_PER_DAY,
  };
}
function _consumePlacementBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _placementBudget.set(k, (_placementBudget.get(k) || 0) + 1);
}

// --- Per-NPC daily animation request budget ---
// Same shape as the placement budget, lower cap. Animation requests are
// heavier review work for the operator (each one might trigger image-
// generation cost) so we want NPCs to be picky about asking.
const ANIMATION_BUDGET_PER_DAY = 2;
const _animationBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _checkAnimationBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, requestedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const requestedToday = _animationBudget.get(k) || 0;
  return {
    allowed: requestedToday < ANIMATION_BUDGET_PER_DAY,
    requestedToday,
    cap: ANIMATION_BUDGET_PER_DAY,
  };
}
function _consumeAnimationBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _animationBudget.set(k, (_animationBudget.get(k) || 0) + 1);
}

// --- Per-NPC daily capability-request budget (Roadmap Stage 4, step 1) ---
// Tighter than the animation cap because each capability proposal — if
// approved — implies a code change in src/agent-actions.js + a server
// restart. NPCs should be picky: 1 proposal per NPC per UTC-local day.
// `system` / `operator` exempt for scripted seeds and manual fixtures.
const CAPABILITY_BUDGET_PER_DAY = 1;
const _capabilityBudget = new Map(); // key: "<by>|<YYYY-MM-DD>" → count
function _checkCapabilityBudget(by) {
  if (by === 'system' || by === 'operator') return { allowed: true, requestedToday: 0, cap: Infinity };
  const k = _budgetKey(by);
  const requestedToday = _capabilityBudget.get(k) || 0;
  return {
    allowed: requestedToday < CAPABILITY_BUDGET_PER_DAY,
    requestedToday,
    cap: CAPABILITY_BUDGET_PER_DAY,
  };
}
function _consumeCapabilityBudget(by) {
  if (by === 'system' || by === 'operator') return;
  const k = _budgetKey(by);
  _capabilityBudget.set(k, (_capabilityBudget.get(k) || 0) + 1);
}

// --- SOUL.md self-revision proposal queue (Roadmap Stage 3, steps 1-2) ---
// NPCs propose edits to their own SOUL.md once per in-game day. Proposals
// are persisted to data/soul-proposals.json and reviewed manually. We
// deliberately do NOT auto-apply edits — the identity-drift risk in
// docs/ROADMAP_SELF_ADVANCEMENT.md is real, and the approval gate is
// non-negotiable for this stage.
// Tests override SOUL_PROPOSALS_PATH so parallel test processes don't
// stomp on each other through a shared file (the read-modify-write isn't
// atomic across processes). Defaults to the on-disk dev location.
const SOUL_PROPOSALS_PATH = process.env.SOUL_PROPOSALS_PATH || path.join(__dirname, 'data', 'soul-proposals.json');
const SOUL_PROPOSALS_CAP = 50; // total stored proposals; oldest dropped when over
const SOUL_PROPOSAL_DAILY_CAP = 1; // per NPC per calendar day

function _ymdToday() {
  // Use UTC to match the ISO createdAt timestamp stamped by
  // soul-reflection.serializeProposal — otherwise NPCs near a midnight
  // boundary can submit twice in one local day if the UTC date crosses
  // between the two POSTs.
  return new Date().toISOString().slice(0, 10);
}

function _readSoulProposalsFile() {
  try {
    const raw = fs.readFileSync(SOUL_PROPOSALS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { proposals: [] };
    if (!Array.isArray(parsed.proposals)) parsed.proposals = [];
    return parsed;
  } catch (_) {
    // Lazy-create: file doesn't exist yet or is unreadable. Start clean.
    return { proposals: [] };
  }
}

function _writeSoulProposalsFile(obj) {
  try { fs.mkdirSync(path.dirname(SOUL_PROPOSALS_PATH), { recursive: true }); } catch (_) {}
  fs.writeFileSync(SOUL_PROPOSALS_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

function _countProposalsToday(proposals, npcName, ymd) {
  return proposals.filter(p => p && p.npcName === npcName && typeof p.createdAt === 'string' && p.createdAt.startsWith(ymd)).length;
}

// Resolve an NPC display name (e.g. "Abby", "Marcus") to its on-disk folder
// (e.g. "abby", "conference_man"). Falls back to the lowercased name if no
// roster entry matches — keeps test-only or future NPCs working.
function _resolveNpcFolder(npcName) {
  if (!npcName) return null;
  const entry = npcRoster.entries.find(e => e.display === npcName);
  if (entry) return entry.folder;
  return String(npcName).toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

// Recent NPC-brain errors, surfaced through GET /api/health so the client
// diagnostic widget can show them without the user opening the terminal.
global._npcRecentErrors = global._npcRecentErrors || [];
/**
 * Build a short demo command to show in the visual WSL terminal window.
 * This is the command the player *sees* Bouncer type — real investigation
 * runs separately via linuxAgent.investigate().
 */
function _buildTerminalShowCmd(threat) {
  const ip = linuxAgent.extractIp(threat.source || threat.detail || '');
  const cmds = {
    network_scan:   ip ? `nmap -T4 -F --open ${ip}` : 'ss -tnp',
    packet_anomaly: 'netstat -an | grep ESTABLISHED | head -20',
    brute_force:    'grep -iE "failed|invalid" /var/log/auth.log 2>/dev/null | tail -20',
    data_breach:    'lsof -i -n 2>/dev/null | grep ESTABLISHED | head -20',
    shell_exec:     'ps aux | sort -rk3 | head -20',
    api_abuse:      'netstat -an | awk \'{print $5}\' | cut -d: -f1 | sort | uniq -c | sort -rn | head -15',
    exfiltration:   'ss -tnp | grep ESTAB',
    scan_probe:     ip ? `nmap -T4 -F --open ${ip}` : 'ss -tlnp',
    process_spawn:  'ps aux | head -30',
    unknown:        'ss -tnp | head -20',
  };
  return cmds[threat.category] || cmds.unknown;
}

/**
 * Open a real visible terminal window showing Bouncer's WSL command.
 * Uses Windows Terminal (wt.exe) if available, falls back to cmd.exe.
 * Never types into the focused window — spawns its own process.
 */
function _fleetBearerFromReq(req) {
  const auth = String(req?.headers?.authorization || '').trim();
  return auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : '';
}

function _hasBouncerApiAuth(req) {
  if (bouncerInvestigation.validateInvestigationAuth(req)) return true;
  const fleet = String(process.env.DENIZEN_FLEET_AGENT_TOKEN || '').trim();
  if (fleet) {
    const bearer = _fleetBearerFromReq(req);
    const fleetHeader = String(req?.headers?.['x-fleet-agent-token'] || '').trim();
    if (bearer === fleet || fleetHeader === fleet) return true;
  }
  // Tokenless escape hatch for a local operator only: loopback socket with no
  // forwarding headers. Tunnel/proxy traffic always carries forwarding headers,
  // so remote requests can never qualify (hostCompute.isLocalOperatorRequest).
  return hostCompute.isLocalOperatorRequest(req);
}

// ---- Operator API auth (dossier defect G#4) --------------------------------
// Sync-verifiable principals: local operator (loopback, no forwarding headers),
// signed CEO grant (sent by DenizenVisitorSession.authHeaders()), or an
// internal/fleet bearer. Loopback smokes, NAS-local curls and the office UI
// with a CEO login all pass; anonymous tunnel traffic does not.
function _operatorBearerOk(req) {
  const bearer = _fleetBearerFromReq(req);
  const internal = String(process.env.DENIZEN_INTERNAL_API_TOKEN || '').trim();
  if (internal && bearer === internal) return true;
  const fleet = String(process.env.DENIZEN_FLEET_AGENT_TOKEN || '').trim();
  if (fleet && (bearer === fleet || String(req?.headers?.['x-fleet-agent-token'] || '').trim() === fleet)) return true;
  return false;
}

function _operatorAccessSync(req) {
  return hostCompute.isLocalOperatorRequest(req)
    || hostCompute.isCeoPrincipalRequest(req)
    || _operatorBearerOk(req);
}

function _denyOperatorApi(res) {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'operator_access_required' }));
}

// Async variant: sync principals OR a verified visitor session with
// org-manage/ceo tier (same shape as _securityTestHasCeoAccess).
async function _hasOperatorApiAccess(req) {
  if (_operatorAccessSync(req)) return true;
  try {
    return await _securityTestHasCeoAccess(req, new URL(req.url || '/', 'http://x'));
  } catch (_) {
    return false;
  }
}

// Voice-tier access: any verified visitor session (ordinary visitors
// legitimately hear NPC voices / use server STT), plus the sync principals.
async function _hasAnySessionAccess(req, body = {}) {
  if (_operatorAccessSync(req)) return true;
  try {
    const merged = _mergeSessionAuthBody(req, body || {});
    const sessionId = _sessionIdFromRequest(req, merged, new URL(req.url || '/', 'http://x'));
    if (!sessionId) return false;
    const access = await _verifyVisitorSession(req, sessionId, merged);
    return !!access;
  } catch (_) {
    return false;
  }
}

const _OPERATOR_GATED_GET_EXACT = new Set([
  '/api/llm/usage', '/api/costs', '/api/npc-profiles',
  '/api/market/portfolio', '/api/market/positions',
  '/api/intelligence/prediction-summary', '/api/federal/pipeline-summary',
  '/api/intelligence/mirofish-status',
]);
const _OPERATOR_GATED_POST_EXACT = new Set([
  '/api/market/watchlist', '/api/market/paper/reset', '/api/market/paper/order',
  '/api/telemetry/openclaw', '/api/intelligence/mirofish-sync',
]);

function _operatorGatedRoute(method, urlPath) {
  if (method === 'GET') {
    if (_OPERATOR_GATED_GET_EXACT.has(urlPath)) return true;
    if (urlPath.startsWith('/api/telemetry') || urlPath.startsWith('/api/pc-activity')) return true;
    // world-state stays open in public-demo mode — the spectate/follower
    // proxy depends on it (followers also send the internal bearer).
    if (urlPath === '/api/world-state') {
      return String(process.env.DENIZEN_PUBLIC_DEMO || '').trim() !== 'true';
    }
    return false;
  }
  if (method === 'POST') {
    if (_OPERATOR_GATED_POST_EXACT.has(urlPath)) return true;
    if (/^\/api\/market\/paper\/from-suggestion\/[^/]+$/.test(urlPath)) return true;
    if (/^\/api\/trade-suggestions\/[^/]+\/dismiss$/.test(urlPath)) return true;
    return false;
  }
  return false;
}

async function _securityTestHasCeoAccess(req, urlObj) {
  if (hostCompute.isCeoPrincipalRequest(req) || hostCompute.isLocalOperatorRequest(req)) return true;
  const merged = _mergeSessionAuthBody(req, {});
  const sessionId = _sessionIdFromRequest(req, merged, urlObj);
  if (!sessionId) return false;
  try {
    const access = await _verifyVisitorSession(req, sessionId, merged);
    return _canManageOrgNpcTeam(access?.session || null) || access?.tier === 'ceo';
  } catch (_) {
    return false;
  }
}

function _openBouncerTerminal(showCmd) {
  const { spawn } = require('node:child_process');
  const wslDistro = String(process.env.WSL_DISTRO || 'kali-linux').trim() || 'kali-linux';
  const wslArgs = ['-d', wslDistro, '--', 'bash', '-c', `${showCmd}; echo; echo '--- Bouncer scan complete. Press any key to close ---'; read -n1`];

  // Try Windows Terminal first (wt.exe)
  const wtPaths = [
    process.env.LOCALAPPDATA + '\\Microsoft\\WindowsApps\\wt.exe',
    'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal_1.0.0.0_x64__8wekyb3d8bbwe\\wt.exe',
  ];
  const fs = require('node:fs');
  const wtExe = wtPaths.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });

  if (wtExe) {
    // wt.exe -d . wsl -d kali-linux -- bash -c "cmd"
    spawn(wtExe, ['-d', '.', 'wsl', ...wslArgs], { detached: true, stdio: 'ignore' }).unref();
  } else {
    // Fallback: cmd.exe window running wsl directly
    // /k keeps the window open so Bouncer can read the output
    spawn('cmd.exe', ['/c', 'start', '"Bouncer - Kali Linux"', 'wsl', ...wslArgs], {
      detached: true, stdio: 'ignore', shell: true,
    }).unref();
  }
}

/**
 * Decide whether a Bouncer investigation result is serious enough to escalate
 * to Dan (IT Support). Returns true if there are strong indicators of a real threat.
 */
function investigationIsSerious(investigation) {
  const verdict = String(investigation?.verdict || '').trim().toLowerCase();
  if (verdict) {
    if (verdict.includes('threat confirmed') || verdict.includes('confirmed') || verdict.includes('blocked')) return true;
    if (verdict.includes('likely false positive') || verdict.includes('false positive') || verdict.includes('inconclusive') || verdict === 'clear' || verdict === 'ok') {
      return false;
    }
  }
  const summary = (investigation.summary || '').toLowerCase();
  return (
    (summary.includes('established') && summary.includes('failed')) ||
    summary.includes('brute') ||
    (summary.match(/open\s+port/g) || []).length > 3 ||
    (summary.includes('accepted') && summary.includes('invalid user'))
  );
}

function _recordNpcError(message) {
  const entry = { ts: Date.now(), message: String(message).slice(0, 400) };
  global._npcRecentErrors.push(entry);
  if (global._npcRecentErrors.length > 20) {
    global._npcRecentErrors = global._npcRecentErrors.slice(-20);
  }
}

// Counters so the diag panel can show "did this even arrive at the
// server?" When the user reports 'no response' but the server saw zero
// player_chat messages, that's a clear client-side issue — not a brain
// failure. Without this we'd be guessing.
global._npcStats = global._npcStats || {
  playerChatReceived: 0, playerChatSucceeded: 0, playerChatFailed: 0,
  npcConvReceived: 0,    npcConvSucceeded: 0,    npcConvFailed: 0,
  lastPlayerChatAt: null, lastNpcConvAt: null,
};

// --- External sinks (Supabase / n8n outbound webhooks) ---
// Forwards filtered worldState change events to whatever HTTP endpoints
// the operator has configured via env vars. No-op when no env vars are set.
const externalSink = new ExternalSink({ worldState });
externalSink.attach();

// Supabase instrumentation — facts, work output, LLM telemetry (fire-and-forget).
llmTelemetry.setDbSink((rec) => denizenDb.recordLlmEvent(rec));
denizenDb.attachWorldState(worldState);

// --- WorldState change broadcast (throttled) ---
// Whenever any subsystem mutates the world, queue a delta for every
// connected /agent-ws client. Without throttling, a busy moment (e.g. a
// tshark burst + every NPC thinking on the same tick) can fire dozens of
// `change` events in <50ms, each cutting its own JSON.stringify and ws.send
// per client. Coalesce into 500ms windows: the latest snapshot wins per
// `kind`, and a single combined frame goes out at most twice per second.
//
// `presence` is special-cased: that flag is human-toggled and the UI must
// feel instant, so we bypass the throttle for it. `threat` is also passed
// through because a robber spawning >500ms after the bubble fires looks
// wrong; the rest (npc state churn, task ticks, event-feed entries) absorb
// the latency just fine.
const WS_BROADCAST_INTERVAL_MS = 500;
const IMMEDIATE_KINDS = new Set([
  'presence', 'threat', 'threat-cleared',
  'office_level_up', 'achievement_unlocked', 'quest_complete', 'quest_claimed',
  'crm_lead',
]);

const worldPubsub = createWorldPubsub();

if (worldPubsub.role === 'primary' && worldPubsub.enabled) {
  _relayPublishAgentFrame = (frame) => worldPubsub.publish(frame).catch(() => null);
}
if (IS_RELAY_ONLY) {
  console.log(`[AgentWS] Relay-only mode (${worldPubsub.role}) — simulation and mutating WS disabled`);
}

let _pendingChanges = new Map(); // `${orgId}:${kind}` -> { orgId, kind, payload, ts }
let _broadcastTimer = null;
let _agentBusBuffer = [];        // collected agent-bus messages

function _defaultOrgId() {
  return worldState.getDefaultOrgId?.() || denizenDb.orgId || '__default__';
}

function _broadcastFrame() {
  _broadcastTimer = null;
  const changes = Array.from(_pendingChanges.values());
  const busMessages = _agentBusBuffer;
  _pendingChanges = new Map();
  _agentBusBuffer = [];
  if (changes.length === 0 && busMessages.length === 0) return;

  const byOrg = new Map();
  for (const entry of changes) {
    const oid = entry.orgId || _defaultOrgId();
    if (!byOrg.has(oid)) byOrg.set(oid, []);
    byOrg.get(oid).push(entry);
  }
  if (busMessages.length > 0) {
    const oid = _defaultOrgId();
    if (!byOrg.has(oid)) byOrg.set(oid, []);
  }

  for (const [orgId, orgChanges] of byOrg) {
    const frame = {
      type: 'world_state_batch',
      org_id: orgId,
      changes: orgChanges,
      busMessages: orgId === _defaultOrgId() ? busMessages : [],
      ts: Date.now(),
    };
    officeRegistry.broadcastAgent(_agentClients(), frame, { orgId });
    worldPubsub.publish(frame).catch(() => null);
  }
}

function _scheduleBroadcast() {
  if (_broadcastTimer) return;
  _broadcastTimer = setTimeout(_broadcastFrame, WS_BROADCAST_INTERVAL_MS);
}

function _sendImmediate(payload, opts = {}) {
  const orgId = opts.orgId ?? payload?.org_id ?? payload?.orgId ?? _defaultOrgId();
  const officeId = opts.officeId ?? payload?.office_id ?? null;
  const framed = { ...payload, org_id: orgId };
  officeRegistry.broadcastAgent(_agentClients(), framed, { officeId: officeId || undefined, orgId });
  worldPubsub.publish(framed).catch(() => null);
}

if (worldPubsub.role === 'follower') {
  worldPubsub.subscribe((frame) => {
    const serialized = JSON.stringify(frame);
    _agentClients().forEach((ws) => {
      if (ws.readyState !== 1) return;
      if (!officeRegistry.shouldDeliverToSocket(frame, ws)) return;
      try { ws.send(serialized); } catch (_) { /* drop */ }
    });
  }).catch((err) => {
    console.warn('[world-pubsub] follower subscribe failed:', err?.message || err);
  });
}

worldState.on('change', ({ orgId, kind, payload }) => {
  const oid = orgId || _defaultOrgId();
  const entry = { orgId: oid, kind, payload, ts: Date.now() };
  if (IMMEDIATE_KINDS.has(kind)) {
    _sendImmediate({ type: 'world_state', ...entry }, { orgId: oid });
    return;
  }
  // Latest write wins per org+kind for the next window.
  _pendingChanges.set(`${oid}:${kind}`, entry);
  _scheduleBroadcast();
});

// --- Agent bus mirror (also throttled in the same window) ---
agentBus.subscribe('*', (msg) => {
  _agentBusBuffer.push(msg);
  // Cap the buffer in case something pathological happens.
  if (_agentBusBuffer.length > 60) _agentBusBuffer.splice(0, _agentBusBuffer.length - 60);
  if (msg?.to && msg?.text && !IS_RELAY_ONLY) {
    npcThinkRunner.wake(msg.to, `agent_bus:${msg.kind || 'speak'}`, { urgent: true });
  }
  _scheduleBroadcast();
});

function safeDecodePath(url) {
  try {
    return decodeURIComponent(url.split('?')[0]);
  } catch (err) {
    return null;
  }
}

const server = http.createServer((req, res) => {
  // Route registry: optional extract for tests/tools — inline handlers in this file remain canonical.
  // See src/route-registry.js (competency-map, job-crm subset). Do not double-register without audit.

  let urlPath = safeDecodePath(req.url);
  const fullUrl = req.url;

  if (!urlPath) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // --- Security: check every request for suspicious patterns ---
  securityMonitor.checkHttpRequest(req);

  const inviteMatch = urlPath.match(/^\/(?:invite|join)\/([A-Za-z0-9_-]+)\/?$/);
  if (inviteMatch && req.method === 'GET') {
    res.writeHead(302, { Location: `/office?join=${encodeURIComponent(inviteMatch[1])}` });
    res.end();
    return;
  }

  if (urlPath === '/api/visitor/ping' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ts: Date.now() }));
    return;
  }

  // Visitor auth first — must stay fast (login modal); avoid waiting behind heavy routes.
  // GET + header fallback: Cloudflare tunnel may not forward POST bodies to origin.
  if (urlPath === '/api/visitor/access/verify' && (req.method === 'POST' || req.method === 'GET')) {
    (async () => {
      let code;
      let accessKind;
      if (req.method === 'GET') {
        const u = new URL(req.url, 'http://localhost');
        accessKind = _parseVisitorAccessKind(u.searchParams.get('kind') ?? u.searchParams.get('type'));
        code = String(
          req.headers['x-visitor-access-code']
          || u.searchParams.get('code')
          || '',
        ).trim();
      } else {
        const body = await _readJsonBody(req, 4 * 1024);
        accessKind = _parseVisitorAccessKind(body.kind ?? body.type);
        code = body.code;
      }
      if (!accessKind) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'kind must be "team" or "ceo"' }));
        return;
      }
      await _respondVisitorAccessVerify(res, code, accessKind);
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath === '/api/visitor/session/open' && req.method === 'GET') {
    (async () => {
      await _createVisitorSession(req, res, _visitorSessionBodyFromHeaders(req));
    })().catch((err) => {
      if (res.writableEnded) return;
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (_handleVisitorAuthRoutes(req, res, urlPath)) {
    return;
  }

  if (urlPath.startsWith('/api/office/')) {
    (async () => {
      await handleOfficeProgressRoutes(req, res);
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/studio-board/')) {
    (async () => {
      await handleStudioBoardRoutes(req, res);
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/business-studio/')) {
    (async () => {
      await handleBusinessStudioRoutes(req, res);
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/crm/')) {
    (async () => {
      await handleCrmRoutes(req, res);
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/n8n/')) {
    (async () => {
      await handleN8nRoutes(req, res, urlPath);
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath.startsWith('/api/compute/') || urlPath.startsWith('/api/desktop/')) {
    (async () => {
      const meshHandled = await _handleMeshOpsComputeRoutes(req, res, urlPath).catch(() => false);
      if (meshHandled || res.writableEnded) return;
      const handled = await handleComputeRoutes(req, res);
      if (handled || res.writableEnded) return;
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Compute route not found' }));
    })().catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  // MCP OAuth front door (discovery, registration, authorize/consent, token).
  if (urlPath.startsWith('/.well-known/oauth') || urlPath.startsWith('/mcp/oauth/')) {
    mcpOauth.handleOAuthRoute(req, res, urlPath, {
      getPublicBaseUrl: npcMcpGateway.getPublicBaseUrl,
      createMcpToken: npcMcpGateway.createMcpToken,
      guardVisitorFeature: _guardVisitorFeature,
      getDefaultOrgId: () => denizenDb.orgId || worldState.getDefaultOrgId?.() || null,
    }).then((handled) => {
      if (!handled && !res.writableEnded) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'not found' }));
      }
    }).catch((err) => {
      if (!res.writableEnded) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  const mcpNpcMatch = urlPath.match(/^\/mcp\/npc\/([^/]+)\/?$/);
  if (mcpNpcMatch) {
    npcMcpGateway.handleHttpRequest(req, res, mcpNpcMatch[1]).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/mcp/team' || urlPath === '/mcp/team/') {
    teamMcpGateway.handleHttpRequest(req, res).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/npc-sync/openapi.json' && req.method === 'GET') {
    const publicBase = npcMcpGateway.getPublicBaseUrl();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(npcMcpGateway.buildOpenApiSpec(publicBase)));
    return;
  }

  const npcSyncMatch = urlPath.match(/^\/api\/npc-sync\/(status|memory|activity|list-skills|skill-job|run-skill|assign-task|team-standup|handoffs|ack-handoff)\/?$/);
  if (npcSyncMatch) {
    npcMcpGateway.handleRestSync(req, res, npcSyncMatch[1]).catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Optional OpenClaw gateway proxy (off by default — Jelly is standalone)
  if (JELLY_ENABLE_OPENCLAW_GATEWAY && fullUrl.startsWith('/openclaw')) {
    const targetPath = fullUrl.replace(/^\/openclaw/, '') || '/';
    const proxyOpts = {
      hostname: OPENCLAW_HOST,
      port: OPENCLAW_PORT,
      path: targetPath,
      method: req.method,
      headers: { ...req.headers, host: `${OPENCLAW_HOST}:${OPENCLAW_PORT}` },
    };
    const proxyReq = http.request(proxyOpts, (proxyRes) => {
      // Strip headers that block iframe embedding
      const headers = { ...proxyRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      res.writeHead(502);
      res.end('OpenClaw proxy error: ' + err.message);
    });
    req.pipe(proxyReq);
    return;
  }

  // --- Per-office layout save/load API ---
  async function _resolveLayoutOfficeId(req, sessionId) {
    if (!sessionId) return officeRegistry.CEO_OFFICE_ID;
    await _verifyVisitorSession(req, sessionId, {});
    const session = await denizenVisitor.getSession(sessionId);
    return officeRegistry.resolveOfficeFromSession(session).officeId;
  }

  if (urlPath === '/api/layout' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 2 * 1024 * 1024);
      const sessionId = body.session_id || body.sessionId || null;
      const officeId = await _resolveLayoutOfficeId(req, sessionId);
      const incoming = body.layout ?? body;
      const existing = officeLayout.readLayoutSync(ROOT, officeId) || {};
      const merged = { ...existing, ...incoming };
      if (Array.isArray(incoming.placements)) merged.placements = incoming.placements;
      if (Array.isArray(incoming.items)) merged.items = incoming.items;
      officeLayout.writeLayoutSync(ROOT, officeId, merged);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, office_id: officeId, placements: (merged.placements || []).length }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/layout' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const officeId = sessionId
        ? await _resolveLayoutOfficeId(req, sessionId)
        : officeRegistry.CEO_OFFICE_ID;
      const layout = officeLayout.readLayoutSync(ROOT, officeId);
      if (!layout) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No saved layout', office_id: officeId }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...layout, office_id: officeId }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    });
    return;
  }

  // --- NPC-facing "place a single piece of furniture" endpoint ---
  // The NPC brain's placeFurniture action POSTs here. We append the
  // item to office-layout.json (read-modify-write), broadcast a
  // worldState event so everyone notices, and return the new item.
  // Validation is strict: a small whitelist of prefab kinds and bounds.
  //
  // Body shape: { by: "Abby", prefabId: "desk_small", x: 320, y: 240, reason?: "..." }
  if (urlPath === '/api/place-furniture' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const prefabId = String(p.prefabId || '').slice(0, 80);
      const x = parseInt(p.x, 10);
      const y = parseInt(p.y, 10);
      const reason = p.reason ? String(p.reason).slice(0, 200) : null;

      // Whitelist + bounds. Keep this short — expanding it should be a
      // deliberate change, not a wide-open "NPC can spawn anything" API.
      if (!ALLOWED_PREFABS.has(prefabId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `prefabId not in whitelist: ${prefabId}`, allowed: [...ALLOWED_PREFABS] }));
        return;
      }
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 16 || y < 16 || x > 1264 || y > 704) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'x/y out of bounds (must fit inside 1280×720 with 16px margin)' }));
        return;
      }

      // Per-NPC daily budget — keep a single NPC from bulldozing the
      // office. system/operator (the empty/'system' caller) is exempt
      // so manual fixtures still work.
      const budgetCheck = _checkPlacementBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily placement budget (${budgetCheck.cap}). Try again tomorrow.`,
          placedToday: budgetCheck.placedToday,
        }));
        return;
      }

      const officeId = p.office_id || p.officeId || officeRegistry.CEO_OFFICE_ID;

      // Anti-stacking + capacity guard. A leaky automated caller once piled
      // 649 plants on one tile ('system' is budget-exempt, so the daily
      // budget never stopped it) — identical prefabs within 12px are dupes,
      // and a full office rejects further placements outright.
      const existingLayout = officeLayout.readLayoutSync(ROOT, officeId);
      const existingItems = Array.isArray(existingLayout?.items) ? existingLayout.items : [];
      if (existingItems.length >= 250) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'office layout is full (250 placed items) — remove something first',
          itemCount: existingItems.length,
        }));
        return;
      }
      const dup = existingItems.find((it) => (
        it.prefabId === prefabId
        && Math.abs((it.x || 0) - x) <= 12
        && Math.abs((it.y || 0) - y) <= 12
      ));
      if (dup) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `a ${prefabId} already sits at (${dup.x}, ${dup.y}) — pick a different spot`,
          existing: dup.instanceId,
        }));
        return;
      }

      const instanceId = `npc_${prefabId}_${Date.now()}`;
      const item = { instanceId, prefabId, x, y, placedBy: by, placedAt: Date.now(), reason };
      try {
        officeLayout.appendFurnitureItem(ROOT, officeId, item);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist layout: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumePlacementBudget(by);

      // Surface as a worldState event so NPCs notice ("Abby placed a couch")
      // and the diag panel logs it.
      try {
        worldState.pushEvent('shipped', `${by} placed ${prefabId} at (${x},${y})${reason ? ' — ' + reason : ''}`);
      } catch (_) {}

      // Broadcast LIVE so the browser can instantiate the sprite without
      // waiting for a page reload. The client subscribes to
      // 'furniture_placed' and pushes the new item into _interactables.
      _sendImmediate({ type: 'furniture_placed', item, by, office_id: officeId }, { officeId });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, item }));
    });
    return;
  }

  // --- Remove a single piece of NPC-placed furniture ---
  // Body: { by: "Abby", instanceId: "npc_couch_169..." }
  // Only items whose instanceId starts with "npc_" can be removed —
  // hand-placed scene furniture is read-only. NPCs can remove their
  // own placements or each other's; we surface who removed what in
  // the world-state event feed so any griefing is visible.
  if (urlPath === '/api/remove-furniture' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const instanceId = String(p.instanceId || '');
      if (!instanceId.startsWith('npc_')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'instanceId must start with "npc_" (only NPC-placed furniture is removable)' }));
        return;
      }

      const officeId = p.office_id || p.officeId || officeRegistry.CEO_OFFICE_ID;
      const layout = officeLayout.readLayoutSync(ROOT, officeId);
      if (!layout?.items?.length) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no layout file', office_id: officeId }));
        return;
      }
      const idx = layout.items.findIndex((it) => it.instanceId === instanceId);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `instanceId not found: ${instanceId}` }));
        return;
      }
      const removed = layout.items[idx];
      try {
        officeLayout.removeFurnitureItem(ROOT, officeId, instanceId);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist layout: ' + err.message }));
        return;
      }
      try {
        worldState.pushEvent('shipped', `${by} removed ${removed.prefabId} (placed by ${removed.placedBy})`);
      } catch (_) {}
      _sendImmediate({ type: 'furniture_removed', instanceId, by, office_id: officeId }, { officeId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed }));
    });
    return;
  }

  // --- NPC-facing "request a new animation" endpoint ---
  // Stage 2 of the self-advancement roadmap. NPCs propose a new
  // animation by name + short description; the proposal goes into a
  // pending queue and an operator decides whether to actually generate
  // / register it. This endpoint does NOT generate sprite frames —
  // that's a separate (and currently stubbed) generator pipeline. See
  // docs/ANIMATION_FORGE.md.
  //
  // Body shape: { by: "Roki", animName: "meditate", description: "sitting cross-legged" }
  const animationProposalsFile = path.join(ROOT, 'data', 'animation-proposals.json');

  if (urlPath === '/api/request-animation' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const animName = String(p.animName || '').slice(0, 80);
      const description = String(p.description || '').slice(0, 400);

      // Shared validator — keeps the endpoint and animation-forge in lockstep.
      const v = animationForge.validateProposal({ animName, description });
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      // Daily budget — lower than the placement budget because each
      // proposal is heavier review work for the operator.
      const budgetCheck = _checkAnimationBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily animation-request budget (${budgetCheck.cap}). Try again tomorrow.`,
          requestedToday: budgetCheck.requestedToday,
        }));
        return;
      }

      // Read-modify-write the proposals file. Shape: { proposals: [...] }.
      let store = { proposals: [] };
      try {
        const raw = fs.readFileSync(animationProposalsFile, 'utf8');
        store = JSON.parse(raw);
        if (!Array.isArray(store.proposals)) store.proposals = [];
      } catch (_) {
        try { fs.mkdirSync(path.dirname(animationProposalsFile), { recursive: true }); } catch (__) {}
      }
      const id = `anim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const proposal = {
        id,
        by,
        animName,
        description,
        proposedAt: Date.now(),
        status: 'pending',
      };
      store.proposals.push(proposal);
      try {
        fs.writeFileSync(animationProposalsFile, JSON.stringify(store, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumeAnimationBudget(by);

      // Surface as a worldState event so the diag panel sees the
      // proposal arrive. NPCs may also notice — at minimum the operator
      // gets a breadcrumb.
      try {
        worldState.pushEvent('proposed-animation',
          `${by} proposed animation "${animName}": ${description}`);
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal }));
    });
    return;
  }

  // --- Operator-facing list of pending animation proposals ---
  // Used by a future operator review UI. Returns the raw JSON; an empty
  // file is treated as `{ proposals: [] }`.
  if (urlPath === '/api/animation-proposals' && req.method === 'GET') {
    let store = { proposals: [] };
    try {
      const raw = fs.readFileSync(animationProposalsFile, 'utf8');
      store = JSON.parse(raw);
      if (!Array.isArray(store.proposals)) store.proposals = [];
    } catch (_) { /* file may not exist yet */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store));
    return;
  }

  // --- Capability-request proposal queue (Roadmap Stage 4, step 1) ---
  // NPCs propose new actions (verbs) that don't exist yet. The proposal
  // goes to a pending queue and an operator decides whether to actually
  // implement the verb in src/agent-actions.js. This endpoint does NOT
  // implement anything — that's step 3 of the roadmap and explicitly
  // future work. See docs/CAPABILITY_PROPOSALS.md.
  //
  // Body shape: { by: "Roki", verbName: "whiteboardDraw", description: "..." }
  const capabilityProposalsFile = path.join(ROOT, 'data', 'capability-proposals.json');

  function _readCapabilityStore() {
    let store = { proposals: [] };
    try {
      const raw = fs.readFileSync(capabilityProposalsFile, 'utf8');
      store = JSON.parse(raw);
      if (!store || typeof store !== 'object') store = { proposals: [] };
      if (!Array.isArray(store.proposals)) store.proposals = [];
    } catch (_) { /* lazy-create */ }
    return store;
  }
  function _writeCapabilityStore(store) {
    try { fs.mkdirSync(path.dirname(capabilityProposalsFile), { recursive: true }); } catch (_) {}
    fs.writeFileSync(capabilityProposalsFile, JSON.stringify(store, null, 2), 'utf8');
  }

  if (urlPath === '/api/request-capability' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const by = String(p.by || 'system').slice(0, 40);
      const verbName = String(p.verbName || '').slice(0, 80);
      // Slice slightly above the validator's MAX_DESCRIPTION_LEN so the
      // validator can still surface a meaningful "too long" error instead
      // of having the endpoint silently truncate at the same boundary.
      const description = String(p.description || '').slice(0, 500);

      // Shared validator — keeps the endpoint and capability-proposal in lockstep.
      const v = capabilityProposal.validateProposal({ verbName, description });
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      // Daily budget — tighter than animations because each capability
      // proposal implies hand-written code + a restart if approved.
      const budgetCheck = _checkCapabilityBudget(by);
      if (!budgetCheck.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${by} has hit the daily capability-request budget (${budgetCheck.cap}). Try again tomorrow.`,
          requestedToday: budgetCheck.requestedToday,
        }));
        return;
      }

      const store = _readCapabilityStore();
      const proposal = capabilityProposal.serializeProposal({ by, verbName, description });
      store.proposals.push(proposal);
      try {
        _writeCapabilityStore(store);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }

      // Consume budget AFTER successful persist (don't penalize the NPC
      // for our IO failures).
      _consumeCapabilityBudget(by);

      try {
        worldState.pushEvent('proposed-capability',
          `${by} proposed capability "${verbName}": ${description}`);
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal }));
    });
    return;
  }

  // GET /api/npc-capabilities — all NPC capability cards
  if (urlPath === '/api/npc-capabilities' && req.method === 'GET') {
    const cards = npcCapabilities.DISPLAY_NAMES.map((name) => {
      const cap = npcCapabilities.getCapabilities(name);
      return cap ? { name, ...cap } : { name };
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ npcs: cards }));
    return;
  }

  // GET /api/npc-capabilities/:name — one NPC
  const capNameMatch = urlPath.match(/^\/api\/npc-capabilities\/([^/]+)$/);
  if (capNameMatch && req.method === 'GET') {
    const rawName = decodeURIComponent(capNameMatch[1]);
    const cap = npcCapabilities.getCapabilities(rawName);
    if (!cap) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unknown NPC' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cap));
    return;
  }

  // GET /api/competency-map — team skill aggregates (Phase 5.1)
  if (urlPath === '/api/competency-map' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const minScore = Number(url.searchParams.get('min_score') || 5);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      team: competencyMap.getTeamProfile(),
      gaps: competencyMap.getTeamGaps(Number.isFinite(minScore) ? minScore : 5),
    }));
    return;
  }

  const competencyNpcMatch = urlPath.match(/^\/api\/competency-map\/([^/]+)$/);
  if (competencyNpcMatch && req.method === 'GET') {
    const rawName = decodeURIComponent(competencyNpcMatch[1]);
    const profile = competencyMap.getNpcProfile(rawName);
    if (!profile) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no competency data for NPC' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, profile }));
    return;
  }

  // GET /api/platform-bridge/status — cloud CRM bridge availability
  if (urlPath === '/api/platform-bridge/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...platformBridge.platformBridgeStatus() }));
    return;
  }

  // GET /api/capability-proposals[?status=pending|approved|rejected]
  if (urlPath === '/api/capability-proposals' && req.method === 'GET') {
    const store = _readCapabilityStore();
    const url = new URL(req.url, 'http://x');
    const statusFilter = url.searchParams.get('status');
    let proposals = store.proposals;
    if (statusFilter) {
      proposals = proposals.filter(p => p && p.status === statusFilter);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals }));
    return;
  }

  // POST /api/capability-proposal/approve — body { id, decision, note? }
  // Same shape as /api/soul-proposal/approve. Does NOT implement the
  // verb — operator still has to ship the code by hand.
  if (urlPath === '/api/capability-proposal/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const id = String(payload.id || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = payload.note ? String(payload.note).slice(0, 400) : null;
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }));
        return;
      }

      const store = _readCapabilityStore();
      const idx = store.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      store.proposals[idx].status = decision;
      store.proposals[idx].review = {
        decision,
        note,
        reviewedAt: new Date().toISOString(),
      };
      try {
        _writeCapabilityStore(store);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist decision: ' + err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: store.proposals[idx] }));
    });
    return;
  }

  // --- SOUL.md self-revision proposal queue (Stage 3 steps 1-2) ---
  // Body: { npcName, proposal: { addToSoul, dropFromSoul, summary, confidence }, reflectionInput? }
  // Validates via src/soul-reflection.validateProposal, persists to
  // data/soul-proposals.json (lazy-create), enforces a 1/NPC/day cap +
  // a 50-proposal total cap (drops oldest), and emits a worldState event.
  // Does NOT apply the edit to SOUL.md — that's deferred (operator UI).
  if (urlPath === '/api/soul-proposal' && req.method === 'POST') {
    // Only the local NPC runtime (loopback reflection loop) or an internal
    // bearer may enqueue soul proposals (dossier G#4).
    if (!(hostCompute.isLocalOperatorRequest(req) || _operatorBearerOk(req))) {
      _denyOperatorApi(res);
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const npcName = String(payload.npcName || '').trim().slice(0, 40);
      if (!npcName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'npcName is required' }));
        return;
      }
      const v = soulReflection.validateProposal(payload.proposal);
      if (!v.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: v.error }));
        return;
      }

      const file = _readSoulProposalsFile();
      const ymd = _ymdToday();
      const todayCount = _countProposalsToday(file.proposals, npcName, ymd);
      if (todayCount >= SOUL_PROPOSAL_DAILY_CAP) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `${npcName} already has ${todayCount} proposal(s) for ${ymd} (cap: ${SOUL_PROPOSAL_DAILY_CAP}/day). Try again tomorrow.`,
          cap: SOUL_PROPOSAL_DAILY_CAP,
        }));
        return;
      }

      const record = soulReflection.serializeProposal({
        npcName,
        proposal: payload.proposal,
        reflectionInput: payload.reflectionInput,
      });

      file.proposals.push(record);
      // Drop oldest if we exceed the total cap.
      if (file.proposals.length > SOUL_PROPOSALS_CAP) {
        file.proposals.splice(0, file.proposals.length - SOUL_PROPOSALS_CAP);
      }
      try {
        _writeSoulProposalsFile(file);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal: ' + err.message }));
        return;
      }
      try {
        worldState.pushEvent('proposed-soul-edit', `${npcName} proposed a SOUL.md edit: ${record.proposal.summary}`);
      } catch (_) {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: record.id }));
    });
    return;
  }

  // GET /api/soul-proposals?npc=Name — returns persisted proposals.
  // Lazy-creates the file (returns { proposals: [] } if absent).
  if (urlPath === '/api/soul-proposals' && req.method === 'GET') {
    const file = _readSoulProposalsFile();
    const url = new URL(req.url, 'http://x');
    const npcFilter = url.searchParams.get('npc');
    let proposals = file.proposals;
    if (npcFilter) {
      proposals = proposals.filter(p => p && p.npcName === npcFilter);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals }));
    return;
  }

  const soulContextMatch = urlPath.match(/^\/api\/soul-proposals\/([^/]+)\/context$/);
  if (soulContextMatch && req.method === 'GET') {
    const id = soulContextMatch[1];
    const file = _readSoulProposalsFile();
    const record = file.proposals.find((p) => p && p.id === id);
    if (!record) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
      return;
    }
    const npcSlug = String(record.npcName || '').toLowerCase().replace(/\s+/g, '_');
    const soulPath = path.join(__dirname, 'npcs', npcSlug, 'SOUL.md');
    let currentSoul = '';
    try {
      currentSoul = fs.readFileSync(soulPath, 'utf8');
    } catch (_) {
      currentSoul = '';
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      npcName: record.npcName,
      currentSoul,
      proposal: record.proposal || {},
    }));
    return;
  }

  // POST /api/soul-proposal/approve — body { id, decision: 'approved'|'rejected', note? }
  // Updates the proposal status in place. Does NOT touch SOUL.md (deferred).
  if (urlPath === '/api/soul-proposal/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // Human-review gate: same access rule as the dossier/skill approval
      // routes (local operator, CEO grant, or approvals-capable session).
      try {
        const access = await _resolveApprovalsAccess(req, payload || {});
        if (!access?.operator) { _denyOperatorApi(res); return; }
      } catch (err) {
        res.writeHead(err?.status || 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || 'unauthorized' }));
        return;
      }
      const id = String(payload.id || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = payload.note ? String(payload.note).slice(0, 400) : null;
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }));
        return;
      }

      const file = _readSoulProposalsFile();
      const idx = file.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      file.proposals[idx].status = decision;
      file.proposals[idx].review = {
        decision,
        note,
        reviewedAt: new Date().toISOString(),
      };
      try {
        _writeSoulProposalsFile(file);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist decision: ' + err.message }));
        return;
      }
      _broadcastProposalQueueChanged('soul', decision, id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: file.proposals[idx] }));
    });
    return;
  }

  // POST /api/soul-proposal/apply — body { id }
  // Roadmap Stage 3 steps 3 + 4. Writes the approved proposal to the
  // target NPC's SOUL.md and appends a structured entry to SOUL.history.md.
  // Idempotent: re-applying the same id returns the existing receipt.
  // Operator gate: only proposals with status === 'approved' may be applied.
  if (urlPath === '/api/soul-proposal/apply' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // Mutates SOUL.md — same review-gate as approve (dossier G#4).
      try {
        const access = await _resolveApprovalsAccess(req, payload || {});
        if (!access?.operator) { _denyOperatorApi(res); return; }
      } catch (err) {
        res.writeHead(err?.status || 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || 'unauthorized' }));
        return;
      }
      const id = String(payload.id || '').trim();
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }

      const file = _readSoulProposalsFile();
      const idx = file.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      const record = file.proposals[idx];

      // Already applied — return the existing receipt with 200 so callers
      // can treat apply as idempotent. The 400 in the spec is for "tried to
      // apply an already-applied proposal expecting a fresh write"; in
      // practice returning the receipt with a clear status code is friendlier.
      // We pick 200 + `alreadyApplied: true` so the front-end can branch
      // without parsing error strings.
      if (record.status === 'applied') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, alreadyApplied: true, proposal: record }));
        return;
      }

      if (record.status !== 'approved') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `proposal must be approved before it can be applied (current status: ${record.status})`,
        }));
        return;
      }

      const folder = _resolveNpcFolder(record.npcName);
      const soulPath = path.join(__dirname, 'npcs', folder, 'SOUL.md');
      const historyPath = path.join(__dirname, 'npcs', folder, 'SOUL.history.md');

      let soulText;
      try {
        soulText = fs.readFileSync(soulPath, 'utf8');
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `SOUL.md not found for ${record.npcName} at npcs/${folder}/SOUL.md` }));
        return;
      }

      const { next, warnings } = soulReflection.applyProposalToSoul({
        soulText,
        proposal: record,
      });
      if (warnings && warnings.length) {
        for (const w of warnings) {
          console.warn(`[soul-apply] ${record.npcName} ${id}: ${w}`);
        }
      }

      const appliedAt = new Date().toISOString();
      const historyEntry = soulReflection.serializeHistoryEntry({
        proposal: record,
        applied: { at: appliedAt },
      });

      try {
        fs.writeFileSync(soulPath, next, 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to write SOUL.md: ' + err.message }));
        return;
      }

      try {
        // Append (create with header if missing) so multiple applications stack.
        let historyHeader = '';
        if (!fs.existsSync(historyPath)) {
          historyHeader = `# ${record.npcName} — SOUL.md Revision History\n\n`;
        }
        fs.appendFileSync(historyPath, historyHeader + historyEntry, 'utf8');
      } catch (err) {
        // Don't roll the SOUL.md back — the apply already happened. Just
        // surface the history-write failure so the operator knows.
        console.warn(`[soul-apply] failed to write SOUL.history.md for ${record.npcName}: ${err.message}`);
      }

      record.status = 'applied';
      record.applied = {
        at: appliedAt,
        soulPath: path.relative(__dirname, soulPath).replace(/\\/g, '/'),
        historyPath: path.relative(__dirname, historyPath).replace(/\\/g, '/'),
        warnings: warnings || [],
      };

      try {
        _writeSoulProposalsFile(file);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist proposal record: ' + err.message }));
        return;
      }

      try {
        worldState.pushEvent(
          'applied-soul-edit',
          `${record.npcName} SOUL.md updated from proposal ${id}`,
        );
      } catch (_) {}

      // Refresh the in-memory SOUL cache so the NPC's next think() picks
      // up the new personality without a restart.
      try { npcBrains.reloadSoul(record.npcName); } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: record }));
    });
    return;
  }

  // --- POST /api/animation-proposal/approve ---
  // Body: { id, decision: 'approved'|'rejected', note? }
  // Symmetric with /api/soul-proposal/approve so the operator UI can use
  // the same shape across kinds. Does NOT trigger sprite generation —
  // that's still future work (see docs/ANIMATION_FORGE.md). Flipping
  // status to 'approved' here just clears the proposal for whatever
  // generator pipeline lands later.
  if (urlPath === '/api/animation-proposal/approve' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const id = String(payload.id || '').trim();
      const decision = String(payload.decision || '').trim();
      const note = payload.note ? String(payload.note).slice(0, 400) : null;
      if (!id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'id is required' }));
        return;
      }
      if (decision !== 'approved' && decision !== 'rejected') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "decision must be 'approved' or 'rejected'" }));
        return;
      }
      let store = { proposals: [] };
      try {
        const raw = fs.readFileSync(animationProposalsFile, 'utf8');
        store = JSON.parse(raw);
        if (!Array.isArray(store.proposals)) store.proposals = [];
      } catch (_) { /* lazy-create equivalent */ }
      const idx = store.proposals.findIndex(p => p && p.id === id);
      if (idx === -1) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `proposal not found: ${id}` }));
        return;
      }
      store.proposals[idx].status = decision;
      store.proposals[idx].review = {
        decision,
        note,
        reviewedAt: new Date().toISOString(),
      };
      try {
        fs.mkdirSync(path.dirname(animationProposalsFile), { recursive: true });
        fs.writeFileSync(animationProposalsFile, JSON.stringify(store, null, 2), 'utf8');
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'failed to persist decision: ' + err.message }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, proposal: store.proposals[idx] }));
    });
    return;
  }

  // --- GET /api/proposals — aggregated read for the operator review UI ---
  // Unifies the animation + SOUL + (future) capability queues into a
  // single timestamp-sorted feed so the operator UI doesn't have to
  // remember three endpoints. Each entry is kind-tagged and carries the
  // raw record for "show details" UX.
  //
  // Query string:
  //   ?status=pending|approved|rejected|applied|all   default: pending
  //   ?kind=animation|soul|capability                 may be comma-separated
  //
  // Hard cap of 100 entries; newest first.
  if (urlPath === '/api/proposals' && req.method === 'GET') {
    (async () => {
      const url = new URL(req.url, 'http://x');
      const statusFilter = (url.searchParams.get('status') || 'pending').toLowerCase();
      const kindParam = url.searchParams.get('kind') || '';
      const kindFilter = new Set(
        kindParam.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      );
      const HARD_CAP = 100;

      let access;
      try {
        access = await _resolveApprovalsAccess(req, {});
      } catch (err) {
        if (err instanceof visitorAccess.VisitorAccessError) {
          return _writeVisitorAccessError(res, err);
        }
        const status = err.status || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
        return;
      }
      const { identityId, operator } = access;

      function maybe(kind) {
        return kindFilter.size === 0 || kindFilter.has(kind);
      }

      const merged = [];

      if (operator && maybe('animation')) {
        let store = { proposals: [] };
        try {
          const raw = fs.readFileSync(animationProposalsFile, 'utf8');
          store = JSON.parse(raw);
          if (!Array.isArray(store.proposals)) store.proposals = [];
        } catch (_) { /* missing file → empty */ }
        for (const p of store.proposals) {
          if (!p || typeof p !== 'object') continue;
          merged.push({
            kind: 'animation',
            id: p.id,
            by: p.by,
            status: p.status || 'pending',
            summary: `${p.animName || '?'} — ${p.description || ''}`.slice(0, 240),
            ts: Number(p.proposedAt) || 0,
            raw: p,
          });
        }
      }

      if (operator && maybe('soul')) {
        const file = _readSoulProposalsFile();
        for (const p of file.proposals) {
          if (!p || typeof p !== 'object') continue;
          const tsMs = p.createdAt ? Date.parse(p.createdAt) : 0;
          merged.push({
            kind: 'soul',
            id: p.id,
            by: p.npcName,
            status: p.status || 'pending',
            summary: (p.proposal && p.proposal.summary) ? String(p.proposal.summary).slice(0, 240) : '(no summary)',
            ts: Number.isFinite(tsMs) ? tsMs : 0,
            raw: p,
          });
        }
      }

      if (operator && maybe('capability')) {
        const capabilityProposalsFile = path.join(ROOT, 'data', 'capability-proposals.json');
        try {
          const raw = fs.readFileSync(capabilityProposalsFile, 'utf8');
          const store = JSON.parse(raw);
          const arr = Array.isArray(store?.proposals) ? store.proposals : [];
          for (const p of arr) {
            if (!p || typeof p !== 'object') continue;
            const tsMs = Number(p.proposedAt) || (p.createdAt ? Date.parse(p.createdAt) : 0) || 0;
            const label = p.verbName || p.capability || p.animName || p.name || '?';
            const desc = p.description || p.summary || '';
            merged.push({
              kind: 'capability',
              id: p.id,
              by: p.by || p.npcName,
              status: p.status || 'pending',
              summary: `${label} — ${desc}`.slice(0, 240),
              ts: Number.isFinite(tsMs) ? tsMs : 0,
              raw: p,
            });
          }
        } catch (_) { /* file may not exist yet — fine */ }
      }

      if (operator && maybe('code')) {
        for (const p of codingTaskRunner.getProposals()) {
          if (!p || typeof p !== 'object') continue;
          const st = p.status === 'pending_review' ? 'pending' : (p.status || 'pending');
          merged.push({
            kind: 'code',
            id: p.id,
            by: p.npc,
            status: st,
            summary: `${p.task || 'code change'} · ${(p.changedFiles || []).join(', ') || 'files TBD'}`.slice(0, 240),
            ts: Number(p.ts) || 0,
            raw: p,
          });
        }
      }

      if (maybe('dossier')) {
        const dossierList = dossierSystem.getProposals({ identityId, operator });
        for (const p of dossierList) {
          if (!p || typeof p !== 'object') continue;
          const st = p.status === 'pending_review' ? 'pending' : p.status;
          merged.push({
            kind: 'dossier',
            id: p.id,
            by: p.npc,
            status: st || 'pending',
            summary: `${p.type || 'dossier'}${p.recipient ? ` for ${p.recipient}` : ''} · ${p.subject || ''}`.slice(0, 240),
            ts: Number(p.ts) || 0,
            raw: p,
          });
        }
      }

      const statusFiltered = statusFilter === 'all'
        ? merged
        : merged.filter(e => String(e.status || '').toLowerCase() === statusFilter);

      const scoped = approvalsScope.filterMergedProposals(statusFiltered, { identityId, operator });
      scoped.sort((a, b) => (b.ts || 0) - (a.ts || 0));

      const total = scoped.length;
      const proposals = scoped.slice(0, HARD_CAP);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        proposals,
        total,
        cap: HARD_CAP,
        truncated: total > HARD_CAP,
        scope: operator ? 'system' : 'individual',
      }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Email inbound (from n8n Gmail trigger) ---
  // n8n POSTs { from, subject, body, threadId?, secret? } whenever
  // a new email lands in the watched inbox. We route to the first NPC
  // with an email_style block in their SOUL (Sarah today), draft a
  // reply with the existing brain pipeline, save to Gmail drafts
  // (or local fallback if Gmail OAuth isn't wired yet), and broadcast
  // a `npc_email_arrived` WS event so the office UI can animate
  // Sarah walking to her desk.
  if (urlPath === '/api/email-inbound' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // Shared-secret check. EMAIL_INBOUND_SECRET in env; if unset, the
      // endpoint is open (useful in dev). Pass the same value in n8n's
      // Webhook node header or body so prod is auth'd.
      const expectedSecret = process.env.EMAIL_INBOUND_SECRET || '';
      if (expectedSecret) {
        const got = String(payload.secret || req.headers['x-denizen-secret'] || '');
        if (got !== expectedSecret) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad or missing secret' }));
          return;
        }
      } else if (!hostCompute.isLocalOperatorRequest(req)) {
        // Secret unset: local-only instead of open-to-everyone (dossier G#4).
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'EMAIL_INBOUND_SECRET not configured; remote posts rejected' }));
        return;
      }

      try {
        const emailPayload = {
          from: String(payload.from || '').slice(0, 200),
          subject: String(payload.subject || '').slice(0, 400),
          body: String(payload.body || '').slice(0, 20000),
          threadId: payload.threadId || null,
        };
        const broadcastWs = (msg) => {
          try {
            cofounderAgent.wsClients.forEach(ws => {
              if (ws.readyState === 1) ws.send(JSON.stringify(msg));
            });
          } catch (_) {}
        };

        // Job-search lifecycle: recruiter replies, interviews, offers, outreach.
        const jobResult = await jobCrm.processInboundJobEmail(
          { npcBrains, gmailClient },
          emailPayload,
        );
        if (jobResult.handled) {
          const reportLines = [];
          if (jobResult.kind === 'interview_request') {
            reportLines.push(`Interview request for ${jobResult.app?.role} at ${jobResult.app?.company}!`);
            if (jobResult.prep?.filePath) reportLines.push(`Prep doc: ${jobResult.prep.filePath}`);
          } else if (jobResult.kind === 'offer') {
            reportLines.push(`Offer from ${jobResult.app?.company} — needs your review.`);
            if (jobResult.brief?.brief) reportLines.push(jobResult.brief.brief.slice(0, 400));
          } else if (jobResult.kind === 'rejection') {
            reportLines.push(`Update: ${jobResult.app?.company} passed on ${jobResult.app?.role}. Logged for learning.`);
          } else if (jobResult.draft) {
            reportLines.push(`Drafted recruiter reply for ${jobResult.app?.company} — check Gmail drafts.`);
          } else if (jobResult.kind === 'recruiter_outreach') {
            reportLines.push(`New recruiter outreach logged: ${jobResult.app?.role} at ${jobResult.app?.company}.`);
          }
          const report = reportLines.join('\n');
          if (report) {
            broadcastWs({ type: 'npc_report_to_ceo', npcName: 'Lucy', text: report, ts: Date.now() });
            broadcastWs({ type: 'job_crm_event', ...jobResult, ts: Date.now() });
          }
          if (jobResult.escalated) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, jobCrm: jobResult, escalated: true }));
            return;
          }
        }

        const result = await emailHandler.processInboundEmail(
          { npcBrains, gmailClient },
          emailPayload,
          { preferredName: payload.preferredName || jobResult.handled ? 'Lucy' : null },
        );
        if (!result.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        // Surface as a worldState event AND a direct WS broadcast so
        // the in-office Sarah sprite can react (walk to desk).
        try {
          worldState.pushEvent('email', `${result.route?.name || 'Secretary'} drafted reply to ${payload.from}`);
        } catch (_) {}
        try {
          broadcastWs({
            type: 'npc_email_arrived',
            npcName: result.route?.name || 'Lucy',
            from: payload.from,
            subject: payload.subject,
            escalated: !!result.escalated,
            draftId: result.drafted?.id || null,
          });
        } catch (_) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result, jobCrm: jobResult.handled ? jobResult : undefined }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    });
    return;
  }

  // --- Email drafts (read for operator review) ---
  if (urlPath === '/api/email-drafts' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const sentParam = url.searchParams.get('sent');
    const sentFilter = sentParam === 'true' ? true : sentParam === 'false' ? false : null;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 25)));
    const drafts = gmailClient.listDrafts({ limit, sentFilter });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ drafts, mode: gmailClient.mode() }));
    return;
  }

  // --- Email draft send (operator action) ---
  if (urlPath === '/api/email-draft/send' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // The route trusts the request only when EMAIL_AUTOSEND env is on.
      // We also check the per-NPC SOUL's email_canAutoSend at gmail-client
      // level via the autoSendAllowed flag.
      const result = await gmailClient.sendDraft({
        id: String(payload.id || ''),
        autoSendAllowed: !!payload.autoSendAllowed,
      });
      res.writeHead(result.status === 'sent' ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // POST /api/grant-permission — CEO grants an NPC access to proceed with a blocked task.
  // Body: { npcName, permission, scope? }
  // Saves to permission-registry (persists across restarts) + NPC's MEMORY.md + fires a
  // directive so the NPC picks up the unblock on their very next think cycle.
  if (urlPath === '/api/grant-permission' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // Grants agent permissions — operator only (dossier G#4).
      if (!(await _hasOperatorApiAccess(req))) { _denyOperatorApi(res); return; }

      const npcName  = String(p.npcName  || '').trim().slice(0, 60);
      const permission = String(p.permission || p.task || '').trim().slice(0, 200);
      const scope    = String(p.scope || permission).trim().slice(0, 200);
      if (!npcName || !permission) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'npcName and permission are required' }));
        return;
      }

      const permissionRegistry = require('./src/permission-registry');
      const isNew = permissionRegistry.grantPermission(npcName, permission, 'CEO', scope);

      // Also write the grant into the NPC's MEMORY.md so it persists across server restarts.
      const memoryPath = require('path').join(__dirname, 'npcs', npcName, 'MEMORY.md');
      permissionRegistry.saveToMemory(npcName, permission, 'CEO', memoryPath);

      // Fire a directive so the NPC unblocks immediately on the next think cycle.
      try {
        npcBrains.assignDirective(
          npcName, 'CEO',
          `Permission granted: proceed with "${permission}". You no longer need approval — just do it.`
        );
      } catch (_) {}

      // Broadcast the grant so the office UI can show a confirmation.
      // Uses the npcBrains broadcaster which is already wired to all WS clients.
      try {
        (agentWss ? agentWss.clients : new Set()).forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify(
            { type: 'npc_permission_granted', npcName, permission, ts: Date.now() }
          ));
        });
      } catch (_) {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, npcName, permission, isNew }));
    });
    return;
  }

  // ---- OPERATOR AUTH GATE (dossier defect G#4) ----------------------------
  // One choke point for the operator-only read/write families: telemetry,
  // cost, pc-activity, sensitive market surfaces, intelligence summaries and
  // (outside public demo) world-state. 403s before any handler runs.
  if (_operatorGatedRoute(req.method, urlPath) && !_operatorAccessSync(req)) {
    _denyOperatorApi(res);
    return;
  }

  // --- Cost dashboard + balance check ---
  if (urlPath === '/api/costs' && req.method === 'GET') {
    (async () => {
      const { buildCostSummary, fetchMoonshotBalance, PRICING } = llmTelemetry;
      const summary = buildCostSummary(llmTelemetry.ring);

      // Check Moonshot/Kimi balance (only provider with a public balance API)
      const moonshotKey = npcBrains.providers?.kimi?.apiKey || npcBrains.providers?.moonshot?.apiKey;
      const moonshot = moonshotKey ? await fetchMoonshotBalance(moonshotKey) : { ok: false, error: 'no key configured' };

      // Per-provider pricing reference
      const pricingRef = Object.entries(PRICING)
        .filter(([k]) => !['claude','gemini','grok','kimi'].includes(k)) // dedupe aliases
        .reduce((acc, [k, v]) => {
          acc[k] = { inputPer1MTokens: `$${v.in}`, outputPer1MTokens: `$${v.out}` };
          return acc;
        }, {});

      // Cheapest provider recommendation
      const cheapest = Object.entries(PRICING)
        .filter(([k]) => !['claude','gemini','grok','kimi','lmstudio'].includes(k) && PRICING[k].in > 0)
        .sort(([,a],[,b]) => (a.in + a.out) - (b.in + b.out))[0];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        period: '24h',
        ...summary,
        balances: { moonshot },
        tip: summary.totalCost > 0.01
          ? `You\'ve spent $${summary.totalCost.toFixed(4)} today. Switch NPCs to "gemini" provider for ~10x savings vs claude.`
          : 'Spend is low. Keep going.',
        pricingRef,
      }, null, 2));
    })();
    return;
  }

  // --- POST /api/assign-directive — push a mandatory task to an NPC ---
  // Body: { from: "Abby", to: "Josh", task: "Fix the auth bug today", urgent?: true }
  if (urlPath === '/api/assign-directive' && req.method === 'POST') {
    _readJsonBody(req).then(async (payload) => {
      // Makes any NPC do work — operator only (dossier G#4).
      if (!(await _hasOperatorApiAccess(req))) { _denyOperatorApi(res); return; }
      if (!payload.from || !payload.to || !payload.task) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'from, to, and task are required' }));
        return;
      }
      npcBrains.assignDirective(payload.to, payload.from, payload.task, !!payload.urgent);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, from: payload.from, to: payload.to }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // --- POST /api/context-drop — Buzz screenshot / voice / note → Abby ---
  if (urlPath === '/api/context-drop' && req.method === 'POST') {
    _readJsonBody(req, 12 * 1024 * 1024).then(async (payload) => {
      if (!(await _hasAnySessionAccess(req, payload || {}))) { _denyOperatorApi(res); return; }
      const result = await contextDrop.handleContextDrop(payload || {}, {
        processAttachments: (raw) => chatAttachments.processChatAttachments(raw),
        assignDirective: (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, urgent),
        broadcast: _ceoBroadcast,
      });
      const status = result.ok ? 200 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- GET /api/workbench — directives + recent Buzz drops for the rail ---
  if (urlPath === '/api/workbench' && req.method === 'GET') {
    (async () => {
      if (!(await _hasAnySessionAccess(req, {}))) { _denyOperatorApi(res); return; }
      const url = new URL(req.url, 'http://localhost');
      const memoryQ = String(url.searchParams.get('q') || url.searchParams.get('memory') || '').trim();
      const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId')
        || req.headers['x-session-id'] || '';

      const crew = seatAiCatalog.buildCrewRows({
        roster: npcRoster,
        directives: npcBrains.listDirectives({ include_archived: false }),
        presenceAtNpc: (key) => mcpTeamTools.getMcpPresenceAtNpc?.(key) || null,
      });

      let handoffs = [];
      if (sessionId) {
        try {
          const pending = await denizenVisitor.getPendingHandoffs(sessionId);
          handoffs = (pending || []).slice(0, 12).map((h) => ({
            id: h.id || h.handoff_id,
            from: h.from_npc || h.from || h.from_display_name,
            message: String(h.message || h.body || '').slice(0, 240),
            ts: h.created_at || h.ts || null,
          }));
        } catch (_) {}
      }

      let approvals = [];
      try {
        const soulFile = typeof _readSoulProposalsFile === 'function' ? _readSoulProposalsFile() : { proposals: [] };
        approvals = (soulFile.proposals || [])
          .filter((p) => String(p.status || 'pending') === 'pending')
          .slice(0, 8)
          .map((p) => ({
            id: p.id,
            by: p.npcName || p.by,
            summary: String(p.proposal?.summary || p.summary || '').slice(0, 180),
            kind: 'soul',
          }));
      } catch (_) {}

      const memory = [];
      try {
        for (const entry of (npcRoster.entries || []).slice(0, 18)) {
          const hit = memoryRetrieve.retrieveMemory(entry.display, memoryQ || entry.display, {
            k: memoryQ ? 4 : 2,
            maxChars: 360,
          });
          if (hit?.lines?.length) {
            memory.push({ npc: entry.display, lines: hit.lines.slice(0, 3) });
          }
          if (memory.length >= 10) break;
        }
      } catch (_) {}

      let providers = [];
      try {
        let tokens = [];
        if (sessionId && denizenDb.enabled) {
          const listed = await denizenDb._rpc('denizen_list_mcp_tokens', {
            p_org_id: null,
            p_session_id: sessionId,
            p_org_wide: false,
          }).catch(() => null);
          tokens = listed?.tokens || listed?.rows || [];
        }
        providers = seatAiCatalog.providersWithStatus({ tokens });
        for (const p of providers) {
          const row = crew.find((c) => c.key === p.id || c.name === p.desk);
          if (row && p.seated) row.seated = true;
        }
      } catch (_) {}

      const snap = contextDrop.workbenchSnapshot({
        listDirectives: () => npcBrains.listDirectives({ include_archived: false }),
        crew,
        handoffs,
        approvals,
        memory,
        leash: seatAiCatalog.leashFromStats(llmTelemetry.getStats({ windowMs: 15 * 60 * 1000 })),
        providers,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snap));
    })().catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- GET /api/seat-ai — which subscriptions can sit at desks ---
  if (urlPath === '/api/seat-ai' && req.method === 'GET') {
    (async () => {
      if (!(await _hasAnySessionAccess(req, {}))) { _denyOperatorApi(res); return; }
      const url = new URL(req.url, 'http://localhost');
      const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId')
        || req.headers['x-session-id'] || '';
      let tokens = [];
      if (sessionId) {
        try {
          const access = await _guardVisitorFeature(req, sessionId, 'mcp_connect', {});
          const listed = await denizenDb._rpc('denizen_list_mcp_tokens', {
            p_org_id: access.orgId,
            p_session_id: sessionId,
            p_org_wide: _canManageOrgNpcTeam(await visitorAccess.resolveSessionAccess(sessionId).catch(() => null)),
          });
          tokens = listed?.tokens || listed?.rows || [];
        } catch (_) {
          tokens = [];
        }
      }
      let lmStudio = { reachable: false };
      try { lmStudio = await seatAiCatalog.probeLmStudio(); } catch (_) {}
      const providers = seatAiCatalog.providersWithStatus({ tokens, lmStudio });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, providers, lmStudio }));
    })().catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- POST /api/task-chains — start a multi-step NPC task chain ---
  // Body: { name, triggeredBy, steps: [{ npc, task, artifactCategory }] }
  if (urlPath === '/api/task-chains' && req.method === 'POST') {
    _readJsonBody(req).then(payload => {
      if (!payload.steps || !Array.isArray(payload.steps) || payload.steps.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'steps array is required' }));
        return;
      }
      const broadcastFn = (msg) =>
        (agentWss ? agentWss.clients : new Set()).forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify(msg));
        });
      const chain = taskChain.startChain(
        payload,
        (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, !!urgent),
        broadcastFn
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, chainId: chain.id, name: chain.name, steps: chain.steps.length }));
    }).catch(err => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // --- GET /api/task-chains — list active chains and their status ---
  if (urlPath === '/api/task-chains' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chains: taskChain.getActiveChains() }));
    return;
  }

  // --- GET /api/task-chains/:id — get a specific chain's status ---
  const chainStatusMatch = urlPath.match(/^\/api\/task-chains\/([^/]+)$/);
  if (chainStatusMatch && req.method === 'GET') {
    const chain = taskChain.getChainStatus(chainStatusMatch[1]);
    if (!chain) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'chain not found' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ chain }));
    return;
  }

  // --- Content pipeline (newsroom task chain preset) ---
  if (urlPath === '/api/content-pipeline' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(contentPipeline.getPipelineSummary(taskChain)));
    return;
  }
  if (urlPath === '/api/content-pipeline' && req.method === 'POST') {
    _readJsonBody(req).then((payload) => {
      const topic = String(payload?.topic || payload?.subject || '').trim();
      if (!topic) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'topic is required' }));
        return;
      }
      const broadcastFn = (msg) =>
        (agentWss ? agentWss.clients : new Set()).forEach((c) => {
          if (c.readyState === 1) c.send(JSON.stringify(msg));
        });
      const chain = contentPipeline.startContentPipeline(taskChain, topic, {
        assignDirectiveFn: (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, !!urgent),
        broadcastFn,
      }, { ...(payload || {}), onBrandBlocked: _onContentBrandBlocked });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        chainId: chain.id,
        name: chain.name,
        topic,
        steps: chain.steps.length,
      }));
    }).catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }
  if (urlPath === '/api/content-pipeline/cancel' && req.method === 'POST') {
    _readJsonBody(req).then((payload) => {
      const broadcastFn = (msg) =>
        (agentWss ? agentWss.clients : new Set()).forEach((c) => {
          if (c.readyState === 1) c.send(JSON.stringify(msg));
        });
      const chainId = payload?.chainId || payload?.chain_id || null;
      const cancelled = contentPipeline.cancelRunningPipelines(taskChain, broadcastFn, chainId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cancelled }));
    }).catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // --- Abort any in-flight desktop agent task ---
  if (urlPath === '/api/desktop-abort' && req.method === 'POST') {
    desktopAgent._abortAll = true;
    setTimeout(() => { desktopAgent._abortAll = false; }, 5000); // auto-reset after 5s
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, note: 'Desktop agent task aborted.' }));
    return;
  }

  // --- Desktop agent (Lucy controls the full PC) ---
  if (urlPath === '/api/desktop-task' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      if (!payload.instruction) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'instruction required' })); return;
      }
      const broadcast = (msg) => cofounderAgent.wsClients.forEach(ws => {
        if (ws.readyState === 1) ws.send(JSON.stringify(msg));
      });
      // Return immediately — task runs async, progress via WS
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const deskNpc = String(payload.npcName || 'Lucy');
      const sessionId = payload.session_id || payload.sessionId || null;
      res.end(JSON.stringify({ ok: true, async: true, note: `${deskNpc} is on it — watch your screen.` }));
      triggerNpcScreenControl(deskNpc, payload.instruction, broadcast, {
        sessionId,
        permissionLevel: payload.agent_permission_level || payload.permission_level || null,
      })
        .catch(err => {
          console.error('[desktop-task] error:', err?.message);
        });
      return;
    });
    return;
  }

  // --- Bouncer investigation proxy (dolonia agent) ---
  if (urlPath === '/api/bouncer-investigate' && req.method === 'POST') {
    if (!bouncerInvestigation.validateInvestigationAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const threat = payload.threat || payload;
      try {
        const result = await bouncerInvestigation.investigate(threat);
        let reportMd = null;
        if (result.ok) {
          reportMd = result.reportMd || linuxAgent.buildReport(threat, result, null);
          result.reportMd = reportMd;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: result.ok, result, reportMd }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  if (urlPath === '/api/bouncer-patrol' && req.method === 'POST') {
    if (!bouncerInvestigation.validateInvestigationAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    (async () => {
      try {
        const patrol = await bouncerInvestigation.perimeterPatrol();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: patrol.ok !== false, patrol }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    })();
    return;
  }

  // --- Bouncer security scan (manual trigger) ---
  // POST /api/bouncer-scan { tool: 'nmap'|'wireshark'|'zenmap', target?: '192.168.1.1', reason?: 'manual' }
  // 'zenmap' and 'nmap' both run nmap via Kali WSL (Zenmap is just a GUI wrapper — nmap is the real tool).
  // 'wireshark' runs tcpdump on loopback via Kali WSL (tshark if installed).
  if (urlPath === '/api/bouncer-scan' && req.method === 'POST') {
    if (!_hasBouncerApiAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      const tool      = payload.tool || 'nmap';
      const target    = payload.target || 'localhost';
      const reason    = payload.reason || 'manual security check';
      const bcast     = (msg) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(msg)); });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tool, async: true, note: `Bouncer is running ${tool} via Kali Linux — results incoming.` }));

      bcast({ type: 'bouncer_tool_status', tool, status: 'starting',
        threat: { category: 'manual', source: target, detail: reason },
        message: `Bouncer running ${tool === 'zenmap' ? 'nmap' : tool} in Kali WSL — ${reason}` });

      // PC activity: linux-agent runs real commands in WSL/Kali. The
      // bouncer terminal window pops up in this path, so mode='visible'
      // when the operator asked for a terminal, otherwise 'background'.
      const scanActivity = pcActivity.record({
        npc: 'Bouncer', kind: 'linux-agent',
        task: `${tool} ${target}${reason && reason !== 'manual security check' ? ' — ' + reason : ''}`.slice(0, 240),
        mode: 'visible', status: 'started',
      });
      const scanStart = Date.now();

      try {
        let result;
        if (tool === 'nmap' || tool === 'zenmap') {
          // nmap scan — zenmap is just a GUI wrapper, use nmap CLI directly
          result = await linuxAgentBridge.investigate({ category: 'network_scan', source: target, detail: reason });
        } else if (tool === 'wireshark') {
          // tcpdump loopback snapshot as Wireshark replacement
          result = await linuxAgent.trafficSnapshot();
          result = { ok: result.ok, summary: result.raw, elapsed: 5000, steps: [{ label: 'tcpdump loopback', output: result.raw }] };
        } else {
          result = await linuxAgentBridge.perimeterPatrol();
          result = { ok: result.ok, summary: result.summary, elapsed: result.elapsed, steps: [] };
        }

        pcActivity.record({
          id: scanActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: scanActivity.task, mode: scanActivity.mode,
          status: result.ok ? 'done' : 'failed',
          durationMs: Date.now() - scanStart,
          detail: (result.summary || '').slice(0, 240) || null,
        });

        bcast({
          type: 'bouncer_tool_status', tool,
          status: result.ok ? 'done' : 'error',
          threat: { category: 'manual', source: target, detail: reason },
          steps: result.steps?.length,
          message: result.ok
            ? `${tool} complete (${((result.elapsed || 0) / 1000).toFixed(1)}s) — ${(result.summary || '').slice(0, 120)}`
            : `${tool} failed`,
        });

        console.log(`[BouncerScan] ${tool} on ${target}: ${result.ok ? 'ok' : 'failed'}`);
      } catch (err) {
        pcActivity.record({
          id: scanActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: scanActivity.task, mode: scanActivity.mode,
          status: 'failed', durationMs: Date.now() - scanStart,
          detail: String(err?.message || err).slice(0, 240),
        });
        console.error(`[bouncer-scan] ${tool} error:`, err?.message);
        bcast({ type: 'bouncer_tool_status', tool, status: 'error',
          threat: { category: 'manual', source: target, detail: reason },
          message: `${tool} threw: ${err?.message}` });
      }
    });
    return;
  }

  // --- Lucy job pipeline (scrape → filter → resume → cover → apply) ---
  // POST /api/lucy-job-pipeline { query, site, pages, remoteOnly, minSalary }
  // Runs Lucy's full pipeline and returns the summary string.
  if (urlPath === '/api/lucy-job-pipeline' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      // PC activity: manual operator-triggered pipeline run.
      const jpActivity = pcActivity.record({
        npc: 'Lucy', kind: 'job-pipeline',
        task: `${payload.query || 'software engineer'} on ${payload.site || 'linkedin'}`,
        mode: 'visible', status: 'started',
      });
      const jpStart = Date.now();
      try {
        const summary = await jobApplication.runJobPipeline({
          query:      payload.query      || 'software engineer',
          site:       payload.site       || 'linkedin',
          pages:      Number(payload.pages || 2),
          remoteOnly: Boolean(payload.remoteOnly),
          minSalary:  Number(payload.minSalary || 0),
        }, { npcBrains });
        pcActivity.record({
          id: jpActivity.id, npc: 'Lucy', kind: 'job-pipeline',
          task: jpActivity.task, mode: 'visible', status: 'done',
          durationMs: Date.now() - jpStart,
          detail: String(summary).slice(0, 240),
        });
        try { worldState.pushEvent('job-pipeline', `Lucy: ${summary}`); } catch (_) {}
        try {
          cofounderAgent.wsClients.forEach(ws => {
            if (ws.readyState !== 1) return;
            try { ws.send(JSON.stringify({ type: 'lucy_job_pipeline_done', summary })); } catch (_) {}
          });
        } catch (_) {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, summary }));
      } catch (err) {
        pcActivity.record({
          id: jpActivity.id, npc: 'Lucy', kind: 'job-pipeline',
          task: jpActivity.task, mode: 'visible', status: 'failed',
          durationMs: Date.now() - jpStart,
          detail: String(err?.message || err).slice(0, 240),
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
    });
    return;
  }

  // --- Lucy web search (visible browser) ---
  // POST /api/lucy-search { query, headless?: false }
  // Opens Lucy's VISIBLE browser, searches DuckDuckGo, returns top results, and
  // surfaces them in the office chat. This is what "Lucy, search X" routes to so
  // she actually browses instead of replying with text (and without needing the
  // OpenClaw gateway running).
  // GET /api/lucy-browser/mirror — live browser mirror state for mobile/remote CEO UI
  if (urlPath === '/api/lucy-browser/mirror' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(_buildLucyMirrorResponse()));
    return;
  }

  const npcBrowserMatch = urlPath.match(/^\/api\/npc-browser\/([^/]+)(?:\/(mirror|live-frame|frame|stream|close|input))?$/);
  if (npcBrowserMatch) {
    const npcKey = decodeURIComponent(npcBrowserMatch[1]);
    const action = npcBrowserMatch[2] || 'mirror';
    if (action === 'mirror' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(_buildNpcMirrorResponse(npcKey)));
      return;
    }
    if (action === 'live-frame' && req.method === 'GET') {
      const childAlive = _lucyBrowserChildAlive();
      const activeKey = normalizeNpcKey(global._activeBrowserNpc || 'lucy');
      const latest = _latestMirrorFrameFileForNpc(npcKey);
      const frameAgeMs = latest ? Date.now() - latest.mtimeMs : Infinity;
      const frameFresh = frameAgeMs < LUCY_MIRROR_FRAME_LIVE_MS;
      const owns = childAlive && activeKey === normalizeNpcKey(npcKey);
      if (!latest || (!owns && !frameFresh)) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          ok: false,
          error: owns ? 'no live frame yet' : 'browser not live for this NPC',
          stale: !owns,
          activeNpcKey: activeKey,
        }));
        return;
      }
      fs.readFile(latest.path, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: 'no live frame yet' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': latest.format === 'png' ? 'image/png' : 'image/jpeg',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(data);
      });
      return;
    }
    if (action === 'frame' && req.method === 'GET') {
      const paths = getNpcBrowserPaths(npcKey);
      const framePath = fs.existsSync(paths.frameFile) ? paths.frameFile : (
        normalizeNpcKey(npcKey) === 'lucy' ? LUCY_MIRROR_FRAME_FILE : paths.frameFile
      );
      fs.readFile(framePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ ok: false, error: 'no frame yet' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(data);
      });
      return;
    }
    if (action === 'stream' && req.method === 'GET') {
      const paths = getNpcBrowserPaths(npcKey);
      lucyBrowserStream.serveLucyMjpegStream(req, res, {
        streamFile: paths.streamFile,
        isLive: () => {
          const activeKey = normalizeNpcKey(global._activeBrowserNpc || 'lucy');
          return (_lucyBrowserChildAlive() && activeKey === normalizeNpcKey(npcKey)) || !!global._lucyBrowserOpen;
        },
      });
      return;
    }
    if (action === 'close' && req.method === 'POST') {
      const r = closeLucyBrowser();
      const broadcast = (m) => {
        const raw = JSON.stringify(m);
        (agentWss ? agentWss.clients : new Set()).forEach((c) => { if (c.readyState === 1) c.send(raw); });
      };
      _broadcastNpcMirrorUpdate(broadcast, npcKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
      return;
    }
    if (action === 'input' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        let payload = {};
        try { payload = JSON.parse(body || '{}'); } catch (_) {}
        const type = String(payload.type || '').toLowerCase();
        const activeKey = normalizeNpcKey(global._activeBrowserNpc || 'lucy');
        if (!['scroll', 'click'].includes(type)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'type must be scroll or click' }));
          return;
        }
        if (!_lucyBrowserChildAlive() || activeKey !== normalizeNpcKey(npcKey)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: `browser not live for ${npcKey} — ask them to search again`,
            activeNpcKey: activeKey,
          }));
          return;
        }
        const cmd = {
          id: `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          x: Number(payload.x),
          y: Number(payload.y),
          deltaX: Number(payload.deltaX) || 0,
          deltaY: Number(payload.deltaY) || 0,
        };
        if (type === 'click' && (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'click requires x and y' }));
          return;
        }
        const queued = _writeBrowserInputCommand(cmd);
        res.writeHead(queued ? 202 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: queued, queued: !!queued, id: cmd.id }));
      });
      return;
    }
  }

  // GET /api/lucy-browser/live-frame — latest mirror frame (PNG or JPEG)
  if (urlPath === '/api/lucy-browser/live-frame' && req.method === 'GET') {
    const childAlive = _lucyBrowserChildAlive();
    const latest = _latestMirrorFrameFile();
    const frameAgeMs = latest ? Date.now() - latest.mtimeMs : Infinity;
    const frameFresh = frameAgeMs < LUCY_MIRROR_FRAME_LIVE_MS;
    if (!latest || (!childAlive && !frameFresh)) {
      res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        ok: false,
        error: childAlive ? 'no live frame yet' : 'browser not live',
        stale: !childAlive,
      }));
      return;
    }
    fs.readFile(latest.path, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'no live frame yet' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': latest.format === 'png' ? 'image/png' : 'image/jpeg',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(data);
    });
    return;
  }

  // GET /api/lucy-browser/stream — MJPEG fallback (some browsers block this on <img>)
  if (urlPath === '/api/lucy-browser/stream' && req.method === 'GET') {
    lucyBrowserStream.serveLucyMjpegStream(req, res, {
      streamFile: LUCY_MIRROR_STREAM_FILE,
      isLive: () => _lucyBrowserChildAlive() || !!global._lucyBrowserOpen,
    });
    return;
  }

  // GET /api/lucy-browser/frame — latest PNG frame from Lucy's Playwright browser
  if (urlPath === '/api/lucy-browser/frame' && req.method === 'GET') {
    fs.readFile(LUCY_MIRROR_FRAME_FILE, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'no frame yet' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(data);
    });
    return;
  }

  if (urlPath === '/api/lucy-browser/close' && req.method === 'POST') {
    const r = closeLucyBrowser();
    const broadcast = (m) => {
      const raw = JSON.stringify(m);
      (agentWss ? agentWss.clients : new Set()).forEach((c) => { if (c.readyState === 1) c.send(raw); });
    };
    _broadcastLucyMirrorUpdate(broadcast);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r));
    return;
  }

  // POST /api/lucy-browser/input — remote scroll / tap on Lucy's open Playwright page
  if (urlPath === '/api/lucy-browser/input' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) {}
      const type = String(payload.type || '').toLowerCase();
      if (!['scroll', 'click'].includes(type)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'type must be scroll or click' }));
        return;
      }
      if (!_lucyBrowserChildAlive()) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'browser not live — ask Lucy to search again' }));
        return;
      }
      const cmd = {
        id: `input-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        x: Number(payload.x),
        y: Number(payload.y),
        deltaX: Number(payload.deltaX) || 0,
        deltaY: Number(payload.deltaY) || 0,
      };
      if (type === 'click' && (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.y))) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'click requires x and y' }));
        return;
      }
      const queued = _writeBrowserInputCommand(cmd);
      res.writeHead(queued ? 202 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: queued, queued: !!queued, id: cmd.id }));
    });
    return;
  }

  // POST /api/open-brave { url? } — launch CEO's real Brave browser
  if (urlPath === '/api/open-brave' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) {}
      try {
        const r = await desktopAgent.openBraveBrowser(payload.url || null);
        res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
    });
    return;
  }

  // POST /api/screen-observe { npcName?, instruction } — screenshot + vision + web research
  if (urlPath === '/api/screen-observe' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const npcName = String(payload.npcName || 'Lucy');
      const instruction = String(payload.instruction || 'Describe what is on my screen.');
      const broadcast = (m) => {
        const raw = JSON.stringify(m);
        (agentWss ? agentWss.clients : new Set()).forEach((c) => { if (c.readyState === 1) c.send(raw); });
      };
      triggerNpcScreenObserve(npcName, instruction, broadcast, {
        sessionId: payload.session_id || payload.sessionId || null,
      })
        .then((r) => {
          res.writeHead(r.ok ? 200 : 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(r));
        })
        .catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
        });
    });
    return;
  }

  if (urlPath === '/api/lucy-search' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid JSON' }));
        return;
      }
      const query = String(payload.query || '').trim();
      const openOnly = payload.openOnly === true;
      if (!openOnly && query && isJunkSearchQuery(query)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'search topic required (not just "search" or "web")' }));
        return;
      }
      if (!query && !openOnly && !payload.directUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'query required' }));
        return;
      }

      // Respond immediately — browser search can take 30–120s and Cloudflare/tunnel
      // HTTP limits return HTML error pages if we block the request.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        pending: true,
        query: query || (openOnly ? 'browser' : ''),
        message: 'Search started — results will appear in chat when Lucy finishes.',
      }));

      const broadcast = (m) => cofounderAgent.wsClients.forEach(c => {
        if (c.readyState === 1) c.send(JSON.stringify(m));
      });
      runLucyWebSearch(query, {
        headless: payload.headless === true,
        quiet: false,
        browserMode: payload.browserMode,
        directUrl: payload.directUrl || null,
        jobBoard: payload.jobBoard || null,
        openOnly: payload.openOnly === true,
        broadcast,
      }).catch((err) => {
        _ceoBroadcast({
          type: 'npc_report_to_ceo',
          npcName: 'Lucy',
          text: `Search failed: ${String(err?.message || err)}`,
          ts: Date.now(),
        });
      });
    });
    return;
  }

  // --- Bouncer Linux terminal (Kali WSL investigation) ---
  // POST /api/bouncer-linux { category?, source?, detail?, openTerminal?: bool }
  // Runs real security commands in Kali WSL and streams results via WS.
  if (urlPath === '/api/bouncer-linux' && req.method === 'POST') {
    if (!_hasBouncerApiAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }

      const broadcast = (msg) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(msg)); });
      const threat = {
        category: payload.category || 'unknown',
        source:   payload.source   || null,
        detail:   payload.detail   || payload.category || 'manual investigation',
        force:    payload.force === true,
      };

      const invGate = _bouncerInvTake(threat, { force: threat.force });
      if (!invGate.allowed) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          skipped: true,
          note: `Investigation cooldown (${invGate.remainingSec}s) for ${invGate.key}`,
        }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, async: true, note: 'Bouncer is running Kali Linux commands — watch your chat.' }));

      const openTerminal = payload.openTerminal === true;
      broadcast({
        type: 'bouncer_linux_status',
        status: 'starting',
        threat,
        openTerminal,
        message: `Bouncer is investigating ${threat.category} in the background...`,
      });

      if (openTerminal) {
        _openBouncerTerminal(_buildTerminalShowCmd(threat));
      }

      // PC activity: bouncer-linux endpoint = linux-agent run.
      // mode = 'visible' when a terminal window is spawned, else 'background'.
      const blActivity = pcActivity.record({
        npc: 'Bouncer', kind: 'linux-agent',
        task: `investigate ${threat.category}${threat.source ? ' (' + threat.source + ')' : ''}`,
        mode: openTerminal ? 'visible' : 'background',
        status: 'started',
      });
      const blStart = Date.now();

      // Run the actual investigation in parallel
      const invCtx = {
        broadcast,
        npcTools,
        npcBrains,
        denizenDb,
        investigationIsSerious,
      };
      linuxAgentBridge.investigate(threat).then(async (result) => {
        pcActivity.record({
          id: blActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: blActivity.task, mode: blActivity.mode,
          status: result.ok ? 'done' : 'failed',
          durationMs: Date.now() - blStart,
          detail: (result.summary || result.error || '').slice(0, 240) || null,
        });
        const { reportPath } = await bouncerInvestigation.completeInvestigation(threat, result, invCtx);
        broadcast({
          type: 'bouncer_linux_result',
          status: result.ok ? 'done' : 'error',
          threat,
          category: result.category,
          ip: result.ip,
          elapsed: result.elapsed,
          steps: result.steps,
          summary: result.summary,
          reportPath: reportPath || null,
          message: result.ok
            ? `Kali investigation complete (${(result.elapsed / 1000).toFixed(1)}s, ${result.steps?.length || 0} commands).`
            : `Linux investigation failed: ${result.error}`,
        });
      }).catch(err => {
        pcActivity.record({
          id: blActivity.id, npc: 'Bouncer', kind: 'linux-agent',
          task: blActivity.task, mode: blActivity.mode,
          status: 'failed', durationMs: Date.now() - blStart,
          detail: String(err?.message || err).slice(0, 240),
        });
        broadcast({ type: 'bouncer_linux_result', status: 'error', threat, message: `WSL error: ${err.message}` });
      });
    });
    return;
  }

  // --- Job CRM: application lifecycle, standup, referrals, maintenance ---
  if (urlPath === '/api/job-crm' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || null;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      applications: jobCrm.listApplications({ status, limit }),
      stats: jobCrm.getOutcomeStats(),
      referrals: jobCrm.loadCrm().referrals,
    }));
    return;
  }

  if (urlPath === '/api/job-crm/standup' && req.method === 'GET') {
    const report = jobCrm.buildWeeklyStandup();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, report }));
    return;
  }

  if (urlPath === '/api/job-crm/maintenance' && req.method === 'POST') {
    const broadcast = (m) => {
      try {
        (agentWss ? agentWss.clients : new Set()).forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify(m));
        });
        cofounderAgent.wsClients.forEach(ws => {
          if (ws.readyState === 1) ws.send(JSON.stringify(m));
        });
      } catch (_) {}
    };
    jobCrm.runMaintenance({ npcBrains, broadcast })
      .then(r => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...r }));
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      });
    return;
  }

  if (urlPath === '/api/job-crm/referral' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const ref = jobCrm.addReferral({
        company: String(p.company || '').trim(),
        contact: String(p.contact || '').trim(),
        relationship: String(p.relationship || 'linkedin').trim(),
        notes: String(p.notes || '').trim(),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, referral: ref }));
    });
    return;
  }

  // --- Research queue + briefs + general Bob chain ---
  if (urlPath === '/api/research-queue' && req.method === 'GET') {
    const pending = researchQueue.listTopics({ status: 'pending', limit: 50 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pending: pending.length, items: pending }));
    return;
  }

  if (urlPath === '/api/research-queue' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const topic = String(p.topic || '').trim();
      if (!topic) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'topic required' })); return; }
      try {
        const item = researchQueue.addTopic({
          topic,
          priority: _mapResearchPriority(p.priority),
          assignedTo: String(p.assignedTo || 'Bob').trim(),
          notes: String(p.notes || '').trim(),
        });
        const pending = researchQueue.listTopics({ status: 'pending', limit: 100 });
        _ceoBroadcast({
          type: 'research_queue_update',
          npcName: 'Lucy',
          topic,
          pending: pending.length,
          ts: Date.now(),
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, item, pending: pending.length }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
    });
    return;
  }

  if (urlPath === '/api/research-brief' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const topic = String(p.topic || '').trim();
      if (!topic) { res.writeHead(400); res.end(JSON.stringify({ ok: false, error: 'topic required' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, note: `Researching "${topic}" — brief incoming.` }));
      const session = researchSessions.startSession({ topic, npcName: 'Bob' });
      const isLeadTopic = /lead|prospect|client|partner|govcon|omes|rm cyber|federal|1921|capture/i.test(topic);
      researchBrief.runFullResearch(topic, { count: 5, read: 2, npcBrains, leadMode: isLeadTopic })
        .then((result) => {
          try { researchSessions.linkSessionToBrief(session.id, result.filePath); } catch (_) {}
          const text = `Research brief ready: "${topic}"\n${result.filePath}\n${(result.summary || '').slice(0, 400)}`;
          const payload = {
            type: 'research_brief_done',
            npcName: 'Bob',
            topic,
            path: result.filePath,
            summary: result.summary || text,
            text,
            ts: Date.now(),
          };
          if (result.leadCandidates && result.leadCandidates.length) {
            payload.leadCandidates = result.leadCandidates;
            payload.note = `Extracted ${result.leadCandidates.length} candidate leads for crm-enrich-contact`;
          }
          _ceoBroadcast(payload);

          // Fix: inject the findings into Bob so he can answer "what did you find" naturally
          if (npcBrains && typeof npcBrains.injectSkillResult === 'function') {
            const findings = result.summary || `Completed research on ${topic}. See ${result.filePath}`;
            npcBrains.injectSkillResult('Bob', 'research', findings);
            // also give Lucy visibility for pipeline work
            try { npcBrains.injectSkillResult('Lucy', 'research', findings); } catch (_) {}
            if (result.leadCandidates && result.leadCandidates.length) {
              const candText = `Lead candidates from research: ${result.leadCandidates.map(c => `${c.name || c.company} (${c.email || c.url || ''})`).join('; ')}. Use crm-enrich-contact then crm-add-deal for high fits.`;
              try { npcBrains.injectSkillResult('Lucy', 'lead-research', candText); } catch (_) {}
              try { npcBrains.injectSkillResult('Bob', 'lead-research', candText); } catch (_) {}

              // Auto-suggest concrete actions + enqueue enrich for top candidates
              result.leadCandidates.slice(0, 2).forEach((cand, i) => {
                const enrichParams = { name: cand.name || cand.company, email: cand.email, company: cand.company || '', source: 'research-brief', notes: cand.why || 'from ' + topic, score: 60, researchMatch: true };
                _ceoBroadcast({
                  type: 'crm_lead_candidate',
                  npcName: 'Grok',
                  candidate: cand,
                  suggested: { skill: 'crm-enrich-contact', params: enrichParams },
                  ts: Date.now(),
                });
                // Strong injection for immediate follow-through
                const act = `ACTION: crm-enrich-contact for ${cand.name || cand.company}. Then crm-add-deal if 1921 fit.`;
                try { npcBrains.injectSkillResult('Lucy', 'lead-candidate-' + i, act + ' ' + candText); } catch (_) {}
              });
            }
          }
          // Also log activity for the office
          try {
            _ceoBroadcast({
              type: 'npc_report_to_ceo',
              npcName: 'Bob',
              text: `I finished the research on "${topic}". Key points: ${(result.summary || '').slice(0, 300)}`,
              ts: Date.now(),
            });
          } catch (_) {}
        })
        .catch(err => {
          _ceoBroadcast({
            type: 'npc_report_to_ceo',
            npcName: 'Lucy',
            text: `Research brief failed for "${topic}": ${err?.message || err}`,
            ts: Date.now(),
          });
        });
    });
    return;
  }

  if (urlPath === '/api/lucy-research-chain' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const topic = String(p.topic || p.query || '').trim();
      if (!topic) { res.writeHead(400); res.end(JSON.stringify({ error: 'topic required' })); return; }
      try {
        const chain = taskChain.startChain({
          name: `Research: ${topic}`,
          triggeredBy: 'CEO',
          steps: [
            { npc: 'Bob', task: `Deep research on: ${topic}. Read sources, write a markdown brief to reports/research/, note risks and next actions.`, artifactCategory: 'research' },
            { npc: 'Lucy', task: `Summarize Bob's brief on "${topic}" for the CEO in chat. Highlight top 3 takeaways and recommended next steps.`, artifactCategory: 'admin' },
          ],
        }, npcBrains.assignDirective.bind(npcBrains), _ceoBroadcast);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, chainId: chain.id, topic }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
    });
    return;
  }

  if (urlPath === '/api/away/digest' && req.method === 'POST') {
    awayNotify.runDailyDigest({
      jobCrm,
      researchQueue,
      gmailClient,
      channels: ['discord', 'slack'],
    }).then((text) => {
      _ceoBroadcast({ type: 'daily_digest_sent', npcName: 'Lucy', report: text, text, ts: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, text }));
    }).catch(err => {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  if (urlPath === '/api/away/research/run' && req.method === 'POST') {
    awayNotify.runScheduledResearch({
      researchQueue,
      assignDirectiveFn: (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, !!urgent),
      from: 'Lucy',
    }).then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500); res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // Bob researches → Lucy applies (task chain for high-value listings)
  if (urlPath === '/api/lucy-job-research-chain' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let p;
      try { p = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      const company = String(p.company || '').trim();
      const role = String(p.role || p.query || '').trim();
      if (!company || !role) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'company and role required' })); return;
      }
      try {
        const chain = taskChain.startChain({
          name: `Job research: ${role} at ${company}`,
          triggeredBy: 'CEO',
          steps: [
            { npc: 'Bob', task: `Research ${company} for a ${role} application. Cover: funding, culture, remote policy, red flags. Write findings to reports/job-research/.`, artifactCategory: 'research' },
            { npc: 'Lucy', task: `Using Bob's research on ${company}, score the ${role} fit and apply if score ≥ 7. Tailor cover letter. Do NOT submit without CEO approval.`, artifactCategory: 'job-apply' },
          ],
        }, npcBrains.assignDirective.bind(npcBrains), (m) => {
          (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, chainId: chain.id }));
      } catch (err) {
        res.writeHead(500); res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
      }
    });
    return;
  }

  // --- Job applications (Lucy applies on behalf of CEO) ---
  if (urlPath === '/api/job-apply' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid JSON' })); return; }
      // LLM cover-letter + outbound Gmail send — operator only (dossier G#4).
      if (!(await _hasOperatorApiAccess(req))) { _denyOperatorApi(res); return; }

      const result = await jobApplication.applyToJob(
        {
          npcBrains,
          gmailClient,
          broadcast: (msg) => cofounderAgent.wsClients.forEach(ws => {
            if (ws.readyState === 1) ws.send(JSON.stringify(msg));
          }),
        },
        {
          applyEmail:   payload.applyEmail,
          applyUrl:     payload.applyUrl,
          jobTitle:     payload.jobTitle,
          company:      payload.company,
          description:  payload.description,
          requirements: payload.requirements,
          provider:     payload.provider || null,  // 'anthropic' | 'kimi' | null (auto)
        },
        {
          // fullAI=true: ask Ministral 14B to write the whole letter (~60-120s)
          // fullAI=false (default): template + LLaMA 8B opener (~3-8s)
          fullAI: payload.fullAI === true,
        }
      );
      try { worldState.pushEvent('job-apply', `Lucy applied to ${payload.jobTitle} at ${payload.company}`); } catch (_) {}
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // --- LLM telemetry endpoints ---
  // Real observability into LM Studio + every other LLM provider call.
  // Each call records: npc, kind, provider, model, latencyMs, tokens
  // in/out, prompt/response preview, error+hint.
  if (urlPath === '/api/telemetry/llm' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const opts = {
      limit: Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 50))),
      kind: url.searchParams.get('kind') || null,
      npc: url.searchParams.get('npc') || null,
      provider: url.searchParams.get('provider') || null,
      sinceMs: url.searchParams.get('sinceMs') ? Number(url.searchParams.get('sinceMs')) : null,
      errorsOnly: url.searchParams.get('errorsOnly') === 'true',
      sort: url.searchParams.get('sort') || 'newest',
    };
    const calls = llmTelemetry.getRecent(opts);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ calls, queryOpts: opts }));
    return;
  }
  if (urlPath === '/api/telemetry/llm/stats' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    const stats = llmTelemetry.getStats({ windowMs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }
  if (urlPath === '/api/telemetry/llm/errors' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)));
    const errors = llmTelemetry.getRecentErrors({ limit });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors }));
    return;
  }
  if (urlPath === '/api/telemetry/insights' && req.method === 'GET') {
    try {
      const telemetryInsights = require('./src/telemetry-insights');
      const url = new URL(req.url, 'http://x');
      const force = url.searchParams.get('force') === '1';
      const insights = telemetryInsights.getInsights({ force });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...insights }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
    return;
  }

  // --- Cost projection: "what would the measured token volume cost on each
  //     cloud model?" Measure locally (free), project onto cloud pricing. ---
  if (urlPath === '/api/telemetry/cost' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 60 * 60 * 1000); // default 1h
    const cacheHitRate = url.searchParams.get('cacheHitRate') != null
      ? Math.max(0, Math.min(1, Number(url.searchParams.get('cacheHitRate'))))
      : undefined;
    const stats = llmTelemetry.getStats({ windowMs });
    const projection = costProjector.project(stats, cacheHitRate != null ? { cacheHitRate } : {});
    // Per-NPC breakdown on the cheapest cloud (non-local) model for "who costs most"
    const cheapestCloud = projection.models.find(m => !m.local) || null;
    projection.perNpc = cheapestCloud
      ? { model: cheapestCloud.label, rows: costProjector.projectPerNpc(stats.byNpc, cheapestCloud, windowMs) }
      : null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projection));
    return;
  }

  // --- Meetings: convene a dynamic multi-turn discussion. ---
  if (urlPath === '/api/meeting' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: meetingRunner.getActive(), history: meetingRunner.getHistory() }));
    return;
  }
  if (urlPath === '/api/meeting' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) {}
      if (!payload.topic) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'topic required' })); return; }
      if (meetingRunner.isActive()) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'a meeting is already in progress' })); return; }
      // Fire async; respond immediately (the discussion plays out over ~30-60s).
      startMeeting(payload).then(r => log.info('Meeting', `"${payload.topic}" → ${r.ok ? r.turns + ' turns, ' + (r.actionItems?.length || 0) + ' action items' : r.error}`)).catch(() => {});
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, started: true, topic: payload.topic, note: 'Meeting convened — watch the conference room.' }));
    });
    return;
  }

  // --- Research: manual web research endpoint (same engine NPCs use). ---
  if (urlPath === '/api/research' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const q = url.searchParams.get('q') || url.searchParams.get('query') || '';
    const read = url.searchParams.get('read') != null ? Number(url.searchParams.get('read')) : 1;
    webResearch.research(q, { count: Number(url.searchParams.get('count')) || 5, read })
      .then(result => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }

  // --- Skill proposals: NPC-authored tools awaiting CEO review. The code is
  //     quarantined in skills-pending/ and only runs after approval. ---
  if (urlPath === '/api/skill-proposals' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const status = url.searchParams.get('status') || null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals: skillBuilder.getSkillProposals({ status }) }));
    return;
  }
  if (/^\/api\/skill-proposals\/([^/]+)\/(approve|reject)$/.test(urlPath) && req.method === 'POST') {
    (async () => {
      const [, , , id, decision] = urlPath.split('/');
      const body = await _readJsonBody(req, 16 * 1024).catch(() => ({}));
      const headerSession = _visitorSessionBodyFromHeaders(req);
      const sessionId = body.session_id || body.sessionId || headerSession.session_id || null;
      // CEO status comes from the verified grant or a strictly-local request —
      // body.is_ceo_principal is a client assertion and is ignored.
      const ceoRequest = hostCompute.isCeoPrincipalRequest(req)
        || hostCompute.isLocalOperatorRequest(req);
      if (sessionId) {
        await _verifyVisitorSession(req, sessionId, body);
        const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
          isCeoPrincipal: ceoRequest,
        });
        if (!approval.allowed) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Team lead or admin role required to approve skills' }));
          return;
        }
      } else if (!ceoRequest) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'CEO or team approver session required' }));
        return;
      }
      const result = decision === 'approve' ? skillBuilder.approveSkill(id) : skillBuilder.rejectSkill(id);
      if (result.ok) {
        _approvedSkillCache = { at: 0, map: {} };
        if (agentWss) agentWss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify({ type: 'skill_proposal_decided', id, decision, ts: Date.now() })); });
        log.info('SkillBuilder', `Skill "${result.proposal?.slug}" ${decision}d`);
      }
      res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/skill-proposals' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const approval = await teamAuth.canApproveSkillsForSession(sessionId);
      if (!approval.allowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Team lead or admin role required' }));
        return;
      }
      const status = u.searchParams.get('status') || 'pending';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        proposals: skillBuilder.getSkillProposals({ status }),
        role: approval.role,
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/visitor\/skill-proposals\/([^/]+)\/(approve|reject)$/.test(urlPath) && req.method === 'POST') {
    (async () => {
      const [, , , , id, decision] = urlPath.split('/');
      const body = await _readJsonBody(req, 16 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const approval = await teamAuth.canApproveSkillsForSession(sessionId);
      if (!approval.allowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Team lead or admin role required' }));
        return;
      }
      const result = decision === 'approve' ? skillBuilder.approveSkill(id) : skillBuilder.rejectSkill(id);
      if (result.ok) {
        _approvedSkillCache = { at: 0, map: {} };
        if (agentWss) agentWss.clients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify({ type: 'skill_proposal_decided', id, decision, ts: Date.now() })); });
      }
      res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: result.ok, ...result, role: approval.role }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/health/runbook' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const scope = body.scope || 'full';
      const remediateActions = Array.isArray(body.remediate) ? body.remediate : [];
      const result = await healthRunbook.runHealthRunbook({
        scope,
        remediateActions,
        verifyAfter: body.verify_after !== false,
        broadcast: _broadcastOps,
        deps: { computeQueue, fleetRegistry },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Per-model LLM usage dashboard: no auth required for local dashboard. ---
  if (urlPath === '/api/llm/usage' && req.method === 'GET') {
    usageTracker.handleApiRequest(req, res);
    return;
  }

  // --- Self-adjust: client timeouts + UX abort telemetry (Angela Assist, etc.) ---
  if (urlPath.startsWith('/api/ux/')) {
    if (selfAdjust.handleApiRequest(req, res, { pathname: urlPath })) return;
    if (urlPath === '/api/ux/event' && req.method === 'POST') {
      (async () => {
        const body = await _readJsonBody(req, 8 * 1024).catch(() => ({}));
        const result = selfAdjust.recordUxEvent(body || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })().catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      });
      return;
    }
  }

  // --- Decision parse-health: how often the model's JSON needed repair or
  //     failed. High repair/fail rate = the current model is not very
  //     model-friendly (consider structured output or a stronger model). ---
  if (urlPath === '/api/telemetry/parse-health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(npcBrains.getDecisionParseStats()));
    return;
  }

  // --- Grounding/hallucination stats: how often NPC claims were flagged as
  //     unbacked (no evidence behind "I fixed it" / "research shows X"). ---
  if (urlPath === '/api/telemetry/grounding' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(require('./src/hallucination-guard').getStats()));
    return;
  }

  // --- Per-NPC profile tracker: actual cost (priced by the model each NPC
  //     really ran on) + estimated cost if it were on a reference cloud model ---
  if (urlPath === '/api/npc-profiles' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 60 * 60 * 1000);
    const referenceModel = url.searchParams.get('referenceModel') || undefined;
    const events = llmTelemetry.getWindowEvents({ windowMs });
    const result = costProjector.buildNpcProfiles(events, { windowMs, referenceModel });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return;
  }

  // --- OpenClaw telemetry: browser dispatcher posts events here ---
  if (urlPath === '/api/telemetry/openclaw' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      try {
        const rec = llmTelemetry.recordOpenClaw({
          tool:          String(payload.tool || 'unknown').slice(0, 80),
          args:          payload.args || null,
          status:        ['started', 'succeeded', 'failed'].indexOf(payload.status) !== -1 ? payload.status : 'unknown',
          latencyMs:     Number.isFinite(payload.latencyMs) ? payload.latencyMs : undefined,
          response:      payload.response || null,
          error:         payload.error ? { message: String(payload.error).slice(0, 600) } : null,
          source:        String(payload.source || 'openclaw').slice(0, 40),
          correlationId: payload.correlationId || null,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: rec.id }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    });
    return;
  }
  if (urlPath === '/api/telemetry/openclaw/stats' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(llmTelemetry.getOpenClawStats({ windowMs })));
    return;
  }
  if (urlPath === '/api/telemetry/openclaw' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: llmTelemetry.getRecentOpenClaw({ limit }) }));
    return;
  }

  // --- LLM decision histogram (what NPCs are actually choosing) ---
  // Extracts the `action` (and optional `skill`) field from every
  // `think` call's responsePreview in the rolling window. Lets the panel
  // show "12 chat · 4 run_skill · 2 meeting" instead of just call counts.
  if (urlPath === '/api/telemetry/llm/decisions' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    const stats = llmTelemetry.getDecisionStats({ windowMs });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // --- PC activity tracker endpoints ---
  // The PC activity ring buffer records every real PC-side task an NPC
  // runs — skills, desktop-agent, coding-agent, linux-agent (Bouncer),
  // job-pipeline (Lucy). Read-only.
  if (urlPath === '/api/pc-activity' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const npc    = url.searchParams.get('npc')    || undefined;
    const kind   = url.searchParams.get('kind')   || undefined;
    const status = url.searchParams.get('status') || undefined;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ events: pcActivity.getRecent({ limit, npc, kind, status }) }));
    return;
  }
  if (urlPath === '/api/pc-activity/stats' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const windowMs = Number(url.searchParams.get('windowMs') || 5 * 60 * 1000);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pcActivity.getStats({ windowMs })));
    return;
  }
  if (urlPath === '/api/pc-activity/active' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ active: pcActivity.getActive() }));
    return;
  }

  // ─── Market / Robinhood endpoints ────────────────────────────────────────────
  // Auth status
  if (urlPath === '/api/market/auth-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      authenticated: robinhoodMcp.isAuthenticated(),
      clientId: robinhoodMcp.getClientId() || null,
      note: robinhoodMcp.isAuthenticated()
        ? 'Robinhood connected. Roki is watching the market.'
        : 'Not connected. Visit /api/market/auth/connect to log in with Robinhood.',
    }));
    return;
  }

  // OAuth2 PKCE initiation — redirect user to Robinhood login
  if (urlPath === '/api/market/auth/connect' && req.method === 'GET') {
    // Robinhood rejects hosted HTTPS callbacks (shows "Uh oh! Something's gone wrong").
    // Loopback http://127.0.0.1 works — guide cloud users to the local connect script.
    try {
      const redirectUri = String(robinhoodMcp.getRedirectUri?.() || '');
      const hostedHttps = /^https:\/\//i.test(redirectUri)
        && !/(localhost|127\.0\.0\.1)/i.test(redirectUri);
      if (hostedHttps) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Connect Robinhood</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.box{max-width:520px;background:#1e293b;border:1px solid #334155;border-radius:14px;padding:28px}
h1{margin:0 0 12px;font-size:22px;color:#86efac}
p{line-height:1.5;color:#cbd5e1}
code{display:block;background:#0f172a;border:1px solid #334155;border-radius:8px;padding:12px;margin:14px 0;color:#fde68a;overflow:auto}
a{color:#93c5fd}
</style></head><body><div class="box">
<h1>Robinhood needs a local connect</h1>
<p>Robinhood’s OAuth only accepts <b>localhost</b> redirects. Connecting from
<code style="display:inline;padding:2px 6px;margin:0">${redirectUri.replace(/</g, '')}</code>
fails with “Uh oh! Something’s gone wrong”.</p>
<p>On your PC (in the Denizen OS repo), run:</p>
<code>py infra/connect-robinhood-local.py</code>
<p>That opens Robinhood, saves the token, and pushes it to the office server.
Then hard-refresh and open <b>Roki Market</b>.</p>
<p><a href="/office">← Back to office</a></p>
</div></body></html>`);
        return;
      }
    } catch (_) {}
    robinhoodMcp.buildAuthUrl()
      .then(authUrl => {
        res.writeHead(302, { Location: authUrl });
        res.end();
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`Auth setup failed: ${err.message}`);
      });
    return;
  }

  // OAuth2 callback — exchange code for tokens
  if (urlPath.startsWith('/api/market/auth/callback') && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const code  = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(`<h2>Robinhood auth failed</h2><p>${error || 'No code received'}</p><p><a href="/api/market/auth/connect">Try again</a></p>`);
      return;
    }

    robinhoodMcp.handleCallback(code, state)
      .then(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><style>
          body{font-family:monospace;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
          .box{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:32px;max-width:400px;text-align:center}
          h2{color:#86efac;margin:0 0 12px} p{color:#94a3b8;margin:0 0 8px} a{color:#93c5fd}
        </style></head><body><div class="box">
          <h2>✓ Robinhood Connected</h2>
          <p>Roki is now watching the market.</p>
          <p>Close this tab and head back to the office.</p>
          <p style="margin-top:16px"><a href="http://localhost:${PORT}">← Return to Denizen</a></p>
        </div></body></html>`);
        if (agentWss) agentWss.clients.forEach(c => {
          if (c.readyState === 1) c.send(JSON.stringify({ type: 'market_auth_connected', ts: Date.now() }));
        });
        log.info('Market', 'Robinhood OAuth connected — Roki activated');
      })
      .catch(err => {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Token exchange failed</h2><p>${err.message}</p><p><a href="/api/market/auth/connect">Try again</a></p>`);
      });
    return;
  }

  // Live market data (proxied through server so auth token stays server-side)
  if (urlPath === '/api/market/quote' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const symbols = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'symbols param required, e.g. ?symbols=NVDA,TSLA' }));
      return;
    }
    robinhoodMcp.getQuote(symbols)
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }
  if (urlPath === '/api/market/chart' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const symbol = (url.searchParams.get('symbol') || '').trim().toUpperCase();
    const range = (url.searchParams.get('range') || '1D').trim().toUpperCase();
    if (!symbol) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'symbol required, e.g. ?symbol=AAPL&range=1D' }));
      return;
    }
    robinhoodMcp.getChart(symbol, range)
      .then((data) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      })
      .catch((err) => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }
  if (urlPath === '/api/market/portfolio' && req.method === 'GET') {
    robinhoodMcp.getPortfolio()
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }
  if (urlPath === '/api/market/positions' && req.method === 'GET') {
    robinhoodMcp.getPositions()
      .then(data => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); })
      .catch(err => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: err.message })); });
    return;
  }

  // Watchlist management
  if (urlPath === '/api/market/watchlist' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ symbols: robinhoodMcp.loadWatchlist() }));
    return;
  }
  if (urlPath === '/api/market/watchlist' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        const { action, symbol } = JSON.parse(body);
        let symbols;
        if (action === 'add') symbols = robinhoodMcp.addToWatchlist(symbol);
        else if (action === 'remove') symbols = robinhoodMcp.removeFromWatchlist(symbol);
        else { res.writeHead(400); res.end(JSON.stringify({ error: 'action must be add|remove' })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, symbols }));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  // Trade suggestions — display + optional paper fills (never live orders)
  if (urlPath === '/api/trade-suggestions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ suggestions: robinhoodMcp.loadSuggestions() }));
    return;
  }
  if (/^\/api\/trade-suggestions\/([^/]+)\/dismiss$/.test(urlPath) && req.method === 'POST') {
    const id = urlPath.split('/')[3];
    const entry = robinhoodMcp.dismissSuggestion(id);
    res.writeHead(entry ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(entry ? { ok: true, entry } : { error: 'not found' }));
    return;
  }

  // Roki paper trading ledger
  if (urlPath === '/api/market/paper' && req.method === 'GET') {
    rokiPaper.getSnapshot(robinhoodMcp)
      .then((account) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(account));
      })
      .catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }
  if (urlPath === '/api/market/paper/reset' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const account = rokiPaper.resetAccount(parsed.cash);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, account: rokiPaper.markAccount(account, {}) }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (urlPath === '/api/market/paper/order' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      Promise.resolve()
        .then(() => JSON.parse(body || '{}'))
        .then((parsed) => rokiPaper.placeOrder({ ...parsed, robinhoodMcp }))
        .then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        })
        .catch((err) => {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
    });
    return;
  }
  if (/^\/api\/market\/paper\/from-suggestion\/([^/]+)$/.test(urlPath) && req.method === 'POST') {
    const id = urlPath.split('/').pop();
    const suggestions = robinhoodMcp.loadSuggestions();
    const suggestion = suggestions.find((s) => s.id === id);
    if (!suggestion) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'suggestion not found' }));
      return;
    }
    rokiPaper.placeFromSuggestion(suggestion, robinhoodMcp)
      .then((result) => {
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      })
      .catch((err) => {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    return;
  }

  if (urlPath === '/api/public/runtime-config' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    });
    res.end(JSON.stringify(agentWsRelay.buildRuntimePublicConfig()));
    return;
  }

  // --- World-state snapshot (read-only) ---
  // Useful for debugging and for the n8n/Supabase integration to know what
  // the office "looks like" before posting an update.
  if (urlPath === '/api/world-state' && req.method === 'GET') {
    if (agentWsRelay.isFollowerRole()) {
      (async () => {
        try {
          const snapshot = await agentWsRelay.fetchPrimaryWorldSnapshot();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(snapshot));
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
        }
      })();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(worldState.snapshot()));
    return;
  }

  // --- Presence flag (Zion at the keyboard) ---
  // GET returns the current value; POST { present: bool } toggles it.
  // The voice gate in the browser reads this on every speech bubble — when
  // false, bubbles still render but no audio fires.
  if (urlPath === '/api/presence' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ zionPresent: worldState.zionPresent }));
    return;
  }
  if (urlPath === '/api/presence' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = body ? JSON.parse(body) : {};
        const next = worldState.setPresence(!!payload.present);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, zionPresent: next }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Discord Spaces avatars — catalog, JSON, baked PNG (shared store with bot).
  // Safe additive API: does not change office HQ UI or map client bundles.
  if (urlPath === '/api/discord/avatar/catalog' && req.method === 'GET') {
    try {
      const avatarApi = require('./src/discord-avatar');
      const plan = avatarApi.resolvePlan(
        (new URL(req.url, 'http://localhost')).searchParams.get('plan')
        || process.env.DENIZEN_SPACES_PLAN,
      );
      const unlocks = avatarApi.resolveUnlocks({});
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        plan,
        ...avatarApi.publicCatalogForPlan(plan, unlocks, {}),
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
    return;
  }

  if (urlPath.startsWith('/api/discord/avatar/') && (req.method === 'GET' || req.method === 'PUT')) {
    (async () => {
      const avatarApi = require('./src/discord-avatar');
      const store = avatarApi.getAvatarStore();
      let rest = urlPath.slice('/api/discord/avatar/'.length);
      let asPng = false;
      if (rest.endsWith('.png')) {
        asPng = true;
        rest = rest.slice(0, -4);
      }
      const userId = String(rest || '').replace(/[^0-9]/g, '');
      if (!userId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'userId required' }));
        return;
      }
      if (req.method === 'GET' && asPng) {
        // Single-flight + capped concurrency — a burst of cold requests
        // (e.g. after a cache clear) shares bakes instead of pinning the CPU.
        const buf = await avatarApi.ensurePngOnDemand(store, userId);
        if (!buf) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'custom avatar not found' }));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=60',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(buf);
        return;
      }
      if (req.method === 'GET') {
        const av = store.get(userId);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          ok: true,
          userId,
          avatar: avatarApi.clientAvatar(av, userId),
          raw: av,
        }));
        return;
      }
      // PUT — require linked Discord session (cannot edit another user)
      const payload = await _readJsonBody(req, 64 * 1024);
      const sessionId = String(
        req.headers['x-session-id']
        || payload.session_id
        || payload.sessionId
        || '',
      ).trim();
      const sessionToken = sessionAuth.extractSessionAuth(req, payload);
      let linked;
      try {
        const discordAuth = require('./src/denizen-discord-auth.js');
        linked = await discordAuth.getLinkStatusForSession(sessionId, sessionToken);
      } catch (_) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'authenticated Discord session required' }));
        return;
      }
      if (!linked?.linked || String(linked.discord_user_id) !== userId) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'cannot edit another Discord user avatar' }));
        return;
      }
      // Plan is resolved SERVER-SIDE only — a client-supplied payload.plan
      // let any linked user claim 'pro' and bypass the free-tier gates.
      const plan = avatarApi.resolvePlan(process.env.DENIZEN_SPACES_PLAN);
      // Sanitize privileged fields a client must not self-assign: unlocks are
      // derived (roles/events), and role:booster hat/tint provenance can only
      // be carried over from the previously stored avatar, never minted here.
      const prev = store.get(userId);
      const submitted = payload.avatar || payload;
      const sanitized = { ...submitted, unlocks: prev?.unlocks || [] };
      if (sanitized.hat && sanitized.hat.source === 'role:booster'
        && prev?.hat?.source !== 'role:booster') {
        sanitized.hat = { ...sanitized.hat, source: 'manual' };
      }
      const av = await avatarApi.ensureBaked(store, userId, sanitized, { plan });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        userId,
        avatar: avatarApi.clientAvatar(av, userId),
      }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Discord Spaces — map access status (membership + team-code gate)
  if (urlPath === '/api/discord/map/access' && req.method === 'GET') {
    (async () => {
      const guildId = mapAccess.extractGuildId(req);
      const status = await guildOrg.getAccessStatus(guildId);
      let unlocked = false;
      let code = null;
      let denyMessage = null;
      if (guildId) {
        // Single source of truth — same gate the /presence proxy enforces.
        const gate = await mapAccess.assertMapAccess(req, { guildId });
        unlocked = !!gate.ok;
        if (!gate.ok) {
          code = gate.code || null;
          denyMessage = gate.message || null;
        }
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify({
        ...status,
        unlocked,
        code,
        message: denyMessage || status.message || null,
      }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Unlock a guild map with the owner's Denizen team code → map_grant
  if (urlPath === '/api/discord/map/unlock' && req.method === 'POST') {
    (async () => {
      const payload = await _readJsonBody(req, 8 * 1024);
      const result = await mapAccess.unlockWithTeamCode(
        payload.guildId || payload.guild_id,
        payload.teamCode || payload.team_code,
      );
      const status = result.ok ? 200 : (result.code === 'BAD_INPUT' ? 400 : 403);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(result));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Bot owner (bridge secret): reveal team code for a linked guild
  if (urlPath === '/api/discord/map/mapcode' && req.method === 'GET') {
    (async () => {
      const expected = String(process.env.DISCORD_BRIDGE_SECRET || '').trim();
      if (expected) {
        const got = String(req.headers['x-denizen-secret'] || '');
        const a = Buffer.from(got);
        const b = Buffer.from(expected);
        const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'bad or missing secret' }));
          return;
        }
      } else {
        const remote = String(req.socket?.remoteAddress || '');
        const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
        if (!isLoopback) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'bridge secret not configured' }));
          return;
        }
      }
      const guildId = mapAccess.extractGuildId(req);
      if (!guildId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'guild_id_required' }));
        return;
      }
      const link = await guildOrg.getLinkForGuild(guildId);
      if (!link?.org) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'setup_required', code: 'SETUP_REQUIRED' }));
        return;
      }
      const teamCode = await guildOrg.getTeamCodeForGuild(guildId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({
        ok: true,
        guild_id: guildId,
        org_id: link.org.id,
        org_slug: link.org.slug || null,
        org_display_name: link.org.display_name || link.org.slug || null,
        team_code: teamCode,
      }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Bot owner: bind Discord guild → Denizen org via team code
  if (urlPath === '/api/discord/map/teamlink' && req.method === 'POST') {
    (async () => {
      const payload = await _readJsonBody(req, 8 * 1024);
      const expected = String(process.env.DISCORD_BRIDGE_SECRET || '').trim();
      if (expected) {
        const got = String(payload.secret || req.headers['x-denizen-secret'] || '');
        const a = Buffer.from(got);
        const b = Buffer.from(expected);
        const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!ok) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'bad or missing secret' }));
          return;
        }
      } else {
        const remote = String(req.socket?.remoteAddress || '');
        const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
        if (!isLoopback) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'bridge secret not configured' }));
          return;
        }
      }
      const result = await guildOrg.linkGuild(
        payload.guildId || payload.guild_id,
        payload.teamCode || payload.team_code,
        { createdByDiscordUserId: payload.discordUserId || payload.discord_user_id || null },
      );
      const status = result.ok ? 200 : (result.code === 'BAD_INPUT' ? 400 : result.code === 'DENIED' ? 403 : 500);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Discord pixel map — proxy guild list + VC presence from discord-bot sidecar.
  if (
    (urlPath === '/api/discord/map/presence'
      || urlPath === '/api/discord/map/guilds'
      || urlPath === '/api/discord/map/invite')
    && req.method === 'GET'
  ) {
    (async () => {
      try {
        // Presence (and invite for a specific guild) require team-code unlock when gated.
        if (urlPath === '/api/discord/map/presence') {
          const gate = await mapAccess.assertMapAccess(req);
          if (!gate.ok) {
            res.writeHead(gate.status || 403, {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store',
              'Access-Control-Allow-Origin': '*',
            });
            res.end(JSON.stringify({
              ok: false,
              error: gate.error,
              code: gate.code,
              message: gate.message,
              guild_id: gate.guild_id || null,
              org_display_name: gate.org_display_name || null,
            }));
            return;
          }
        }
        const botPort = Number(process.env.DISCORD_PRESENCE_PORT) || 5180;
        const qs = (req.url || '').includes('?') ? (req.url || '').slice((req.url || '').indexOf('?')) : '';
        const pathPart = urlPath === '/api/discord/map/guilds'
          ? '/guilds'
          : urlPath === '/api/discord/map/invite'
            ? '/invite'
            : '/presence';
        const upstream = `http://127.0.0.1:${botPort}${pathPart}${qs}`;
        const r = await fetch(upstream, { signal: AbortSignal.timeout(8000) });
        const body = await r.text();
        // Strip public ungated map hints from presence payloads for linked guilds.
        let outBody = body;
        if (urlPath === '/api/discord/map/presence') {
          try {
            const data = JSON.parse(body);
            if (data && typeof data === 'object') {
              if (data.mapUrl && String(data.mapUrl).includes('view=public')) {
                data.mapUrl = String(data.mapUrl).replace(/([?&])view=public&?/, '$1').replace(/[?&]$/, '');
              }
              if (data.publicMapUrl) delete data.publicMapUrl;
              outBody = JSON.stringify(data);
            }
          } catch (_) { /* keep upstream body */ }
        }
        // Guild list — hide servers the caller has no membership or team-code
        // path into rather than returning the bot's full unfiltered list.
        if (urlPath === '/api/discord/map/guilds') {
          try {
            const data = JSON.parse(body);
            const rawGuilds = Array.isArray(data?.guilds) ? data.guilds : [];
            const accessible = await mapAccess.filterAccessibleGuilds(req, rawGuilds);
            outBody = JSON.stringify({
              ...data,
              guilds: accessible,
              botHasGuilds: rawGuilds.length > 0,
            });
          } catch (_) { /* keep upstream body */ }
        }
        res.writeHead(r.status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(outBody);
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: 'discord presence unavailable',
          detail: err?.message || String(err),
        }));
      }
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Discord bot → office presence (VC join/leave/move) ---
  // Auth: DISCORD_BRIDGE_SECRET via x-denizen-secret (or body.secret).
  // Unset secret only stays open for loopback callers (the bot sidecar runs
  // in the same container); remote posts without a configured secret are 401.
  if (urlPath === '/api/discord/presence' && req.method === 'POST') {
    (async () => {
      try {
        const payload = await _readJsonBody(req, 16 * 1024);
        const expected = String(process.env.DISCORD_BRIDGE_SECRET || '').trim();
        if (expected) {
          const got = String(payload.secret || req.headers['x-denizen-secret'] || '');
          const a = Buffer.from(got);
          const b = Buffer.from(expected);
          const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
          if (!ok) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad or missing secret' }));
            return;
          }
        } else {
          const remote = String(req.socket?.remoteAddress || '');
          const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
          if (!isLoopback) {
            if (!global.__bridgeOpenWarned) {
              global.__bridgeOpenWarned = true;
              console.warn('[discord-bridge] rejected remote POST /api/discord/presence — set DISCORD_BRIDGE_SECRET to allow non-local bridge callers');
            }
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bridge secret not configured' }));
            return;
          }
        }
        const userId = String(payload.userId || payload.user_id || '').trim();
        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'userId required' }));
          return;
        }
        const officeId = officeRegistry.normalizeOfficeId(
          payload.office_id || payload.officeId || process.env.DISCORD_OFFICE_ID || officeRegistry.CEO_OFFICE_ID,
        );
        const sessionId = `discord:${userId}`;
        const event = String(payload.event || 'voice_join').toLowerCase();
        if (event === 'voice_leave' || event === 'leave') {
          const removed = officeRegistry.removePlayerFromOffice(officeId, sessionId);
          if (removed) {
            _broadcastToOffice(officeId, {
              type: 'player_left',
              office_id: officeId,
              sessionId,
              displayName: removed.displayName || null,
              source: 'discord',
              ts: Date.now(),
            });
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, event: 'voice_leave', sessionId, office_id: officeId }));
          return;
        }
        const displayName = String(payload.displayName || payload.display_name || `Discord ${userId}`).slice(0, 48);
        const x = Number.isFinite(Number(payload.x)) ? Number(payload.x) : 310;
        const y = Number.isFinite(Number(payload.y)) ? Number(payload.y) : 200;
        const seeded = officeRegistry.upsertPlayerPose(officeId, {
          sessionId,
          visitorId: null,
          displayName,
          x,
          y,
          facing: payload.facing || 'down',
          anim: payload.anim || 'idle',
          room: payload.room || payload.channelName || null,
          interactive: false,
          spectator: true,
        }, { force: true });
        if (seeded.ok) {
          _broadcastToOffice(officeId, {
            type: 'player_pose',
            office_id: officeId,
            source: 'discord',
            channelId: payload.channelId || null,
            channelName: payload.channelName || null,
            ...seeded.pose,
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          event,
          sessionId,
          office_id: officeId,
          pose: seeded.pose || null,
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    })();
    return;
  }

  // --- Discord bot premium subscriptions (guild-scoped plans) ---
  if (urlPath === '/api/discord/billing/checkout' && req.method === 'POST') {
    (async () => {
      try {
        const payload = await _readJsonBody(req, 8 * 1024);
        const billing = require('./src/denizen-guild-billing');
        const result = await billing.createGuildSubscriptionCheckout({
          guildId: String(payload.guildId || payload.guild_id || '').trim(),
          plan: String(payload.plan || 'pro').trim().toLowerCase(),
          discordUserId: payload.discordUserId || payload.discord_user_id || null,
        });
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[billing] checkout endpoint error: ${err?.message || err}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
      }
    })();
    return;
  }

  if (urlPath === '/api/discord/billing/pet-checkout' && req.method === 'POST') {
    (async () => {
      try {
        const payload = await _readJsonBody(req, 8 * 1024);
        const billing = require('./src/denizen-guild-billing');
        const result = await billing.createPetCheckout({
          guildId: String(payload.guildId || payload.guild_id || '').trim(),
          discordUserId: payload.discordUserId || payload.discord_user_id || null,
          giftToUserId: payload.giftToUserId || payload.gift_to_user_id || null,
        });
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[billing] pet-checkout endpoint error: ${err?.message || err}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
      }
    })();
    return;
  }

  if (urlPath === '/api/discord/billing/webhook' && req.method === 'POST') {
    (async () => {
      try {
        // Stripe HMAC needs the exact raw bytes — do NOT parse before verifying.
        const rawBody = await new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => {
            size += c.length;
            if (size > 512 * 1024) { reject(new Error('body_too_large')); req.destroy(); return; }
            chunks.push(c);
          });
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error', reject);
        });
        const billing = require('./src/denizen-guild-billing');
        const sig = req.headers['stripe-signature'] || '';
        const result = await billing.handleGuildBillingWebhook(rawBody, sig);
        // Permanent client errors (bad payload) → 4xx so Stripe stops retrying.
        // Transient failures (e.g. DB write failed) → 5xx so Stripe DOES retry
        // and a lapsed webhook doesn't silently lose a paid entitlement.
        let status = 200;
        if (!result.ok) {
          const permanent = new Set(['bad_signature', 'invalid_json']);
          status = permanent.has(result.error) ? 400 : 500;
        }
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[billing] webhook endpoint error: ${err?.message || err}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'internal_error' }));
      }
    })();
    return;
  }

  // --- Assistant profile: persistent user/project memory + autonomy policy ---
  if (urlPath === '/api/assistant-profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(npcBrains.getAssistantProfile()));
    return;
  }

  if (urlPath === '/api/assistant-profile' && req.method === 'POST') {
    (async () => {
      const patch = await _readJsonBody(req, 2 * 1024 * 1024);
      const updated = npcBrains.updateAssistantProfile(patch || {});
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile: updated }));
    })().catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Visitor sessions + personal assistant claims ---
  if (urlPath === '/api/orgs' && req.method === 'GET') {
    (async () => {
      const orgs = await denizenVisitor.listOrganizations();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, orgs }));
    })().catch((err) => {
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/session' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      await _createVisitorSession(req, res, body);
    })().catch((err) => {
      if (res.writableEnded) return;
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/org' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const slug = u.searchParams.get('slug') || denizenDb.orgSlug || 'zion';
      const org = await denizenVisitor.resolveOrgBySlug(slug);
      if (!org) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Organization "${slug}" not found` }));
        return;
      }
      const policy = await orgPolicy.getOrgPolicy(org.slug);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        org: {
          slug: org.slug,
          id: org.id,
          display_name: org.display_name,
          plan: org.plan || null,
          policy,
        },
      }));
    })().catch((err) => {
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/org/policy' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const slug = u.searchParams.get('slug') || denizenDb.orgSlug || 'zion';
      const table = u.searchParams.get('table');
      const policy = await orgPolicy.getOrgPolicy(slug);
      const allowed = table
        ? await orgPolicy.isBusinessTableAllowed(slug, table)
        : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, slug, policy, table: table || null, allowed }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/org/clone-template' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const ceoRequest = hostCompute.isCeoPrincipalRequest(req)
        || hostCompute.isLocalOperatorRequest(req);
      const sessionId = body.session_id || body.sessionId || null;
      if (sessionId) {
        await _verifyVisitorSession(req, sessionId, body);
        const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
          isCeoPrincipal: ceoRequest,
        });
        if (!approval.allowed && !ceoRequest) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Team lead or CEO required to clone template pack' }));
          return;
        }
      } else if (!ceoRequest) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'CEO or team approver session required' }));
        return;
      }
      if (!denizenDb.enabled) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Database unavailable' }));
        return;
      }
      const orgSlug = body.org_slug || body.orgSlug;
      const templatePack = body.template_pack || body.templatePack || '1921-govcon';
      if (!orgSlug) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'org_slug required' }));
        return;
      }
      const org = await denizenVisitor.resolveOrgBySlug(orgSlug);
      if (!org?.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Organization "${orgSlug}" not found` }));
        return;
      }
      const agentSouls = require('./src/agent-souls');
      const result = await agentSouls.cloneTemplatePackToOrg(denizenDb, org.id, templatePack);
      if (npcBrains?.hydrateAgentSoulsFromDb) {
        await npcBrains.hydrateAgentSoulsFromDb(org.id).catch(() => null);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, org_slug: orgSlug, org_id: org.id, ...result }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/intelligence/prediction-summary' && req.method === 'GET') {
    (async () => {
      if (!denizenDb.enabled || !denizenDb.orgId) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Intelligence layer unavailable' }));
        return;
      }
      const summary = await getPredictionSummary(denizenDb.orgId, denizenDb, { includeTopForecasts: true, topLimit: 5 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, summary }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/federal/pipeline-summary' && req.method === 'GET') {
    (async () => {
      if (!denizenDb.enabled || !denizenDb.orgId) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Intelligence layer unavailable' }));
        return;
      }
      // This surface is single-tenant by design (the process-global org), but
      // the org must still be passed explicitly — the shared Supabase holds
      // every other tenant's rfps too (dossier G#5).
      const summary = await getRfpPipelineSummary(denizenDb, { orgId: denizenDb.orgId });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, summary }));
    })().catch((err) => {
      // A missing org_id column means the platform-bridge migration has not
      // been applied — that is a 503 (not configured), not a 500 (crash).
      const status = err?.code === 'ORG_SCOPE_UNAVAILABLE' ? 503 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err), code: err?.code }));
    });
    return;
  }

  if (urlPath === '/api/intelligence/mirofish-status' && req.method === 'GET') {
    (async () => {
      const cfg = mirofishPrediction.getConfig();
      const available = await mirofishPrediction.isAvailable();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, enabled: cfg.enabled, baseUrl: cfg.baseUrl, available }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/intelligence/mirofish-sync' && req.method === 'POST') {
    (async () => {
      if (!denizenDb.enabled || !denizenDb.orgId) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Intelligence layer unavailable' }));
        return;
      }
      const result = await runMiroFishMaintenance(denizenDb);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/session' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, session }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/email/status' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const settings = await denizenVisitor.getSessionSettings(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        has_email: !!(settings?.email),
        email: settings?.email || null,
        notify_email: settings?.notify_email !== false,
        resend_configured: !!(process.env.RESEND_API_KEY),
        operator_inbox: true,
        visitor_gmail_oauth: false,
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/desktop-downloads' && req.method === 'GET') {
    const desktopDownloads = require('./src/denizen-desktop-downloads.js');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(desktopDownloads.getDesktopDownloadsPayload()));
    return;
  }

  if (urlPath === '/api/visitor/team/invite-link' && req.method === 'GET') {
    (async () => {
      const teamInviteLinks = require('./src/denizen-team-invite-links.js');
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      const access = await _verifyVisitorSession(req, sessionId, {});
      if (access.tier === 'demo' || access.isDemo) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Team invite links require a team account' }));
        return;
      }
      const org = access.org || null;
      if (!org?.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Organization not found for session' }));
        return;
      }
      const account = await teamAuth.getTeamAccountForSession(sessionId).catch(() => null);
      const inviterName = account?.display_name || access.session?.display_name || 'Teammate';
      const payload = await teamInviteLinks.buildInvitePayloadForOrg(org, { inviterName });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/team/invite' && req.method === 'POST') {
    (async () => {
      const { inviteTeamMember } = require('./src/denizen-crm-team-invite.js');
      const body = await _readJsonBody(req, 32 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      const access = await _verifyVisitorSession(req, sessionId, body);
      if (access.tier === 'demo' || access.isDemo) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Team invites require a team account' }));
        return;
      }
      const org = access.org || null;
      if (!org?.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Organization not found for session' }));
        return;
      }
      const principal = await teamAuth.resolveCeoPrincipalForSession(sessionId, { access });
      const approval = await teamAuth.canApproveSkillsForSession(sessionId, {
        isCeoPrincipal: !!principal?.ceo,
      });
      if (!approval.allowed) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Only team owners and admins can send invites' }));
        return;
      }
      const account = await teamAuth.getTeamAccountForSession(sessionId).catch(() => null);
      const inviterName = account?.display_name || access.session?.display_name || 'Teammate';
      const result = await inviteTeamMember(
        org.id,
        access.orgSlug || org.slug || null,
        {
          email: body.email,
          displayName: body.display_name || body.displayName,
          platform: invitePlatform.normalizeInvitePlatform(body.platform || 'windows'),
        },
        inviterName,
      );
      if (!result.ok) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/settings' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const settings = await denizenVisitor.getSessionSettings(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, settings: settings || {} }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/settings' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const providerKeys = body.provider_keys || body.providerKeys || null;
      const notifyEmail = body.notify_email ?? body.notifyEmail;
      const email = body.email;
      const displayName = body.display_name ?? body.displayName;
      const session = await denizenVisitor.updateSessionSettings(sessionId, {
        providerKeys,
        notifyEmail,
        email,
        displayName,
      });
      const settings = await denizenVisitor.getSessionSettings(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, session, settings: settings || {} }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/position/suggestions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, suggestions: userPosition.POSITION_SUGGESTIONS }));
    return;
  }

  if (urlPath === '/api/visitor/position' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const identity = await userIdentity.getIdentityBySession(sessionId);
      const position = userPosition.toClientPosition(userPosition.getPositionFromIdentity(identity));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, position, suggestions: userPosition.POSITION_SUGGESTIONS }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/position/resolve' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 8 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const title = body.title || body.position_title || body.positionTitle;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      if (!userPosition.normalizeTitle(title)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'title required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const profile = await userPosition.resolvePositionProfile(title, { useLlm: body.use_llm !== false });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, position: userPosition.toClientPosition(profile) }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/position' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 16 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const title = body.title || body.position_title || body.positionTitle;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      if (!userPosition.normalizeTitle(title)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'title required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const identity = await userIdentity.getIdentityBySession(sessionId);
      if (!identity?.id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'This session is not linked to a user profile yet' }));
        return;
      }
      const shouldResolve = body.resolve !== false;
      const position = await userPosition.saveIdentityPosition(identity.id, {
        title,
        resolve: shouldResolve,
        profile: body.profile || null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, position: userPosition.toClientPosition(position) }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/auth/change-password' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 16 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const identity = await userIdentity.getIdentityBySession(sessionId);
      if (!identity?.id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'This session is not linked to a user profile yet' }));
        return;
      }
      await userIdentity.changeIdentityPassword(identity.id, {
        currentPassword: body.current_password || body.currentPassword,
        newPassword: body.new_password || body.newPassword,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    })().catch((err) => {
      const status = /incorrect|required|at least/i.test(String(err?.message || '')) ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/assistant' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      const assistant = await denizenVisitor.getAssistant(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, assistant: assistant || null }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/npc-team' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      const npcKey = u.searchParams.get('npc_key') || u.searchParams.get('npcKey');
      const soulFlag = String(
        u.searchParams.get('soul') || u.searchParams.get('include_soul') || '',
      );
      const soulHeader = String(req.headers['x-denizen-npc-soul'] || '').trim();
      const wantSoul = npcKey && (
        /^(1|true|yes)$/i.test(soulFlag)
        || soulHeader === '1'
        || /^true$/i.test(soulHeader)
      );
      const identityId = session.identity_id;
      if (wantSoul) {
        if (!identityId) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Profile required' }));
          return;
        }
        const soul = await userIdentity.getNpcTeamMemberSoulView(identityId, npcKey, session.org_id || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, soul }));
        return;
      }
      const team = identityId ? await userIdentity.getNpcTeam(identityId) : null;
      const orgTeam = session.org_id && _hasOrgNpcTeamAccess(session)
        ? await userIdentity.orgNpcTeam.getOrgTeam(session.org_id).catch(() => null)
        : null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, team: team || null, org_team: orgTeam, can_manage_org: _canManageOrgNpcTeam(session) }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/npc-team' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      if (!session.identity_id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'This session is not linked to a user profile yet' }));
        return;
      }
      if (body.action === 'soul' || body.soul === true) {
        const soulKey = body.npc_key || body.npcKey;
        if (!soulKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'npc_key required for soul view' }));
          return;
        }
        const soul = await userIdentity.getNpcTeamMemberSoulView(session.identity_id, soulKey, session.org_id || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, soul }));
        return;
      }
      if (body.action === 'batch_add' || body.batch_add === true) {
        const batch = await _batchAddNpcTeamMembers(session, body);
        res.writeHead(batch.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(batch.payload));
        return;
      }
      await userIdentity.updateNpcTeamTemplate(session.identity_id, {
        orgId: session.org_id || null,
        name: body.name,
        purpose: body.purpose,
        settings: body.settings,
      });
      visitorOfficeContext.clearTeamCache(session.identity_id);
      const team = await userIdentity.getNpcTeam(session.identity_id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, team: team || null }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/npc-team/member' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      if (!session.identity_id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'This session is not linked to a user profile yet' }));
        return;
      }
      if (body.action === 'batch_add' || body.batch_add === true) {
        const batch = await _batchAddNpcTeamMembers(session, body);
        res.writeHead(batch.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(batch.payload));
        return;
      }
      const npcKey = body.npc_key || body.npcKey;
      if (!npcKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and npc_key required' }));
        return;
      }
      if (body.action === 'soul' || body.soul === true) {
        const soul = await userIdentity.getNpcTeamMemberSoulView(session.identity_id, npcKey, session.org_id || null);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, soul }));
        return;
      }
      if (body.active === false || body.remove === true) {
        await userIdentity.deactivateNpcTeamMember(session.identity_id, npcKey);
      } else {
        const eligible = denizenVisitor.isNpcTeamEligible(npcKey);
        if (!eligible?.eligible) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: `NPC "${npcKey}" cannot be added to a personal team (${eligible?.reason || 'ineligible'})` }));
          return;
        }
        await userIdentity.upsertNpcTeamMember(session.identity_id, {
          orgId: session.org_id || null,
          npcKey,
          displayName: body.display_name ?? body.displayName,
          role: body.role,
          focus: body.focus,
          instructions: body.instructions,
          job: body.job,
          soulSnippet: body.soul_snippet ?? body.soulSnippet,
          personality: body.personality,
          extraSkills: body.extra_skills ?? body.extraSkills,
          sortOrder: body.sort_order ?? body.sortOrder,
          settings: body.settings,
        });
      }
      const team = await userIdentity.getNpcTeam(session.identity_id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, team: team || null }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/npc-team/members/batch' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 128 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      const batch = await _batchAddNpcTeamMembers(session, body);
      res.writeHead(batch.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(batch.payload));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/npc-team/member/soul' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const npcKey = u.searchParams.get('npc_key') || u.searchParams.get('npcKey');
      if (!sessionId || !npcKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and npc_key required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      if (!session?.identity_id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Profile required' }));
        return;
      }
      const soul = await userIdentity.getNpcTeamMemberSoulView(session.identity_id, npcKey, session.org_id || null);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, soul }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/org-npc-team' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      if (!session?.org_id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Org membership required' }));
        return;
      }
      if (!_hasOrgNpcTeamAccess(session)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Team tier required for org NPC defaults' }));
        return;
      }
      const orgTeam = await userIdentity.orgNpcTeam.getOrgTeam(session.org_id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        org_team: orgTeam,
        can_manage: _canManageOrgNpcTeam(session),
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/org-npc-team' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 96 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const session = await denizenVisitor.getSession(sessionId);
      if (!session?.org_id) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Org membership required' }));
        return;
      }
      if (!_canManageOrgNpcTeam(session)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Owner or admin required to edit org NPC defaults' }));
        return;
      }
      if (body.action === 'member') {
        const npcKey = body.npc_key || body.npcKey;
        if (!npcKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'npc_key required' }));
          return;
        }
        if (body.remove === true || body.active === false) {
          await userIdentity.orgNpcTeam.deactivateOrgMember(session.org_id, npcKey);
        } else {
          await userIdentity.orgNpcTeam.upsertOrgMember(session.org_id, {
            npcKey,
            displayName: body.display_name ?? body.displayName,
            role: body.role,
            focus: body.focus,
            instructions: body.instructions,
            job: body.job,
            soulSnippet: body.soul_snippet ?? body.soulSnippet,
            personality: body.personality,
            extraSkills: body.extra_skills ?? body.extraSkills,
            sortOrder: body.sort_order ?? body.sortOrder,
            settings: body.settings,
          });
        }
      } else {
        await userIdentity.orgNpcTeam.updateOrgTemplate(session.org_id, {
          name: body.name,
          purpose: body.purpose,
          settings: body.settings,
        });
      }
      const orgTeam = await userIdentity.orgNpcTeam.getOrgTeam(session.org_id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, org_team: orgTeam }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/claim' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const npcKey = body.npc_key || body.npcKey || body.npc_name || body.npcName;
      if (!sessionId || !npcKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and npc_key (or npc_name) required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const assistant = await denizenVisitor.claimAssistant({
        sessionId,
        npcKey,
        assistantName: body.assistant_name ?? body.assistantName,
        focus: body.focus,
        roleOverlay: body.role_overlay ?? body.roleOverlay,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, assistant }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/chat/threads' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      const identityId = await _resolveChatIdentityId(session, sessionId);
      const threads = identityId
        ? await userIdentity.listChatThreads(identityId)
        : [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, threads }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) return _writeVisitorAccessError(res, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/chat/history' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const threadId = u.searchParams.get('thread_id') || u.searchParams.get('threadId');
      if (!sessionId || !threadId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and thread_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      const identityId = await _resolveChatIdentityId(session, sessionId);
      if (!identityId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, messages: [] }));
        return;
      }
      const displayName = session?.display_name || 'You';
      let messages = [];
      if (String(threadId).startsWith('dm:')) {
        const npcKey = String(threadId).slice(3);
        const rows = await userIdentity.loadDmChatHistory(identityId, npcKey, 80);
        const npcName = npcFolderToDisplay(npcKey);
        messages = userIdentity.mapChatRowsToMemories(rows, npcName, displayName);
      } else if (String(threadId).startsWith('group:')) {
        const groupId = String(threadId).slice(6);
        const rows = await userIdentity.loadGroupChatHistory(identityId, groupId, 80);
        messages = userIdentity.mapGroupRowsToMessages(rows, displayName, npcFolderToDisplay);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, messages }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) return _writeVisitorAccessError(res, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/chat/groups' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const session = await denizenVisitor.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Session not found' }));
        return;
      }
      const identityId = await _resolveChatIdentityId(session, sessionId);
      const memberNpcKeys = body.member_npc_keys || body.memberNpcKeys || body.npc_keys || body.npcKeys;
      const group = await userIdentity.createGroupChat({
        identityId,
        name: body.name || body.group_name || body.groupName,
        memberNpcKeys,
      });
      if (!group?.id) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Could not create group chat' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        group,
        thread_id: `group:${group.id}`,
        storage: group._local ? 'memory' : 'database',
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) return _writeVisitorAccessError(res, err);
      const status = String(err?.message || '').includes('at least two') ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/assistant' && req.method === 'PATCH') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const assistant = await denizenVisitor.updateAssistant({
        sessionId,
        assistantName: body.assistant_name ?? body.assistantName,
        focus: body.focus,
        roleOverlay: body.role_overlay ?? body.roleOverlay,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, assistant }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/assistant' && req.method === 'DELETE') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024).catch(() => ({}));
      const u = new URL(req.url, 'http://localhost');
      const sessionId = body.session_id || body.sessionId
        || u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const result = await denizenVisitor.releaseAssistant(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/projects' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const projects = await denizenVisitor.listProjects(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, projects }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/projects' && req.method === 'POST') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const body = await _readJsonBody(req, 64 * 1024);
      const sid = sessionId || body.session_id || body.sessionId;
      if (!sid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sid, body);
      const project = await denizenVisitor.addProject(sid, {
        name: body.name,
        status: body.status,
        priority: body.priority,
        notes: body.notes,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, project }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/visitor\/projects\/([^/]+)$/.test(urlPath) && req.method === 'PATCH') {
    (async () => {
      const projectId = urlPath.split('/')[4];
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const body = await _readJsonBody(req, 64 * 1024);
      const sid = sessionId || body.session_id || body.sessionId;
      if (!sid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sid, body);
      const project = await denizenVisitor.updateProject(projectId, sid, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, project }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/visitor\/projects\/([^/]+)$/.test(urlPath) && req.method === 'DELETE') {
    (async () => {
      const projectId = urlPath.split('/')[4];
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      await denizenVisitor.deleteProject(projectId, sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/connections' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const data = await visitorConnections.listConnections(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...data }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      if (err instanceof visitorConnections.ConnectionError) {
        return _writeVisitorConnectionError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/connections/request' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const sessionId = body.session_id || body.sessionId || body.from_session_id || body.fromSessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const connection = await visitorConnections.requestConnection({
        fromSessionId: sessionId,
        targetEmail: body.target_email || body.targetEmail || body.email,
        targetSessionId: body.target_session_id || body.targetSessionId,
        message: body.message,
      });
      _broadcastConnectionUpdate(connection, {
        event: 'incoming_request',
        sessionIds: [connection.target_session_id, sessionId],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connection }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      if (err instanceof visitorConnections.ConnectionError) {
        return _writeVisitorConnectionError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/connections/respond' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 16 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId || !(body.connection_id || body.connectionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and connection_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const connection = await visitorConnections.respondConnection({
        sessionId,
        connectionId: body.connection_id || body.connectionId,
        action: body.action,
      });
      const action = String(body.action || '').toLowerCase();
      const event = action === 'accept' ? 'accepted' : (action === 'block' ? 'blocked' : 'declined');
      _broadcastConnectionUpdate(connection, {
        event,
        sessionIds: [connection.target_session_id, sessionId],
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, connection }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      if (err instanceof visitorConnections.ConnectionError) {
        return _writeVisitorConnectionError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/office-bus' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const fromSessionId = body.session_id || body.sessionId || body.from_session_id;
      if (!fromSessionId || !body.message) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and message required' }));
        return;
      }
      await _verifyVisitorSession(req, fromSessionId, body);
      const busMsg = await officeBus.sendOfficeBusMessage({
        fromSessionId,
        toOfficeId: body.to_office_id || body.toOfficeId,
        toSessionId: body.to_session_id || body.toSessionId,
        message: body.message,
        intent: body.intent || 'sync',
        fromNpc: body.from_npc || body.fromNpc,
        metadata: body.metadata,
      }, { denizenVisitor, userIdentity, visitorConnections, listOnlineSessionIds });
      const targetSid = busMsg.to_session_id;
      if (targetSid) {
        const clients = _agentClients();
        for (const c of clients) {
          if (c.readyState === 1 && c._denizenSessionId === targetSid) {
            _deliverHandoffWs(c, busMsg, { officeId: busMsg.to_office_id });
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: busMsg }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      if (err instanceof visitorConnections.ConnectionError) {
        return _writeVisitorConnectionError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/offices' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const session = await denizenVisitor.getSession(sessionId);
      const myOffice = officeRegistry.resolveOfficeFromSession(session);
      const teammates = await denizenVisitor.listTeammatesWithPresence(sessionId, listOnlineSessionIds());
      const onlineOffices = officeRegistry.listOfficesOnline(_agentClients());
      const offices = teammates.map((tm) => {
        const officeId = tm.identity_id || `session:${tm.session_id}`;
        const live = onlineOffices.find((o) => o.sessionId === tm.session_id);
        return {
          session_id: tm.session_id,
          display_name: tm.display_name,
          office_id: officeId,
          identity_id: tm.identity_id,
          assistant_npc: tm.npc_key,
          assistant_name: tm.assistant_name,
          online: !!tm.online || !!live,
          npc_team_name: tm.npc_team_name,
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        my_office: myOffice,
        offices,
        online_offices: onlineOffices,
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/teammates' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const teammates = await denizenVisitor.listTeammatesWithPresence(
        sessionId,
        listOnlineSessionIds(),
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, teammates }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/handoff' && req.method === 'POST') {
    _handleVisitorHandoffPost(req, res).catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      if (err instanceof visitorConnections.ConnectionError) {
        _writeVisitorConnectionError(res, err);
        return;
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/handoffs' && req.method === 'POST') {
    _handleVisitorHandoffPost(req, res).catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      if (err instanceof visitorConnections.ConnectionError) {
        _writeVisitorConnectionError(res, err);
        return;
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/handoffs' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const handoffs = await denizenVisitor.getPendingHandoffs(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, handoffs }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/visitor\/handoffs\/([^/]+)\/delivered$/.test(urlPath) && req.method === 'POST') {
    (async () => {
      const messageId = urlPath.split('/')[4];
      const body = await _readJsonBody(req, 64 * 1024);
      let sid = body.session_id || body.sessionId;
      if (body.is_ceo || body.isCeo) {
        sid = await denizenVisitor.getOrCreateCeoBridgeSession();
      }
      if (!sid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id or is_ceo required' }));
        return;
      }
      if (!(body.is_ceo || body.isCeo)) {
        await _verifyVisitorSession(req, sid, body);
      }
      const handoff = await denizenVisitor.markHandoffDelivered(messageId, sid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, handoff }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/visitor\/handoffs\/([^/]+)$/.test(urlPath) && req.method === 'PATCH') {
    (async () => {
      const messageId = urlPath.split('/')[4];
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const body = await _readJsonBody(req, 64 * 1024);
      const sid = sessionId || body.session_id || body.sessionId;
      if (!sid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sid, body);
      const handoff = await denizenVisitor.markHandoffDelivered(messageId, sid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, handoff }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = denizenVisitor.visitorErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/briefing' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const access = await visitorAccess.resolveSessionAccess(sessionId);
      visitorAccess.assertTeamFeature(access, 'briefing');
      const force = u.searchParams.get('force') === '1';
      const briefing = await visitorIntel.getOrCreateTodayBriefing(sessionId, { force });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, briefing }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/profile' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const profile = await visitorIntel.getProfile(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/profile' && req.method === 'PATCH') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      if (
        body.slack_webhook_url !== undefined
        || body.slackWebhookUrl !== undefined
        || body.slack_user_id !== undefined
        || body.slackUserId !== undefined
      ) {
        await _guardVisitorFeature(req, sessionId, 'profile_slack', body);
      }
      const profile = await visitorIntel.upsertProfile(sessionId, body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/commitments' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const status = u.searchParams.get('status') || 'open';
      const commitments = await visitorIntel.listCommitments(sessionId, { status });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, commitments }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/commitments' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId || !body.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and text required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const commitment = await visitorIntel.addCommitment(sessionId, {
        text: body.text,
        npcKey: body.npc_key || body.npcKey,
        dueAt: body.due_at || body.dueAt,
        source: body.source,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, commitment }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/visitor\/commitments\/([^/]+)\/resolve$/.test(urlPath) && req.method === 'POST') {
    (async () => {
      const commitmentId = urlPath.split('/')[4];
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, body);
      const commitment = await visitorIntel.resolveCommitment(commitmentId, sessionId, body.status || 'done');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, commitment }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/recurring-tasks' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _verifyVisitorSession(req, sessionId, {});
      const tasks = await visitorIntel.listRecurringTasks(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, tasks }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/recurring-tasks' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId || !body.label || !body.prompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id, label, and prompt required' }));
        return;
      }
      await _guardVisitorFeature(req, sessionId, 'recurring_tasks_post', body);
      const task = await visitorIntel.addRecurringTask(sessionId, {
        label: body.label,
        prompt: body.prompt,
        npcKey: body.npc_key || body.npcKey,
        schedule: body.schedule,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, task }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/research' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const query = u.searchParams.get('q') || u.searchParams.get('query');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const external = u.searchParams.get('external');
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'q required' }));
        return;
      }
      if (sessionId) {
        await _verifyVisitorSession(req, sessionId, {});
        if (external == null || /^(1|true|yes)$/i.test(String(external))) {
          await _guardVisitorFeature(req, sessionId, 'research_external', {});
        }
      }
      const cited = await citedResearch.runCitedResearch(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, research: cited, display: citedResearch.formatForDisplay(cited) }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/slack/link' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 64 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      await _guardVisitorFeature(req, sessionId, 'slack_link', body);
      const profile = await slackChannel.linkSlackSession(sessionId, {
        webhookUrl: body.webhook_url || body.webhookUrl,
        slackUserId: body.slack_user_id || body.slackUserId,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, profile }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        _writeVisitorAccessError(res, err);
        return;
      }
      const status = visitorIntel.intelligenceErrorStatus(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/visitor/slack/inbound' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 256 * 1024);
      const result = await slackChannel.relaySlackInbound(body, {
        resolveSessionBySlackUser: async (slackUserId) => {
          if (!denizenDb.enabled || !denizenDb.orgId) return null;
          const rows = await denizenDb._get(
            `denizen_visitor_profiles?select=session_id&slack_user_id=eq.${encodeURIComponent(slackUserId)}&limit=1`,
          );
          return rows?.[0]?.session_id || null;
        },
        onInboundMessage: async ({ sessionId, text }) => {
          const assistant = await denizenVisitor.getAssistant(sessionId).catch(() => null);
          const npcKey = assistant?.npc_key;
          if (!npcKey) return;
          const session = await denizenVisitor.getSession(sessionId);
          const result = await npcBrains.getPlayerResponse(npcKey, text, {
            sessionId,
            displayName: session?.display_name,
            assistant,
          });
          if (result?.text) {
            await slackChannel.sendToSlack(sessionId, result.text);
          }
        },
      });
      if (result.challenge) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(result.challenge);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/tokens' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      const access = await _guardVisitorFeature(req, sessionId, 'mcp_connect', {});
      const session = await visitorAccess.resolveSessionAccess(sessionId).catch(() => null);
      const orgWide = _canManageOrgNpcTeam(session);
      const listed = await denizenDb._rpc('denizen_list_mcp_tokens', {
        p_org_id: access.orgId,
        p_session_id: sessionId,
        p_org_wide: orgWide,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(listed || { ok: false, error: 'list_failed' }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/tokens' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const npcKey = String(body.npc_key || body.npcKey || '').toLowerCase().trim();
      if (!sessionId || !npcKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and npc_key required' }));
        return;
      }
      if (npcKey === '_team') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Use POST /api/mcp/team-tokens for org team MCP' }));
        return;
      }
      const access = await _guardVisitorFeature(req, sessionId, 'mcp_connect', body);
      const accounts = await denizenDb._get(
        `denizen_team_accounts?select=id&visitor_session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
      ).catch(() => []);
      const result = await npcMcpGateway.createMcpToken({
        orgId: access.orgId,
        npcKey,
        memberId: accounts?.[0]?.id || null,
        sessionId,
        label: body.label || null,
        scopes: _mcpScopesFromBody(body),
        clientType: body.client_type || body.clientType || null,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        ...result,
        warning: 'Save this token now — it cannot be retrieved again.',
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/team-tokens' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 32 * 1024);
      const sessionId = body.session_id || body.sessionId;
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id required' }));
        return;
      }
      const access = await _guardVisitorFeature(req, sessionId, 'mcp_connect', body);
      const accounts = await denizenDb._get(
        `denizen_team_accounts?select=id&visitor_session_id=eq.${encodeURIComponent(sessionId)}&limit=1`,
      ).catch(() => []);
      const result = await teamMcpGateway.createTeamMcpToken({
        orgId: access.orgId,
        memberId: accounts?.[0]?.id || null,
        sessionId,
        label: body.label || 'team-operator',
        scopes: _mcpScopesFromBody(body),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        scope_mode: 'team',
        ...result,
        warning: 'Save this token now — it cannot be retrieved again.',
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/tokens/revoke' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 16 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const tokenId = body.token_id || body.tokenId;
      if (!sessionId || !tokenId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and token_id required' }));
        return;
      }
      const access = await _guardVisitorFeature(req, sessionId, 'mcp_connect', body);
      const session = await visitorAccess.resolveSessionAccess(sessionId).catch(() => null);
      const orgWide = _canManageOrgNpcTeam(session);
      const revoked = await denizenDb._rpc('denizen_revoke_mcp_token', {
        p_token_id: tokenId,
        p_org_id: access.orgId,
        p_session_id: sessionId,
        p_org_wide: orgWide,
      });
      res.writeHead(revoked?.ok ? 200 : 403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(revoked || { ok: false, error: 'revoke_failed' }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/test' && req.method === 'POST') {
    (async () => {
      const body = await _readJsonBody(req, 16 * 1024);
      const sessionId = body.session_id || body.sessionId;
      const bearer = String(body.token || '').trim();
      const teamMode = body.team === true || body.team === '1' || body.scope_mode === 'team';
      if (!sessionId || !bearer) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'session_id and token required' }));
        return;
      }
      await _guardVisitorFeature(req, sessionId, 'mcp_connect', body);
      const scope = await npcMcpGateway.resolveToken(bearer);
      if (!scope?.ok) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid or revoked token' }));
        return;
      }
      const tool = teamMode || scope.npc_key === '_team' ? 'team_status' : 'get_status';
      const result = teamMode || scope.npc_key === '_team'
        ? await teamMcpGateway.callTool(scope, tool, {})
        : await npcMcpGateway.callTool(scope, tool, { limit: 5 });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: result?.ok !== false,
        tool,
        scopes: scope.scopes || mcpScopes.ALL_SCOPES,
        result,
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/connect-info' && req.method === 'GET') {
    (async () => {
      const u = new URL(req.url, 'http://localhost');
      const teamMode = u.searchParams.get('team') === '1' || u.searchParams.get('scope') === 'team';
      const npcKey = String(u.searchParams.get('npc_key') || u.searchParams.get('npcKey') || '').toLowerCase().trim();
      const sessionId = u.searchParams.get('session_id') || u.searchParams.get('sessionId');
      const publicBase = process.env.DENIZEN_PUBLIC_URL
        || process.env.DENIZEN_URL
        || `http://localhost:${PORT}`;
      if (teamMode) {
        if (sessionId) await _verifyVisitorSession(req, sessionId, {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...teamMcpGateway.buildConnectInfo(publicBase) }));
        return;
      }
      if (!npcKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'npc_key required (or team=1)' }));
        return;
      }
      if (sessionId) {
        await _verifyVisitorSession(req, sessionId, {});
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        ...npcMcpGateway.buildConnectInfo(npcKey, publicBase),
      }));
    })().catch((err) => {
      if (err instanceof visitorAccess.VisitorAccessError) {
        return _writeVisitorAccessError(res, err);
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (urlPath === '/api/mcp/servers' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, servers: mcpConnector.listServers() }));
    return;
  }

  if (urlPath === '/api/mcp/discover' && req.method === 'GET') {
    (async () => {
      const discovered = await mcpConnector.discoverAll();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, discovered }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  if (/^\/api\/mcp\/servers\/([^/]+)\/tools$/.test(urlPath) && req.method === 'GET') {
    (async () => {
      const serverId = urlPath.split('/')[4];
      const tools = await mcpConnector.listTools(serverId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...tools }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- Task webhook (n8n / Supabase / external workflows post here) ---
  // Body shape: { id, source?, title, status?, assignee?, detail?, foreground? }
  // We upsert into worldState; the change event then fans out to the browser
  // and the next NPC think cycle picks it up via the Current State block.
  if (urlPath === '/api/task-update' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const task = JSON.parse(body || '{}');
        if (!task || typeof task !== 'object' || !task.id || !task.title) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'task requires { id, title }' }));
          return;
        }
        const foreground = !!task.foreground;
        const merged = worldState.upsertTask({
          id: String(task.id),
          source: task.source || 'external',
          title: String(task.title).slice(0, 200),
          status: task.status || 'queued',
          assignee: task.assignee || null,
          detail: task.detail ? String(task.detail).slice(0, 400) : null,
        }, { foreground });
        // Also surface as an office event so NPCs notice immediately.
        worldState.pushEvent('task', `${merged.status}: ${merged.title}${merged.assignee ? ' → ' + merged.assignee : ''}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, task: merged }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- Agent-bus publish (let external systems poke a specific NPC) ---
  // POST body: { to, from?, text, kind? }
  if (urlPath === '/api/agent-bus' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const msg = agentBus.publish(payload.to, {
          from: payload.from || 'external',
          text: String(payload.text || '').slice(0, 600),
          kind: payload.kind || 'speak',
        });
        if (!msg) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'requires { to, text }' }));
          return;
        }
        if (payload.to) {
          npcThinkRunner.wake(payload.to, 'agent_bus_api', { urgent: true });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, msg }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // --- GET /api/code-proposals — list all NPC code proposals ---
  if (urlPath === '/api/code-proposals' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ proposals: codingTaskRunner.getProposals() }));
    return;
  }

  // --- POST /api/code-proposals/:id/approve ---
  const approveMatch = urlPath.match(/^\/api\/code-proposals\/([^/]+)\/approve$/);
  if (approveMatch && req.method === 'POST') {
    const proposalId = approveMatch[1];
    _readJsonBody(req, 16 * 1024).then(async (body) => {
      // Merges an NPC branch into master — review gate (dossier G#4).
      try {
        const access = await _resolveApprovalsAccess(req, body || {});
        if (!access?.operator) { _denyOperatorApi(res); return null; }
      } catch (err) {
        res.writeHead(err?.status || 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || 'unauthorized' }));
        return null;
      }
      const note = body?.note ? String(body.note).slice(0, 400) : null;
      return codingTaskRunner.approveProposal(proposalId, { note });
    }).then(result => {
      if (!result) return;
      if (result.ok) {
        _broadcastProposalQueueChanged('code', 'approved', proposalId);
      }
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- POST /api/code-proposals/:id/reject ---
  const rejectMatch = urlPath.match(/^\/api\/code-proposals\/([^/]+)\/reject$/);
  if (rejectMatch && req.method === 'POST') {
    const proposalId = rejectMatch[1];
    _readJsonBody(req, 16 * 1024).then(async (body) => {
      // Same review gate as approve (dossier G#4).
      try {
        const access = await _resolveApprovalsAccess(req, body || {});
        if (!access?.operator) { _denyOperatorApi(res); return null; }
      } catch (err) {
        res.writeHead(err?.status || 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || 'unauthorized' }));
        return null;
      }
      const note = body?.note ? String(body.note).slice(0, 400) : null;
      return codingTaskRunner.rejectProposal(proposalId, { note });
    }).then(result => {
      if (!result) return;
      if (result.ok) {
        _broadcastProposalQueueChanged('code', 'rejected', proposalId);
      }
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    });
    return;
  }

  // --- GET /api/dossier-proposals — branded PDF dossier proposals ---
  if (urlPath === '/api/dossier-proposals' && req.method === 'GET') {
    (async () => {
      try {
        const access = await _resolveApprovalsAccess(req, {});
        const proposals = dossierSystem.getProposals({
          identityId: access.identityId,
          operator: access.operator,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ proposals, scope: access.operator ? 'system' : 'individual' }));
      } catch (err) {
        if (err instanceof visitorAccess.VisitorAccessError) {
          return _writeVisitorAccessError(res, err);
        }
        const status = err.status || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  const dossierPreviewMatch = urlPath.match(/^\/api\/dossier-proposals\/([^/]+)\/preview$/);
  if (dossierPreviewMatch && req.method === 'GET') {
    (async () => {
      try {
        const access = await _resolveApprovalsAccess(req, {});
        const proposalId = dossierPreviewMatch[1];
        const proposal = dossierSystem.getProposalById(proposalId);
        if (!proposal) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'proposal not found' }));
          return;
        }
        if (!approvalsScope.canDecideDossierProposal(proposal, access)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not your dossier proposal' }));
          return;
        }
        const u = new URL(req.url, 'http://x');
        const format = (u.searchParams.get('format') || 'html').toLowerCase();
        const filePath = dossierSystem.resolveProposalArtifact(proposal, format);
        if (!filePath) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'preview file not found',
            hint: 'Regenerate the dossier on this server or redeploy with reports/dossiers included',
            outDirRel: proposal.outDirRel || null,
          }));
          return;
        }
        const ctype = format === 'pdf' ? 'application/pdf' : 'text/html; charset=utf-8';
        res.writeHead(200, { 'Content-Type': ctype });
        fs.createReadStream(filePath).pipe(res);
      } catch (err) {
        if (err instanceof visitorAccess.VisitorAccessError) {
          return _writeVisitorAccessError(res, err);
        }
        const status = err.status || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  const dossierApproveMatch = urlPath.match(/^\/api\/dossier-proposals\/([^/]+)\/approve$/);
  if (dossierApproveMatch && req.method === 'POST') {
    _readJsonBody(req, 16 * 1024).then(async (body) => {
      try {
        const access = await _resolveApprovalsAccess(req, body || {});
        const proposalId = dossierApproveMatch[1];
        const proposal = dossierSystem.getProposalById(proposalId);
        if (!proposal) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'proposal not found' }));
          return;
        }
        if (!approvalsScope.canDecideDossierProposal(proposal, access)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not your dossier proposal' }));
          return;
        }
        const note = body?.note ? String(body.note).slice(0, 400) : null;
        const result = dossierSystem.approveProposal(proposalId, { note });
        if (result.ok) {
          _broadcastProposalQueueChanged('dossier', 'approved', proposalId);
        }
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        if (err instanceof visitorAccess.VisitorAccessError) {
          return _writeVisitorAccessError(res, err);
        }
        const status = err.status || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    }).catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
    });
    return;
  }

  const dossierRejectMatch = urlPath.match(/^\/api\/dossier-proposals\/([^/]+)\/reject$/);
  if (dossierRejectMatch && req.method === 'POST') {
    _readJsonBody(req, 16 * 1024).then(async (body) => {
      try {
        const access = await _resolveApprovalsAccess(req, body || {});
        const proposalId = dossierRejectMatch[1];
        const proposal = dossierSystem.getProposalById(proposalId);
        if (!proposal) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'proposal not found' }));
          return;
        }
        if (!approvalsScope.canDecideDossierProposal(proposal, access)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Not your dossier proposal' }));
          return;
        }
        const note = body?.note ? String(body.note).slice(0, 400) : null;
        const result = dossierSystem.rejectProposal(proposalId, { note });
        if (result.ok) {
          _broadcastProposalQueueChanged('dossier', 'rejected', proposalId);
        }
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        if (err instanceof visitorAccess.VisitorAccessError) {
          return _writeVisitorAccessError(res, err);
        }
        const status = err.status || 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
    }).catch((err) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
    });
    return;
  }

  // --- Scripted ambient NPC dialogue (no LLM) ---
  if (urlPath === '/api/office-config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(promptTuning.toClientConfig()));
    return;
  }

  if (urlPath === '/api/ambient-dialogue/pair' && req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const initiator = url.searchParams.get('initiator') || '';
    const responder = url.searchParams.get('responder') || '';
    if (!initiator.trim() || !responder.trim()) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'initiator and responder required' }));
      return;
    }
    const pair = ambientDialogue.generateAmbientPair(initiator.trim(), responder.trim(), npcBrains);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(pair));
    return;
  }

  function buildHealthHardwarePayload(req) {
    const hostHardware = fleetRegistry.getGlobalHostSnapshot()
      || hardwareMonitor.getLatestSnapshot();
    if (!hostHardware) return null;
    const isCeo = hostCompute.isCeoPrincipalRequest(req);
    const summary = fleetRegistry.buildFleetSummary(null, null, { isOperator: isCeo });
    let fleet = summary?.fleet || [];
    if (!isCeo) {
      fleet = fleet
        .filter((m) => m.role === 'desktop' || m.role === 'node')
        .map((m) => fleetRegistry.sanitizeMachineForViewer(m))
        .filter(Boolean);
    }
    return {
      available: true,
      machines: Math.max(fleet.length, 1 + fleetRegistry.listAuxiliary().length),
      sampled_at: hostHardware.sampled_at || summary?.sampled_at || null,
      fleet,
      live_usage: isCeo ? (summary?.live_usage || hostHardware) : null,
    };
  }

  // Abby cofounder dispatcher thread — in-memory only (not Postgres).
  if (urlPath === '/api/cofounder/history') {
    if (req.method === 'GET') {
      const hist = cofounderAgent.conversationHistory || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        storage: 'in-memory',
        note: 'Cofounder chat is not in denizen_llm_events or chat tables — restart clears it. Telemetry "N msgs" is per LM request after alternation repair.',
        length: hist.length,
        roles: hist.map((m) => m.role),
        corruptTrailingUser: hist.length > 0 && hist[hist.length - 1].role === 'user',
        preview: hist.slice(-8).map((m) => ({
          role: m.role,
          content: String(m.content || '').slice(0, 160),
        })),
      }));
      return;
    }
    if (req.method === 'DELETE') {
      cofounderAgent.resetConversationHistory?.();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, cleared: true }));
      return;
    }
  }

  // --- A+ P2.2 high-impact approval queue (email/code/trade/deploy gates) ---
  if (urlPath === '/api/impact-approvals' && req.method === 'GET') {
    try {
      if (!denizenImpactGates) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'impact_gates_unavailable' }));
        return;
      }
      const url = new URL(req.url, 'http://x');
      const status = url.searchParams.get('status') || 'pending';
      const approvals = denizenImpactGates.listPending({ status });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, approvals, count: approvals.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
    return;
  }
  const impactResolveMatch = urlPath.match(/^\/api\/impact-approvals\/([^/]+)\/resolve$/);
  if (impactResolveMatch && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 50_000) req.destroy(); });
    req.on('end', () => {
      try {
        if (!denizenImpactGates) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'impact_gates_unavailable' }));
          return;
        }
        const id = decodeURIComponent(impactResolveMatch[1] || '');
        const parsed = body ? JSON.parse(body) : {};
        const result = denizenImpactGates.resolveApproval(id, {
          approved: parsed.approved,
          decision: parsed.decision,
          note: parsed.note,
          resolvedBy: parsed.resolvedBy || parsed.resolved_by || null,
        });
        if (!result.ok) {
          const code = result.error === 'not_found' ? 404 : 400;
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: result.error }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, approval: result.row }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  // --- A+ P2.2 company daily plan (heuristic 5 priorities) ---
  if (urlPath === '/api/daily-plan' && req.method === 'GET') {
    try {
      const plan = denizenDailyPlan.getTodayPlan();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, plan }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
    return;
  }
  if (urlPath === '/api/daily-plan/regenerate' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 50_000) req.destroy(); });
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        const plan = denizenDailyPlan.buildDailyPlan({
          officeSnapshot: parsed.officeSnapshot || parsed.office || null,
          crmBrief: parsed.crmBrief || parsed.crm || null,
          date: parsed.date || null,
        });
        denizenDailyPlan.saveDailyPlan(plan);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, plan, regenerated: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  // --- Dolonia data plane: conversation quality warehouse (Denizen = first product) ---
  if ((urlPath === '/api/dolonia/conversation-quality' || urlPath === '/api/data/conversation-quality')
    && req.method === 'GET') {
    (async () => {
      try {
        const dolonia = require('./src/dolonia-conversation-data');
        const sense = require('./src/denizen-conversation-sense');
        const farm = require('./src/denizen-discord-farm');
        const warehouse = await dolonia.buildWarehouseScorecard({
          productKey: String(new URL(req.url, 'http://local').searchParams.get('product') || 'denizen'),
        });
        const localSense = sense.buildSenseScorecard();
        const localThemes = farm.buildDiscordFarmScorecard();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          company: 'dolonia',
          product: warehouse.productKey || 'denizen',
          warehouse,
          local: {
            sense: localSense,
            themes: {
              messages24h: localThemes.messages24h,
              questions24h: localThemes.questions24h,
              friction24h: localThemes.friction24h,
              topicsHot: (localThemes.topicsHot || []).slice(0, 8),
            },
          },
          notes: [
            'Denizen is Dolonia product #1 — conversation quality dual-writes to Supabase.',
            'user_hash only · redacted bodies · quality_score gates data products.',
          ],
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    })();
    return;
  }
  if (urlPath === '/api/dolonia/conversation-retain' && req.method === 'POST') {
    (async () => {
      try {
        const dolonia = require('./src/dolonia-conversation-data');
        const result = await dolonia.retain({});
        res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    })();
    return;
  }

  // --- Denizen Harness control plane ---
  if ((urlPath === '/api/harness' || urlPath === '/api/harness/status') && req.method === 'GET') {
    (async () => {
      try {
        const body = await denizenHarness.status();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    })();
    return;
  }
  if (urlPath === '/api/harness/skills' && req.method === 'GET') {
    try {
      const skills = denizenHarness.listSkills();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: skills.length, skills }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
    return;
  }
  if (urlPath === '/api/harness/complete' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
    req.on('end', async () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        // Operator/debug only — not a public unauthenticated agent loop.
        const result = await denizenHarness.complete({
          tier: parsed.tier,
          kind: parsed.kind || 'chat',
          npc: parsed.npc || null,
          systemPrompt: parsed.systemPrompt || parsed.system_prompt || '',
          messages: Array.isArray(parsed.messages) ? parsed.messages : [{ role: 'user', content: String(parsed.prompt || parsed.text || 'ping') }],
          max_tokens: parsed.max_tokens || 128,
          model: parsed.model || null,
          enableThinking: parsed.enableThinking === true,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
    return;
  }

  // --- Office health (one-shot diagnostic the client polls every few seconds) ---
  // Reports: WS clients connected, LM Studio reachability, which providers
  // are configured (names only — never keys), recent provider errors, and
  // last successful think+chat timestamps. Designed to answer the question
  // "why isn't the NPC responding when I talk to it?" without the user
  // needing terminal access.
  if (urlPath === '/api/health' && req.method === 'GET') {
    (async () => {
      const cache = global._healthCache = global._healthCache || { at: 0, body: null, inflight: null };
      const now = Date.now();

      const cacheTtlMs = (body) => {
        if (!body?.lmStudio) return 5000;
        if (body.lmStudio.livenessSource?.startsWith('brain call')) return 5000;
        return body.lmStudio.reachable ? 10000 : 20000;
      };

      if (cache.body && (now - cache.at) < cacheTtlMs(cache.body)) {
        const cachedHardware = buildHealthHardwarePayload(req) || cache.body.hardware;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...cache.body,
          hardware: cachedHardware,
          ts: now,
          wsClients: {
            agent: cofounderAgent.wsClients.size,
            security: securityMonitor.clients?.size || 0,
            max: MAX_WS_CLIENTS,
          },
          ws: {
            agent: cofounderAgent.wsClients.size,
            security: securityMonitor.clients?.size || 0,
            max: MAX_WS_CLIENTS,
            utilization: MAX_WS_CLIENTS > 0
              ? Number((cofounderAgent.wsClients.size / MAX_WS_CLIENTS).toFixed(4))
              : 0,
          },
          stats: global._npcStats,
          recentErrors: (global._npcRecentErrors || []).slice(-5),
        }));
        return;
      }

      if (!cache.inflight) {
        cache.inflight = (async () => {
          const builtAt = Date.now();
          const lmStudioStatus = await hostCompute.probeLmStudio(npcBrains).catch(() => ({
            reachable: false,
            url: process.env.LM_STUDIO_URL || lmStudioRouter.defaultHostUrl?.() || 'http://localhost:1234',
            error: 'probe failed',
            model: npcBrains.providers?.lmstudio?.model || null,
            livenessSource: null,
          }));

          const providers = Object.entries(npcBrains.providers || {})
            .filter(([k]) => k !== 'demo')
            .map(([name, cfg]) => ({ name, type: cfg.type, model: cfg.model || null }));

          const hardwarePayload = buildHealthHardwarePayload(req);

          const body = {
            ok: true,
            ts: builtAt,
            server: {
              id: process.env.DENIZEN_SERVER_ID || `host-${process.env.HOSTNAME || 'local'}`,
              role: process.env.DENIZEN_SERVER_ROLE || 'primary',
              port: Number(process.env.PORT) || 8080,
            },
            lmStudio: lmStudioStatus,
            lmStudioPool: lmStudioRouter.isEnabled()
              ? lmStudioRouter.buildStatus(npcBrains.getQueueDepth?.() || 0)
              : null,
            // A+ plan P0.2 — tier truth: if the MAIN pin isn't among the
            // loaded models, fail LOUD here instead of silently answering
            // hard questions with the 2B fast model.
            issues: (() => {
              const issues = [];
              try {
                const pool = lmStudioRouter.isEnabled()
                  ? lmStudioRouter.buildStatus(npcBrains.getQueueDepth?.() || 0)
                  : null;
                const loaded = [];
                for (const n of pool?.nodes || []) {
                  for (const m of n.models || []) loaded.push(String(m).toLowerCase());
                }
                const mainPin = String(process.env.LM_STUDIO_MODEL || '').trim().toLowerCase();
                if (mainPin && loaded.length
                    && !loaded.some((m) => m.includes(mainPin) || mainPin.includes(m))) {
                  issues.push('main_model_unloaded');
                }
                if (!lmStudioStatus?.reachable) issues.push('inference_unreachable');
                // demo_mode = no LLM at all (scripted). local_only = LM Studio only (normal).
                if (npcBrains._demoMode) issues.push('demo_mode');
                const cfStatus = cofounderAgent?.buildDirectorHealth?.();
                if (cfStatus?.offline) issues.push('director_offline');
              } catch (_) {}
              return issues;
            })(),
            // Exact director state for the office banner (WS can race; HTTP is truth).
            director: (() => {
              try {
                return cofounderAgent?.buildDirectorHealth?.() || null;
              } catch (_) {
                return null;
              }
            })(),
            inference: inferenceMetrics.buildMetrics(),
            usageSummary: (() => {
              try {
                const usage = usageTracker.buildStats({ hours: 24 }).stats;
                return {
                  total: usage.total,
                  byModel: usage.byModel,
                  byTier: usage.byTier,
                };
              } catch (err) {
                return { ok: false, error: err?.message || String(err) };
              }
            })(),
            intelligenceLoop: (() => {
              try {
                return require('./src/intelligence-loop-health').buildHealth();
              } catch (err) {
                return { ok: false, error: err?.message || String(err) };
              }
            })(),
            harness: (() => {
              try {
                const stats = global._npcStats || {};
                const providerOk = stats.providerOk || 0;
                const harnessComplete = stats.harnessComplete || 0;
                const streamParity = stats.streamParity || 0;
                // Honest rate: only complete() counts as harness; streams are
                // sampling-parity only (see streamParity).
                return {
                  version: denizenHarness?.version || null,
                  skills: denizenHarness?.listSkills?.()?.length ?? null,
                  npcs: denizenHarness?.listNpcs?.()?.length ?? null,
                  // A+ scorecard: harnessComplete / providerOk ≥ 0.95
                  providerOk,
                  harnessComplete,
                  streamParity,
                  harnessRate: providerOk > 0
                    ? Number((harnessComplete / providerOk).toFixed(4))
                    : null,
                  npcTiers: denizenHarness?.config?.npc_tiers?.map
                    ? Object.keys(denizenHarness.config.npc_tiers.map).length
                    : 0,
                  bound: {
                    jelly: !!jelly,
                    brains: !!npcBrains,
                  },
                };
              } catch (err) {
                return { ok: false, error: err?.message || String(err) };
              }
            })(),
            // MCP / BYO-AI surface (A-grade P3.2) — no secrets
            mcp: (() => {
              try {
                return mcpHealth.summarizeMcpSurface();
              } catch (err) {
                return { ok: false, error: err?.message || String(err), notes: ['mcp_health_failed'] };
              }
            })(),
            publicDemo: {
              enabled: process.env.DENIZEN_PUBLIC_DEMO === 'true',
              trimBrains: process.env.DENIZEN_PUBLIC_DEMO_TRIM_BRAINS === 'true',
              npcFolders: promptTuning?.publicDemoNpcFolders || null,
              haiku_configured: !!(process.env.DENIZEN_PUBLIC_DEMO_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY),
              model: process.env.DENIZEN_PUBLIC_DEMO_MODEL || null,
            },
            lucyBrowser: {
              playwrightInstalled: probePlaywrightBrowsers(),
              headlessDefault: resolveLucyBrowserHeadless({}),
            },
            federation: denizenFederation.buildStatus(),
            worldPubsub: worldPubsub.buildStatus(),
            providers,
            demoMode: !!npcBrains._demoMode,
            // Distinct from demoMode: local LM Studio with no cloud keys (normal lab).
            localOnly: !!npcBrains._localOnlyMode,
            hardware: hardwarePayload,
            wsClients: {
              agent: cofounderAgent.wsClients.size,
              security: securityMonitor.clients?.size || 0,
              max: MAX_WS_CLIENTS,
            },
            ws: {
              agent: cofounderAgent.wsClients.size,
              security: securityMonitor.clients?.size || 0,
              max: MAX_WS_CLIENTS,
              utilization: MAX_WS_CLIENTS > 0
                ? Number((cofounderAgent.wsClients.size / MAX_WS_CLIENTS).toFixed(4))
                : 0,
            },
            stats: global._npcStats,
            recentErrors: (global._npcRecentErrors || []).slice(-5),
            visitor: {
              enabled: true,
              db: denizenDb.enabled,
              features: [
                'session', 'claim', 'handoff', 'projects', 'onboarding', 'prediction_loop',
                'briefing', 'commitments', 'deep_memory', 'proactive_triggers', 'recurring_tasks',
                'slack_channel', 'cited_research', 'voice_walkup', 'mcp_connector',
              ],
            },
            bouncer: {
              patrolEnabled: linuxAgentBridge.isBouncerPatrolEnabled?.() ?? false,
              patrolMode: String(process.env.BOUNCER_PATROL || '').trim() || (process.platform === 'win32' ? 'wsl' : 'off'),
              investigationUrl: String(process.env.BOUNCER_INVESTIGATION_URL || '').trim() || null,
              investigationConfigured: !!String(process.env.BOUNCER_INVESTIGATION_URL || '').trim(),
              investigationTokenConfigured: bouncerInvestigation.investigationAuthConfigured(),
              wslLocal: process.platform === 'win32',
              relayOnly: IS_RELAY_ONLY,
              securityRelay: _securityRelayStatus || null,
              lastPatrol: worldState?.bouncerPatrol || null,
            },
          };
          cache.body = body;
          cache.at = builtAt;
          return body;
        })().finally(() => {
          cache.inflight = null;
        });
      }

      const body = await cache.inflight;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...body,
        ts: Date.now(),
        wsClients: {
          agent: cofounderAgent.wsClients.size,
          security: securityMonitor.clients?.size || 0,
          max: MAX_WS_CLIENTS,
        },
        ws: {
          agent: cofounderAgent.wsClients.size,
          security: securityMonitor.clients?.size || 0,
          max: MAX_WS_CLIENTS,
          utilization: MAX_WS_CLIENTS > 0
            ? Number((cofounderAgent.wsClients.size / MAX_WS_CLIENTS).toFixed(4))
            : 0,
        },
        stats: global._npcStats,
        recentErrors: (global._npcRecentErrors || []).slice(-5),
      }));
    })().catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // --- TTS health (cheap probe — does this server have ElevenLabs configured?) ---
  // The client uses this to decide whether to wire the ElevenLabs voice
  // provider. Returns the key SOURCE but never the value.
  if (urlPath === '/api/tts/health' && req.method === 'GET') {
    const status = elevenLabs.status();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const byGender = { female: 0, male: 0 };
    for (const e of npcRoster.entries || []) {
      if (e.gender === 'female') byGender.female++;
      else if (e.gender === 'male') byGender.male++;
    }
    res.end(JSON.stringify({
      ...status,
      voiceMapEntries: Object.keys(_voiceMap.npcs || {}).length,
      rosterGender: byGender,
      autoAssignByGender: _voiceMap.autoAssignByGender !== false,
    }));
    return;
  }

  if (urlPath === '/api/voice/health' && req.method === 'GET') {
    const tts = elevenLabs.status();
    const stt = _resolveSttConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      voice_call: true,
      streaming_llm: true,
      sentence_tts: true,
      hands_free_vad: true,
      barge_in: true,
      tts: { configured: !!tts.configured, source: tts.source || null },
      stt: { configured: !!stt.configured, model: stt.model || null },
    }));
    return;
  }

  // --- STT health (server-side fallback transcription capability) ---
  // Client uses this when browser SpeechRecognition is missing (Brave/Simple Browser).
  if (urlPath === '/api/stt/health' && req.method === 'GET') {
    const stt = _resolveSttConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      configured: stt.configured,
      provider: 'openai-whisper',
      model: stt.model,
      source: stt.source,
      maxAudioBytes: STT_MAX_AUDIO_BYTES,
    }));
    return;
  }

  // --- STT: transcribe uploaded audio ---
  // POST body: { audioBase64, mimeType?, lang? }
  // Returns: { text }
  if (urlPath === '/api/stt' && req.method === 'POST') {
    (async () => {
      // Provider-cost surface — same session-tier gate as /api/tts (G#4).
      if (!(await _hasAnySessionAccess(req, {}))) { _denyOperatorApi(res); return; }
      const stt = _resolveSttConfig();
      if (!stt.configured) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'STT not configured. Set OPENAI_WHISPER_API_KEY or OPENAI_API_KEY on the server.',
        }));
        return;
      }

      const payload = await _readJsonBody(req, 32 * 1024 * 1024);
      const audioBase64 = String(payload.audioBase64 || '').trim();
      const mimeType = String(payload.mimeType || 'audio/webm').trim();
      const language = String(payload.lang || '').trim();

      if (!audioBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audioBase64 is required' }));
        return;
      }

      let audio;
      try {
        audio = Buffer.from(audioBase64, 'base64');
      } catch (_) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audioBase64 is not valid base64' }));
        return;
      }

      if (!audio.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'audio payload is empty' }));
        return;
      }
      if (audio.length > STT_MAX_AUDIO_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `audio too large (${audio.length} bytes)` }));
        return;
      }

      const ext = mimeType.includes('wav') ? 'wav'
        : mimeType.includes('mp4') ? 'm4a'
          : mimeType.includes('mpeg') ? 'mp3'
            : 'webm';

      const fields = [
        { name: 'model', value: stt.model },
        { name: 'response_format', value: 'json' },
        {
          name: 'file',
          filename: `denizen-stt.${ext}`,
          contentType: mimeType || 'audio/webm',
          value: audio,
        },
      ];
      if (language) {
        fields.push({ name: 'language', value: language });
      }

      const mp = _buildMultipartForm(fields);
      const upstream = await fetch(`${stt.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stt.apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${mp.boundary}`,
        },
        body: mp.body,
        signal: AbortSignal.timeout(45000),
      });

      const raw = await upstream.text();
      if (!upstream.ok) {
        let detail = raw;
        try {
          const j = JSON.parse(raw);
          detail = j?.error?.message || j?.message || raw;
        } catch (_) {}
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `STT upstream error: ${detail}` }));
        return;
      }

      let text = '';
      try {
        const j = JSON.parse(raw);
        text = String(j?.text || '').trim();
      } catch (_) {
        text = String(raw || '').trim();
      }

      if (!text) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ text: '', warning: 'empty transcript' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    });
    return;
  }

  // --- TTS: synthesize speech for an NPC and stream MP3 back ---
  // POST body: { npcName?, text, voiceId?, modelId? }
  // The voice gate (browser) calls this; we proxy to ElevenLabs server-side
  // so the API key never touches the browser. NPC name maps via voice-map.json.
  if (urlPath === '/api/tts' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      // Provider-cost surface: any verified visitor session (or operator
      // principal) may synthesize speech; anonymous internet may not (G#4).
      if (!(await _hasAnySessionAccess(req, payload))) { _denyOperatorApi(res); return; }
      const text = String(payload.text || '').slice(0, 4000);
      if (!text.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'text is required' }));
        return;
      }
      const { voiceId, modelId, gender, source } = _resolveVoiceForNpc(payload.npcName, payload);
      if (payload.npcName && process.env.DEBUG_TTS) {
        console.log(`[TTS] ${payload.npcName} → ${voiceId} (${gender || '?'}, ${source})`);
      }

      try {
        await elevenLabs.synthesize({ text, voiceId, modelId }, res);
        // Streaming complete; nothing else to send.
      } catch (err) {
        // Headers may or may not be sent depending on whether the failure
        // happened before or after upstream returned 200. Guard both paths.
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          try { res.end(); } catch (_) {}
        }
      }
    });
    return;
  }

  // --- LLM-backed city plan ---
  // POST body: { prompt, seed?, gridW?, gridH?, provider? }
  // Reuses NpcBrainManager's provider clients so we don't reimplement
  // five HTTP integrations. The model is asked for a JSON-only response;
  // we parse, validate shape, and fall back to the heuristic on any
  // failure (no LLM, malformed JSON, missing zones field). The planner
  // module itself calls into this endpoint when CITY_PLAN_PROVIDER is set
  // — see src/city/planner.js.
  if (urlPath === '/api/llm-city-plan' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let payload;
      try { payload = JSON.parse(body || '{}'); }
      catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON: ' + err.message }));
        return;
      }
      const prompt = String(payload.prompt || '').slice(0, 1000);
      const seed = String(payload.seed || 'city-plan').slice(0, 80);
      const gridW = Math.max(1, Math.min(20, parseInt(payload.gridW, 10) || 5));
      const gridH = Math.max(1, Math.min(20, parseInt(payload.gridH, 10) || 3));

      // Pick a provider. Order: explicit body.provider → env → first available.
      const providerKey = payload.provider
        || process.env.CITY_PLAN_PROVIDER
        || ['claude', 'grok', 'gemini', 'kimi', 'lmstudio'].find(k => npcBrains.providers[k]);
      const providerConfig = providerKey ? npcBrains.providers[providerKey] : null;

      const heuristic = () => {
        // .cjs extension forces CommonJS even though src/city/ is an ESM
        // folder (package.json type:module). Keep the lazy require here so
        // boot stays fast.
        const { planCityZones } = require('./src/city/planner-heuristic.cjs');
        const plan = planCityZones({ prompt, seed, gridW, gridH });
        return { ...plan, source: 'heuristic' };
      };

      if (!providerConfig || providerConfig.type === 'demo') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heuristic()));
        return;
      }

      const system = [
        'You are a city planner. Given a free-form prompt and a grid size W x H, return ONE JSON object and NOTHING ELSE.',
        'Shape: { "zones": [ { "zone": "downtown"|"residential"|"industrial"|"park", "rect": { "x": int, "y": int, "w": int, "h": int } }, ... ] }.',
        'Constraints: 0 <= x < W, 0 <= y < H, x+w <= W, y+h <= H, no zones may overlap, every cell must be covered.',
        'No prose. No markdown. Just the JSON object.',
      ].join('\n');
      const userMsg = `Prompt: ${prompt || '(none — invent a coherent small city)'}\nW=${gridW} H=${gridH}\nReturn the JSON now.`;

      try {
        const raw = await npcBrains._callProvider(providerConfig, system,
          [{ role: 'user', content: userMsg }],
          { maxTokens: 800, sliceLen: 1200, temperature: 0.5 });
        const match = String(raw || '').match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) : null;
        if (!parsed || !Array.isArray(parsed.zones)) {
          throw new Error('LLM did not return { zones: [] }');
        }
        // Light validation — clamp every rect into bounds; drop bad entries.
        const clean = parsed.zones
          .filter(z => z && z.rect && typeof z.zone === 'string')
          .map(z => ({
            zone: z.zone,
            rect: {
              x: Math.max(0, Math.min(gridW - 1, parseInt(z.rect.x, 10) || 0)),
              y: Math.max(0, Math.min(gridH - 1, parseInt(z.rect.y, 10) || 0)),
              w: Math.max(1, parseInt(z.rect.w, 10) || 1),
              h: Math.max(1, parseInt(z.rect.h, 10) || 1),
            },
          }));
        if (clean.length === 0) throw new Error('All LLM zones invalid');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ seed, gridW, gridH, zones: clean, source: providerKey }));
      } catch (err) {
        console.warn(`[CityPlan] LLM failed (${err.message}) — falling back to heuristic`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(heuristic()));
      }
    });
    return;
  }

  // --- Full city generation (planner → chunk → optional interior) as JSON ---
  // Query: ?seed=…&prompt=…&width=…&height=…&roadStride=…&chunkX=…&chunkY=…
  // Returns the same data the in-game phaserAdapter consumes — useful for
  // a debug overlay (?debug=city) and for headless snapshot tests.
  // Implementation uses dynamic import() because city/* are ES modules.
  if (urlPath === '/api/generate-city' && req.method === 'GET') {
    const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const seed = params.get('seed') || 'office-demo';
    const prompt = params.get('prompt') || '';
    const width = Math.max(8, Math.min(256, parseInt(params.get('width'), 10) || 48));
    const height = Math.max(8, Math.min(256, parseInt(params.get('height'), 10) || 48));
    const roadStride = Math.max(2, Math.min(32, parseInt(params.get('roadStride'), 10) || 8));
    const chunkX = parseInt(params.get('chunkX'), 10) || 0;
    const chunkY = parseInt(params.get('chunkY'), 10) || 0;

    (async () => {
      try {
        // Dynamic ESM import — these modules use `import/export`.
        const cityMod = await import('./src/city/cityGenerator.js');
        const interiorMod = await import('./src/city/interiorGenerator.js');
        const plannerMod = await import('./src/city/planner.js');

        // Plan (LLM if available, heuristic otherwise — planner module
        // honors CITY_PLAN_PROVIDER + the /api/llm-city-plan endpoint when
        // running in the browser; on the server we just call the local
        // heuristic to keep this endpoint sync-cheap for snapshots).
        const plan = plannerMod.planCityZones({ seed, prompt, gridW: 4, gridH: 3 });
        const chunk = cityMod.generateCityChunk({ seed, chunkX, chunkY, width, height, roadStride });
        const interior = chunk.buildings && chunk.buildings[0]
          ? interiorMod.generateOfficeInterior({
              seed: `${seed}:${chunk.buildings[0].id}`,
              buildingId: chunk.buildings[0].id,
              width: 24,
              height: 16,
            })
          : null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ plan, chunk, sampleInterior: interior }));
      } catch (err) {
        console.warn('[GenerateCity] failed:', err?.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    })();
    return;
  }

  // --- Security test endpoint: simulate threats for testing ---
  if (urlPath === '/security-test') {
    if (IS_RELAY_ONLY) {
      const primary = agentWsRelay.resolvePrimaryBaseUrl();
      const relayUrl = `${primary}${req.url}`;
      (async () => {
        try {
          const headers = {};
          const internalHdr = req.headers['x-internal-token'];
          if (internalHdr) headers['x-internal-token'] = internalHdr;
          const upstream = await fetch(relayUrl, {
            signal: AbortSignal.timeout(12000),
            headers,
          });
          const body = await upstream.text();
          res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
          res.end(body);
        } catch (err) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err?.message || 'primary security-test proxy failed' }));
        }
      })();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    (async () => {
      const category = url.searchParams.get('type') || 'network_scan';
      const severity = url.searchParams.get('severity') || 'medium';
      const detail = url.searchParams.get('detail') || `Test ${category} threat`;
      const source = url.searchParams.get('source') || (url.searchParams.get('force') === '1' ? '203.0.113.50' : 'test');
      const force = url.searchParams.get('force') === '1';
      const loopback = securityIp.isLocalOrLoopback(req.socket?.remoteAddress || '');
      const ceoAllowed = await _securityTestHasCeoAccess(req, url);
      const internalToken = String(process.env.DENIZEN_INTERNAL_API_TOKEN || '').trim();
      const suppliedInternal = String(
        req.headers['x-internal-token']
        || url.searchParams.get('internal_token')
        || '',
      ).trim();
      const internalAllowed = internalToken && suppliedInternal === internalToken;
      const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
      const isPublicDemo = String(process.env.DENIZEN_PUBLIC_DEMO || '').toLowerCase() === 'true';
      const allowPublic = /^(1|true|yes|on)$/i.test(String(process.env.DENIZEN_SECURITY_TEST_PUBLIC || ''));
      const forceExternal = force && source !== 'test';

      if (isPublicDemo && !allowPublic && !loopback && !ceoAllowed && !internalAllowed && !forceExternal) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: 'security-test disabled on public demo',
          code: 'SECURITY_TEST_DISABLED',
        }));
        return;
      }

      if (isProd && !loopback && !ceoAllowed && !internalAllowed && !forceExternal) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: 'security-test restricted to loopback or CEO session in production',
          code: 'SECURITY_TEST_FORBIDDEN',
        }));
        return;
      }

      securityMonitor._emitThreat({
        category,
        severity,
        source,
        target: 'test-target',
        detail,
        force,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, message: `Simulated ${category} threat`, source, force }));
    })().catch((err) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    });
    return;
  }

  // Discord Spaces map (phone app) — static under /app/discord-map (NAS + local)
  if (urlPath === '/discord-map' || urlPath.startsWith('/discord-map/')) {
    const DISCORD_MAP_ROOT = path.join(ROOT, 'discord-map');
    const DISCORD_MAP_DEV = path.join(ROOT, '..', 'discord pixel game');
    let rel = urlPath.replace(/^\/discord-map\/?/, '') || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const primaryFile = path.resolve(DISCORD_MAP_ROOT, rel);
    const devFile = path.resolve(DISCORD_MAP_DEV, rel);
    const primaryInside = path.relative(DISCORD_MAP_ROOT, primaryFile);
    const devInside = path.relative(DISCORD_MAP_DEV, devFile);
    const primaryOk = !primaryInside.startsWith('..') && !path.isAbsolute(primaryInside);
    const devOk = !devInside.startsWith('..') && !path.isAbsolute(devInside);
    let filePath = null;
    if (primaryOk && fs.existsSync(primaryFile) && fs.statSync(primaryFile).isFile()) filePath = primaryFile;
    else if (devOk && fs.existsSync(devFile) && fs.statSync(devFile).isFile()) filePath = devFile;
    if (!filePath) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (['.html', '.js'].includes(ext)) {
        headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        headers.Pragma = 'no-cache';
      } else if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
        headers['Cache-Control'] = 'public, max-age=86400';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  // Discord bot public command catalog (Bleed-style)
  if (urlPath === '/discord/commands' || urlPath === '/discord/commands/') {
    res.writeHead(302, { Location: '/discord-commands/' });
    res.end();
    return;
  }
  if (urlPath === '/discord-commands' || urlPath.startsWith('/discord-commands/')) {
    const CMD_ROOT = path.join(ROOT, 'discord-commands');
    let rel = urlPath.replace(/^\/discord-commands\/?/, '') || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = path.resolve(CMD_ROOT, rel);
    const inside = path.relative(CMD_ROOT, filePath);
    if (inside.startsWith('..') || path.isAbsolute(inside) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
      if (['.html', '.js', '.json'].includes(ext)) {
        headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
        headers.Pragma = 'no-cache';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
    return;
  }

  // Deal Weaver CRM — Vite SPA served at /crm/ (phone app embeds this route)


  if (urlPath === '/studio-board.html') {
    res.writeHead(302, { Location: '/studio-board/' });
    res.end();
    return;
  }

  if (urlPath === '/business-studio.html') {
    res.writeHead(302, { Location: '/business-studio/' });
    res.end();
    return;
  }

  // Business Studio — Founder OS at /business-studio/
  // Phone app navigates here like CRM + Studio Board (full page), not an in-phone iframe.
  if (urlPath === '/business-studio' || urlPath.startsWith('/business-studio/')) {
    const BS_ROOT = path.join(ROOT, 'business-studio');
    let rel = urlPath.replace(/^\/business-studio\/?/, '') || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = path.resolve(BS_ROOT, rel);
    const inside = path.relative(BS_ROOT, filePath);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const sendBs = (target) => {
      fs.readFile(target, (err, data) => {
        if (err) {
          if (target !== path.join(BS_ROOT, 'index.html')) {
            sendBs(path.join(BS_ROOT, 'index.html'));
            return;
          }
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Business Studio not found');
          return;
        }
        const ext = path.extname(target).toLowerCase() || '.html';
        const headers = {
          'Content-Type': MIME[ext] || 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        };
        res.writeHead(200, headers);
        res.end(data);
      });
    };
    sendBs(path.extname(rel) ? filePath : path.join(BS_ROOT, 'index.html'));
    return;
  }

  // Studio Board — Agency Tracker (Monday-style board) at /studio-board/
  // Phone app navigates here like CRM (full page), not an in-phone iframe.
  if (urlPath === '/studio-board' || urlPath.startsWith('/studio-board/')) {
    const BOARD_ROOT = path.join(ROOT, 'studio-board');
    let rel = urlPath.replace(/^\/studio-board\/?/, '') || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const filePath = path.resolve(BOARD_ROOT, rel);
    const inside = path.relative(BOARD_ROOT, filePath);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const sendBoard = (target) => {
      fs.readFile(target, (err, data) => {
        if (err) {
          if (target !== path.join(BOARD_ROOT, 'index.html')) {
            sendBoard(path.join(BOARD_ROOT, 'index.html'));
            return;
          }
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Studio Board not found');
          return;
        }
        const ext = path.extname(target).toLowerCase() || '.html';
        const headers = {
          'Content-Type': MIME[ext] || 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
        };
        res.writeHead(200, headers);
        res.end(data);
      });
    };
    sendBoard(path.extname(rel) ? filePath : path.join(BOARD_ROOT, 'index.html'));
    return;
  }

  if (urlPath === '/crm' || urlPath.startsWith('/crm/')) {
    let crmRel = urlPath.replace(/^\/crm\/?/, '') || 'index.html';
    if (crmRel.endsWith('/')) crmRel += 'index.html';
    const crmFile = path.resolve(CRM_DIST, crmRel);
    const crmInside = path.relative(CRM_DIST, crmFile);
    if (crmInside.startsWith('..') || path.isAbsolute(crmInside)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const sendCrmFile = (filePath, fallbackSpa) => {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          if (fallbackSpa) {
            fs.readFile(path.join(CRM_DIST, 'index.html'), (err2, html) => {
              if (err2) {
                res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('CRM not built. Run: npm run build:crm');
                return;
              }
              res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                Pragma: 'no-cache',
              });
              res.end(html);
            });
            return;
          }
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
        const hashedAsset = /\/crm\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css|mjs)$/.test(urlPath);
        if (hashedAsset) {
          headers['Cache-Control'] = 'public, max-age=31536000, immutable';
        } else if (urlPath === '/crm/manifest.json') {
          headers['Cache-Control'] = 'no-cache';
        } else if (['.html', '.js', '.css', '.json', '.map'].includes(ext)) {
          headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
          headers.Pragma = 'no-cache';
        }
        res.writeHead(200, headers);
        res.end(data);
      });
    };
    const spaFallback = !path.extname(crmRel);
    sendCrmFile(crmFile, spaFallback);
    return;
  }

  // Default to the game's index.html — also accept legacy /denizen/ and
  // /pixel-office-game/ prefixes so old bookmarks keep working.
  if (urlPath === '/desktop' || urlPath === '/desktop/') {
    res.writeHead(302, { Location: '/desktop/download.html' });
    res.end();
    return;
  }
  // LLM usage dashboard alias
  if (urlPath === '/llm-usage' || urlPath === '/llm-usage/') {
    urlPath = '/llm-usage.html';
  }
  // Marketing landing page — root and welcome aliases
  if (urlPath === '/' || urlPath === '/home' || urlPath === '/landing' || urlPath === '/welcome'
      || urlPath === '/home/' || urlPath === '/landing/' || urlPath === '/welcome/') {
    urlPath = '/landing.html';
  }
  // Live office game — also accept legacy /denizen/ and /pixel-office-game/ prefixes
  if (urlPath === '/office' || urlPath === '/office/' || urlPath === '/index.html'
      || urlPath === '/denizen/' || urlPath === '/denizen'
      || urlPath === '/pixel-office-game/' || urlPath === '/pixel-office-game') {
    urlPath = '/index.html';
  }
  // Backwards-compat: this project was once served from a parent folder
  // with index.html using `<base href="/pixel-office-game/">`, and later
  // briefly under `/denizen/`. The base tag is gone, but stripping the
  // legacy prefixes keeps old bookmarks and external links working.
  if (urlPath.startsWith('/denizen/')) {
    urlPath = urlPath.replace('/denizen', '');
  } else if (urlPath.startsWith('/pixel-office-game/')) {
    urlPath = urlPath.replace('/pixel-office-game', '');
  }
  const filePath = path.resolve(ROOT, `.${urlPath}`);
  const relativePath = path.relative(ROOT, filePath);

  // Prevent directory traversal above ROOT
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end('Forbidden');
    // This itself is a threat!
    securityMonitor._emitThreat({
      category: 'file_access',
      severity: 'high',
      source: req.socket?.remoteAddress || 'unknown',
      target: urlPath,
      detail: `Directory traversal blocked: ${urlPath.slice(0, 60)}`,
    });
    return;
  }

    fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    if (['.html', '.js', '.css', '.json', '.map'].includes(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers.Pragma = 'no-cache';
    } else if (['.exe', '.dmg', '.AppImage', '.blockmap'].includes(ext)) {
      headers['Cache-Control'] = 'public, max-age=3600';
      headers['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

// --- WebSocket Servers (using 'ws' package) ---

// Security Monitor WebSocket
const securityWss = new WebSocketServer({ noServer: true });
securityWss.on('connection', (ws) => {
  console.log('[SecurityMonitor] WS client connected');
  securityMonitor.addClient(ws);
  ws.on('close', () => {
    console.log('[SecurityMonitor] WS client disconnected');
    securityMonitor.clients?.delete(ws);
  });
  ws.on('error', () => {
    securityMonitor.clients?.delete(ws);
  });
});

// Security threats: primary → Redis → follower /security-ws clients
const _securityRelayStatus = securityRelay.wireSecurityRelay({
  securityMonitor,
  worldPubsub,
  securityWss,
  isRelayOnly: IS_RELAY_ONLY,
});
if (_securityRelayStatus.wired && _securityRelayStatus.pubsubEnabled) {
  console.log(`[security-relay] active role=${_securityRelayStatus.role} relayOnly=${_securityRelayStatus.relayOnly}`);
}

// Agent Office WebSocket
function sendToVisitorClients(sessionId, payload) {
  if (!agentWss || !sessionId) return;
  const raw = JSON.stringify(payload);
  agentWss.clients.forEach((c) => {
    if (c.readyState === 1 && c._denizenSessionId === sessionId) c.send(raw);
  });
}

function sendToCeoClients(payload) {
  if (!agentWss) return;
  const raw = JSON.stringify(payload);
  agentWss.clients.forEach((c) => {
    if (c.readyState === 1 && c._denizenIsCeo) c.send(raw);
  });
}

const agentWss = new WebSocketServer({ noServer: true });
const MAX_WS_CLIENTS = Number(process.env.DENIZEN_MAX_WS_CLIENTS)
  || (process.env.DENIZEN_PUBLIC_DEMO === 'true' ? 30 : 50);

meshWatchdog.startMeshWatchdog({
  computeQueue,
  fleetRegistry,
  broadcast: _broadcastOps,
  log,
  resourcePressure,
  probeLmStudio: healthRunbook.probeLmStudio,
});

agentWss.on('connection', (ws) => {
  if (agentWss.clients.size > MAX_WS_CLIENTS) {
    try { ws.close(1013, 'server at capacity'); } catch (_) {}
    console.warn(`[AgentWS] Rejected connection — at capacity (${MAX_WS_CLIENTS})`);
    return;
  }
  console.log(`[CofounderAgent] WS client connected (${cofounderAgent.wsClients.size + 1} total)`);
  cofounderAgent.addClient(ws);

  // Keepalive — Cloudflare / reverse proxies often kill idle sockets (browser 1006).
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  if (!agentWss._denizenHeartbeat) {
    agentWss._denizenHeartbeat = setInterval(() => {
      for (const client of agentWss.clients) {
        if (client.readyState !== 1) continue;
        if (client.isAlive === false) {
          try { client.terminate(); } catch (_) {}
          continue;
        }
        client.isAlive = false;
        try { client.ping(); } catch (_) {}
      }
    }, 25000);
    agentWss._denizenHeartbeat.unref?.();
  }

  if (agentWsRelay.isFollowerRole()) {
    agentWsRelay.fetchPrimaryWorldSnapshot()
      .then((snapshot) => {
        if (ws.readyState !== 1) return;
        ws.send(JSON.stringify({
          type: 'world_state_snapshot',
          snapshot,
          ts: Date.now(),
        }));
      })
      .catch((err) => {
        console.warn('[AgentWS] follower world snapshot failed:', err?.message || err);
      });
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (IS_RELAY_ONLY && agentWsRelay.isMutatingClientMessage(msg)) {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(agentWsRelay.relayReadonlyError()));
        }
        return;
      }
      if (msg.type === 'npc_conversation') {
        // Resolve the NPC name case-insensitively — cofounder dispatch and
        // LM Studio replies sometimes return lowercased or title-cased names.
        let resolvedName = null;
        if (typeof msg.npcName === 'string' && msg.npcName) {
          if (npcBrains.brains[msg.npcName]) {
            resolvedName = msg.npcName;
          } else {
            const lower = msg.npcName.toLowerCase();
            resolvedName = Object.keys(npcBrains.brains).find(n => n.toLowerCase() === lower) || null;
          }
        }
        if (!resolvedName) {
          // Throttle warning — cofounder dispatch floods this otherwise.
          const now = Date.now();
          if (!global._lastUnknownNpcWarn || now - global._lastUnknownNpcWarn > 30000) {
            console.warn(`[AgentWS] npc_conversation: unknown npcName "${msg.npcName}" (further warnings throttled 30s)`);
            global._lastUnknownNpcWarn = now;
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'npc_response',
              npcName: typeof msg.npcName === 'string' && msg.npcName ? msg.npcName : 'Unknown',
              fromName: typeof msg.fromName === 'string' ? msg.fromName : '',
              text: '(No reply right now.)',
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            }));
          }
          return;
        }
        // Normalize the name going forward so downstream code looks up the right brain.
        msg.npcName = resolvedName;
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          console.warn('[AgentWS] npc_conversation: invalid text payload');
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'npc_response',
              npcName: msg.npcName,
              fromName: msg.fromName,
              text: '(No reply right now.)',
              turn: typeof msg.turn === 'number' ? msg.turn : 1,
            }));
          }
          return;
        }
        // Work-status queries use live task state; social chatter stays scripted replay.
        global._npcStats.npcConvReceived++;
        global._npcStats.lastNpcConvAt = Date.now();
        const workStatusReply = npcPeerWorkStatus.buildWorkStatusReply(
          npcBrains,
          msg.npcName,
          msg.fromName,
          msg.text,
        );
        const response = workStatusReply
          || ambientDialogue.getNpcConversationReply(
            npcBrains,
            msg.npcName,
            msg.fromName,
            msg.text,
          );
        global._npcStats.npcConvSucceeded++;
        if (workStatusReply) {
          global._npcStats.npcConvWorkStatus = (global._npcStats.npcConvWorkStatus || 0) + 1;
        } else {
          global._npcStats.npcConvScripted = (global._npcStats.npcConvScripted || 0) + 1;
        }
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'npc_response',
            npcName: msg.npcName,
            fromName: msg.fromName,
            text: response,
            turn: typeof msg.turn === 'number' ? msg.turn : 1,
            scripted: !workStatusReply,
          }));
        }
      } else if (msg.type === 'npc_think') {
        const thinkCtx = {
          ...(msg.context || {}),
          officeId: ws._denizenOfficeId || msg.context?.officeId || msg.office_id,
          visitorSessionId: ws._denizenSessionId || msg.context?.visitorSessionId,
          identityId: ws._denizenIdentityId || msg.context?.identityId,
          isOperatorOffice: ws._denizenIsOperatorOffice ?? msg.context?.isOperatorOffice,
        };
        npcThinkRunner.runCycle(msg.npcName, thinkCtx)
          .then((decision) => {
            if (!decision) return;
            const reply = JSON.stringify({
              type: 'npc_decision',
              npcName: msg.npcName,
              decision,
              office_id: thinkCtx.officeId || null,
            });
            if (ws.readyState === 1 && officeRegistry.shouldDeliverToSocket(JSON.parse(reply), ws)) {
              ws.send(reply);
            }
          })
          .catch((err) => console.warn('[NpcBrains] Think error:', err.message));
      } else if (msg.type === 'npc_assign_directive') {
        // Any manager can push a mandatory task to a direct report
        if (msg.from && msg.to && msg.task) {
          npcBrains.assignDirective(msg.to, msg.from, msg.task, !!msg.urgent);
          npcThinkRunner.wake(msg.to, 'ws_directive', { urgent: true });
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'directive_assigned',
            from: msg.from,
            to: msg.to,
            task: msg.task,
          }));
        }
      } else if (msg.type === 'visitor_register') {
        ws._deliveredHandoffIds = ws._deliveredHandoffIds || new Set();
        const sid = msg.session_id || null;
        const isCeo = !sid || msg.is_ceo === true;
        const displayName = msg.display_name || msg.displayName || null;
        ws._denizenJoinedAt = ws._denizenJoinedAt || Date.now();
        ws._denizenDemoMode = _mpIsSpectator(msg) || !!msg.demo;
        ws._denizenSpectator = ws._denizenDemoMode || msg.spectator === true;
        ws._denizenInteractive = !ws._denizenSpectator && msg.interactive !== false;
        _applyOfficeToSocket(ws, { sessionId: sid, displayName, isCeo })
          .then((office) => {
            officeRegistry.ensurePresenceKey(ws);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'office_registered',
                office_id: office.officeId,
                identity_id: office.identityId,
                is_operator_office: office.isOperatorOffice,
                session_id: sid,
                presence_key: ws._denizenPresenceKey,
              }));
            }
            _mpSendOfficeSync(ws, office);
            // Seed presence so peers see the joiner before first pose tick.
            if (ws._denizenInteractive !== false && !ws._denizenSpectator) {
              const key = officeRegistry.ensurePresenceKey(ws);
              const seeded = officeRegistry.upsertPlayerPose(office.officeId, {
                sessionId: key,
                visitorId: ws._denizenIdentityId || null,
                displayName: ws._denizenDisplayName || displayName || 'Guest',
                x: 310,
                y: 200,
                facing: 'down',
                anim: 'idle',
                interactive: true,
                spectator: false,
              }, { force: true });
              if (seeded.ok) {
                _broadcastToOffice(office.officeId, {
                  type: 'player_pose',
                  office_id: office.officeId,
                  ...seeded.pose,
                });
              }
            }
            if (sid && !isCeo) {
              const markOnline = () => {
                visitorOfficeContext.wakeVisitorTeam(sid, {
                  denizenVisitor,
                  userIdentity,
                  npcThinkRunner,
                  visitorAccess,
                  listOnlineSessionIds,
                }).catch(() => {});
              };
              if (displayName) {
                _setVisitorOnline(sid, displayName);
                markOnline();
              } else {
                denizenVisitor.getSession(sid)
                  .then((s) => {
                    _setVisitorOnline(sid, s?.display_name || 'Guest');
                    ws._denizenDisplayName = s?.display_name || 'Guest';
                    markOnline();
                  })
                  .catch(() => {
                    _setVisitorOnline(sid, 'Guest');
                    markOnline();
                  });
              }
            }
          })
          .catch((err) => console.warn('[Office] visitor_register:', err?.message || err));
      } else if (msg.type === 'player_pose') {
        const officeId = ws._denizenOfficeId || msg.office_id || msg.officeId;
        if (!officeId) {
          // ignore until registered
        } else {
          const presenceKey = officeRegistry.ensurePresenceKey(ws);
          const result = officeRegistry.upsertPlayerPose(officeId, {
            sessionId: presenceKey,
            visitorId: ws._denizenIdentityId || msg.visitorId || null,
            displayName: ws._denizenDisplayName || msg.displayName || msg.display_name || 'Guest',
            x: msg.x,
            y: msg.y,
            facing: msg.facing,
            anim: msg.anim,
            room: msg.room,
            interactive: ws._denizenInteractive !== false,
            spectator: !!ws._denizenSpectator,
          });
          if (result.ok && result.pose) {
            // Feed Lucy/tour awareness (same as player_idle path).
            if (worldState) {
              worldState.environment = worldState.environment || {};
              worldState.environment.playerPosition = {
                x: result.pose.x,
                y: result.pose.y,
                room: result.pose.room,
              };
            }
            // Don't echo pose back to the sender — that spawns a second "me".
            _broadcastToOffice(officeId, {
              type: 'player_pose',
              office_id: officeId,
              ...result.pose,
            }, { excludeWs: ws, excludePresenceKey: presenceKey });
          }
        }
      } else if (msg.type === 'npc_poses') {
        const officeId = ws._denizenOfficeId || msg.office_id || msg.officeId;
        const presenceKey = officeRegistry.ensurePresenceKey(ws);
        const host = officeId ? officeRegistry.getSimHost(officeId) : null;
        if (officeId && host && host.presenceKey === presenceKey && Array.isArray(msg.npcs)) {
          _broadcastToOffice(officeId, {
            type: 'npc_poses',
            office_id: officeId,
            npcs: msg.npcs.slice(0, 40).map((n) => ({
              key: n.key || n.id || n.npcKey,
              x: Number(n.x) || 0,
              y: Number(n.y) || 0,
              facing: n.facing || 'down',
              anim: n.anim || null,
              taskState: n.taskState || n.status || null,
            })).filter((n) => n.key),
            ts: Date.now(),
            hostSessionId: presenceKey,
          });
        }
      } else if (msg.type === 'player_chat_cancel') {
        const turnId = typeof msg.turn_id === 'string' ? msg.turn_id.trim() : '';
        if (turnId && ws._activePlayerTurnId === turnId) {
          ws._activePlayerTurnId = null;
        }
        const cancelNpc = typeof msg.npcName === 'string' ? msg.npcName.trim() : '';
        if (cancelNpc) npcBrains.clearPlayerChatBusy?.(cancelNpc);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'player_chat_cancelled',
            turn_id: turnId || null,
            npcName: typeof msg.npcName === 'string' ? msg.npcName : null,
            cancelled: true,
          }));
        }
      } else if (msg.type === 'player_chat') {
        // CEO (player) is talking directly to an NPC
        // Office chat → data farm (privacy-aware; never blocks reply path)
        try {
          if (!/^(0|false|no|off)$/i.test(String(process.env.DISCORD_FARM ?? '1'))) {
            const farmText = typeof msg.text === 'string' ? msg.text.trim() : '';
            if (farmText.length >= 2) {
              const farm = require('./src/denizen-discord-farm');
              farm.ingestChatEvent({
                source: 'office',
                ts: Date.now(),
                guildId: null,
                channelId: 'office',
                channelName: 'office-chat',
                guildName: 'Denizen Office',
                userId: String(msg.userId || msg.playerId || ws._sessionId || 'player'),
                displayName: String(msg.displayName || msg.playerName || 'Player').slice(0, 64),
                content: farmText,
                messageId: typeof msg.turn_id === 'string' ? msg.turn_id : null,
                isDm: false,
                bot: false,
                keepCommands: true,
              });
            }
          }
        } catch (_) { /* farm optional */ }
        const resolvedNpc = resolvePlayerChatNpc(msg);
        let npcName = resolvedNpc.npcName;
        if (!npcName) {
          const displayName = resolvedNpc.displayName;
          const rawEarly = typeof msg.text === 'string' ? msg.text.trim() : '';
          console.warn(
            '[AgentWS] player_chat: no brain for',
            displayName,
            `(npcName=${JSON.stringify(msg.npcName)}, npcKey=${JSON.stringify(msg.npcKey)})`,
          );
          if (rawEarly && npcCapabilities.isCapabilitiesQuestion(rawEarly) && displayName !== 'Unknown') {
            const capText = npcCapabilities.formatCapabilitiesReply(displayName, {});
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'player_chat_response',
                npcName: displayName,
                text: capText,
                delegation: null,
                actions: [],
              }));
            }
            return;
          }
          const demoFolders = promptTuning?.publicDemoNpcFolders;
          const unavailableText = demoFolders?.length
            ? `${displayName} isn't available in this demo — active staff: ${demoFolders.map(npcFolderToDisplay).join(', ')}.`
            : `${displayName} isn't loaded on the server right now.`;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: displayName,
              text: unavailableText,
              delegation: null,
              actions: [],
            }));
          }
          return;
        }
        if (typeof msg.text !== 'string' || !msg.text.trim()) {
          if (Array.isArray(msg.attachments) && msg.attachments.length) {
            // Attachment-only drop (photo/file with no text) is a valid message.
            msg.text = 'I just shared some files with you — take a look.';
          } else {
            console.warn('[AgentWS] player_chat: invalid text payload');
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'player_chat_response',
                npcName: npcName,
                text: 'I did not catch that. Try again?',
                delegation: null,
                actions: [],
              }));
            }
            return;
          }
        }
        (async () => {
        const turnId = typeof msg.turn_id === 'string' && msg.turn_id.trim()
          ? msg.turn_id.trim()
          : `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        ws._activePlayerTurnId = turnId;
        const isTurnActive = () => ws._activePlayerTurnId === turnId;
        const sendTurnMessage = (payload) => {
          if (ws.readyState !== 1) return false;
          if (payload?.type === 'voice_chat_token'
            || payload?.type === 'voice_chat_sentence'
            || payload?.type === 'voice_chat_done'
            || payload?.type === 'voice_chat_filler'
            || payload?.type === 'player_chat_response'
            || payload?.type === 'player_chat_ack') {
            if (!isTurnActive()) return false;
            ws.send(JSON.stringify({ ...payload, turn_id: turnId }));
            return true;
          }
          ws.send(JSON.stringify(payload));
          return true;
        };
        const rawPlayerText = msg.text.trim();
        const originalNpc = npcName;
        npcName = resolveStaffIntentNpc(rawPlayerText, npcName);
        if (npcName !== originalNpc) {
          console.log(`[PlayerChat] Staff intent → routing ${originalNpc} request to Lucy`);
        }
        if (!msg.session_id) {
          console.log(`[PlayerChat] CEO → ${npcName}: "${msg.text}"`);
        }
        global._npcStats.playerChatReceived++;
        global._npcStats.lastPlayerChatAt = Date.now();
        const playerText = fixVoiceMishearings(rawPlayerText);
        const normPlayerText = normalizePlayerUtterance(playerText);
        let ceoLucySearchStarted = false;
        const _broadcast = (m) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        const visitorToolGate = await _resolveVisitorToolGate(msg.session_id);
        const chatCtx = msg.session_id
          ? await (async () => {
              const session = await denizenVisitor.getSession(msg.session_id);
              if (!session) return { identityId: null, sessionId: msg.session_id };
              return {
                identityId: await _resolveChatIdentityId(session, msg.session_id),
                sessionId: msg.session_id,
              };
            })().catch(() => ({ identityId: null, sessionId: msg.session_id }))
          : { identityId: null, sessionId: null };
        const persistUserTurn = () => {
          if (!chatCtx.identityId) return;
          _persistChatTurn({
            identityId: chatCtx.identityId,
            sessionId: chatCtx.sessionId,
            npcName,
            role: 'user',
            content: playerText,
          });
        };
        const persistNpcTurn = (text) => {
          if (!chatCtx.identityId || !text) return;
          _persistChatTurn({
            identityId: chatCtx.identityId,
            sessionId: chatCtx.sessionId,
            npcName,
            role: 'npc',
            content: text,
          });
        };
        persistUserTurn();
        const blockDemoTools = () => {
          if (visitorToolGate.canUseRealWork) return false;
          _denyVisitorRealTools(ws, npcName);
          return true;
        };

        const crmWritePlan = crmNpcPersonas.inferCrmWriteAction?.(playerText) || null;
        const blockBrowserForCrm = Boolean(crmWritePlan);

        if (officeStatusBrief.isOfficeStatusQuery(playerText)) {
          const chatSession = msg.session_id
            ? await denizenVisitor.getSession(msg.session_id).catch(() => null)
            : null;
          const orgId = chatSession?.org_id || worldState.getDefaultOrgId?.() || null;
          const wsOrg = orgId ? worldState.forOrg(orgId) : worldState;
          const brief = officeStatusBrief.buildBrief(wsOrg);
          persistNpcTurn(brief);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName,
              text: brief,
              delegation: null,
              actions: [],
            }));
          }
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Lucy — reopen browser and retry last search.
        const browserRetry = extractBrowserRetryIntent(rawPlayerText)
          || extractBrowserRetryIntent(playerText)
          || extractBrowserRetryIntent(normPlayerText);
        if (!blockBrowserForCrm && npcName === 'Lucy' && browserRetry?.retrySearch && global._lucyLastSearchQuery) {
          if (blockDemoTools()) return;
          const retryQuery = global._lucyLastSearchQuery;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: browserRetry.openBrowser
              ? `Opening my browser and searching "${retryQuery}" again…`
              : `Trying "${retryQuery}" again…`,
            delegation: null, actions: [],
          }));
          if (browserRetry.openBrowser) closeLucyBrowser();
          runLucyWebSearch(retryQuery, { broadcast: _broadcast, quiet: true })
            .catch(err => console.error('[lucy-search-retry] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Lucy — open Playwright browser (instant; no LM Studio, no desktop control).
        if (!blockBrowserForCrm && npcName === 'Lucy' && (wantsLucyBrowserOpen(rawPlayerText)
          || wantsLucyBrowserOpen(playerText) || wantsLucyBrowserOpen(normPlayerText))) {
          if (blockDemoTools()) return;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: `Opening my browser now — you'll see it on screen.`,
            delegation: null, actions: [],
          }));
          runLucyWebSearch('', { broadcast: _broadcast, openOnly: true, quiet: true })
            .catch(err => console.error('[lucy-open-browser] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Instant greeting — no LM Studio queue (play Lucy / yo Lucy / hi)
        if (npcBrains._isGreetingOnly?.(playerText, npcName)) {
          const greetText = npcBrains._greetingReply(npcName, npcBrains._hierarchy[npcName]);
          persistNpcTurn(greetText);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName,
              text: greetText,
              delegation: null,
              actions: [],
            }));
          }
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Instant capabilities — no LM Studio queue
        if (npcCapabilities.isCapabilitiesQuestion(playerText)) {
          const brain = npcBrains.brains[npcName];
          const capText = npcCapabilities.formatCapabilitiesReply(npcName, {
            soulSection: brain?.capabilitiesSoul,
          });
          persistNpcTurn(capText);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName,
              text: capText,
              delegation: null,
              actions: [],
            }));
          }
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Roki — live market brief (no LM; avoids reasoning-model leaks)
        if (npcName === 'Roki' && npcCapabilities.isMarketQuestion?.(playerText)) {
          try {
            const marketData = await npcBrains._fetchMarketObservation();
            const marketText = npcBrains._formatRokiMarketBrief(marketData);
            persistNpcTurn(marketText);
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'player_chat_response',
                npcName,
                text: marketText,
                delegation: null,
                actions: [],
              }));
            }
            global._npcStats.playerChatSucceeded++;
            return;
          } catch (err) {
            console.warn('[AgentWS] Roki market brief failed:', err?.message || err);
          }
        }

        if (npcName === 'Bouncer') {
          if (/honeypot|honey\s*pot|honey\s*trap/i.test(playerText)) {
            _broadcast({ type: 'bouncer_player_order', order: /deploy|set up|activate|working/i.test(playerText) ? 'deploy_honeypot' : 'honeypot_status' });
          } else if (/catch|stop them|get them|grab them|rate\s*limit|intruder|robber/i.test(playerText)) {
            _broadcast({ type: 'bouncer_player_order', order: 'confront' });
          }
        }

        // Lucy — which browser am I using?
        if (npcName === 'Lucy' && extractBrowserStatusIntent(playerText)) {
          const last = global._lucyLastBrowser || {};
          const reply = last.label
            ? `I'm on ${last.label}${last.url ? ` — last opened ${last.url}` : ''}.`
            : `No browser open yet — say "search jobs on indeed" or "I'm on linkedin.com" and I'll pick Playwright Chromium, Chrome, or Edge depending on the site.`;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response', npcName: 'Lucy', text: reply, delegation: null, actions: [],
          }));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Lucy — how to use LinkedIn/Indeed job search tools
        const jobBoardHelp = npcName === 'Lucy' ? extractJobBoardHelpIntent(playerText) : null;
        if (jobBoardHelp) {
          const siteLabel = jobBoardHelp === 'linkedin' ? 'LinkedIn Jobs' : 'Indeed';
          const url = jobBoardHelp === 'linkedin'
            ? 'https://www.linkedin.com/jobs/search/'
            : 'https://www.indeed.com/jobs';
          const reply = `Yes — ${siteLabel} has a built-in search. I open it in Playwright + Chrome, run keyword searches, and can queue roles for you. Say "search software engineer jobs on ${jobBoardHelp}" and I'll go there directly.`;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response', npcName: 'Lucy', text: reply, delegation: null, actions: [],
          }));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Lucy — open Indeed/LinkedIn job search directly (skip DuckDuckGo).
        const jobBoard = extractJobBoardSearchIntent(playerText);
        if (npcName === 'Lucy' && jobBoard) {
          if (blockDemoTools()) return;
          const label = jobBoard.site === 'linkedin' ? 'LinkedIn Jobs' : 'Indeed';
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: `Opening ${label}${jobBoard.query ? ` for "${jobBoard.query}"` : ''} in the browser…`,
            delegation: null, actions: [],
          }));
          runLucyWebSearch(jobBoard.query || `jobs on ${jobBoard.site}`, {
            broadcast: _broadcast,
            directUrl: jobBoard.url,
            jobBoard: jobBoard.site,
            browserMode: 'chrome',
          }).catch(err => console.error('[lucy-jobboard] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Lucy web search — visible browser via web-search skill (not OpenClaw gateway).
        const hasChatAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
        let searchQuery = hasChatAttachments ? null
          : (extractSearchQuery(playerText) || extractSearchQuery(normPlayerText)
          || extractSearchQuery(rawPlayerText));
        if (!searchQuery && npcName === 'Lucy') {
          const bare = extractBareSearchTopic(rawPlayerText);
          if (bare) searchQuery = bare;
        }
        if (searchQuery && isJunkSearchQuery(searchQuery)) searchQuery = null;
        if (blockBrowserForCrm) searchQuery = null;
        if (npcName === 'Lucy' && isCancelUtterance(playerText)) {
          closeLucyBrowser();
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: 'Lucy',
              text: 'Okay — stopping. Browser closed.',
              delegation: null,
              actions: [],
            }));
          }
          global._npcStats.playerChatSucceeded++;
          return;
        }
        const wsBrowserRetry = extractBrowserRetryIntent(rawPlayerText)
          || extractBrowserRetryIntent(playerText)
          || extractBrowserRetryIntent(normPlayerText);
        const wsWantsSearchAgain = /\b(?:search|do it|try|run it)(?:\s+it)?\s+again\b/i.test(playerText)
          || /\b(?:search|do it|try|run it)(?:\s+it)?\s+again\b/i.test(normPlayerText);
        if (npcName === 'Lucy' && global._lucyLastSearchQuery
          && (wsBrowserRetry?.retrySearch
            || (wsWantsSearchAgain && (wantsLucyBrowserOpen(playerText) || extractOpenBrowserIntent(playerText))))) {
          if (blockDemoTools()) return;
          const retryQ = global._lucyLastSearchQuery;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: 'Lucy',
              text: `Opening my browser and searching "${retryQ}" again…`,
              delegation: null,
              actions: [],
            }));
          }
          closeLucyBrowser();
          runLucyWebSearch(retryQ, { broadcast: _broadcast, quiet: true })
            .catch(err => console.error('[lucy-search-retry] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }
        if (npcName === 'Lucy' && (extractBrowserReadIntent(playerText) || extractBrowserReadIntent(normPlayerText))) {
          if (blockDemoTools()) return;
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: 'Lucy',
              text: 'Reading what\'s in the browser…',
              delegation: null,
              actions: [],
            }));
          }
          triggerNpcScreenObserve('Lucy', `The CEO said: "${playerText}". Read Lucy's browser window and summarize the document in plain English.`, _broadcast, { sessionId: msg.session_id || null })
            .then((r) => {
              if (r?.summary) {
                _ceoBroadcast({ type: 'npc_report_to_ceo', npcName: 'Lucy', text: r.summary.slice(0, 2000), ts: Date.now() });
              }
            })
            .catch((err) => console.error('[lucy-browser-read] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }
        if (npcName === 'Lucy' && !searchQuery && /\b(?:search|google|look\s+up)\b/i.test(normPlayerText || playerText)) {
          if (global._lucyLastSearchQuery && wsBrowserRetry?.retrySearch) {
            const retryQ = global._lucyLastSearchQuery;
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'player_chat_response',
                npcName: 'Lucy',
                text: `Opening my browser and searching "${retryQ}" again…`,
                delegation: null,
                actions: [],
              }));
            }
            closeLucyBrowser();
            runLucyWebSearch(retryQ, { broadcast: _broadcast, quiet: true })
              .catch(err => console.error('[lucy-search-retry] error:', err?.message));
            global._npcStats.playerChatSucceeded++;
            return;
          }
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_chat_response',
              npcName: 'Lucy',
              text: 'What should I search for? Try: search Goldendoodles or search remote AI jobs.',
              delegation: null,
              actions: [],
            }));
          }
          global._npcStats.playerChatSucceeded++;
          return;
        }
        if (npcName === 'Lucy' && searchQuery && !blockBrowserForCrm) {
          if (blockDemoTools()) return;
          ceoLucySearchStarted = true;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: `On it — I'll look up "${searchQuery}" and give you a quick brief.`,
            delegation: null, actions: [],
          }));
          runLucyWebSearch(searchQuery, { broadcast: _broadcast, quiet: true })
            .catch(err => console.error('[lucy-search] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Lucy — close visible browser on command.
        if (npcName === 'Lucy' && extractCloseBrowserIntent(playerText)) {
          const wasOpen = global._lucyBrowserOpen;
          closeLucyBrowser();
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: wasOpen ? 'Closing my browser now.' : 'No browser was open — but I sent the close signal just in case.',
            delegation: null, actions: [],
          }));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Open CEO's real Brave browser (their profile + cookies).
        if (!blockBrowserForCrm && extractOpenBraveIntent(playerText)) {
          if (blockDemoTools()) return;
          const urlMatch = playerText.match(/https?:\/\/\S+/i);
          const url = urlMatch ? urlMatch[0] : null;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName,
            text: url ? `Opening Brave to ${url}…` : `Opening your Brave browser…`,
            delegation: null, actions: [],
          }));
          desktopAgent.openBraveBrowser(url)
            .then((r) => {
              if (!r.ok && ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'player_chat_response',
                  npcName,
                  text: r.error || 'Could not open Brave.',
                  delegation: null, actions: [],
                }));
              }
            })
            .catch((err) => console.error('[open-brave] error:', err?.message));
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Screen control — any NPC: click/type/fill on CEO's real screen (when asked).
        if (!hasChatAttachments && !blockBrowserForCrm && extractScreenControlIntent(playerText) && !searchQuery) {
          if (blockDemoTools()) return;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName,
            text: `On it — I'll use your screen to help. Watch your mouse move.`,
            delegation: null, actions: [],
          }));
          triggerNpcScreenControl(npcName, playerText, _broadcast, {
            sessionId: msg.session_id || null,
          })
            .then((result) => {
              if (result?.summary && ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'player_chat_response',
                  npcName,
                  text: result.summary.slice(0, 2000),
                  delegation: null, actions: [],
                }));
              }
            })
            .catch((err) => {
              if (ws.readyState === 1) ws.send(JSON.stringify({
                type: 'player_chat_response',
                npcName,
                text: `I couldn't control your screen: ${err?.message || err}`,
                delegation: null, actions: [],
              }));
            });
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Screen observe — any NPC: screenshot, describe, web research fallback.
        if (!hasChatAttachments && extractScreenObserveIntent(playerText) && !searchQuery) {
          if (blockDemoTools()) return;
          const observeInstruction = `The CEO said: "${playerText}". Describe their screen read-only — browser, URLs, typed text, forms. Search the web for anything unclear.`;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName,
            text: `Let me look at your screen…`,
            delegation: null, actions: [],
          }));
          const act = pcActivity.record({
            npc: npcName, kind: 'screen-observe',
            task: observeInstruction.slice(0, 240),
            mode: 'visible', status: 'started',
          });
          const t0 = Date.now();
          triggerNpcScreenObserve(npcName, observeInstruction, _broadcast, {
            sessionId: msg.session_id || null,
          })
            .then((result) => {
              if (result.summary && ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'player_chat_response',
                  npcName,
                  text: result.summary.slice(0, 2000),
                  delegation: null, actions: [],
                }));
              }
              pcActivity.record({
                id: act.id, npc: npcName, kind: 'screen-observe',
                task: act.task, mode: 'visible',
                status: result.ok ? 'done' : 'failed',
                durationMs: Date.now() - t0,
                detail: String(result.summary || '').slice(0, 240),
              });
            })
            .catch((err) => {
              pcActivity.record({
                id: act.id, npc: npcName, kind: 'screen-observe',
                task: act.task, mode: 'visible', status: 'failed',
                durationMs: Date.now() - t0,
                detail: String(err?.message || err).slice(0, 240),
              });
              if (ws.readyState === 1) ws.send(JSON.stringify({
                type: 'player_chat_response',
                npcName,
                text: `I couldn't read your screen: ${err?.message || err}`,
                delegation: null, actions: [],
              }));
            });
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // If talking to Lucy and the message looks like a PC control request,
        // trigger the desktop agent directly instead of just chatting.
        // Word boundaries — avoid "dog types" falsely matching "type".
        const nativeDenizenIntent = isDenizenNativeIntent(rawPlayerText)
          || isDenizenNativeIntent(playerText)
          || isDenizenNativeIntent(normPlayerText);
        const desktopTriggers = /\b(click|type|navigate|screenshot|copy|paste|close|minimize|maximize|volume|spotify|notepad|calculator|file|folder)\b|go to|take a screenshot/i;
        const desktopOpenTrigger = /\b(open|launch)\b/i.test(playerText)
          && !wantsLucyBrowserOpen(rawPlayerText)
          && !wantsLucyBrowserOpen(playerText)
          && !wantsLucyBrowserOpen(normPlayerText)
          && !extractOpenBrowserIntent(playerText)
          && !extractOpenBrowserIntent(normPlayerText);
        const desktopBrowserOnly = wantsLucyBrowserOpen(rawPlayerText)
          || wantsLucyBrowserOpen(playerText)
          || wantsLucyBrowserOpen(normPlayerText)
          || extractOpenBrowserIntent(playerText)
          || extractOpenBrowserIntent(normPlayerText)
          || extractCloseBrowserIntent(playerText)
          || extractCloseBrowserIntent(normPlayerText)
          || nativeDenizenIntent;
        if (npcName === 'Lucy' && !normPlayerText.match(/^(?:search|google|look\s+up)\b/i)
          && (desktopTriggers.test(playerText) || desktopOpenTrigger) && !searchQuery && !desktopBrowserOnly) {
          if (blockDemoTools()) return;
          if (ws.readyState === 1) ws.send(JSON.stringify({
            type: 'player_chat_response',
            npcName: 'Lucy',
            text: `On it — taking control of your PC now.`,
            delegation: null, actions: [],
          }));
          // PC activity: chat-triggered desktop-agent invocation. Mode
          // is 'visible' — the user is literally about to watch Lucy
          // pilot the desktop.
          const dtChatActivity = pcActivity.record({
            npc: 'Lucy', kind: 'desktop-agent',
            task: String(msg.text).slice(0, 240),
            mode: 'visible', status: 'started',
          });
          const dtChatStart = Date.now();
          triggerNpcScreenControl('Lucy', msg.text, _broadcast, {
            sessionId: msg.session_id || null,
          })
            .then((result) => {
              pcActivity.record({
                id: dtChatActivity.id, npc: 'Lucy', kind: 'desktop-agent',
                task: dtChatActivity.task, mode: 'visible',
                status: result?.ok ? 'done' : 'failed',
                durationMs: Date.now() - dtChatStart,
                detail: result && typeof result === 'object'
                  ? String(result.summary || result.note || '').slice(0, 240) || null
                  : null,
              });
            })
            .catch(err => {
              pcActivity.record({
                id: dtChatActivity.id, npc: 'Lucy', kind: 'desktop-agent',
                task: dtChatActivity.task, mode: 'visible', status: 'failed',
                durationMs: Date.now() - dtChatStart,
                detail: String(err?.message || err).slice(0, 240),
              });
              console.error('[desktop-task] error:', err?.message);
            });
          global._npcStats.playerChatSucceeded++;
          return;
        }

        // Incident reports from the Bouncer use a stripped-down system prompt
        // so the NPC speaks in their own voice about what just happened,
        // rather than routing through the player-response delegation framework.
        const isIncidentReport = msg.isIncidentReport === true;
        const visitorLoadPromise = msg.session_id
          ? (async () => {
              const session = await denizenVisitor.getSession(msg.session_id);
              if (!session) return null;
              const [assistant, projects, pendingHandoffs, deepProfile, openCommitments] = await Promise.all([
                denizenVisitor.getAssistant(msg.session_id),
                denizenVisitor.listProjects(msg.session_id).catch(() => []),
                denizenVisitor.getPendingHandoffs(msg.session_id).catch(() => []),
                visitorIntel.getProfile(msg.session_id).catch(() => ({})),
                visitorIntel.listCommitments(msg.session_id, { status: 'open' }).catch(() => []),
              ]);
              const identity = session.identity_id
                ? await userIdentity.getIdentityById(session.identity_id).catch(() => null)
                : await userIdentity.getIdentityBySession(session.id).catch(() => null);
              const identityId = await _resolveChatIdentityId(session, msg.session_id);
              return {
                sessionId: session.id,
                identityId,
                orgId: session.org_id || null,
                displayName: identity?.display_name || session.display_name || 'Guest',
                workPosition: userPosition.getPositionFromIdentity(identity),
                assistant,
                projects,
                pendingHandoffs,
                deepProfile,
                openCommitments,
              };
            })().catch((err) => {
              console.warn('[PlayerChat] visitor session load failed:', err?.message || err);
              return null;
            })
          : Promise.resolve(null);

        const ceoHandoffsPromise = (!msg.session_id && npcName === 'Lucy')
          ? denizenVisitor.getOrCreateCeoBridgeSession()
            .then((bridgeId) => (bridgeId ? denizenVisitor.getPendingHandoffs(bridgeId) : []))
            .catch((err) => {
              console.warn('[PlayerChat] CEO handoff load failed:', err?.message || err);
              return [];
            })
          : Promise.resolve([]);

        let _visitorCitedResearch = null;
        let _visitorCtxForSkills = null;
        let _taskAdviceForChat = null;
        const responsePromise = Promise.all([visitorLoadPromise, ceoHandoffsPromise]).then(async ([visitorCtx, ceoHandoffs]) => {
          _visitorCtxForSkills = visitorCtx;
          if (visitorCtx) {
            console.log(`[PlayerChat] ${visitorCtx.displayName} → ${npcName}: "${msg.text}"`);
          }
          const playerOpts = visitorCtx
            ? {
              sessionId: visitorCtx.sessionId,
              identityId: visitorCtx.identityId,
              orgId: visitorCtx.orgId || null,
              displayName: visitorCtx.displayName,
              workPosition: visitorCtx.workPosition || null,
              assistant: visitorCtx.assistant,
              projects: visitorCtx.projects,
              pendingHandoffs: visitorCtx.pendingHandoffs,
              deepProfile: visitorCtx.deepProfile,
              openCommitments: visitorCtx.openCommitments,
              sessionTier: visitorToolGate.sessionTier,
              canUseRealWork: visitorToolGate.canUseRealWork,
              sessionMetadata: visitorToolGate.sessionMetadata,
              orgSettings: visitorToolGate.orgSettings,
            }
            : (ceoHandoffs.length ? { pendingHandoffs: ceoHandoffs } : undefined);

          if (playerOpts?.sessionId && visitorToolGate.canUseRealWork
            && playerChatSkills.isTaskLikeMessage(msg.text)) {
            const providerKeys = await denizenVisitor.getSessionProviderKeys(playerOpts.sessionId).catch(() => ({}));
            const meshContext = await _buildMeshContextForAdvice();
            meshContext.taskText = msg.text;
            meshContext.hasVisitorAnthropicKey = !!providerKeys.anthropic;
            meshContext.hasVisitorOpenaiKey = !!providerKeys.openai;
            _taskAdviceForChat = taskResourceAdvisor.advise(meshContext);
            playerOpts.providerKeys = providerKeys;
            playerOpts.meshContext = meshContext;
            playerOpts.taskAdvice = _taskAdviceForChat;
            playerOpts.resource_pressure_block = meshContext.resource_pressure_block;
            await _maybeBroadcastResourcePressure(meshContext).catch(() => {});
          }

          if (visitorCtx?.sessionId && visitorToolGate.canUseRealWork
            && citedResearch.looksLikeResearchQuery(msg.text)) {
            const query = citedResearch.extractResearchQuery(msg.text);
            const cited = await citedResearch.runCitedResearch(query).catch(() => null);
            if (cited?.citations?.length) {
              playerOpts.researchContext = citedResearch.formatForPrompt(cited);
              _visitorCitedResearch = cited;
            }
          }

          if (isIncidentReport) {
            return npcBrains.getResponse(npcName, 'CEO', msg.text, { kind: 'incident-report', description: 'You are reporting a security incident to the CEO. Speak in your own voice — stoic, professional, dry. 2-3 sentences max.' })
              .then(text => ({ text: typeof text === 'string' ? text : String(text || ''), delegation: null, actions: [] }));
          }
          const chatOpts = playerOpts && typeof playerOpts === 'object' ? { ...playerOpts } : {};
          if (msg.voice_mode) {
            const sentenceStream = createSentenceStream((text, index) => {
              if (!isTurnActive()) return;
              voiceBridge.sendWs(ws, { type: 'voice_chat_sentence', npcName, text, index, turn_id: turnId });
            });
            chatOpts.stream = {
              onToken: (token) => {
                if (!isTurnActive()) return;
                voiceBridge.sendWs(ws, { type: 'voice_chat_token', npcName, token, turn_id: turnId });
                sentenceStream.push(token);
              },
            };
            chatOpts._voiceSentenceFlush = () => sentenceStream.flush();
          }
          // Files/photos dropped in chat → analyze (vision for images, inline for
          // text) and append to what the brain sees. Runs after the ack so the
          // client shows typing while vision works.
          if (Array.isArray(msg.attachments) && msg.attachments.length && !msg._attachmentBlock) {
            const processed = await chatAttachments.processChatAttachments(msg.attachments)
              .catch((err) => ({ ok: false, contextBlock: '', saved: [], error: err?.message || String(err) }));
            if (processed.ok) {
              msg._attachmentBlock = processed.contextBlock;
              msg._attachmentInfo = processed.saved;
              console.log(`[PlayerChat] ${npcName} received ${processed.saved.length} attachment(s): ${processed.saved.map((a) => a.name).join(', ')}`);
            } else {
              msg._attachmentBlock = `

[Note: the sender tried to attach file(s) but they could not be processed (${processed.error}). Tell them what went wrong.]`;
              console.warn('[PlayerChat] attachment processing failed:', processed.error);
            }
          }
          const textForBrain = msg._attachmentBlock ? `${msg.text}${msg._attachmentBlock}` : msg.text;
          if (msg._attachmentBlock) {
            // Chat history shows the typed text + a file note, not the raw analysis block.
            const names = (msg._attachmentInfo || []).map((a) => a.name).join(', ');
            chatOpts.displayText = names ? `${msg.text} [📎 ${names}]` : msg.text;
          }
          return npcBrains.getPlayerResponse(npcName, textForBrain, chatOpts).then((result) => {
            if (msg.voice_mode && chatOpts._voiceSentenceFlush) {
              if (!isTurnActive()) return result;
              chatOpts._voiceSentenceFlush();
              voiceBridge.sendWs(ws, { type: 'voice_chat_done', npcName, text: result?.text || '', turn_id: turnId });
            }
            return result;
          });
        });

        if (msg.voice_mode && ws.readyState === 1 && !isIncidentReport) {
          if (isTurnActive()) voiceBridge.emitVoiceFiller(ws, npcName, { turn_id: turnId });
        }

        if (ws.readyState === 1 && !isIncidentReport) {
          sendTurnMessage({
            type: 'player_chat_ack',
            npcName,
            queueLen: npcBrains.getQueueDepth?.() ?? 0,
          });
        }

        responsePromise
          .then(async (result) => {
            if (!isTurnActive()) return;
            // Server-side: visitor assistant handoffs to Lucy are persisted here.
            // The client receives the action in player_chat_response for visibility;
            // denizenVisitor.sendHandoff writes denizen_assistant_messages for Lucy/WS delivery.
            const handoffActions = (result?.actions || []).filter((a) => a?.action === 'visitor_handoff');
            if (handoffActions.length && msg.session_id) {
              for (const handoff of handoffActions) {
                try {
                  const target = await denizenVisitor.resolveHandoffTarget({
                    toCeo: handoff.toCeo !== false,
                    toSessionId: handoff.toSessionId || handoff.to_session_id,
                    toDisplayName: handoff.toDisplayName || handoff.to_display_name,
                  });
                  await denizenVisitor.sendHandoff({
                    fromSessionId: msg.session_id,
                    toSessionId: target.session_id,
                    message: handoff.message,
                    fromNpc: npcName,
                    toNpc: handoff.toNpc || handoff.to_npc,
                  });
                } catch (err) {
                  console.warn('[PlayerChat] visitor_handoff persist failed:', err?.message || err);
                }
              }
            }

            // If the brain returned nothing usable, treat it as an
            // error so the client sees WHY instead of an empty bubble.
            const text = (result && typeof result.text === 'string') ? result.text.trim() : '';
            if (!text) {
              const errMsg = `${npcName}'s brain returned no text (provider may be down — check /api/health)`;
              _recordNpcError(errMsg);
              global._npcStats.playerChatFailed++;
              const reply = JSON.stringify({
                type: 'player_chat_response',
                npcName,
                text: '(no reply — provider error, see diagnostics)',
                error: errMsg,
                delegation: null, actions: [],
                turn_id: turnId,
              });
              if (ws.readyState === 1) ws.send(reply);
              return;
            }
            global._npcStats.playerChatSucceeded++;

            if (!result.delegation && !msg.session_id) {
              const synthDelegate = playerChatSkills.extractDelegateTarget?.(msg.text);
              if (synthDelegate && synthDelegate !== npcName) {
                result.delegation = {
                  delegateTo: synthDelegate,
                  reason: msg.text,
                  originalMessage: msg.text,
                  _synthetic: true,
                };
              }
            }

            let outboundText = text;
            if (_taskAdviceForChat?.recommendation
              && msg.session_id
              && visitorToolGate.canUseRealWork
              && playerChatSkills.isTaskLikeMessage(msg.text)) {
              outboundText = `${text}\n\n⏱ ${_taskAdviceForChat.recommendation}`;
            }

            if (msg.session_id) {
              visitorIntel.absorbChatContext(msg.session_id, {
                userMessage: msg.text,
                npcResponse: outboundText,
                npcKey: npcName,
              }).catch(() => {});
              visitorIntel.recordCommitmentsFromChat(msg.session_id, {
                userMessage: msg.text,
                npcResponse: outboundText,
                npcKey: npcName,
              }).catch(() => {});
              slackChannel.sendToSlack(msg.session_id, `${npcName}: ${outboundText}`).catch(() => {});
            }

            const reply = JSON.stringify({
              type: isIncidentReport ? 'bouncer_security' : 'player_chat_response',
              npcName, text: outboundText,
              delegation: result.delegation || null,
              actions: result.actions || [],
              citations: _visitorCitedResearch?.citations || null,
              task_advice: _taskAdviceForChat || null,
              turn_id: turnId,
            });
            if (ws.readyState === 1) ws.send(reply);
            npcBrains.touchPlayerChatBusy?.(npcName, 120000);

            const gapActions = (result?.actions || []).filter((a) => a?.action === 'skill_gap_intake');
            if (gapActions.length && msg.session_id && visitorToolGate.canUseRealWork) {
              for (const gap of gapActions) {
                _runSkillGapFromChat({
                  ws,
                  npcName: gap.npcName || npcName,
                  sessionId: msg.session_id,
                  message: gap.message || msg.text,
                  visitorCtx: _visitorCtxForSkills,
                  visitorToolGate,
                  meshContext: _taskAdviceForChat ? { ...await _buildMeshContextForAdvice().catch(() => ({})), taskText: msg.text } : await _buildMeshContextForAdvice().catch(() => ({})),
                }).catch((err) => {
                  console.warn('[PlayerChat] skill gap intake failed:', err?.message || err);
                });
              }
            }

            if (msg.session_id && visitorToolGate.canUseRealWork && !isIncidentReport) {
              const deferTo = playerChatSkills.shouldDeferSkillToDelegatee?.(msg.text, result.delegation);
              if (!deferTo) {
                _executePlayerChatSkillFollowup({
                  ws,
                  npcName,
                  sessionId: msg.session_id,
                  message: msg._attachmentBlock ? `${msg.text}${msg._attachmentBlock}` : msg.text,
                  responseText: text,
                  visitorCtx: _visitorCtxForSkills,
                  visitorToolGate,
                  gapAlreadyHandled: gapActions.length > 0,
                  meshContext: {
                    ...(await _buildMeshContextForAdvice().catch(() => ({}))),
                    taskText: msg.text,
                    hasVisitorAnthropicKey: !!_visitorCtxForSkills?.providerKeys?.anthropic,
                  },
                }).catch((err) => {
                  console.warn('[PlayerChat] skill followup failed:', err?.message || err);
                });
              }
            } else if (!msg.session_id && visitorToolGate.canUseRealWork && !isIncidentReport) {
              const deferTo = playerChatSkills.shouldDeferSkillToDelegatee?.(msg.text, result.delegation);
              const inferred = playerChatSkills.inferSkillFromMessage?.(npcName, msg.text);
              const lucyLookup = npcName === 'Lucy' && !ceoLucySearchStarted
                && inferred?.skill === 'research';
              const ceoDirectOrder = playerChatSkills.isTaskLikeMessage?.(msg.text)
                || /\brun_skill\b/i.test(msg.text)
                || Boolean(inferred?.skill);

              if (deferTo && deferTo !== npcName) {
                const delegateTask = result.delegation?.originalMessage
                  || result.delegation?.reason
                  || msg.text;
                npcBrains.assignDirective(deferTo, npcName, `[From CEO via ${npcName}] ${delegateTask}`, true);
                const delegateInfer = playerChatSkills.inferSkillFromMessage(deferTo, msg.text);
                if (delegateInfer?.skill && (/\brun_skill\b/i.test(msg.text) || ceoDirectOrder)) {
                  _executePlayerChatSkillFollowup({
                    ws,
                    npcName: deferTo,
                    sessionId: null,
                    message: msg._attachmentBlock ? `${msg.text}${msg._attachmentBlock}` : msg.text,
                    responseText: text,
                    visitorCtx: _visitorCtxForSkills,
                    visitorToolGate,
                    gapAlreadyHandled: false,
                    ceoLookup: false,
                    ceoDirectOrder: true,
                    forceInfer: true,
                    meshContext: { taskText: msg.text },
                  }).catch((err) => {
                    console.warn('[PlayerChat] delegatee skill followup failed:', err?.message || err);
                  });
                }
              } else if (inferred?.skill?.startsWith?.('crm-') || lucyLookup || ceoDirectOrder) {
                _executePlayerChatSkillFollowup({
                  ws,
                  npcName,
                  sessionId: null,
                  message: msg._attachmentBlock ? `${msg.text}${msg._attachmentBlock}` : msg.text,
                  responseText: text,
                  visitorCtx: _visitorCtxForSkills,
                  visitorToolGate,
                  gapAlreadyHandled: false,
                  ceoLookup: !!lucyLookup,
                  ceoDirectOrder: !!ceoDirectOrder,
                  forceInfer: !!ceoDirectOrder,
                  meshContext: { taskText: msg.text },
                }).catch((err) => {
                  console.warn('[PlayerChat] CEO skill followup failed:', err?.message || err);
                });
              }
            }

            if (result.delegation?.delegateTo && visitorToolGate.canUseRealWork) {
              const deferTo = playerChatSkills.shouldDeferSkillToDelegatee?.(msg.text, result.delegation);
              const ceoDelegated = !msg.session_id && deferTo && deferTo !== npcName;
              if (!ceoDelegated) {
                const delegateTo = result.delegation.delegateTo;
                const delegateTask = result.delegation.reason
                  || result.delegation.originalMessage
                  || msg.text;
                npcBrains.assignDirective(
                  delegateTo,
                  npcName,
                  `[From CEO via ${npcName}] ${delegateTask}`,
                  true,
                );
              }
            }

            if (!isIncidentReport && !msg.session_id) {
              const attachNote = msg._attachmentInfo?.length ? ` [CEO shared files: ${msg._attachmentInfo.map((a) => `${a.name} (${a.kind}) → ${a.url}`).join(', ')}]` : '';
              npcBrains.saveMemory(npcName, `CEO said: "${msg.text}"${attachNote} — I replied: "${text}"${result.delegation ? ` [delegated to ${result.delegation.delegateTo}]` : ''}`);
              npcBrains.setMoodFromExternal(npcName, 'ceo_talked');
            }
          })
          .catch(err => {
            if (!isTurnActive()) return;
            const errMsg = String(err?.message ?? err);
            console.warn('[PlayerChat] Response error:', errMsg);
            _recordNpcError(`getPlayerResponse(${npcName}): ${errMsg}`);
            global._npcStats.playerChatFailed++;
            const fallback = JSON.stringify({
              type: 'player_chat_response',
              npcName,
              text: 'Got it, I\'ll look into that.',
              error: errMsg,
              delegation: null, actions: [],
              turn_id: turnId,
            });
            if (ws.readyState === 1) ws.send(fallback);
          });
        })().catch((err) => {
          console.warn('[PlayerChat] handler error:', err?.message || err);
        });
      } else if (msg.type === 'player_group_chat') {
        const sessionId = msg.session_id || msg.sessionId;
        const groupId = msg.group_id || msg.groupId;
        const rawText = typeof msg.text === 'string' ? msg.text.trim() : '';
        if (!sessionId || !groupId || !rawText) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_group_chat_response',
              groupId: groupId || null,
              error: 'session_id, group_id, and text required',
              text: 'Could not send — missing group info.',
            }));
          }
          return;
        }
        npcBrains.touchPlayerChatBusy?.(npcName);
        (async () => {
          const session = await denizenVisitor.getSession(sessionId).catch(() => null);
          if (!session) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'player_group_chat_response',
                groupId,
                error: 'session_not_found',
                text: 'Session not found — refresh and try again.',
              }));
            }
            return;
          }
          const identityId = await _resolveChatIdentityId(session, sessionId);
          const group = await userIdentity.getGroupChat(identityId, groupId);
          if (!group) {
            if (ws.readyState === 1) {
              ws.send(JSON.stringify({
                type: 'player_group_chat_response',
                groupId,
                error: 'group_not_found',
                text: 'That group chat was not found.',
              }));
            }
            return;
          }
          const visitorToolGate = await _resolveVisitorToolGate(sessionId);
          const [assistant, projects, pendingHandoffs, deepProfile, openCommitments] = await Promise.all([
            denizenVisitor.getAssistant(sessionId).catch(() => null),
            denizenVisitor.listProjects(sessionId).catch(() => []),
            denizenVisitor.getPendingHandoffs(sessionId).catch(() => []),
            visitorIntel.getProfile(sessionId).catch(() => ({})),
            visitorIntel.listCommitments(sessionId, { status: 'open' }).catch(() => []),
          ]);
          const identity = identityId && !String(identityId).startsWith('session:')
            ? await userIdentity.getIdentityById(identityId).catch(() => null)
            : null;
          const displayName = identity?.display_name || session.display_name || 'Guest';
          const playerOpts = {
            sessionId: session.id,
            identityId,
            displayName,
            assistant,
            projects,
            pendingHandoffs,
            deepProfile,
            openCommitments,
            sessionTier: visitorToolGate.sessionTier,
            canUseRealWork: visitorToolGate.canUseRealWork,
            sessionMetadata: visitorToolGate.sessionMetadata,
            orgSettings: visitorToolGate.orgSettings,
          };

          userIdentity.saveGroupChatMessage({
            identityId,
            groupId,
            senderType: 'user',
            content: rawText,
            sessionId,
          });

          const historyRows = await userIdentity.loadGroupChatHistory(identityId, groupId, 40);
          const recentMessages = userIdentity.mapGroupRowsToMessages(historyRows, displayName, npcFolderToDisplay);
          const memberKeys = Array.isArray(group.member_npc_keys) ? group.member_npc_keys : [];
          const responders = pickGroupResponders(rawText, memberKeys, assistant);
          const turnReplies = [];
          const playerText = fixVoiceMishearings(rawText);

          for (const npcKey of responders) {
            const npcName = npcFolderToDisplay(npcKey);
            if (!npcBrains.brains[npcName]) continue;
            try {
              const result = await npcBrains.getPlayerResponse(npcName, playerText, {
                ...playerOpts,
                groupChat: {
                  groupId,
                  groupName: group.name,
                  members: memberKeys.map(npcFolderToDisplay),
                  recentMessages,
                  turnReplies,
                },
              });
              const replyText = (result && typeof result.text === 'string') ? result.text.trim() : '';
              if (!replyText) continue;
              userIdentity.saveGroupChatMessage({
                identityId,
                groupId,
                senderType: 'npc',
                senderNpcKey: npcKey,
                content: replyText,
                sessionId,
              });
              turnReplies.push({ from: npcName, text: replyText });
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'player_group_chat_response',
                  groupId,
                  npcName,
                  npcKey,
                  text: replyText,
                  delegation: result.delegation || null,
                  actions: result.actions || [],
                }));
              }
            } catch (err) {
              console.warn(`[PlayerChat] group reply ${npcName} failed:`, err?.message || err);
            }
          }

          if (!turnReplies.length && ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_group_chat_response',
              groupId,
              npcName: npcFolderToDisplay(memberKeys[0] || 'Lucy'),
              text: '(no reply right now)',
            }));
          }
        })().catch((err) => {
          console.warn('[PlayerChat] group chat error:', err?.message || err);
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({
              type: 'player_group_chat_response',
              groupId: msg.group_id || msg.groupId || null,
              error: err?.message || String(err),
              text: 'Group chat failed — try again.',
            }));
          }
        });
      } else if (msg.type === 'npc_introduce') {
        // Tour stop: Lucy is presenting NPC X to the player. Ask X's
        // brain to compose a one-line introduction in their own voice.
        // Reuses the npc_conversation reply pipeline so the bubble +
        // voice paths work without new wiring.
        let introName = msg.npcName;
        if (typeof introName === 'string' && introName && !npcBrains.brains[introName]) {
          const lower = introName.toLowerCase();
          introName = Object.keys(npcBrains.brains).find(n => n.toLowerCase() === lower) || introName;
        }
        if (introName && npcBrains.brains[introName]) {
          npcBrains.getResponse(introName, 'Lucy', String(msg.context || 'Introduce yourself briefly to the CEO.'), {})
            .then(response => {
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({
                  type: 'npc_response',
                  npcName: introName,
                  fromName: 'Lucy',
                  text: response,
                  turn: 1,
                }));
              }
            })
            .catch(err => {
              console.warn('[Tour] introduction error:', err?.message || err);
            });
        }
      } else if (msg.type === 'npc_addressed') {
        // Conversation focus: the client tells us "NPC X was just spoken
        // to by Y". Mirror into worldState so X's next think() sees the
        // 'lastAddressed' field and acknowledges them before doing
        // something else.
        if (msg.target && worldState && typeof worldState.updateNpc === 'function') {
          worldState.updateNpc(msg.target, {
            lastAddressed: { by: msg.from || 'someone', text: msg.text || '', at: msg.ts || Date.now() },
          });
        }
      } else if (msg.type === 'npc_friction') {
        const npcName = msg.npcName || msg.npc_key;
        if (npcName && localMetrics.captureSystemError) {
          localMetrics.captureSystemError(
            npcName,
            msg.context || 'path_stuck',
            msg.error || { message: 'client friction report' },
          );
        }
      } else if (msg.type === 'player_idle') {
        // Receptionist tour: the client tells us "the player has been
        // idle for N ms". Mirror into worldState so Lucy's brain (or a
        // scheduler) can decide to offer them a tour.
        if (worldState) {
          worldState.environment = worldState.environment || {};
          worldState.environment.playerIdleMs = msg.idleMs || 0;
          worldState.environment.playerPosition = msg.position || null;
          worldState._emit('environment', worldState.environment);
        }
      } else if (msg.type === 'client_profile') {
        ws._denizenClientProfile = msg;
        let mobileCount = 0;
        (agentWss ? agentWss.clients : cofounderAgent.wsClients).forEach((c) => {
          if (c._denizenClientProfile?.touch) mobileCount++;
        });
        global._denizenMobileClients = mobileCount;
      } else if (msg.type === 'bouncer_run_tool') {
        // Bouncer requests a security scan via Kali WSL.
        // tool: 'nmap' | 'zenmap' (both run nmap CLI) | 'wireshark' (runs tcpdump)
        // threat: { category, severity, source, target, detail }
        const _broadcast = (m) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        const threat   = msg.threat || {};
        const invGate = _bouncerInvTake(threat);
        if (!invGate.allowed) {
          console.log(`[BouncerTool] Suppressed duplicate ${msg.tool || 'nmap'} for ${invGate.key} (${invGate.remainingSec}s left)`);
        } else {
        const tool     = msg.tool   || 'nmap';
        const sourceIp = threat.source && /\d{1,3}\.\d{1,3}/.test(String(threat.source)) ? String(threat.source) : null;
        const quietTool = tool === 'zenmap' || tool === 'nmap';

        console.log(`[BouncerTool] Running ${tool} (Kali WSL) for ${threat.category} threat from ${sourceIp || 'unknown'}`);

        if (!quietTool) {
          _broadcast({
            type: 'bouncer_tool_status', tool, status: 'starting', threat,
            message: `Bouncer running ${tool} in Kali Linux — investigating ${threat.category || 'the threat'}...`,
          });
        }

        // PC activity: bouncer-driven linux-agent run. mode = 'background'
        // since this code path doesn't spawn its own terminal window.
        const btActivity = pcActivity.record({
          npc: 'Bouncer', kind: 'linux-agent',
          task: `${tool} ${threat.category || 'investigation'}${sourceIp ? ' (' + sourceIp + ')' : ''}`.slice(0, 240),
          mode: 'background', status: 'started',
        });
        const btStart = Date.now();

        // All tools now run via Kali WSL — no desktop agent / GUI dependency
        const scanPromise = (tool === 'nmap' || tool === 'zenmap')
          ? linuxAgentBridge.investigate({ ...threat, source: sourceIp || threat.source })
          : (tool === 'wireshark')
            ? linuxAgent.trafficSnapshot().then(r => ({ ok: r.ok, summary: r.raw, elapsed: 5000, steps: [{ label: 'tcpdump', output: r.raw }] }))
            : linuxAgentBridge.perimeterPatrol().then(r => ({ ok: r.ok, summary: r.summary, elapsed: r.elapsed, steps: [] }));

        scanPromise.then(result => {
            pcActivity.record({
              id: btActivity.id, npc: 'Bouncer', kind: 'linux-agent',
              task: btActivity.task, mode: 'background',
              status: result.ok ? 'done' : 'failed',
              durationMs: Date.now() - btStart,
              detail: (result.summary || result.error || '').slice(0, 240) || null,
            });
            if (!quietTool) {
              _broadcast({
                type: 'bouncer_tool_status',
                tool,
                status: result.ok ? 'done' : 'error',
                threat,
                steps: result.steps?.length,
                message: result.ok
                  ? `${tool} complete (${((result.elapsed || 0) / 1000).toFixed(1)}s).`
                  : `${tool} failed: ${result.error}`,
              });
            }
          })
          .catch(err => {
            pcActivity.record({
              id: btActivity.id, npc: 'Bouncer', kind: 'linux-agent',
              task: btActivity.task, mode: 'background',
              status: 'failed', durationMs: Date.now() - btStart,
              detail: String(err?.message || err).slice(0, 240),
            });
            console.error(`[BouncerTool] ${tool} error:`, err?.message);
            if (!quietTool) {
              _broadcast({
                type: 'bouncer_tool_status',
                tool,
                status: 'error',
                threat,
                message: `${tool} threw: ${err?.message || err}`,
              });
            }
          });
        }
      } else if (msg.type === 'bouncer_run_linux') {
        // Bouncer requests a Kali WSL investigation for a threat.
        // threat: { category, severity, source, target, detail }
        // openTerminal: bool (default false) — set true to open a visible WSL window
        const _broadcast = (m) => cofounderAgent.wsClients.forEach(c => { if (c.readyState === 1) c.send(JSON.stringify(m)); });
        const threat = msg.threat || {};
        const invGate = _bouncerInvTake(threat);
        if (!invGate.allowed) {
          if (!invGate.loopback) {
            console.log(`[BouncerLinux] Suppressed duplicate investigation for ${invGate.key} (${invGate.remainingSec}s left)`);
          }
        } else {

        console.log(`[BouncerLinux] WSL investigation for ${threat.category} from ${threat.source || 'unknown'}`);

        const blrOpenTerm = msg.openTerminal === true;
        _broadcast({
          type: 'bouncer_linux_status',
          status: 'starting',
          threat,
          message: `Bouncer is investigating ${threat.category || 'the threat'} in the background...`,
        });

        // Visible WSL window only when CEO explicitly requests via API (never from robber auto-run).
        if (blrOpenTerm) {
          _openBouncerTerminal(_buildTerminalShowCmd(threat));
        }

        // PC activity: WS-triggered linux-agent investigation. Mode follows
        // whether we actually pop a terminal window.
        const blrActivity = pcActivity.record({
          npc: 'Bouncer', kind: 'linux-agent',
          task: `investigate ${threat.category || 'threat'}${threat.source ? ' (' + threat.source + ')' : ''}`,
          mode: blrOpenTerm ? 'visible' : 'background',
          status: 'started',
        });
        const blrStart = Date.now();

        // Run the real investigation (fast, direct WSL exec — no vision needed)
        const blrCtx = {
          broadcast: _broadcast,
          npcTools,
          npcBrains,
          denizenDb,
          investigationIsSerious,
        };
        linuxAgentBridge.investigate(threat).then(async (result) => {
          pcActivity.record({
            id: blrActivity.id, npc: 'Bouncer', kind: 'linux-agent',
            task: blrActivity.task, mode: blrActivity.mode,
            status: result.ok ? 'done' : 'failed',
            durationMs: Date.now() - blrStart,
            detail: (result.summary || result.error || '').slice(0, 240) || null,
          });
          const { reportPath } = await bouncerInvestigation.completeInvestigation(threat, result, blrCtx);
          _broadcast({
            type: 'bouncer_linux_result',
            status: result.ok ? 'done' : 'error',
            threat,
            category: result.category,
            ip: result.ip,
            elapsed: result.elapsed,
            steps: result.steps,
            summary: result.summary,
            reportPath: reportPath || null,
            message: result.ok
              ? `Kali investigation complete (${(result.elapsed / 1000).toFixed(1)}s).`
              : `WSL error: ${result.error}`,
          });
        }).catch(err => {
          pcActivity.record({
            id: blrActivity.id, npc: 'Bouncer', kind: 'linux-agent',
            task: blrActivity.task, mode: blrActivity.mode,
            status: 'failed', durationMs: Date.now() - blrStart,
            detail: String(err?.message || err).slice(0, 240),
          });
          console.error('[BouncerLinux] WSL error:', err?.message);
          _broadcast({ type: 'bouncer_linux_result', status: 'error', threat, message: `WSL threw: ${err?.message || err}` });
        });
        }
      } else {
        cofounderAgent.handleClientMessage(msg);
      }
    } catch (err) {
      console.warn('[AgentWS] Failed to parse client message:', err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[CofounderAgent] WS client disconnected (${cofounderAgent.wsClients.size - 1} remaining)`);
    try { _mpHandleDisconnect(ws); } catch (err) {
      console.warn('[Office] multiplayer disconnect:', err?.message || err);
    }
    cofounderAgent.removeClient(ws);
    let mobileCount = 0;
    (agentWss ? agentWss.clients : cofounderAgent.wsClients).forEach((c) => {
      if (c._denizenClientProfile?.touch) mobileCount++;
    });
    global._denizenMobileClients = mobileCount;
  });
  ws.on('error', () => {
    try { _mpHandleDisconnect(ws); } catch (_) {}
    cofounderAgent.removeClient(ws);
  });
});

setInterval(async () => {
  if (!agentWss || !denizenDb.enabled) return;
  for (const ws of agentWss.clients) {
    if (ws.readyState !== 1) continue;
    if (!ws._deliveredHandoffIds) ws._deliveredHandoffIds = new Set();

    if (ws._denizenSessionId) {
      _touchVisitorOnline(ws._denizenSessionId);
      try {
        const handoffs = await denizenVisitor.getPendingHandoffs(ws._denizenSessionId);
        for (const handoff of handoffs) {
          _deliverHandoffWs(ws, handoff);
        }
        const proactive = await visitorIntel.getPendingProactiveEvents(ws._denizenSessionId);
        for (const event of proactive || []) {
          if (!ws._deliveredProactiveIds) ws._deliveredProactiveIds = new Set();
          if (ws._deliveredProactiveIds.has(event.id)) continue;
          ws._deliveredProactiveIds.add(event.id);
          ws.send(JSON.stringify(visitorIntel.buildProactiveBroadcast(event)));
          visitorIntel.markProactiveDelivered(event.id, ws._denizenSessionId).catch(() => {});
        }
      } catch (_) { /* non-fatal poll */ }
    }

    if (ws._denizenIsCeo) {
      try {
        const bridgeId = await denizenVisitor.getOrCreateCeoBridgeSession();
        if (bridgeId) {
          const handoffs = await denizenVisitor.getPendingHandoffs(bridgeId);
          for (const handoff of handoffs) {
            _deliverHandoffWs(ws, handoff, { ceoBridge: true });
          }
        }
      } catch (_) { /* non-fatal poll */ }
    }
  }
}, 15000);

// Route WebSocket upgrades (pathname only — Cloudflare/nginx may add ?query)
function _wsUpgradePath(reqUrl) {
  try {
    return new URL(reqUrl || '/', 'http://127.0.0.1').pathname.replace(/\/$/, '') || '/';
  } catch (_) {
    return String(reqUrl || '').split('?')[0].replace(/\/$/, '') || '/';
  }
}

server.on('upgrade', (req, socket, head) => {
  const wsPath = _wsUpgradePath(req.url);

  if (wsPath === '/security-ws') {
    securityWss.handleUpgrade(req, socket, head, (ws) => {
      securityWss.emit('connection', ws, req);
    });
    return;
  }

  if (wsPath === '/agent-ws') {
    if (agentWss.clients.size >= MAX_WS_CLIENTS) {
      try {
        socket.write(
          'HTTP/1.1 503 Service Unavailable\r\n'
          + 'Connection: close\r\n'
          + 'Content-Type: text/plain\r\n'
          + 'Content-Length: 18\r\n'
          + '\r\n'
          + 'server at capacity',
        );
      } catch (_) {}
      try { socket.destroy(); } catch (_) {}
      return;
    }
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit('connection', ws, req);
    });
    return;
  }

  // Optional OpenClaw WebSocket proxy (off by default)
  if (!JELLY_ENABLE_OPENCLAW_GATEWAY) {
    socket.destroy();
    return;
  }
  const target = net.createConnection(OPENCLAW_PORT, OPENCLAW_HOST, () => {
    const reqLine = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    target.write(reqLine + headers + '\r\n\r\n');
    if (head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  target.on('error', (err) => {
    console.warn('[WS Proxy] Error:', err.message);
    socket.destroy();
  });
  socket.on('error', () => target.destroy());
});

// If port is already in use, kill whatever's holding it and retry once.
// This makes `node server.js` safe to run without manually killing the old process.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server] Port ${PORT} busy — killing existing process and retrying...`);
    const { execSync } = require('child_process');
    try {
      if (process.platform === 'win32') {
        // Find PID on the port and kill it
        const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', timeout: 3000 });
        const pids = [...new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => /^\d+$/.test(p) && p !== '0' && Number(p) !== process.pid))];
        pids.forEach((pid) => {
          try {
            execSync(`taskkill /PID ${pid} /F`, { timeout: 2000, stdio: 'pipe' });
          } catch (err) {
            console.warn(`[Server] Could not kill PID ${pid} on port ${PORT} — close the other server terminal manually, then restart.`);
          }
        });
      } else {
        execSync(`fuser -k ${PORT}/tcp 2>/dev/null || lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 3000 });
      }
    } catch (_) {}
    setTimeout(() => server.listen(PORT), 1000);
  }
});

// Research scheduler: job CRM maintenance + queue dispatch (6h) + daily digest (8am).
startResearchScheduler({
  jobCrm,
  gmailClient,
  npcBrains,
  researchQueue,
  broadcast: _ceoBroadcast,
  assignDirectiveFn: (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, !!urgent),
});

const _contentPipelineBroadcast = (msg) => {
  try {
    (agentWss ? agentWss.clients : new Set()).forEach((c) => {
      if (c.readyState === 1) c.send(JSON.stringify(msg));
    });
  } catch (_) {}
};
startContentPipelineScheduler({
  taskChain,
  assignDirectiveFn: (to, from, task, urgent) => npcBrains.assignDirective(to, from, task, !!urgent),
  broadcastFn: _contentPipelineBroadcast,
  onBrandBlocked: _onContentBrandBlocked,
});

startCrmScheduler({
  broadcastToOffice: _broadcastToOffice,
  log,
  npcBrains,
});

// Durable Jenny — MCP presence + directive pulse without an open Grok/Claude tab.
try {
  startJennyDurableLoop({
    npcBrains,
    mcpTeamTools,
    denizenDb,
    log,
  });
} catch (err) {
  log.warn?.('JennyDurable', `failed to start: ${err?.message || err}`);
}

// Nightly SAM.gov federal-opportunity auto-ingest (no-op until SAM_GOV_API_KEY
// is set; disable with SAM_GOV_AUTO_INGEST=0).
try {
  require('./src/denizen-crm-sam').startAutoIngest({ log });
} catch (err) {
  log.warn?.('SAM', `auto-ingest scheduler failed to start: ${err?.message || err}`);
}

_resetLucyBrowserOnStartup();
probePlaywrightBrowsers();
_startLucyMirrorFrameWatcher();

// Quest tick — advances daily/weekly quest progress; works in zero-config demo mode too.
const _questTickTimer = setInterval(() => {
  try { denizenQuests.tickQuests(); } catch (_) {}
}, 60_000);
_questTickTimer.unref?.();
setTimeout(() => { try { denizenQuests.tickQuests(); } catch (_) {} }, 20_000);

const DISCORD_SIDECAR_MAX_RETRIES = 5;
const DISCORD_SIDECAR_RETRY_BASE_MS = 10_000;
const DISCORD_SIDECAR_STABLE_MS = 60_000; // ran this long without exiting -> reset backoff
let _discordSidecarAttempt = 0;

function _startDiscordBotSidecar() {
  if (/^(0|false|no|off)$/i.test(String(process.env.DENIZEN_DISCORD_BOT || 'auto'))) return;
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!token) return;
  const botRoot = path.join(ROOT, 'discord-bot');
  const botMain = path.join(botRoot, 'index.js');
  if (!fs.existsSync(botMain)) return;
  const { spawn } = require('child_process');
  try {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [botMain], {
      cwd: botRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => process.stdout.write(d));
    child.stderr?.on('data', (d) => process.stderr.write(d));
    child.on('exit', (code) => {
      log.warn('DiscordBot', `sidecar exited (${code})`);
      if (Date.now() - startedAt >= DISCORD_SIDECAR_STABLE_MS) _discordSidecarAttempt = 0;
      if (code === 0) return; // clean shutdown, don't restart
      if (_discordSidecarAttempt >= DISCORD_SIDECAR_MAX_RETRIES) {
        log.warn('DiscordBot', `giving up after ${_discordSidecarAttempt} restart attempts`);
        return;
      }
      _discordSidecarAttempt += 1;
      const delay = DISCORD_SIDECAR_RETRY_BASE_MS * _discordSidecarAttempt;
      log.info('DiscordBot', `retrying sidecar in ${Math.round(delay / 1000)}s (attempt ${_discordSidecarAttempt}/${DISCORD_SIDECAR_MAX_RETRIES})`);
      setTimeout(_startDiscordBotSidecar, delay);
    });
    const presencePort = Number(process.env.DISCORD_PRESENCE_PORT) || 5180;
    log.info('DiscordBot', `sidecar started · presence http://127.0.0.1:${presencePort}/presence`);
  } catch (err) {
    log.warn('DiscordBot', `sidecar start failed: ${err?.message || err}`);
  }
}

const PREDICTION_MAINTENANCE_MS = 6 * 60 * 60 * 1000;
let _predictionMaintenanceTimer = null;
let _visitorIntelligenceLoop = null;
let _bouncerDailyBriefTimer = null;
let _patrolTimer = null;

server.listen(PORT, () => {
  denizenDb.init().then((result) => {
    if (!result?.ok) return;
    if (denizenDb.orgId) {
      worldState.setDefaultOrgId(denizenDb.orgId);
    }
    npcBrains.refreshDbMemories().catch((err) => {
      console.warn('[NpcBrains] initial DB memory refresh failed:', err?.message || err);
    });
    npcBrains.hydrateAgentSoulsFromDb().catch((err) => {
      console.warn('[NpcBrains] agent_souls hydrate failed:', err?.message || err);
    });
    denizenNpcStats.hydrateFromDb().catch((err) => {
      console.warn('[DenizenNpcStats] hydrate failed:', err?.message || err);
    });
    denizenOfficeProgress.hydrateFromDb().catch((err) => {
      console.warn('[DenizenOfficeProgress] hydrate failed:', err?.message || err);
    });
    denizenAchievements.hydrateFromDb().catch((err) => {
      console.warn('[DenizenAchievements] hydrate failed:', err?.message || err);
    });
    denizenQuests.hydrateFromDb().catch((err) => {
      console.warn('[DenizenQuests] hydrate failed:', err?.message || err);
    });
    runPredictionMaintenance(denizenDb).catch((err) => {
      console.warn('[DenizenPredictionLoop] initial maintenance failed:', err?.message || err);
    });
    _predictionMaintenanceTimer = setInterval(() => {
      runPredictionMaintenance(denizenDb).catch((err) => {
        console.warn('[DenizenPredictionLoop] maintenance failed:', err?.message || err);
      });
    }, PREDICTION_MAINTENANCE_MS);
    _predictionMaintenanceTimer.unref?.();

    _visitorIntelligenceLoop = startVisitorIntelligenceLoop({
      broadcast: (payload, sessionId) => _broadcastToVisitorSession(sessionId, payload),
      onRecurringTask: ({ task, event, sessionId }) => {
        _broadcastToVisitorSession(sessionId, visitorIntel.buildProactiveBroadcast(event));
        slackChannel.sendToSlack(sessionId, `Recurring: ${task.label}\n${task.prompt}`).catch(() => {});
      },
    }, { immediate: false });
    log.info('VisitorIntelligence', `scheduler started (${_visitorIntelligenceLoop.intervalMs}ms tick)`);

    if (/^(1|true|yes|on)$/i.test(String(process.env.DENIZEN_MARKET_TICK || 'true'))) {
      const marketLoop = marketScheduler.startMarketScheduler({
        robinhoodMcp,
        broadcast: _broadcastToOffice,
        npcBrains,
        log,
      });
      if (marketLoop?.ok) log.info('Market', `scheduler started (${marketLoop.tickMs}ms tick, US market hours)`);
    }
  }).catch(() => {});

  const parallel = process.env.LM_STUDIO_PARALLEL || 1;
  const npcCount = Object.keys(npcRoster || {}).length || 16;
  log.banner({ port: PORT, parallel, npcs: npcCount });
  log.info('Server', `http://localhost:${PORT}`);
  log.info('WS', `ws://localhost:${PORT}/agent-ws`);
  log.info('Security', `ws://localhost:${PORT}/security-ws`);
  // Keep main+fast resident in LM Studio; heavy stays JIT-only (16GB GPU).
  setTimeout(() => {
    try {
      const modelMgr = require('./src/lm-studio-model-manager');
      modelMgr.ensureResidentModels().then((r) => {
        if (r?.skipped) {
          log.info('LMStudio', `resident preload skipped (${r.reason})`);
        } else if (r?.ok) {
          const loaded = (r.resident || []).map((x) => `${x.model}${x.already ? ' (already)' : ''}`).join(', ');
          log.info('LMStudio', `resident models ready: ${loaded || 'none'}`);
          if (r.heavy) log.info('LMStudio', `heavy=${r.heavy.model} strategy=${r.heavy.strategy} ttl=${r.heavy.ttl_sec}s`);
        } else {
          log.warn('LMStudio', `resident preload: ${r?.error || 'failed'}`);
        }
      }).catch((err) => {
        log.warn('LMStudio', `resident preload error: ${err?.message || err}`);
      });
    } catch (err) {
      log.warn('LMStudio', `model manager unavailable: ${err?.message || err}`);
    }
  }, 4000).unref?.();
  // Spot client timeouts vs real LM latency and raise Assist budgets automatically.
  try {
    const adj = selfAdjust.startLoop();
    if (adj?.started) log.info('SelfAdjust', `loop every ${adj.loop_ms}ms`);
    else if (adj?.skipped) log.info('SelfAdjust', 'disabled (DENIZEN_SELF_ADJUST=0)');
  } catch (err) {
    log.warn('SelfAdjust', `start failed: ${err?.message || err}`);
  }
  _startDiscordBotSidecar();
  const ttsStatus = elevenLabs.status();
  if (ttsStatus.configured) {
    log.info('TTS', `ElevenLabs ✓ (key from ${ttsStatus.source})`);
  } else {
    log.warn('TTS', 'ElevenLabs not configured — set ELEVENLABS_API_KEY to enable');
  }

  // Sync LM Studio's active loaded model BEFORE starting the agent loop
  // so every component picks up the right model from the first request.
  ensureBrowserclawRunning()
    .then((r) => {
      if (r?.started) log.info('BrowserClaw', `auto-started at ${r.url}`);
      else if (r?.ok) log.info('BrowserClaw', `ready at ${r.url}`);
      else log.warn('BrowserClaw', `not reachable at ${r?.url || '18792'} — trend/browser skills may retry spawn`);
    })
    .catch(() => {});

  npcBrains.syncLmStudioModel().catch(() => {}).finally(() => {
    if (npcBrains.providers?.lmstudio?.model) {
      cofounderAgent.model = npcBrains.providers.lmstudio.model;
    }
    log.info('ModelSync',
      `active main=${npcBrains.providers?.lmstudio?.model} ` +
      `fast=${npcBrains.providers?.['lmstudio-fast']?.model}`
    );
    if (IS_RELAY_ONLY) {
      log.info('CofounderAgent', 'skipped — relay-only node');
      return;
    }
    // Economy: Abby uses scripted office commands instead of LM Studio thinks.
    if (promptTuning.economyMode && !/^(1|true|yes|on)$/i.test(String(process.env.DENIZEN_COFOUNDER_LLM || ''))) {
      console.log('[CofounderAgent] Economy mode — scripted demo loop (no LLM)');
      cofounderAgent._usingDemoLoop = true;
      cofounderAgent._startDemoLoop();
    } else {
      cofounderAgent.start();
    }
  });

  // ── Bouncer proactive patrol loop ─────────────────────────────────────────
  // Every 5 minutes Bouncer runs a real nmap baseline scan via Kali WSL and
  // broadcasts the results. NPCs (especially Bouncer's think loop) can read
  // the latest patrol result from worldState.bouncerPatrol.
  // First patrol fires after 60s so startup settles first.
  const PATROL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  async function runBouncerPatrol() {
    // PC activity: every 5-min patrol runs real WSL commands. Background
    // by default — no terminal window is opened for the timer-driven
    // patrol.
    const patActivity = pcActivity.record({
      npc: 'Bouncer', kind: 'linux-agent',
      task: 'scheduled perimeter patrol',
      mode: 'background', status: 'started',
    });
    const patStart = Date.now();
    try {
      log.info('Patrol', 'running perimeter check...');
      const patrol = await linuxAgentBridge.perimeterPatrol();
      pcActivity.record({
        id: patActivity.id, npc: 'Bouncer', kind: 'linux-agent',
        task: patActivity.task, mode: 'background',
        status: patrol.ok ? 'done' : 'failed',
        durationMs: Date.now() - patStart,
        detail: (patrol.summary || '').slice(0, 240) || null,
      });

      // Store in world-state so it injects into Bouncer's think prompts
      if (worldState) {
        worldState.bouncerPatrol = {
          ts:        Date.now(),
          summary:   patrol.summary,
          openPorts: patrol.openPorts || [],
          wsServer:  patrol.wsServer,
          lmStudio:  patrol.lmStudio,
          elapsed:   patrol.elapsed,
        };
      }

      // Broadcast to all clients so the HUD can show patrol status
      const patrolMsg = JSON.stringify({
        type:      'bouncer_patrol_result',
        summary:   patrol.summary,
        openPorts: patrol.openPorts || [],
        wsUp:      patrol.wsServer?.open || false,
        lmUp:      patrol.lmStudio?.open || false,
        elapsed:   patrol.elapsed,
        ts:        Date.now(),
      });
      (agentWss ? agentWss.clients : new Set()).forEach(c => { if (c.readyState === 1) c.send(patrolMsg); });

      log.patrol({ openPorts: patrol.openPorts, wsUp: patrol.wsServer?.open, lmUp: patrol.lmStudio?.open, elapsed: patrol.elapsed });

      // If open ports changed, broadcast a security event
      if (patrol.openPorts && patrol.openPorts.length > 0) {
        const portList = patrol.openPorts.map(p => `${p.port}/${p.service}`).join(', ');
        broadcast({ type: 'threat', category: 'scan_probe', severity: 'low',
          source: 'localhost', detail: `Baseline scan found open ports: ${portList}` });
      }
    } catch (err) {
      pcActivity.record({
        id: patActivity.id, npc: 'Bouncer', kind: 'linux-agent',
        task: patActivity.task, mode: 'background',
        status: 'failed', durationMs: Date.now() - patStart,
        detail: String(err?.message || err).slice(0, 240),
      });
      log.warn('Patrol', err?.message || String(err));
    }
    _patrolTimer = setTimeout(runBouncerPatrol, PATROL_INTERVAL_MS);
  }

  // Kick off first patrol after 60s (primary only — followers are relay-only)
  if (!IS_RELAY_ONLY && linuxAgent.isBouncerPatrolEnabled()) {
    _patrolTimer = setTimeout(runBouncerPatrol, 60 * 1000);
    log.info('Patrol', 'scheduled — first check in 60s, then every 5 min');
  } else if (!IS_RELAY_ONLY) {
    log.info('Patrol', 'disabled (BOUNCER_PATROL=0 or non-Windows host)');
  }

  const BOUNCER_DAILY_BRIEF_MS = Number(process.env.BOUNCER_DAILY_BRIEF_MS) || (24 * 60 * 60 * 1000);
  const BOUNCER_FRIDAY_BRIEF = /^(1|true|yes|on)$/i.test(String(process.env.BOUNCER_FRIDAY_BRIEF || ''));
  const _runBouncerDailyBrief = () => {
    try {
      const threats = Array.isArray(worldState.activeThreats) ? worldState.activeThreats.slice(0, 8) : [];
      const patrol = worldState.bouncerPatrol || null;
      const summary = {
        ts: Date.now(),
        generatedAt: new Date().toISOString(),
        threatCount: threats.length,
        activeThreats: threats.map((t) => ({
          category: t.category || 'unknown',
          severity: t.severity || 'unknown',
          source: t.source || null,
          detail: String(t.detail || '').slice(0, 160) || null,
          at: t.ts || null,
        })),
        lastPatrol: patrol
          ? {
              ts: patrol.ts || null,
              elapsed: patrol.elapsed || 0,
              summary: String(patrol.summary || '').slice(0, 320),
              openPorts: Array.isArray(patrol.openPorts) ? patrol.openPorts.slice(0, 12) : [],
            }
          : null,
      };

      worldState.bouncerDailyBrief = summary;
      worldState.pushEvent(
        'security',
        `Bouncer daily brief: ${summary.threatCount} active threat(s); patrol ${summary.lastPatrol ? 'available' : 'missing'}.`,
      );
      const payload = JSON.stringify({ type: 'bouncer_daily_brief', summary });
      (agentWss ? agentWss.clients : new Set()).forEach((c) => { if (c.readyState === 1) c.send(payload); });

      if (BOUNCER_FRIDAY_BRIEF && new Date().getDay() === 5) {
        const weeklyName = `weekly_${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_${Date.now()}`;
        const weeklyMd = [
          '# Weekly security brief',
          '',
          `Generated: ${summary.generatedAt}`,
          '',
          `- Active threats: ${summary.threatCount}`,
          `- Last patrol: ${summary.lastPatrol ? summary.lastPatrol.summary : 'No patrol data yet'}`,
          '',
          '## Threat list',
          ...(summary.activeThreats.length
            ? summary.activeThreats.map((t) => `- ${t.category} (${t.severity}) from ${t.source || 'unknown'}: ${t.detail || 'n/a'}`)
            : ['- No active threats recorded.']),
        ].join('\n');
        const weeklyPath = npcTools.writeArtifact('Bouncer', 'security', weeklyName, weeklyMd);
        if (weeklyPath) {
          worldState.pushEvent('security', `Bouncer weekly brief filed: ${weeklyPath}`);
        }
      }
    } catch (err) {
      log.warn('Patrol', `daily brief failed: ${err?.message || String(err)}`);
    }
  };

  if (!IS_RELAY_ONLY) {
    _bouncerDailyBriefTimer = setInterval(_runBouncerDailyBrief, BOUNCER_DAILY_BRIEF_MS);
    _bouncerDailyBriefTimer.unref?.();
    log.info('Patrol', `daily brief scheduler started (${BOUNCER_DAILY_BRIEF_MS}ms)`);
  }

  // Grok mentor drainer — answer pending grok-consult-queue rows (CLI or telemetry)
  // and inject lessons into local NPC memory (P4 measurable mentor loop).
  const GROK_DRAINER_MS = Math.max(60_000, Number(process.env.GROK_MENTOR_DRAINER_MS) || 5 * 60_000);
  if (!IS_RELAY_ONLY && process.env.GROK_MENTOR_DRAINER !== '0') {
    let grokDrainer = null;
    try { grokDrainer = require('./src/grok-mentor-drainer'); } catch (_) {}
    if (grokDrainer?.drainConsultQueue) {
      const _runGrokMentorDrainer = async () => {
        try {
          const summary = await grokDrainer.drainConsultQueue({ run: true, limit: 10 });
          if (summary.processed > 0) {
            log.info('Mentor', `Grok drainer mentored ${summary.processed} NPC(s)`);
          }
          // Backfill answered consults that never wrote MEMORY.md
          try {
            const mem = require('./src/npc-memory-inject');
            const bf = mem.backfillAnsweredConsults({ limit: 25 });
            if (bf.injected > 0) {
              log.info('Mentor', `Backfilled ${bf.injected} consult lesson(s) into MEMORY.md`);
            }
          } catch (_) {}
        } catch (err) {
          log.warn('Mentor', `Grok drainer failed: ${err?.message || String(err)}`);
        }
      };
      const _grokDrainerTimer = setInterval(_runGrokMentorDrainer, GROK_DRAINER_MS);
      _grokDrainerTimer.unref?.();
      setTimeout(_runGrokMentorDrainer, 45_000).unref?.();
      log.info('Mentor', `Grok mentor drainer started (${GROK_DRAINER_MS}ms, limit 6/run)`);
    }

    // Mentor dialogue drainer — unstick Grok↔Claude sessions left in awaiting_peers.
    let dialogueDrainer = null;
    try { dialogueDrainer = require('./src/mentor-dialogue-drainer'); } catch (_) {}
    if (dialogueDrainer?.drainMentorDialogues) {
      const DIALOGUE_MS = Math.max(60_000, Number(process.env.MENTOR_DIALOGUE_DRAINER_MS) || 7 * 60_000);
      const _runDialogueDrainer = async () => {
        try {
          const summary = await dialogueDrainer.drainMentorDialogues({ run: true, limit: 5 });
          if (summary.finalized > 0 || summary.processed > 0) {
            log.info('Mentor', `Dialogue drainer processed=${summary.processed} finalized=${summary.finalized}`);
          }
        } catch (err) {
          log.warn('Mentor', `Dialogue drainer failed: ${err?.message || String(err)}`);
        }
      };
      const _dialogueTimer = setInterval(_runDialogueDrainer, DIALOGUE_MS);
      _dialogueTimer.unref?.();
      setTimeout(_runDialogueDrainer, 55_000).unref?.();
      log.info('Mentor', `Mentor dialogue drainer started (${DIALOGUE_MS}ms)`);
    }
  }

  // Live telemetry job — refresh grok-telemetry-latest.json (no canned facts).
  // Deliberately OUTSIDE the mentor-drainer gate above. It used to be nested
  // inside it, so GROK_MENTOR_DRAINER=0 (or a relay-only node) silently killed
  // the 10-min telemetry refresh with no log line saying so.
  if (process.env.GROK_TELEMETRY_JOB !== '0') {
      const pathMod = require('path');
      const { spawn } = require('child_process');
      const TEL_JOB_MS = Math.max(120_000, Number(process.env.GROK_TELEMETRY_JOB_MS) || 10 * 60_000);
      const jobPy = pathMod.join(__dirname, 'infra', 'grok-mesh-telemetry-job.py');
      const _runTelemetryJob = () => {
        try {
          const py = process.env.DENIZEN_PYTHON_BIN
            || process.env.PYTHON
            || process.env.PYTHON_PATH
            || (process.platform === 'win32' ? 'py' : 'python3');
          const child = spawn(py, [jobPy, '--force'], {
            cwd: __dirname,
            env: { ...process.env, GROK_AGENT: '1' },
            windowsHide: true,
          });
          child.on('error', (err) => log.warn('Telemetry', `job spawn: ${err?.message || err}`));
          child.on('close', (code) => {
            if (code !== 0) log.warn('Telemetry', `mesh job exit ${code}`);
            else log.info('Telemetry', 'mesh job refreshed live facts');
          });
        } catch (err) {
          log.warn('Telemetry', `job failed: ${err?.message || err}`);
        }
      };
      const _telTimer = setInterval(_runTelemetryJob, TEL_JOB_MS);
      _telTimer.unref?.();
      setTimeout(_runTelemetryJob, 70_000).unref?.();
      log.info('Telemetry', `Grok mesh telemetry job scheduled (${TEL_JOB_MS}ms)`);
    }
});

// Graceful shutdown — stop the security monitor's intervals and child
// processes (tshark, journalctl polling) so the process exits cleanly
// instead of hanging on the event loop. Idempotent across signals.
let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[Server] ${signal} received — shutting down`);
  try { securityMonitor.stop?.(); } catch (e) { console.warn('[Server] securityMonitor.stop:', e?.message); }
  try { cofounderAgent.stop?.(); } catch (_) {}
  try { externalSink.detach(); } catch (_) {}
  try { denizenDb.detachWorldState(worldState); } catch (_) {}
  try {
    denizenDb.recordFact({
      factType: 'office.stopped',
      actorType: 'system',
      actorId: 'denizen-server',
      payload: { signal },
      tags: ['office', 'shutdown'],
    });
  } catch (_) {}
  try { if (_patrolTimer) { clearTimeout(_patrolTimer); _patrolTimer = null; } } catch (_) {}
  try { if (_bouncerDailyBriefTimer) { clearInterval(_bouncerDailyBriefTimer); _bouncerDailyBriefTimer = null; } } catch (_) {}
  try { if (_predictionMaintenanceTimer) { clearInterval(_predictionMaintenanceTimer); _predictionMaintenanceTimer = null; } } catch (_) {}
  try { if (_visitorIntelligenceLoop) { _visitorIntelligenceLoop.stop(); _visitorIntelligenceLoop = null; } } catch (_) {}
  try {
    if (_broadcastTimer) clearTimeout(_broadcastTimer);
  } catch (_) {}
  // Give in-flight requests up to 3s, then exit.
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
