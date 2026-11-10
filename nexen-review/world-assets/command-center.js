// The command center reads existing records. Only a clicked checklist control changes one.
const $ = id => document.getElementById(id);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const short = (value, max = 150) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
let refreshing = false;
let daySaving = false;
let dayRecords = [];

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}

async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      credentials: 'same-origin', signal: controller.signal,
      ...(body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Nexen-Action': 'launch' },
        body: JSON.stringify(body)
      })
    });
    if (response.status === 401 || new URL(response.url).pathname === '/login') {
      location.assign('/login');
      throw Error('NEXEN is locked. Sign in to continue.');
    }
    if (!response.ok) throw Error(`The workspace did not respond (${response.status}).`);
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw Error('The workspace is taking longer to respond. Refresh to check again.');
    throw error;
  } finally { clearTimeout(timeout); }
}

function unavailable(id, text) {
  const target = $(id);
  target.replaceChildren(node('div', 'empty compact', text));
}

function renderTasks(data) {
  if (!Array.isArray(data.tasks)) throw Error('Task records are unavailable.');
  const statuses = data.counts && typeof data.counts === 'object' ? data.counts : {};
  const countsValid = Object.values(statuses).length && Object.values(statuses).every(n => count(n) !== null);
  const total = countsValid ? Object.values(statuses).reduce((a, b) => a + b, 0) : null;
  const done = countsValid ? (statuses.done || 0) : null;
  const open = total === null ? count(data.total) : total - done;
  $('tasks-link-status').textContent = open === null ? 'Priorities and follow-ups' : `${plural(open, 'open task')}`;
  const blocked = count(statuses.blocked);
  $('tasks-summary').textContent = total === null ? 'Showing available records. Open the task room for full history.' : `${plural(open, 'open task')} · ${done.toLocaleString()} marked done${blocked ? ' · ' + blocked.toLocaleString() + ' blocked' : ''}`;
  const visible = data.tasks.filter(t => t && t.status !== 'done' && (t.status === 'blocked' || t.priority === 'urgent'));
  const weight = t => (t.pinned ? 10 : 0) + (t.priority === 'urgent' ? 5 : 0) + (t.status === 'blocked' ? 3 : 0);
  visible.sort((a, b) => weight(b) - weight(a));
  const list = $('attention-list');
  list.replaceChildren();
  for (const task of visible.slice(0, 4)) {
    const row = node('a', `attention-item ${task.status === 'blocked' ? 'blocked' : 'urgent'}`);
    row.href = '/tasks';
    row.append(node('span', 'attention-dot'));
    const words = node('div', 'attention-copy');
    words.append(node('h3', '', short(task.text, 105) || 'Saved task'));
    words.append(node('p', '', short(task.next_step, 145) || 'Open the task to review its next step.'));
    row.append(words, node('span', 'task-label', task.status === 'blocked' ? 'Blocked' : 'Urgent'));
    list.append(row);
  }
  if (!visible.length) list.append(node('div', 'empty compact', 'No urgent or blocked items in these task records. Open your task room to choose the next step.'));
  const rent = data.tasks.find(t => t && t.status !== 'done' && /\b(rent|housing|eviction|notice)\b/i.test(String(t.text)));
  $('rent-record-state').textContent = rent ? `Recorded: ${short(rent.status, 25).replaceAll('_', ' ')}${rent.next_step ? ' · ' + short(rent.next_step, 115) : '. Review the next step in your task room.'}` : 'Track the notice deadline and each contact outcome in your task room.';
}

function renderDay(data) {
  if (!Array.isArray(data.items) || count(data.total) === null || count(data.completed) === null) throw Error('Daily checklist unavailable.');
  dayRecords = data.items;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(data.day) ? new Date(`${data.day}T12:00:00`) : null;
  $('day-date').textContent = day ? day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }) : 'Your saved daily checklist';
  $('day-completion').textContent = `${data.completed} of ${data.total} completed`;
  const progress = $('day-progress');
  progress.max = Math.max(1, data.total);
  progress.value = Math.min(data.completed, data.total);
  const list = $('today-items');
  list.replaceChildren();
  for (const item of dayRecords.slice(0, 5)) {
    const row = node('div', `today-item${item.completed ? ' done' : ''}`);
    const check = node('button', 'day-check', item.completed ? '✓' : '');
    check.type = 'button';
    check.setAttribute('aria-pressed', String(Boolean(item.completed)));
    check.setAttribute('aria-label', `${item.completed ? 'Mark incomplete' : 'Mark complete'}: ${short(item.title, 130)}`);
    check.disabled = daySaving;
    check.addEventListener('click', () => markDay(item, check));
    const words = node('div');
    words.append(node('div', 'day-title', short(item.title, 100)));
    words.append(node('div', 'day-time', short(item.scheduled_time, 30) || 'Any time today'));
    const open = node('a', 'day-open', '↗');
    open.href = '/day';
    open.setAttribute('aria-label', `Open daily plan: ${short(item.title, 100)}`);
    row.append(check, words, open);
    list.append(row);
  }
  if (!dayRecords.length) list.append(node('div', 'empty compact', 'Your daily plan has no checklist items yet.'));
  if (dayRecords.length > 5) list.append(node('div', 'sourcecount', `${dayRecords.length - 5} more in your daily plan.`));
}

async function markDay(item, button) {
  if (daySaving || !Number.isSafeInteger(item.id) || item.id < 1) return;
  daySaving = true;
  document.querySelectorAll('.day-check').forEach(b => { b.disabled = true; });
  $('day-feedback').textContent = 'Saving your checklist mark…';
  try {
    const data = await request(`/api/day/${item.id}`, { completed: !item.completed });
    daySaving = false;
    renderDay(data);
    $('day-feedback').textContent = 'Saved. This marks your progress; it does not run the task.';
  } catch (error) {
    $('day-feedback').textContent = `${error.message} The checklist mark was not confirmed.`;
    button.focus();
  } finally {
    daySaving = false;
    document.querySelectorAll('.day-check').forEach(b => { b.disabled = false; });
  }
}

function renderPhotos(data) {
  const total = count(data.total), pending = count(data.pending_analysis);
  if (total === null || pending === null) throw Error('Photo queue unavailable.');
  $('photos-link-status').textContent = `${plural(total, 'photo')} · ${pending} awaiting analysis`;
  $('photo-queue-summary').textContent = pending ? `${plural(pending, 'photo')} awaiting visual analysis. Captions can create plans.` : 'No photos awaiting analysis in this queue. Use Show a problem for a new local model request.';
}

function renderLife(data) {
  $('route-readiness').textContent = data.model_routing === 'local_only' ? 'Life problem requests use local models. Cloud handoff has not been verified.' : 'Open provider checks to verify the current route. Automatic handoff is not confirmed.';
  // A listening port or a configured device is not evidence of authenticated phone access.
  $('phone-readiness').textContent = data.mobile_access === 'verified' ? 'Private phone access reported verified by the service.' : 'Private phone access needs verification. Use this PC while setup is checked.';
  $('mobile-dot').className = `ready-dot ${data.mobile_access === 'verified' ? 'ready' : 'pending'}`;
  $('mobile-state').textContent = data.model_routing === 'local_only' ? 'Shared context · local model checks' : 'Models and shared context';
}

async function refreshFront() {
  if (refreshing) return;
  refreshing = true;
  const operations = [
    [request('/api/tasks?include_done=false&limit=200'), renderTasks, () => {
      unavailable('attention-list', 'The task room is unavailable. Open it directly or refresh to retry.');
      $('tasks-link-status').textContent = 'Task status unavailable';
      $('tasks-summary').textContent = 'No task counts have been confirmed.';
      $('rent-record-state').textContent = 'Recorded rent progress is unavailable. Open your task room to check it.';
    }],
    [request('/api/day'), data => { if (!daySaving) renderDay(data); }, () => {
      if (!daySaving) {
        unavailable('today-items', 'Your daily plan is unavailable. Open the checklist or refresh to retry.');
        $('day-date').textContent = 'Checklist not connected';
        $('day-completion').textContent = 'Progress unavailable';
        $('day-progress').value = 0;
      }
    }],
    [request('/api/photos/queue?limit=1'), renderPhotos, () => {
      $('photos-link-status').textContent = 'Photo status unavailable';
      $('photo-queue-summary').textContent = 'The photo queue could not be checked. Open photos to retry.';
    }],
    [request('/api/life/status'), renderLife, () => {
      $('route-readiness').textContent = 'Local model readiness could not be checked. Open provider checks.';
      $('phone-readiness').textContent = 'Private phone access is not yet verified.';
    }]
  ];
  try {
    await Promise.allSettled(operations.map(async ([promise, render, failure]) => {
      try { render(await promise); } catch { failure(); }
    }));
  } finally { refreshing = false; }
}

const resources = $('front-resources');
document.addEventListener('click', async event => {
  const control = event.target.closest('[data-front]');
  if (!control) return;
  if (control.dataset.front === 'resources' && !resources.open) resources.showModal();
  if (control.dataset.front === 'close-resources') resources.close();
  if (control.dataset.front === 'tv') {
    try {
      const tv = window.NexenCinema || $('gameframe').contentWindow.NexenCinema;
      if (tv?.open) { tv.open(); return; }
    } catch { /* The embedded game can still be loading. */ }
    $('commandfeedback').textContent = 'The TV controls are still loading. Enter WDR City and use its TV button, or try again after the game loads.';
    $('commandfeedback').scrollIntoView({ block: 'center' });
  }
  if (control.dataset.front === 'lock') {
    control.disabled = true;
    try {
      await request('/api/auth/logout', {});
      location.assign('/login');
    } catch (error) {
      control.disabled = false;
      $('commandfeedback').textContent = `Lock was not confirmed. ${error.message}`;
      $('commandfeedback').scrollIntoView({ block: 'center' });
    }
  }
});
resources.addEventListener('click', event => {
  if (event.target === resources) {
    const box = resources.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) resources.close();
  }
});
document.querySelectorAll('[data-action="refresh"]').forEach(button => button.addEventListener('click', refreshFront));
const hashViews = new Set(['memory', 'store', 'requests', 'music', 'control', 'digest', 'skills', 'ai', 'map', 'guide']);
function openHash() {
  const view = location.hash.slice(1);
  if (hashViews.has(view)) document.querySelector(`[data-action="${view}"]`)?.click();
}
window.addEventListener('hashchange', openHash);
window.addEventListener('pageshow', event => { if (event.persisted) refreshFront(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFront(); });
refreshFront();
openHash();
setInterval(() => { if (!document.hidden) refreshFront(); }, 60000);
