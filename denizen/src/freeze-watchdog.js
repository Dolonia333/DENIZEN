/**
 * Freeze watchdog — detects stuck input and auto-recovers.
 */
(function () {
  'use strict';

  const LOG_MAX = 96;
  const STUCK_MS = 800;
  const log = [];
  let lastSample = { x: 0, y: 0, t: 0, keys: false };
  let lastRecoverAt = 0;

  function wantsMove() {
    const r = window.__DenizenRawMoveKeys || {};
    return !!(r.up || r.down || r.left || r.right);
  }

  function snapshot() {
    const sc = window.game?.scene?.scenes?.[0];
    const p = sc?.player;
    const loop = window.game?.loop;
    return {
      t: Date.now(),
      moveFix: window.__DenizenMoveFix || 'missing',
      lightOffice: window.__DenizenLightOffice !== false,
      inputEnabled: window.game?.input?.enabled,
      modalOpen: document.documentElement.dataset.denizenModal === 'open',
      loopPaused: !!loop?.isPaused,
      playerLocked: sc?.playerLocked,
      playerOnPhone: sc?._playerOnPhone,
      playerSitting: sc?._playerSitting,
      pos: p ? { x: Math.round(p.x), y: Math.round(p.y) } : null,
      vel: p?.body ? { x: p.body.velocity?.x, y: p.body.velocity?.y } : null,
      wantsMove: wantsMove(),
    };
  }

  function recover(reason) {
    const now = Date.now();
    if (now - lastRecoverAt < 400) return;
    lastRecoverAt = now;
    try { window.DenizenUnlockMovement?.(); } catch (_) {}
    try { window.DenizenMovementGuard?.unlock?.(); } catch (_) {}
    const sc = window.game?.scene?.scenes?.[0];
    if (sc) {
      sc._playerOnPhone = false;
      sc._playerSitting = false;
      sc.playerLocked = false;
      sc.playerState = 'walk';
      try { sc._applyRawKeyMovement?.(); } catch (_) {}
      try { window.DenizenMovementGuard?.directNudge?.(sc); } catch (_) {}
    }
    try {
      if (window.game?.input) window.game.input.enabled = true;
      window.game?.input?.keyboard?.enableGlobalCapture?.();
      window.game?.loop?.resume?.();
      window.game?.canvas?.focus?.({ preventScroll: true });
    } catch (_) {}
    console.warn('[FreezeWatchdog] auto-recovered:', reason);
    log.push({ recover: reason, ...snapshot() });
  }

  setInterval(() => {
    const s = snapshot();
    log.push(s);
    if (log.length > LOG_MAX) log.shift();

    if (wantsMove() && s.pos) {
      const moved = Math.hypot(s.pos.x - lastSample.x, s.pos.y - lastSample.y);
      if (lastSample.keys && moved < 3 && (s.t - lastSample.t) >= STUCK_MS) {
        recover('keys-held-no-move');
      }
      lastSample = { x: s.pos.x, y: s.pos.y, t: s.t, keys: true };
    } else if (s.pos) {
      lastSample = { x: s.pos.x, y: s.pos.y, t: s.t, keys: false };
    }
  }, 1000);

  window.__DenizenFreezeLog = log;
  window.DenizenFreezeLog = () => log.slice();
  console.log('[Denizen] movement fix', window.__DenizenMoveFix || '?', '+ freeze-watchdog v7', '+ light-office', window.__DenizenLightOffice !== false);
})();
