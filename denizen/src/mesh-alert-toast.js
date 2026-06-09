/**
 * Mesh / ops alert toasts — desktop-linked / CEO users.
 */
(function () {
  'use strict';

  const TOAST_ID = 'denizen-mesh-alert-toast';
  let hideTimer = null;

  function caps() {
    return globalThis.DenizenVisitorCapabilities || {};
  }

  function canSee() {
    return !!caps().canSeeMeshDashboard?.() || !!caps().isCeo?.();
  }

  function ensureToast() {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      el.setAttribute('role', 'status');
      el.style.cssText = `
        position:fixed;left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));
        bottom:calc(var(--denizen-dock-height,56px) + 72px + env(safe-area-inset-bottom));
        z-index:100140;max-width:420px;margin:0 auto;display:none;
        background:rgba(69,10,10,0.96);border:1px solid #f87171;border-radius:10px;
        padding:10px 12px;font:11px/1.45 ui-monospace,Menlo,monospace;color:#fecaca;
        box-shadow:0 12px 28px rgba(0,0,0,0.45);pointer-events:auto;
      `;
      document.body.appendChild(el);
    }
    return el;
  }

  function showToast(title, body, tone) {
    if (!canSee()) return;
    const el = ensureToast();
    const border = tone === 'info' ? '#38bdf8' : tone === 'ok' ? '#4ade80' : '#f87171';
    const bg = tone === 'info' ? 'rgba(8,47,73,0.96)' : tone === 'ok' ? 'rgba(5,46,22,0.96)' : 'rgba(69,10,10,0.96)';
    el.style.borderColor = border;
    el.style.background = bg;
    el.innerHTML = `<b>${title}</b><br>${body}`;
    el.style.display = 'block';
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { el.style.display = 'none'; }, 12000);
    globalThis.DenizenMeshJobs?.refresh?.();
  }

  function showAlerts(detail) {
    const alerts = detail?.alerts || [];
    if (!alerts.length) return;
    const top = alerts[0];
    const more = alerts.length > 1 ? ` (+${alerts.length - 1} more)` : '';
    showToast('Mesh watchdog', `${top.message || top.code || 'alert'}${more}`, 'warn');
  }

  function onWsMessage(ev) {
    const msg = ev.detail;
    if (!msg) return;
    if (msg.type === 'mesh_watchdog_alert') {
      showAlerts(msg);
      return;
    }
    if (msg.type === 'mesh_scale_action') {
      const label = String(msg.action || 'scale').replace(/_/g, ' ');
      showToast('Auto-scale', msg.summary || `${label} ${msg.ok ? 'ok' : 'failed'}`, msg.ok ? 'ok' : 'warn');
      return;
    }
    if (msg.type === 'resource_pressure_alert') {
      const pressures = (msg.pressures || []).join(', ');
      showToast('Resource pressure', `${msg.severity || 'alert'}: ${pressures}`, 'warn');
      return;
    }
    if (msg.type === 'health_runbook_complete') {
      const issues = (msg.issues || []).join(', ') || 'none';
      showToast('Health runbook', msg.ok ? 'All checks passed' : `Issues: ${issues}`, msg.ok ? 'ok' : 'warn');
      return;
    }
    if (msg.type === 'health_runbook_progress' && msg.phase === 'remediate') {
      showToast('Health runbook', `Remediating: ${msg.action || 'action'}`, 'info');
    }
  }

  function init() {
    document.addEventListener('denizen-ws-message', onWsMessage);
  }

  globalThis.DenizenMeshAlertToast = { showAlerts, showToast };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
