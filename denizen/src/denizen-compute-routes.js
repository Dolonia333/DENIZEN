'use strict';

const { URL } = require('node:url');
const computeQueue = require('./denizen-compute-queue');
const nodeWorker = require('./denizen-node-worker');
const computePlatform = require('./denizen-compute-platform');
const hostCompute = require('./denizen-host-compute');
const desktopLink = require('./denizen-desktop-link');
const desktopPairing = require('./denizen-desktop-pairing');
const desktopPermissions = require('./denizen-desktop-permissions');
const desktopPermissionBridge = require('./desktop-permission-bridge');
const desktopFeedback = require('./denizen-desktop-feedback');
const sessionAuth = require('./visitor-session-auth');
const denizenDb = require('./denizen-db');
const hardwareMonitor = require('./denizen-hardware-monitor');
const fleetRegistry = require('./denizen-fleet-registry');
const computeCredits = require('./denizen-compute-credits');
const contributionTracker = require('./denizen-contribution-tracker');
const nodeProfiler = require('./denizen-node-profiler');
const fleetAgentBundle = require('./denizen-fleet-agent-bundle');
const lmStudioRouter = require('./lm-studio-router');

let hardwareSamplerStarted = false;

function ensureHardwareSampler() {
  if (hardwareSamplerStarted) return;
  hardwareSamplerStarted = true;
  hardwareMonitor.startHostSampler({
    intervalMs: 5000,
    onSample: (snap) => {
      fleetRegistry.setGlobalHostSnapshot(snap);
    },
  });
  fleetRegistry.startAuxiliaryProbeLoop(60000);
}

function extractLiveMetrics(body = {}) {
  const raw = body.live_metrics || body.liveMetrics || body.machine?.live_metrics || null;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

function scoreFromLiveMetrics(live = {}) {
  return nodeProfiler.scoreHardware({
    cpuCores: live.cpu_cores ?? null,
    ramMb: live.ram?.total_mb ?? null,
    vramMb: live.gpu?.vram_total_mb ?? null,
    gpu: live.gpu?.model ?? null,
  }).score;
}

function recordContributionSample(identityId, body = {}, defaults = {}) {
  if (!identityId) return null;
  const live = extractLiveMetrics(body) || defaults.live_metrics || null;
  const machineId = body.machine_id
    || body.machineId
    || live?.machine_id
    || defaults.machine_id
    || 'default';
  const hardwareScore = Number(defaults.hardware_score)
    || Number(body.hardware_score)
    || (live ? scoreFromLiveMetrics(live) : 0);
  return contributionTracker.recordSample({
    identityId,
    machineId,
    hardwareScore,
    contributionLevel: defaults.contribution_level || body.contribution_level || 'standard',
    contributing: defaults.contributing != null ? !!defaults.contributing : true,
    lmStudioActive: !!defaults.lm_studio_active,
    liveMetrics: live,
    role: defaults.role || live?.role || null,
  });
}

function recordIdentityLiveMetrics(identityId, body = {}, defaults = {}) {
  if (!identityId) return null;
  const live = extractLiveMetrics(body);
  if (!live) return null;
  const machineId = body.machine_id
    || body.machineId
    || live.machine_id
    || defaults.machine_id
    || `desktop-${body.desktop_install_id || body.desktopInstallId || 'node'}`;
  recordContributionSample(identityId, body, {
    ...defaults,
    machine_id: machineId,
    contributing: defaults.contributing != null ? defaults.contributing : live.contributing,
  });
  const machine = fleetRegistry.upsertMachine(identityId, machineId, {
    role: defaults.role || live.role || 'desktop',
    label: defaults.label || live.label || live.hostname || machineId,
    ...live,
    jobs_completed: Number(defaults.jobs_completed ?? live.jobs_completed) || 0,
    contributing: defaults.contributing != null ? defaults.contributing : live.contributing,
  });
  if (machine) lmStudioRouter.ingestFromMachine(machine);
  return machine;
}

async function resolveProfileForNode(node, serverContext = {}) {
  if (!node?.identity_id) return null;
  return computePlatform.getProfileByIdentity(node.identity_id);
}

function safeRequire(modulePath) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(modulePath);
  } catch (_) {
    return null;
  }
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function resolvePathAndMethod(req) {
  const reqUrl = req.url || '/';
  const url = new URL(reqUrl, 'http://localhost');
  return { path: url.pathname, method: req.method || 'GET', url };
}

function headerValue(req, name) {
  const headers = req?.headers || {};
  const target = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === target) return value;
  }
  return '';
}

function extractSessionId(req, body = {}, url = null) {
  return String(
    body.session_id || body.sessionId
    || headerValue(req, 'x-session-id')
    || (url && url.searchParams.get('session_id'))
    || '',
  ).trim() || null;
}

function extractSessionToken(req, body = {}) {
  return sessionAuth.extractSessionAuth(req, body);
}

function mergeTunnelHeaders(req, body = {}, url = null) {
  const out = { ...body };
  const sid = extractSessionId(req, out, url);
  if (sid) out.session_id = sid;
  const token = extractSessionToken(req, out);
  if (token) out.session_token = token;
  const grant = headerValue(req, 'x-access-grant');
  if (grant) out.access_grant = grant;
  const permission = headerValue(req, 'x-agent-permission-level') || headerValue(req, 'x-permission-level');
  if (permission) out.agent_permission_level = permission;
  const optIn = headerValue(req, 'x-opt-in') || headerValue(req, 'x-contribute-compute');
  if (optIn) out.opt_in = /^(1|true|yes)$/i.test(String(optIn));
  const displayName = headerValue(req, 'x-display-name');
  if (displayName) out.display_name = displayName;
  const serverUrl = headerValue(req, 'x-server-url') || headerValue(req, 'x-home-server-url');
  if (serverUrl) out.home_server_url = serverUrl;
  if (url) {
    const qpAliases = [
      ['identity_id', ['identityId']],
      ['node_id', ['nodeId']],
      ['job_id', ['jobId']],
      ['token', ['nodeToken']],
    ];
    for (const [canonical, aliases] of qpAliases) {
      for (const name of [canonical, ...aliases]) {
        const value = url.searchParams.get(name);
        if (value != null && value !== '') {
          out[canonical] = value;
          if (name !== canonical) out[name] = value;
          break;
        }
      }
    }
  }
  return out;
}

async function readBodyOrHeaders(req, url, limitBytes = 256 * 1024) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return mergeTunnelHeaders(req, {}, url);
  }
  const body = await readJsonBody(req, limitBytes);
  return mergeTunnelHeaders(req, body, url);
}

function resolvePublicServerUrl(req) {
  const forwarded = headerValue(req, 'x-forwarded-host');
  const proto = headerValue(req, 'x-forwarded-proto') || 'https';
  if (forwarded) return `${proto}://${forwarded}`.replace(/\/+$/, '');
  const host = headerValue(req, 'host');
  if (host && !/localhost|127\.0\.0\.1/i.test(host)) {
    const scheme = /:\d+$/.test(host) ? 'http' : 'https';
    return `${scheme}://${host}`.replace(/\/+$/, '');
  }
  return String(process.env.DENIZEN_URL || process.env.DENIZEN_PUBLIC_URL || '').replace(/\/+$/, '') || null;
}

function extractToken(req, body = {}, url = null) {
  const headerToken = req.headers['x-node-token'] || req.headers.authorization;
  const authBearer =
    typeof headerToken === 'string' && headerToken.startsWith('Bearer ')
      ? headerToken.slice('Bearer '.length)
      : headerToken;
  return String(
    authBearer
    || body.token
    || body.endpointToken
    || body.nodeToken
    || (url && url.searchParams.get('token'))
    || '',
  ).trim();
}

function resolveMinDesktopVersion() {
  return String(process.env.DENIZEN_MIN_DESKTOP_VERSION || '0.1.0').trim() || '0.1.0';
}

function hasValidInternalToken(req, body = {}, url = null, serverContext = {}) {
  const requiredToken =
    serverContext.internalToken || process.env.DENIZEN_INTERNAL_API_TOKEN || '';
  if (!requiredToken) return false;
  const supplied =
    req.headers['x-internal-token']
    || body.internalToken
    || (url && url.searchParams.get('internal_token'))
    || '';
  return String(supplied).trim() === String(requiredToken).trim();
}

function assertInternalRequest(req, body = {}, url = null, serverContext = {}) {
  const requiredToken =
    serverContext.internalToken || process.env.DENIZEN_INTERNAL_API_TOKEN || '';
  if (!requiredToken) return;
  const supplied =
    req.headers['x-internal-token']
    || body.internalToken
    || (url && url.searchParams.get('internal_token'))
    || '';
  if (String(supplied).trim() !== String(requiredToken).trim()) {
    const err = new Error('Internal token required');
    err.statusCode = 401;
    throw err;
  }
}

function assertFleetAgentRequest(req, body = {}, url = null, serverContext = {}) {
  const fleetToken =
    serverContext.fleetAgentToken || process.env.DENIZEN_FLEET_AGENT_TOKEN || '';
  if (fleetToken) {
    const supplied =
      req.headers['x-fleet-agent-token']
      || body.fleet_agent_token
      || body.fleetAgentToken
      || (url && url.searchParams.get('fleet_agent_token'))
      || '';
    if (String(supplied).trim() === String(fleetToken).trim()) return;
    const err = new Error('Fleet agent token required');
    err.statusCode = 401;
    throw err;
  }
  assertInternalRequest(req, body, url, serverContext);
}

async function resolveIdentityForSession(serverContext, req, sessionId, body = {}) {
  const verify = serverContext.verifyVisitorSession;
  if (typeof verify !== 'function') {
    const err = new Error('Visitor session verification unavailable');
    err.statusCode = 503;
    throw err;
  }
  let access;
  try {
    access = await verify(req, sessionId, body);
  } catch (err) {
    if (Number(err?.statusCode) === 503) throw err;
    const notFound = new Error('Identity not found for session');
    notFound.statusCode = 404;
    throw notFound;
  }
  const identityApi = serverContext.userIdentity || safeRequire('./denizen-user-identity.js');
  let identity = null;
  if (access?.session?.identity_id && identityApi?.getIdentityById) {
    identity = await identityApi.getIdentityById(access.session.identity_id);
  }
  if (!identity && identityApi?.getIdentityBySession) {
    identity = await identityApi.getIdentityBySession(sessionId);
  }
  if (!identity?.id && identityApi?.resolveIdentityForSession && access?.session?.id) {
    const meta = access.session.metadata || {};
    const tier = access.tier || meta.tier || 'demo';
    const realEmail = body.email || body.identity_email || meta.email || null;
    // Synthetic guest identities are for demo visitors only. Team members
    // must link by their real email (collected at login) — minting guest+
    // rows for them orphans their actual identity in the database.
    if (realEmail || tier === 'demo') {
      const guestEmail = 'guest+' + String(sessionId).replace(/-/g, '').slice(0, 16) + '@demo.denizen.local';
      identity = await identityApi.resolveIdentityForSession({
        email: realEmail || guestEmail,
        displayName: access.session.display_name || body.display_name || 'Guest',
        tier,
        orgId: access.orgId || access.session.org_id || access.org?.id || null,
        orgSlug: access.orgSlug || meta.org_slug || null,
        source: meta.access_method || (tier === 'demo' ? 'demo' : 'session'),
        sessionId: access.session.id,
      }).catch(() => null);
    }
  }
  if (!identity?.id && access?.session?.id) {
    const meta = access.session.metadata || {};
    identity = {
      id: `session:${access.session.id}`,
      display_name: access.session.display_name || body.display_name || 'Guest',
      tier: access.tier || meta.tier || 'demo',
      source: meta.access_method || 'session',
    };
  }
  return { access, identity };
}

async function resolveLmStudioSnapshot(req, serverContext = {}) {
  const npcBrains = serverContext.npcBrains;
  const allowProbe =
    desktopLink.detectClientType(req) === 'desktop'
    || hostCompute.isLocalOperatorRequest(req);
  if (npcBrains) {
    return hostCompute.getLmStudioSnapshot(npcBrains, { allowProbe }).catch(() => null);
  }
  if (typeof serverContext.getLmStudioSnapshot === 'function') {
    return serverContext.getLmStudioSnapshot().catch(() => null);
  }
  return null;
}

async function maybeAwardCredits({ node, job, serverContext = {}, body = {} } = {}) {
  const identityId = node?.identity_id;
  if (!identityId || !job?.id) return null;

  const creditsApi =
    serverContext.denizenCredits
    || safeRequire('./denizen-credits.js')
    || safeRequire('./denizen-credits');
  if (!creditsApi || typeof creditsApi.awardCredits !== 'function') return null;

  const profile = await resolveProfileForNode(node, serverContext).catch(() => null);
  const live = extractLiveMetrics(body);
  const finished = contributionTracker.finishJob(job.id, live);
  const jobType = String(job?.job_type || finished?.job_type || '').trim();
  const payout = computeCredits.computeJobCredits({
    jobType,
    hardwareScore: profile?.hardware_score || finished?.hardware_score || 0,
    contributionLevel: profile?.contribution_level || finished?.contribution_level || 'standard',
    durationMs: finished?.duration_ms
      || (job.started_at && job.completed_at
        ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
        : null),
    gpuUtilAvg: finished?.gpu_util_avg,
    cpuPercentAvg: finished?.cpu_percent_avg,
  });

  const cap = contributionTracker.grantWithCap(identityId, 'job', payout.amount);
  if (cap.granted <= 0) {
    return { ok: false, capped: true, requested: payout.amount, cap };
  }

  const ledger = await creditsApi.awardCredits(identityId, cap.granted, 'compute_job_complete', {
    jobId: job.id,
    metadata: {
      ...payout.breakdown,
      formula_version: payout.formula_version,
      node_id: node?.id || null,
      machine_id: live?.machine_id || null,
      capped: cap.capped,
      duration_ms: finished?.duration_ms || null,
    },
  });
  return { ok: true, delta: cap.granted, ledger, payout, cap };
}

function mountComputeRoutes(serverContext = {}) {
  ensureHardwareSampler();

  return async function handleComputeRoutes(req, res) {
    const { path, method, url } = resolvePathAndMethod(req);

    try {
      if (
        path === '/api/compute/node/register'
        && (method === 'GET' || method === 'POST')
      ) {
        const body = await readBodyOrHeaders(req, url, 128 * 1024);
        const node = await nodeWorker.registerNode({
          identityId: body.identityId || body.identity_id || null,
          nodeProfileId: body.nodeProfileId || body.node_profile_id || null,
          endpointToken: body.endpointToken || body.token || body.nodeToken || null,
        });
        sendJson(res, 200, {
          ok: Boolean(node),
          node,
          db_enabled: Boolean(denizenDb?.enabled),
        });
        return true;
      }

      if (
        path === '/api/compute/node/heartbeat'
        && (method === 'GET' || method === 'POST')
      ) {
        const body = await readBodyOrHeaders(req, url, 64 * 1024);
        const nodeId = body.nodeId || body.node_id;
        const token = extractToken(req, body, url);
        const node = await nodeWorker.heartbeat(nodeId, token);
        if (!node) {
          sendJson(res, 401, { ok: false, error: 'Invalid node token or node id' });
          return true;
        }
        if (node.identity_id) {
          recordIdentityLiveMetrics(node.identity_id, body, {
            role: 'node',
            machine_id: body.machine_id || body.machineId || `node-${node.id}`,
            jobs_completed: node.jobs_completed,
            contributing: true,
          });
        }
        sendJson(res, 200, { ok: true, node });
        return true;
      }

      if (
        path === '/api/compute/node/claim'
        && (method === 'GET' || method === 'POST')
      ) {
        const body = await readBodyOrHeaders(req, url, 64 * 1024);
        const token = extractToken(req, body, url);
        const node = await nodeWorker.resolveNodeAuth({
          nodeId: body.nodeId || body.node_id || null,
          identityId: body.identityId || body.identity_id || null,
          token,
        });
        if (!node) {
          sendJson(res, 401, { ok: false, error: 'Invalid node credentials' });
          return true;
        }

        const job = await computeQueue.claimJob(node.id);
        if (!job) {
          sendJson(res, 200, { ok: true, job: null, note: 'No queued jobs available' });
          return true;
        }

        const profile = await resolveProfileForNode(node, serverContext).catch(() => null);
        const live = extractLiveMetrics(body);
        contributionTracker.startJob({
          jobId: job.id,
          nodeId: node.id,
          identityId: node.identity_id,
          jobType: job.job_type,
          hardwareScore: profile?.hardware_score || 0,
          contributionLevel: profile?.contribution_level || 'standard',
          liveMetrics: live,
        });

        sendJson(res, 200, { ok: true, node, job });
        return true;
      }

      if (
        path === '/api/compute/node/complete'
        && (method === 'GET' || method === 'POST')
      ) {
        const body = await readBodyOrHeaders(req, url, 1024 * 1024);
        const token = extractToken(req, body, url);
        const node = await nodeWorker.resolveNodeAuth({
          nodeId: body.nodeId || body.node_id || null,
          identityId: body.identityId || body.identity_id || null,
          token,
        });
        if (!node) {
          sendJson(res, 401, { ok: false, error: 'Invalid node credentials' });
          return true;
        }

        const jobId = body.jobId || body.job_id;
        if (!jobId) {
          sendJson(res, 400, { ok: false, error: 'jobId is required' });
          return true;
        }

        if (body.error || body.ok === false) {
          const failed = await computeQueue.failJob(jobId, node.id, body.error || body.message || 'Job failed');
          sendJson(res, 200, { ok: Boolean(failed), job: failed });
          return true;
        }

        const completed = await computeQueue.completeJob(jobId, node.id, body.result || {});
        if (!completed) {
          sendJson(res, 409, { ok: false, error: 'Job not assigned to this node or already closed' });
          return true;
        }

        await nodeWorker.incrementJobsCompleted(node.id).catch(() => null);
        const credits = await maybeAwardCredits({
          node,
          job: completed,
          serverContext,
          body,
        }).catch(() => null);

        sendJson(res, 200, { ok: true, job: completed, credits_award: credits || null });
        return true;
      }

      if (method === 'GET' && path === '/api/compute/hardware/live') {
        const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }

        let identity;
        try {
          const resolved = await resolveIdentityForSession(serverContext, req, sessionId, {});
          identity = resolved.identity;
        } catch (err) {
          sendJson(res, 200, {
            ok: true,
            live_usage: null,
            fleet: [],
            fleet_totals: { machines: 0 },
            session_warning: err?.message || String(err),
          });
          return true;
        }

        if (!identity?.id) {
          sendJson(res, 200, {
            ok: true,
            live_usage: null,
            fleet: [],
            fleet_totals: { machines: 0 },
          });
          return true;
        }

        const isOperator = hostCompute.isHostOperatorSession(req, identity);
        const hostSnap = isOperator
          ? (fleetRegistry.getGlobalHostSnapshot()
            || hardwareMonitor.getLatestSnapshot()
            || await hardwareMonitor.refreshSnapshot({ role: 'host' }).catch(() => null))
          : null;
        const fleetSummary = fleetRegistry.buildFleetSummary(identity.id, hostSnap, { isOperator });
        sendJson(res, 200, {
          ok: true,
          identity_id: identity.id,
          host_operator: isOperator,
          ...fleetSummary,
        });
        return true;
      }

      if (method === 'GET' && path === '/api/compute/fleet/agent-bundle.tar.gz') {
        try {
          assertFleetAgentRequest(req, {}, url, serverContext);
        } catch (err) {
          sendJson(res, Number(err?.statusCode || 500), {
            ok: false,
            error: err?.message || String(err),
          });
          return true;
        }
        const machineId = url.searchParams.get('machine_id')
          || url.searchParams.get('machineId')
          || 'hp81081d';
        const label = url.searchParams.get('label')
          || (machineId === 'hp81081d' ? 'Kali · hp81081d' : machineId);
        const agentRoot = url.searchParams.get('agent_root') || '~/denizen-agent';
        const denizenUrl = (
          url.searchParams.get('denizen_url')
          || url.searchParams.get('pull_url')
          || process.env.DENIZEN_TAILSCALE_URL
          || serverContext.denizenLanUrl
          || process.env.DENIZEN_LAN_URL
          || process.env.DENIZEN_URL
        );
        const body = fleetAgentBundle.createAgentBundleBuffer({
          machineId,
          label,
          agentRoot,
          denizenUrl,
          publicUrl: serverContext.denizenPublicUrl || process.env.DENIZEN_PUBLIC_URL,
          identityId: process.env.DENIZEN_FLEET_IDENTITY_ID,
          sessionId: process.env.DENIZEN_FLEET_SESSION_ID,
          sessionToken: process.env.DENIZEN_FLEET_SESSION_TOKEN,
          fleetToken: serverContext.fleetAgentToken || process.env.DENIZEN_FLEET_AGENT_TOKEN,
        });
        res.writeHead(200, {
          'Content-Type': 'application/gzip',
          'Content-Disposition': 'attachment; filename="denizen-agent-bundle.tar.gz"',
          'Content-Length': body.length,
        });
        res.end(body);
        return true;
      }

      if (
        path === '/api/compute/fleet/report'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 512 * 1024);
        try {
          assertFleetAgentRequest(req, body, url, serverContext);
        } catch (err) {
          sendJson(res, Number(err?.statusCode || 500), {
            ok: false,
            error: err?.message || String(err),
          });
          return true;
        }

        const identityId = String(body.identity_id || body.identityId || '').trim();
        const live = extractLiveMetrics(body) || body.snapshot || null;
        if (!identityId) {
          sendJson(res, 400, { ok: false, error: 'identity_id required' });
          return true;
        }
        if (!live || typeof live !== 'object') {
          sendJson(res, 400, { ok: false, error: 'live_metrics required' });
          return true;
        }

        const machineId = body.machine_id
          || body.machineId
          || live.machine_id
          || `nas-${live.hostname || 'remote'}`;
        const role = String(body.role || live.role || 'nas').trim() || 'nas';
        const label = body.label || live.label || live.hostname || machineId;
        const smoke = !!body.smoke
          || /^1|true|yes$/i.test(String(headerValue(req, 'x-fleet-smoke') || ''))
          || String(machineId).startsWith('nas-smoke-');
        const fleetMachine = recordIdentityLiveMetrics(identityId, {
          live_metrics: live,
          machine_id: machineId,
          smoke,
        }, {
          role,
          label,
          machine_id: machineId,
          smoke,
          contributing: body.contributing != null ? !!body.contributing : true,
          jobs_completed: Number(body.jobs_completed ?? live.jobs_completed) || 0,
        });
        if (!smoke) {
          fleetRegistry.upsertAuxiliary(machineId, {
            ...live,
            role,
            label,
            machine_id: machineId,
            reachable: true,
            reporting: true,
          });
        }
        if (global._healthCache) global._healthCache.at = 0;
        sendJson(res, 200, {
          ok: true,
          identity_id: identityId,
          fleet_machine: fleetMachine,
          machine_id: machineId,
        });
        return true;
      }

      if (method === 'GET' && path === '/api/compute/contribution/summary') {
        const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }

        let identity;
        try {
          const resolved = await resolveIdentityForSession(serverContext, req, sessionId, {});
          identity = resolved.identity;
        } catch (err) {
          sendJson(res, Number(err?.statusCode || 500), {
            ok: false,
            error: err?.message || String(err),
          });
          return true;
        }

        if (!identity?.id) {
          sendJson(res, 404, { ok: false, error: 'Identity not found for session' });
          return true;
        }

        let profile = null;
        let activeNode = null;
        try {
          profile = await computePlatform.getProfileByIdentity(identity.id);
        } catch (_) {
          profile = null;
        }
        try {
          activeNode = await hostCompute.getOnlineNodeForIdentity(identity.id);
        } catch (_) {
          activeNode = null;
        }

        const lmStudio = await resolveLmStudioSnapshot(req, serverContext);
        const creditsApi =
          serverContext.denizenCredits
          || safeRequire('./denizen-credits.js')
          || safeRequire('./denizen-credits');
        const summary = await computePlatform.buildContributionSummary(
          identity,
          profile,
          activeNode,
          { req, lmStudio, creditsApi },
        );
        sendJson(res, 200, { ok: true, identity_id: identity.id, ...summary });
        return true;
      }

      if (method === 'GET' && path === '/api/compute/node/status') {
        const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId');
        if (sessionId) {
          let access;
          let identity;
          try {
            const resolved = await resolveIdentityForSession(serverContext, req, sessionId, {});
            access = resolved.access;
            identity = resolved.identity;
          } catch (err) {
            sendJson(res, Number(err?.statusCode || 500), {
              ok: false,
              error: err?.message || String(err),
            });
            return true;
          }

          const lmStudio = await resolveLmStudioSnapshot(req, serverContext);
          const sessionTier = access?.tier || access?.session?.metadata?.tier || 'team';

          if (!identity?.id) {
            sendJson(res, 200, computePlatform.buildSessionHostStatus({
              sessionTier,
              lmStudio,
              req,
            }));
            return true;
          }

          if (hostCompute.isHostOperatorSession(req, identity)) {
            await hostCompute.markHostOperatorIfLocal(identity.id, req, identity).catch(() => null);
            identity = await serverContext.userIdentity?.getIdentityById?.(identity.id).catch(() => identity) || identity;
          }

          const statusPayload = await computePlatform.getStatusForIdentity(identity, {
            req,
            lmStudio,
            sessionTier,
            allowHostAutoSync: true,
          });
          sendJson(res, 200, statusPayload || { ok: true, credits: 0, tier: sessionTier, opted_in: false });
          return true;
        }

        const nodeId = url.searchParams.get('nodeId') || url.searchParams.get('node_id');
        const token = extractToken(req, {}, url);
        const limit = Number(url.searchParams.get('limit') || 20);
        const pending = await computeQueue.listPendingJobs(limit);
        const running = await computeQueue.listAssignedJobs(limit);
        const recent = await computeQueue.listRecentCompletedJobs(Math.min(limit, 15));
        let node = null;
        if (nodeId && token) {
          node = await nodeWorker.verifyNodeToken(nodeId, token);
        }
        const brains = serverContext.npcBrains;
        const queueDepth = brains?.getQueueDepth?.() || 0;
        sendJson(res, 200, {
          ok: true,
          node: node || null,
          pending_jobs: pending || [],
          pending_count: Array.isArray(pending) ? pending.length : 0,
          running_jobs: running || [],
          running_count: Array.isArray(running) ? running.length : 0,
          recent_completions: recent || [],
          db_enabled: Boolean(denizenDb?.enabled),
          inference: lmStudioRouter.buildStatus(queueDepth),
        });
        return true;
      }

      if (method === 'GET' && path === '/api/compute/inference/nodes') {
        const brains = serverContext.npcBrains;
        const queueDepth = brains?.getQueueDepth?.() || 0;
        sendJson(res, 200, {
          ok: true,
          ...lmStudioRouter.buildStatus(queueDepth),
        });
        return true;
      }

      if (method === 'POST' && path === '/api/compute/node/opt-in') {
        const body = await readJsonBody(req, 128 * 1024);
        const sessionId = body.session_id || body.sessionId;
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }

        let access;
        let identity;
        try {
          const resolved = await resolveIdentityForSession(serverContext, req, sessionId, body);
          access = resolved.access;
          identity = resolved.identity;
        } catch (err) {
          sendJson(res, Number(err?.statusCode || 500), {
            ok: false,
            error: err?.message || String(err),
          });
          return true;
        }

        const lmStudio = await resolveLmStudioSnapshot(req, serverContext);

        if (!identity?.id) {
          const sessionTier = access?.tier || access?.session?.metadata?.tier || 'team';
          sendJson(res, 200, computePlatform.buildSessionHostStatus({ sessionTier, lmStudio, req }));
          return true;
        }

        const clientType = desktopLink.detectClientType(req);
        const isHostBrowser = clientType === 'browser' && hostCompute.isLocalOperatorRequest(req);
        if (clientType === 'browser' && !isHostBrowser) {
          sendJson(res, 400, {
            ok: false,
            error: 'Install Denizen Desktop on this machine to add City Power.',
            needs_desktop_download: true,
            contributor_state: 'browser_only',
            download_url: '/desktop/',
          });
          return true;
        }

        const explicitLevel = body.contribution_level || body.contributionLevel || null;
        const optIn = body.opt_in ?? body.optIn ?? body.opted_in;
        const enabled = explicitLevel
          ? explicitLevel !== 'off'
          : !!optIn;
        let profile = null;
        try {
          profile = await computePlatform.upsertProfileForIdentity(identity.id, {
            optIn: enabled,
            hardware: body.hardware || body.profile || {},
            contributionLevel: explicitLevel,
            idleOnly: body.idle_only ?? body.idleOnly ?? null,
          });
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err?.message || 'Profile update failed' });
          return true;
        }

        const freshIdentity = serverContext.userIdentity?.getIdentityById
          ? await serverContext.userIdentity.getIdentityById(identity.id)
          : identity;

        const statusPayload = await computePlatform.getStatusForIdentity(freshIdentity || identity, {
          req,
          lmStudio,
          allowHostAutoSync: enabled,
          sessionTier: access?.tier || access?.session?.metadata?.tier || null,
        });
        sendJson(res, 200, statusPayload || computePlatform.buildStatusPayload(freshIdentity || identity, profile));
        return true;
      }

      if (
        path === '/api/desktop/pairing/create'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 16 * 1024);
        const sessionId = extractSessionId(req, body, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required — log in via browser first' });
          return true;
        }
        await resolveIdentityForSession(serverContext, req, sessionId, body);
        const sessionToken = extractSessionToken(req, body);
        const serverUrl = body.server_url || body.home_server_url || resolvePublicServerUrl(req)
          || `http://127.0.0.1:${process.env.PORT || 8080}`;
        const token = desktopPairing.createPairingToken({
          sessionId,
          sessionToken,
          serverUrl,
        });
        sendJson(res, 200, desktopPairing.buildPairingResponse(token, serverUrl));
        return true;
      }

      if (method === 'GET' && path === '/api/desktop/pairing/claim') {
        const token = String(url.searchParams.get('token') || '').trim();
        if (!token) {
          sendJson(res, 400, { ok: false, error: 'token required' });
          return true;
        }
        const claimed = desktopPairing.claimPairingToken(token);
        if (!claimed?.session_id) {
          sendJson(res, 403, { ok: false, error: 'Invalid or expired pairing token' });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          session_id: claimed.session_id,
          session_token: claimed.session_token || null,
          server_url: claimed.server_url || null,
        });
        return true;
      }

      if (
        path === '/api/desktop/permission/request'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 16 * 1024);
        const sessionId = extractSessionId(req, body, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        const npcName = body.npc || body.npcName || body.npc_name || 'Denizen';
        const capability = body.capability || 'action';
        const detail = body.detail || body.action || body.instruction || '';
        let permissionLevel = body.agent_permission_level || body.permission_level || null;
        if (!permissionLevel) {
          permissionLevel = await desktopPermissionBridge.resolvePermissionLevelForSession(sessionId);
        }
        const result = desktopPermissionBridge.requestDesktopApprovalIfNeeded({
          sessionId,
          npcName,
          capability,
          detail,
          permissionLevel: permissionLevel || 'ask',
        });
        sendJson(res, 200, {
          ok: true,
          ...result,
          request_id: result.requestId || null,
        });
        return true;
      }

      if (method === 'GET' && path === '/api/desktop/permission/pending') {
        const body = await readBodyOrHeaders(req, url, 8 * 1024);
        const sessionId = extractSessionId(req, body, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        const pending = desktopPermissions.getPending(sessionId);
        sendJson(res, 200, { ok: true, pending });
        return true;
      }

      if (
        path === '/api/desktop/permission/respond'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 16 * 1024);
        const sessionId = extractSessionId(req, body, url);
        const requestId = body.request_id || body.requestId
          || url.searchParams.get('request_id');
        const approved = body.approved ?? body.approve
          ?? url.searchParams.get('approved');
        if (!sessionId || !requestId) {
          sendJson(res, 400, { ok: false, error: 'session_id and request_id required' });
          return true;
        }
        const result = desktopPermissions.respond(
          sessionId,
          requestId,
          approved === true || approved === 'true' || approved === '1' || approved === 1,
        );
        sendJson(res, result.ok ? 200 : 404, result);
        return true;
      }

      if (
        path === '/api/desktop/wizard/complete'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 256 * 1024);
        const sessionId = extractSessionId(req, body, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        const { identity } = await resolveIdentityForSession(serverContext, req, sessionId, body);
        if (!identity?.id) {
          sendJson(res, 404, { ok: false, error: 'Identity not found — log in via browser first' });
          return true;
        }
        const profile = await desktopLink.completeSetupWizard(identity.id, body);
        const node = await nodeWorker.registerNode({ identityId: identity.id }).catch(() => null);
        const statusPayload = await computePlatform.getStatusForIdentity(identity, {
          req,
          allowHostAutoSync: false,
        });
        sendJson(res, 200, {
          ...statusPayload,
          ok: Boolean(profile),
          profile,
          node: node
            ? {
              id: node.id,
              endpoint_token: node.endpoint_token,
              identity_id: node.identity_id,
            }
            : null,
          identity: {
            id: identity.id,
            email: identity.email || identity.email_normalized || null,
          },
        });
        return true;
      }

      if (
        path === '/api/desktop/capabilities/sync'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 256 * 1024);
        const sessionId = extractSessionId(req, body, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        const { identity } = await resolveIdentityForSession(serverContext, req, sessionId, body);
        if (!identity?.id) {
          sendJson(res, 404, { ok: false, error: 'Identity not found' });
          return true;
        }
        const syncResult = await desktopLink.syncDesktopCapabilities(identity.id, body);
        const profile = syncResult?.profile ?? syncResult;
        const node = syncResult?.node ?? null;
        const fleetMachine = recordIdentityLiveMetrics(identity.id, body, {
          role: 'desktop',
          machine_id: body.machine_id
            || body.machine?.machine_id
            || `desktop-${body.desktop_install_id || profile?.desktop_install_id || 'app'}`,
          label: body.machine?.hostname || profile?.metadata?.desktop_hostname || 'Denizen Desktop',
          contributing: !!body.opt_in || !!profile?.opt_in,
          jobs_completed: node?.jobs_completed || 0,
        });
        sendJson(res, 200, {
          ok: Boolean(profile),
          profile,
          node,
          fleet_machine: fleetMachine,
          min_desktop_version: resolveMinDesktopVersion(),
        });
        return true;
      }

      if (
        path === '/api/desktop/feedback'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 512 * 1024);
        const qp = {};
        for (const key of [
          'install_id', 'installId', 'app_version', 'appVersion', 'platform', 'arch',
          'os_version', 'osVersion', 'channel', 'event', 'detail', 'logs_tail', 'logsTail',
        ]) {
          const v = url.searchParams.get(key);
          if (v != null && v !== '') qp[key] = v;
        }
        const payload = { ...body, ...qp };
        const sessionId = extractSessionId(req, payload, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        await resolveIdentityForSession(serverContext, req, sessionId, payload);
        const record = desktopFeedback.submitFeedback({
          sessionId,
          installId: payload.install_id || payload.installId,
          appVersion: payload.app_version || payload.appVersion,
          platform: payload.platform,
          arch: payload.arch,
          osVersion: payload.os_version || payload.osVersion,
          channel: payload.channel,
          event: payload.event,
          detail: payload.detail,
          logsTail: payload.logs_tail || payload.logsTail,
        });
        sendJson(res, 200, { ok: true, record });
        return true;
      }

      if (method === 'GET' && path === '/api/desktop/feedback/recent') {
        const body = await readBodyOrHeaders(req, url, 8 * 1024);
        const internalOk = hasValidInternalToken(req, body, url, serverContext);
        if (!internalOk) {
          const sessionId = extractSessionId(req, body, url);
          if (!sessionId) {
            sendJson(res, 401, { ok: false, error: 'session_id or internal token required' });
            return true;
          }
          await resolveIdentityForSession(serverContext, req, sessionId, body);
        }
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || 50)));
        const items = desktopFeedback.listRecentFeedback({ limit });
        sendJson(res, 200, { ok: true, items, count: items.length });
        return true;
      }

      if (method === 'POST' && path === '/api/desktop/register') {
        const body = await readJsonBody(req, 256 * 1024);
        const sessionId = body.session_id || body.sessionId;
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        const { identity } = await resolveIdentityForSession(serverContext, req, sessionId, body);
        if (!identity?.id) {
          sendJson(res, 404, { ok: false, error: 'Identity not found — log in via browser first' });
          return true;
        }
        const profile = await desktopLink.registerDesktopInstall(identity.id, {
          ...body,
          home_server_url: body.home_server_url || body.server_url || null,
        });
        sendJson(res, 200, { ok: Boolean(profile), profile, contributor_state: 'desktop_linked' });
        return true;
      }

      if (method === 'GET' && path === '/api/compute/credits/economy') {
        const sessionId = url.searchParams.get('session_id') || url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        let identity;
        try {
          const resolved = await resolveIdentityForSession(serverContext, req, sessionId, {});
          identity = resolved.identity;
        } catch (err) {
          sendJson(res, Number(err?.statusCode || 500), {
            ok: false,
            error: err?.message || String(err),
          });
          return true;
        }
        if (!identity?.id) {
          sendJson(res, 404, { ok: false, error: 'Identity not found for session' });
          return true;
        }
        const profile = await computePlatform.getProfileByIdentity(identity.id).catch(() => null);
        const hardwareScore = profile?.hardware_score || 0;
        const contributionLevel = profile?.contribution_level || 'off';
        sendJson(res, 200, {
          ok: true,
          identity_id: identity.id,
          credits_balance: Number(identity.credits_balance) || 0,
          economy: contributionTracker.getEconomySummary(identity.id),
          estimates: {
            npc_think_batch: computeCredits.computeJobCredits({
              jobType: 'npc_think_batch',
              hardwareScore,
              contributionLevel,
            }),
            embedding_index: computeCredits.computeJobCredits({
              jobType: 'embedding_index',
              hardwareScore,
              contributionLevel,
            }),
            uptime_15m: computeCredits.computeUptimeCredits({
              hardwareScore,
              contributionLevel,
              windowSeconds: 900,
              contributing: !!profile?.opt_in,
            }),
            host_stipend_hour: computeCredits.computeHostStipendCredits({
              hardwareScore,
              lmStudioActive: true,
              gpuUtilAvg: 30,
              windowHours: 1,
            }),
          },
          spend_catalog: computeCredits.SPEND_CATALOG,
        });
        return true;
      }

      if (
        path === '/api/compute/credits/spend'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 128 * 1024);
        const sessionId = extractSessionId(req, body, url);
        if (!sessionId) {
          sendJson(res, 400, { ok: false, error: 'session_id required' });
          return true;
        }
        const { identity } = await resolveIdentityForSession(serverContext, req, sessionId, body);
        if (!identity?.id) {
          sendJson(res, 404, { ok: false, error: 'Identity not found for session' });
          return true;
        }
        const spendReason = String(body.reason || body.spend_reason || 'priority_boost').trim();
        const option = computeCredits.getSpendOption(spendReason);
        if (!option) {
          sendJson(res, 400, { ok: false, error: 'Unknown spend reason' });
          return true;
        }
        const creditsApi =
          serverContext.denizenCredits
          || safeRequire('./denizen-credits.js')
          || safeRequire('./denizen-credits');
        if (!creditsApi?.spendCredits) {
          sendJson(res, 503, { ok: false, error: 'Credits API unavailable' });
          return true;
        }
        const spent = await creditsApi.spendCredits(
          identity.id,
          option.cost,
          `compute_spend_${spendReason}`,
          { metadata: { spend_reason: spendReason, ...option } },
        ).catch((err) => ({
          ok: false,
          error: err?.message || String(err),
        }));
        if (!spent?.ok) {
          sendJson(res, 402, {
            ok: false,
            error: spent?.error || 'INSUFFICIENT_CREDITS',
            spend: option,
          });
          return true;
        }
        sendJson(res, 200, {
          ok: true,
          spend: option,
          result: spent,
        });
        return true;
      }

      if (
        path === '/api/compute/jobs/enqueue'
        && (method === 'POST' || method === 'GET')
      ) {
        const body = await readBodyOrHeaders(req, url, 1024 * 1024);
        let priority = body.priority;
        let spendResult = null;

        const sessionId = extractSessionId(req, body, url);
        const spendReason = body.spend_reason || body.spendReason || null;
        if (sessionId && spendReason) {
          const { identity } = await resolveIdentityForSession(serverContext, req, sessionId, body).catch(() => ({}));
          const option = computeCredits.getSpendOption(spendReason);
          const creditsApi =
            serverContext.denizenCredits
            || safeRequire('./denizen-credits.js')
            || safeRequire('./denizen-credits');
          if (identity?.id && option && creditsApi?.spendCredits) {
            spendResult = await creditsApi.spendCredits(
              identity.id,
              option.cost,
              `compute_spend_${spendReason}`,
              { metadata: { spend_reason: spendReason, enqueue: true, ...option } },
            ).catch((err) => ({ ok: false, error: err?.message || String(err) }));

            if (spendResult?.ok) {
              priority = Math.min(100, (Number(priority) || 50) + (option.priority_delta || 0));
            } else {
              // Non-fatal: session-based identities may not exist as a UUID-backed
              // denizen_user_identities row yet. In that case we still want compute
              // mesh job enqueue to work (the job + claim/complete proof).
              console.warn('[compute/jobs/enqueue] credits spend skipped:', spendResult?.error || spendResult);
              spendResult = null;
            }
          }
        } else {
          assertInternalRequest(req, body, url, serverContext);
        }

        const job = await computeQueue.enqueueJob({
          jobType: body.jobType || body.job_type,
          payload: body.payload || {},
          priority,
        });
        sendJson(res, 200, {
          ok: Boolean(job),
          job,
          priority,
          credits_spent: spendResult?.ok ? spendResult : null,
        });
        return true;
      }
    } catch (err) {
      const status = Number(err?.statusCode || 500);
      sendJson(res, status, {
        ok: false,
        error: err?.message || String(err),
      });
      return true;
    }

    return false;
  };
}

module.exports = {
  mountComputeRoutes,
  desktopPermissions,
  desktopPermissionBridge,
};
