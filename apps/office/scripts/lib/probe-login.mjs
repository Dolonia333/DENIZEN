/**
 * Shared Playwright login helpers for Denizen probes/smoke scripts.
 * Uses unified Login modal (path-login) with env fallbacks.
 *
 * Env:
 *   PROBE_OWNER_USER / PROBE_OWNER_PASS / PROBE_TEAM_CODE / PROBE_OWNER_EMAIL
 *   DENIZEN_TEAM_CODE (team code fallback)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DENIZEN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_PATH = path.join(DENIZEN_ROOT, '.env');
if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

const DEFAULTS = {
  username: process.env.PROBE_OWNER_USER || process.env.PROBE_USERNAME || 'Dolonia',
  password: process.env.PROBE_OWNER_PASS || process.env.PROBE_PASSWORD || '',
  teamCode: process.env.PROBE_TEAM_CODE || process.env.DENIZEN_TEAM_CODE || '1921',
  email: process.env.PROBE_OWNER_EMAIL || process.env.PROBE_EMAIL || 'zionvanzandt@gmail.com',
  ceoCode: process.env.PROBE_CEO_CODE || 'Dolonia',
};

export async function waitForSessionReady(page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => !document.getElementById('denizen-visitor-name-modal')
      && (globalThis.DenizenVisitorSession?.getSessionId?.() || null),
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(800);
}

async function dismissLoginModal(page, timeoutMs = 45_000) {
  const modal = page.locator('#denizen-visitor-name-modal');
  if (await modal.count() === 0) return;
  const errSel = '#denizen-vis-error:not([hidden])';
  await Promise.race([
    modal.waitFor({ state: 'detached', timeout: timeoutMs }),
    modal.waitFor({ state: 'hidden', timeout: timeoutMs }),
  ]).catch(async () => {
    const errText = await page.locator(errSel).textContent().catch(() => '');
    if (errText?.trim()) throw new Error(errText.trim());
    throw new Error('Login modal still visible — check PROBE_OWNER_PASS / credentials');
  });
}

export async function loginUnified(page, {
  username = DEFAULTS.username,
  password = DEFAULTS.password,
  teamCode = DEFAULTS.teamCode,
  email = DEFAULTS.email,
  timeoutMs = 30_000,
} = {}) {
  if (await page.locator('#denizen-visitor-name-modal').count() === 0) {
    const ready = await page.waitForFunction(
      () => globalThis.DenizenVisitorSession?.getSessionId?.() || null,
      { timeout: 5000 },
    ).then(() => true).catch(() => false);
    if (ready) return { method: 'existing_session' };
  }

  // Legacy builds still expose CEO quick path
  const legacyCeo = page.locator('[data-action="path-ceo"]');
  if (await legacyCeo.count() && !password && !username) {
    await legacyCeo.click({ timeout: 15_000 });
    await page.locator('#denizen-visitor-code-input').fill(DEFAULTS.ceoCode);
    await page.locator('[data-action="submit-ceo-code"]').click({ timeout: 15_000 });
    await waitForSessionReady(page, timeoutMs);
    return { method: 'legacy_ceo' };
  }

  await page.locator('[data-action="path-login"]').click({ timeout: 15_000 });
  await page.waitForSelector('#denizen-visitor-username-input', { timeout: 10_000 });

  const emailInput = page.locator('#denizen-visitor-email-input');
  if (username) await page.locator('#denizen-visitor-username-input').fill(username);
  if (password) await page.locator('#denizen-visitor-password-input').fill(password);
  if (teamCode) await page.locator('#denizen-visitor-team-code-input').fill(teamCode);
  else if (email && await emailInput.count() && await emailInput.isVisible()) {
    await emailInput.fill(email);
  }

  await page.locator('[data-action="submit-login"]').click({ timeout: 15_000 });

  // Name step if server needs display name
  const nameInput = page.locator('#denizen-visitor-name-input');
  if (await nameInput.count() && await nameInput.isVisible()) {
    await nameInput.fill(username || 'Probe User');
    await page.locator('[data-action="submit-name"]').click({ timeout: 15_000 });
  }

  await dismissLoginModal(page, timeoutMs);
  await waitForSessionReady(page, timeoutMs);
  return { method: 'unified_login' };
}

export async function loginOwnerViaApi(page, baseUrl, opts = {}) {
  const url = String(opts.baseUrl || baseUrl || process.env.DENIZEN_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
  const username = opts.username || DEFAULTS.username;
  const password = opts.password || DEFAULTS.password;
  const teamCode = opts.teamCode || DEFAULTS.teamCode;
  const email = opts.email || DEFAULTS.email;
  if (!password) throw new Error('PROBE_OWNER_PASS required for API login');

  const loginRes = await page.request.post(`${url}/api/visitor/auth/login`, {
    data: { username, password, team_code: teamCode, email: email || undefined },
  });
  const login = await loginRes.json();
  if (!login.ok) throw new Error(login.error || `login failed (${loginRes.status()})`);

  const isOwner = login.tier === 'ceo' || !!login.ceo_grant || !!login.is_owner;
  const headers = {
    'X-Display-Name': login.display_name || username,
    'X-Access-Grant': login.access_grant,
    'X-Org-Slug': login.org_slug || 'zion',
    'X-Access-Method': isOwner ? 'ceo' : 'website_login',
    'X-Email': login.identity?.email || email,
  };
  if (login.ceo_grant) headers['X-Denizen-Ceo-Grant'] = login.ceo_grant;

  const sessRes = await page.request.get(`${url}/api/visitor/session/open`, { headers });
  const sess = await sessRes.json();
  const sessionId = sess.session?.id || sess.session_id;
  const sessionToken = sess.session_token;
  if (!sessionId || !sessionToken) throw new Error(sess.error || 'session open failed');

  await page.goto(`${url}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.evaluate(({ login, sessionId, sessionToken, isOwner }) => {
    if (login.ceo_grant) localStorage.setItem('denizen-ceo-grant', login.ceo_grant);
    localStorage.setItem('denizen-onboarding-seen', '1');
    localStorage.setItem('denizen-visitor-session', JSON.stringify({
      session_id: sessionId,
      session_token: sessionToken,
      display_name: login.display_name,
      tier: login.tier,
      org_slug: login.org_slug,
      email: login.identity?.email,
    }));
    localStorage.setItem('denizen-role', isOwner ? 'ceo' : (login.tier || 'team'));
  }, { login, sessionId, sessionToken, isOwner });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitForSessionReady(page, opts.timeoutMs || 45_000);
  return { method: 'api_login' };
}

export async function loginOwner(page, opts = {}) {
  const baseUrl = opts.baseUrl || process.env.DENIZEN_URL;
  const password = opts.password || DEFAULTS.password;
  if (baseUrl && password) {
    try {
      return await loginOwnerViaApi(page, baseUrl, opts);
    } catch (err) {
      console.warn('[probe-login] API login failed, trying UI:', err?.message || err);
    }
  }
  return loginUnified(page, {
    username: opts.username || DEFAULTS.username,
    password: opts.password || DEFAULTS.password,
    teamCode: opts.teamCode || DEFAULTS.teamCode,
    email: opts.email || DEFAULTS.email,
    timeoutMs: opts.timeoutMs,
  });
}

export async function loginDemo(page, {
  username = 'demouser',
  password = process.env.PROBE_DEMO_PASS || 'demo1234',
  timeoutMs = 30_000,
} = {}) {
  if (await page.locator('#denizen-visitor-name-modal').count() === 0) {
    await waitForSessionReady(page, 5000);
    return { method: 'existing_session' };
  }
  await page.locator('[data-action="path-demo"]').click({ timeout: 15_000 });
  const emailInput = page.locator('#denizen-visitor-email-input');
  if (await emailInput.count()) {
    await emailInput.fill(`probe+${Date.now()}@example.com`);
    await page.locator('[data-action="submit-demo-email"]').click({ timeout: 15_000 });
  }
  const nameInput = page.locator('#denizen-visitor-name-input');
  if (await nameInput.count()) {
    await nameInput.fill(username);
    await page.locator('[data-action="submit-name"]').click({ timeout: 15_000 });
  }
  await waitForSessionReady(page, timeoutMs);
  return { method: 'demo' };
}

export async function joinTeamProbe(page, {
  teamCode = DEFAULTS.teamCode,
  username,
  email,
  password = 'ProbePass1!',
  timeoutMs = 30_000,
} = {}) {
  if (await page.locator('#denizen-visitor-name-modal').count() === 0) return;

  const legacyTeam = page.locator('[data-action="path-team"]');
  if (await legacyTeam.count()) {
    await legacyTeam.click({ timeout: 15_000 });
    await page.locator('#denizen-visitor-code-input').fill(teamCode);
    await page.locator('[data-action="submit-team-code"]').click({ timeout: 15_000 });
    return;
  }

  await page.locator('[data-action="path-login"]').click({ timeout: 15_000 });
  await page.locator('[data-action="goto-join-team"]').click({ timeout: 10_000 });
  await page.locator('#denizen-visitor-team-code-input').fill(teamCode);
  await page.locator('#denizen-visitor-username-input').fill(username);
  await page.locator('#denizen-visitor-email-input').fill(email);
  await page.locator('#denizen-visitor-password-input').fill(password);
  await page.locator('[data-action="submit-join-team"]').click({ timeout: 15_000 });
  await waitForSessionReady(page, timeoutMs);
}

export async function assertOwnerProfile(page) {
  const profile = await page.evaluate(() => {
    const p = globalThis.DenizenVisitorSession?.getProfile?.() || {};
    const ceo = globalThis.DenizenVisitorSession?.isCeoPrincipal?.() || false;
    return {
      tier: p.tier,
      teamRole: p.teamRole,
      canApproveSkills: p.canApproveSkills,
      isCeoPrincipal: ceo,
    };
  });
  const isOwner = profile.isCeoPrincipal
    || profile.tier === 'ceo'
    || profile.teamRole === 'owner'
    || profile.canApproveSkills;
  return { ok: !!isOwner, profile };
}
