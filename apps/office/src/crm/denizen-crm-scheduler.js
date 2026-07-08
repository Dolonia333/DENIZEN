'use strict';



const crmStore = require('./denizen-crm-store');

const { findOverdueTasks, pipelineBriefForOrg } = require('./denizen-crm-handoffs');

const { tickSequences } = require('./denizen-crm-sequences');

const { tickWeeklyDigests } = require('./denizen-crm-digest');

const { appendDailySnapshot } = require('./denizen-crm-metrics');

const { applyServerAutomations } = require('./denizen-crm-automations');

const crmSetup = require('./denizen-crm-setup');

const denizenDb = require('../intelligence/denizen-db');

const _overdueSent = new Map();

const _briefSent = new Map();

const _atRiskSent = new Map();

const _ticketSlaSent = new Map();

const _setupNudgeSent = new Map();



function startCrmScheduler(deps = {}) {

  const broadcastToOffice = deps.broadcastToOffice;

  const log = deps.log || console;

  const orgId = () => denizenDb.orgId;



  async function tick() {

    if (!denizenDb.enabled || !orgId()) return;

    const oid = orgId();

    try {

      const row = await crmStore.getWorkspace(oid);

      const state = row?.state || {};



      if (crmSetup.shouldNotify(state, 'task-overdue')) {

        const overdue = findOverdueTasks(state);

        for (const task of overdue.slice(0, 20)) {

          const key = `${oid}:${task.id}:${task.due}`;

          if (_overdueSent.has(key)) continue;

          _overdueSent.set(key, Date.now());

          if (typeof broadcastToOffice === 'function') {

            broadcastToOffice(oid, {

              type: 'crm_event',

              kind: 'task-overdue',

              npcName: crmSetup.notificationNpcForKind('task-overdue'),

              title: task.title,

              due: task.due,

              contact: task.contact,

              at: new Date().toISOString(),

            });

          }

        }

      }



      if (crmSetup.shouldNotify(state, 'at-risk')) {

        const deals = Array.isArray(state.deals) ? state.deals : [];

        const atRisk = deals.filter((d) => d?.health === 'at-risk'

          && !/closed won|closed lost/i.test(String(d.stage || '')));

        for (const deal of atRisk.slice(0, 10)) {

          const key = `${oid}:at-risk:${deal.id}`;

          if (_atRiskSent.has(key)) continue;

          _atRiskSent.set(key, Date.now());

          if (typeof broadcastToOffice === 'function') {

            broadcastToOffice(oid, {

              type: 'crm_event',

              kind: 'at-risk',

              npcName: crmSetup.notificationNpcForKind('at-risk'),

              title: deal.title,

              contact: deal.contact,

              value: deal.value,

              stage: deal.stage,

              at: new Date().toISOString(),

            });

          }

        }

      }



      if (crmSetup.shouldNotify(state, 'ticket-overdue')) {

        const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [];

        const today = new Date().toISOString().slice(0, 10);

        const overdue = tickets.filter((t) => t

          && (t.status === 'open' || t.status === 'pending')

          && t.slaDue && String(t.slaDue) < today);

        for (const ticket of overdue.slice(0, 15)) {

          const key = `${oid}:ticket-sla:${ticket.id}:${ticket.slaDue}`;

          if (_ticketSlaSent.has(key)) continue;

          _ticketSlaSent.set(key, Date.now());

          if (typeof broadcastToOffice === 'function') {

            broadcastToOffice(oid, {

              type: 'crm_event',

              kind: 'ticket-overdue',

              npcName: crmSetup.notificationNpcForKind('ticket-overdue'),

              title: ticket.subject,

              contact: ticket.contact,

              assignee: ticket.assignee,

              slaDue: ticket.slaDue,

              at: new Date().toISOString(),

            });

          }

        }

      }



      if (crmSetup.shouldNotify(state, 'team-inactive')) {

        const usageLog = Array.isArray(state.usageLog) ? state.usageLog : [];

        const policy = state.teamPolicy && typeof state.teamPolicy === 'object' ? state.teamPolicy : {};

        const days = Number(policy.nudgeInactiveDays) || 3;

        const cutoff = Date.now() - days * 86400000;

        const lastByUser = new Map();

        for (const entry of usageLog) {

          if (!entry?.user) continue;

          const prev = lastByUser.get(entry.user);

          if (!prev || entry.at > prev) lastByUser.set(entry.user, entry.at);

        }

        for (const [user, lastAt] of lastByUser) {

          if (new Date(lastAt).getTime() >= cutoff) continue;

          const key = `${oid}:inactive:${user}:${new Date().toISOString().slice(0, 7)}`;

          if (_inactiveSent.has(key)) continue;

          _inactiveSent.set(key, Date.now());

          if (typeof broadcastToOffice === 'function') {

            broadcastToOffice(oid, {

              type: 'crm_event',

              kind: 'team-inactive',

              npcName: crmSetup.notificationNpcForKind('team-inactive'),

              user,

              lastAt,

              at: new Date().toISOString(),

            });

          }

        }

      }



      let workingState = state;

      const seqResult = await tickSequences(workingState, 'Sequences');

      if (seqResult.changed) workingState = seqResult.state;



      const autoResult = await applyServerAutomations(workingState, workingState);

      if (autoResult.changed) workingState = autoResult.state;



      if (workingState !== state) {

        await crmStore.upsertWorkspace(oid, workingState, null, { skipAutomations: true });

      }



      await tickDailySnapshots(log);



      const hour = new Date().getHours();

      const briefKey = `${oid}:${new Date().toISOString().slice(0, 10)}`;

      await tickWeeklyDigests(log);



      if (hour === 8 && !_briefSent.has(briefKey) && crmSetup.shouldNotify(state, 'pipeline-brief')) {

        _briefSent.set(briefKey, Date.now());

        const summary = await pipelineBriefForOrg(oid);

        const setup = crmSetup.buildSetupSummary(state);

        const setupNote = setup.onboarding.completed < setup.onboarding.total

          ? ` Setup ${setup.onboarding.completed}/${setup.onboarding.total} — next: ${setup.onboarding.next?.label || 'review CRM'}.`

          : '';

        if (typeof broadcastToOffice === 'function' && summary) {

          broadcastToOffice(oid, {

            type: 'crm_event',

            kind: 'pipeline-brief',

            npcName: crmSetup.notificationNpcForKind('pipeline-brief'),

            text: `Morning CRM brief: ${summary}${setupNote}`,

            at: new Date().toISOString(),

          });

        }

      }

      const setupSummary = crmSetup.buildSetupSummary(state);
      const setupKey = `${oid}:setup:${new Date().toISOString().slice(0, 10)}`;
      if (hour === 10
        && !_setupNudgeSent.has(setupKey)
        && setupSummary.onboarding?.completed < setupSummary.onboarding?.total
        && crmSetup.shouldNotify(state, 'setup-reminder')) {
        _setupNudgeSent.set(setupKey, Date.now());
        const setupWizard = require('./denizen-crm-setup-wizard');
        const orgSlug = denizenDb.orgSlug || process.env.DENIZEN_ORG_SLUG || null;
        const nudge = setupWizard.buildSetupNudge(state, { orgSlug });
        if (nudge && typeof broadcastToOffice === 'function') {
          broadcastToOffice(oid, {
            type: 'crm_event',
            kind: 'setup-reminder',
            npcName: nudge.npcName,
            text: nudge.text,
            crm_actions: nudge.crm_actions,
            at: new Date().toISOString(),
          });
        }
      }

    } catch (err) {

      log.warn?.('[CrmScheduler]', err?.message || err);

    }

  }



  const timer = setInterval(tick, 5 * 60 * 1000);

  setTimeout(tick, 30_000);

  return { stop: () => clearInterval(timer) };

}



async function tickDailySnapshots(log) {

  if (!denizenDb.enabled) return;

  const hour = new Date().getHours();

  const dayKey = new Date().toISOString().slice(0, 10);

  if (hour !== 1) return;

  if (tickDailySnapshots._done === dayKey) return;

  tickDailySnapshots._done = dayKey;



  const rows = await denizenDb._get('denizen_crm_workspaces?select=org_id,state&limit=200').catch(() => []);

  for (const row of rows || []) {

    try {

      const snap = appendDailySnapshot(row.state || {});

      if (snap.changed) {

        await crmStore.upsertWorkspace(row.org_id, snap.state, null);

      }

    } catch (err) {

      log?.warn?.('[CrmScheduler] snapshot', row.org_id, err?.message || err);

    }

  }

}



module.exports = { startCrmScheduler, tickDailySnapshots };

