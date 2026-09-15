'use strict';

/**
 * Studio Board automations — evaluated server-side after mutations.
 * Cascade depth capped to avoid loops.
 */

const activity = require('./denizen-studio-board-activity');

const MAX_DEPTH = 3;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function listAutomations(state) {
  const list = state?.config?.automations;
  return Array.isArray(list) ? list : [];
}

function matchWhen(rule, ctx) {
  if (!rule || rule.enabled === false) return false;
  const when = rule.when || {};
  const type = String(when.type || '');
  if (type === 'status_changed') {
    if (ctx.kind !== 'status_changed') return false;
    if (when.to && String(when.to) !== String(ctx.to)) return false;
    if (when.from && String(when.from) !== String(ctx.from)) return false;
    return true;
  }
  if (type === 'field_changed') {
    if (ctx.kind !== 'field_changed') return false;
    if (when.column_id && String(when.column_id) !== String(ctx.columnId)) return false;
    return true;
  }
  if (type === 'due_passed') {
    return ctx.kind === 'due_passed';
  }
  return false;
}

function findPerson(state, idOrName) {
  const q = String(idOrName || '').trim().toLowerCase();
  if (!q) return null;
  const people = state.people || [];
  return people.find((p) => String(p.id) === q)
    || people.find((p) => String(p.name || '').toLowerCase() === q)
    || null;
}

function applyActions(state, task, actions, who, depth) {
  const fired = [];
  for (const action of actions || []) {
    const type = String(action.type || '');
    if (type === 'notify_assignee') {
      const assignee = findPerson(state, task.assignee);
      if (assignee) {
        const note = {
          id: uid(),
          from: 'automation',
          to: assignee.id,
          text: String(action.text || `Update on “${task.title}”`).slice(0, 2000),
          ts: Date.now(),
          read: false,
        };
        state.notes = [...(state.notes || []), note];
        activity.appendActivity(state, {
          who,
          text: `Automation notified ${assignee.name}`,
          taskId: task.id,
          title: task.title,
          kind: 'automation',
        });
        fired.push({ type, to: assignee.id });
      }
    } else if (type === 'move_group') {
      const gid = action.group_id || action.groupId;
      if (gid) {
        task.groupId = gid;
        activity.appendActivity(state, {
          who,
          text: `Automation moved group → ${gid}`,
          taskId: task.id,
          title: task.title,
          kind: 'automation',
        });
        fired.push({ type, group_id: gid });
      }
    } else if (type === 'set_field') {
      const col = action.column_id || action.columnId;
      if (col) {
        task.fields = task.fields && typeof task.fields === 'object' ? task.fields : {};
        task.fields[col] = action.value;
        fired.push({ type, column_id: col });
      }
    } else if (type === 'set_status' || type === 'set_field_status') {
      const next = action.status || action.value;
      if (next && next !== task.status) {
        const from = task.status;
        task.status = next;
        task.statusSince = todayISO();
        activity.appendActivity(state, {
          who,
          text: `Automation status: ${from} → ${next}`,
          taskId: task.id,
          title: task.title,
          kind: 'automation',
        });
        fired.push({ type: 'set_status', status: next });
        // nested status change may cascade
        if (depth < MAX_DEPTH) {
          const nested = runRules(state, {
            kind: 'status_changed',
            task,
            from,
            to: next,
            who,
          }, depth + 1);
          fired.push(...nested);
        }
      }
    } else if (type === 'add_comment') {
      task.comments = Array.isArray(task.comments) ? task.comments : [];
      task.comments.push({
        id: uid(),
        ts: Date.now(),
        who,
        text: String(action.text || action.comment || 'Automated note').slice(0, 2000),
      });
      activity.appendActivity(state, {
        who,
        text: 'Automation added a comment',
        taskId: task.id,
        title: task.title,
        kind: 'automation',
      });
      fired.push({ type });
    } else if (type === 'create_followup') {
      const follow = {
        id: uid(),
        title: String(action.title || `Follow-up: ${task.title}`).slice(0, 200),
        client: task.client || '',
        type: task.type || 'general',
        assignee: action.assignee || task.assignee || null,
        status: action.status || (state.config?.stages?.[0]?.id || 'backlog'),
        priority: task.priority || 'normal',
        due: action.due || null,
        notes: String(action.notes || `Follow-up from ${task.id}`).slice(0, 4000),
        statusSince: todayISO(),
        groupId: action.group_id || task.groupId || null,
        fields: {},
        log: [{ ts: Date.now(), who, text: 'Created by automation' }],
        comments: [],
        subtasks: [],
        remind: true,
      };
      state.tasks = [...(state.tasks || []), follow];
      activity.appendActivity(state, {
        who,
        text: `Automation created follow-up “${follow.title}”`,
        taskId: follow.id,
        title: follow.title,
        kind: 'automation',
      });
      fired.push({ type, task_id: follow.id });
    }
    // webhook stub — recorded only
    else if (type === 'webhook') {
      activity.appendActivity(state, {
        who,
        text: `Automation webhook stub → ${String(action.url || '').slice(0, 80)}`,
        taskId: task?.id,
        title: task?.title,
        kind: 'automation',
      });
      fired.push({ type, stub: true });
    }
  }
  return fired;
}

function runRules(state, ctx, depth = 0) {
  if (!state || !ctx?.task || depth > MAX_DEPTH) return [];
  const who = ctx.who || 'Automation';
  const fired = [];
  for (const rule of listAutomations(state)) {
    if (!matchWhen(rule, ctx)) continue;
    const part = applyActions(state, ctx.task, rule.then || [], who, depth);
    if (part.length) {
      activity.appendActivity(state, {
        who,
        text: `Ran automation “${rule.name || rule.id}”`,
        taskId: ctx.task.id,
        title: ctx.task.title,
        kind: 'automation',
      });
      fired.push({ rule_id: rule.id, actions: part });
    }
  }
  return fired;
}

/** Sweep open tasks whose due date is before today. */
function sweepDuePassed(state, who = 'Automation') {
  const today = todayISO();
  const fired = [];
  const stages = state.config?.stages || [];
  const isFinal = (statusId) => {
    const s = stages.find((x) => x.id === statusId);
    return !!(s && s.final);
  };
  for (const task of state.tasks || []) {
    if (!task?.due || isFinal(task.status)) continue;
    if (String(task.due) >= today) continue;
    if (task._duePassedAt === task.due) continue; // already swept for this due
    const part = runRules(state, {
      kind: 'due_passed',
      task,
      who,
    }, 0);
    if (part.length) {
      task._duePassedAt = task.due;
      fired.push(...part);
    }
  }
  return fired;
}

module.exports = {
  MAX_DEPTH,
  listAutomations,
  runRules,
  sweepDuePassed,
  matchWhen,
};
