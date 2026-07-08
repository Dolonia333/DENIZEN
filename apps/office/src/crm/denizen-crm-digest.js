'use strict';

const crmStore = require('./denizen-crm-store');
const { sendResendEmail } = require('../visitors/visitor-notify');
const denizenDb = require('../intelligence/denizen-db');
const npcStats = require('../office-hq/denizen-npc-stats');
const officeProgress = require('../office-hq/denizen-office-progress');

function fmt(n) {
  return `$${Number(n || 0).toLocaleString()}`;
}

function buildOfficeStatsSection() {
  const leaderboard = npcStats.getLeaderboard({ period: 'week' });
  const streaks = npcStats.getStreaks();
  const progress = officeProgress.getProgress();
  const top = leaderboard.filter((r) => r.shipped > 0).slice(0, 3);
  const totalShipped = leaderboard.reduce((s, r) => s + r.shipped, 0);

  const lines = [
    '',
    'This week in your office',
    `Level ${progress.level}${progress.xpForNextLevel != null ? ` · ${progress.xpIntoLevel}/${progress.xpForNextLevel} XP to next level` : ' (max level)'}`,
    `Tasks shipped office-wide: ${totalShipped}`,
  ];
  if (top.length) {
    lines.push('Top shippers:');
    top.forEach((r) => lines.push(`• ${r.npcName} — ${r.shipped} shipped${r.streakDays > 0 ? ` (${r.streakDays}d streak)` : ''}`));
  }
  if (streaks.length) {
    lines.push(`Active streaks: ${streaks.map((s) => `${s.npcName} (${s.streakDays}d)`).join(', ')}`);
  }
  return lines;
}

function buildWeeklyDigest(state) {
  const deals = Array.isArray(state?.deals) ? state.deals : [];
  const contacts = Array.isArray(state?.contacts) ? state.contacts : [];
  const tasks = Array.isArray(state?.tasks) ? state.tasks : [];
  const open = deals.filter((d) => !/closed (won|lost)/i.test(String(d.stage || '')));
  const won = deals.filter((d) => /closed won/i.test(String(d.stage || '')));
  const wonValue = won.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const pipeline = open.reduce((s, d) => s + (Number(d.value) || 0), 0);
  const overdue = tasks.filter((t) => !t.done && t.due && new Date(t.due) < new Date());
  const atRisk = open.filter((d) => d.health === 'at-risk');

  const lines = [
    'Weekly recap',
    '',
    `Pipeline: ${fmt(pipeline)} across ${open.length} open deals`,
    `Won (all time in workspace): ${won.length} deals · ${fmt(wonValue)}`,
    `Contacts: ${contacts.length}`,
    `Overdue tasks: ${overdue.length}`,
    `At-risk deals: ${atRisk.length}`,
  ];
  if (atRisk.length) {
    lines.push('', 'At-risk:');
    atRisk.slice(0, 5).forEach((d) => lines.push(`• ${d.title} (${d.stage})`));
  }
  lines.push(...buildOfficeStatsSection());
  return lines.join('\n');
}

async function sendWeeklyDigestsForOrg(orgId) {
  const row = await crmStore.getWorkspace(orgId);
  const state = row?.state || {};
  const prefs = state.userPrefs && typeof state.userPrefs === 'object' ? state.userPrefs : {};
  const notif = prefs.notifications && typeof prefs.notifications === 'object' ? prefs.notifications : {};
  if (notif.weeklyDigest === false) return { ok: true, skipped: true };

  const profile = prefs.profile && typeof prefs.profile === 'object' ? prefs.profile : {};
  const email = String(profile.email || '').trim();
  if (!email) return { ok: true, skipped: true, reason: 'no_email' };

  const body = buildWeeklyDigest(state);
  const result = await sendResendEmail({
    to: email,
    subject: 'Your weekly recap',
    text: body,
  });
  return { ok: !!result.ok, email, result };
}

async function tickWeeklyDigests(log) {
  if (!denizenDb.enabled) return;
  const day = new Date().getDay();
  const hour = new Date().getHours();
  if (day !== 1 || hour !== 9) return;

  const weekKey = new Date().toISOString().slice(0, 10);
  if (tickWeeklyDigests._sentWeek === weekKey) return;
  tickWeeklyDigests._sentWeek = weekKey;

  const rows = await denizenDb._get('denizen_crm_workspaces?select=org_id&limit=200').catch(() => []);
  for (const row of rows || []) {
    try {
      await sendWeeklyDigestsForOrg(row.org_id);
    } catch (err) {
      log?.warn?.('[CrmDigest]', row.org_id, err?.message || err);
    }
  }
}

module.exports = {
  buildWeeklyDigest,
  buildOfficeStatsSection,
  sendWeeklyDigestsForOrg,
  tickWeeklyDigests,
};
