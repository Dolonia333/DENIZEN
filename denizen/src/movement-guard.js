/**
 * Movement guard — keeps player movement alive when Phaser input/physics stall.
 * Uses velocity first, then direct position nudge if the player still won't move.
 */
(function () {
  'use strict';

  if (!window.__DenizenRawMoveKeys) {
    window.__DenizenRawMoveKeys = { up: false, down: false, left: false, right: false };
    const map = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right',
    };
    const set = (e, on) => {
      const dir = map[e.key];
      if (!dir) return;
      window.__DenizenRawMoveKeys[dir] = on;
    };
    window.addEventListener('keydown', (e) => set(e, true), true);
    window.addEventListener('keyup', (e) => set(e, false), true);
    window.addEventListener('blur', () => {
      Object.keys(window.__DenizenRawMoveKeys).forEach((k) => { window.__DenizenRawMoveKeys[k] = false; });
    });
  }

  let lastProbe = { x: 0, y: 0, t: 0 };

  function wantsMove() {
    const r = window.__DenizenRawMoveKeys || {};
    return !!(r.up || r.down || r.left || r.right);
  }

  function unlock() {
    window.__DenizenGameInputBlocked = false;
    if (typeof window.DenizenUnlockMovement === 'function') {
      window.DenizenUnlockMovement();
      return;
    }
    const sc = window.game?.scene?.scenes?.[0];
    if (!sc) return;
    sc.playerLocked = false;
    sc.playerState = 'walk';
    sc._playerOnPhone = false;
    sc._playerSitting = false;
    try {
      document.activeElement?.blur?.();
      window.game?.input?.keyboard?.enableGlobalCapture?.();
      window.game?.input?.keyboard?.clearCaptures?.();
      window.game?.loop?.resume?.();
    } catch (_) {}
  }

  /** Last resort — move the sprite directly when physics/input are dead. */
  function directNudge(sc, dt = 0.016) {
    if (!sc?.player || document.documentElement.dataset.denizenModal === 'open') return;
    const r = window.__DenizenRawMoveKeys || {};
    const speed = 220;
    let dx = 0;
    let dy = 0;
    if (r.left) dx = -speed * dt;
    else if (r.right) dx = speed * dt;
    if (r.up) dy = -speed * dt;
    else if (r.down) dy = speed * dt;
    if (dx && dy) {
      dx *= 0.707106781;
      dy *= 0.707106781;
    }
    if (!dx && !dy) return;
    sc.playerLocked = false;
    sc._playerOnPhone = false;
    sc._playerSitting = false;
    sc.player.x += dx;
    sc.player.y += dy;
    if (sc.player.body) {
      sc.player.body.reset(sc.player.x, sc.player.y);
      sc.player.body.setVelocity(dx / dt, dy / dt);
    }
    sc._depthDirty = true;
    if (sc._agentManager) sc._agentManager._lastPlayerActiveAt = Date.now();
  }

  function tick() {
    const game = window.game;
    if (!game) return;

    const loginModalOpen = document.documentElement.dataset.denizenModal === 'open';
    if (!loginModalOpen) {
      if (window.__DenizenGameInputBlocked || game.input?.enabled === false) {
        window.__DenizenGameInputBlocked = false;
        try {
          if (game.input) game.input.enabled = true;
          game.input?.keyboard?.enableGlobalCapture?.();
          game.input?.keyboard?.clearCaptures?.();
        } catch (_) {}
      }
    }

    if (game.loop?.isPaused) {
      try { game.loop.resume(); } catch (_) {}
    }

    const sc = game.scene?.scenes?.[0];
    if (!sc) return;

    const blocked = sc.playerLocked || sc._playerOnPhone || sc._playerSitting || window.__DenizenEditorActive;

    if (wantsMove()) {
      const el = document.activeElement;
      const isField = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (isField && !loginModalOpen && !document.documentElement.classList.contains('denizen-phone-open')) {
        try { el.blur(); } catch (_) {}
        try {
          game.input?.keyboard?.enableGlobalCapture?.();
          game.canvas?.focus?.({ preventScroll: true });
        } catch (_) {}
      }

      if (blocked) {
        sc.playerLocked = false;
        sc._playerOnPhone = false;
        sc._playerSitting = false;
        sc._phonePhase = 'none';
        sc._sitPhase = 'none';
        try { sc._applyRawKeyMovement?.(); } catch (_) {}
      } else if (sc.player?.body) {
        try { sc._applyRawKeyMovement?.(); } catch (_) {}
      }

      const p = sc.player;
      const now = performance.now();
      if (p && lastProbe.t) {
        const moved = Math.hypot(p.x - lastProbe.x, p.y - lastProbe.y);
        if (moved < 1.5 && (now - lastProbe.t) > 100) {
          directNudge(sc);
        }
      }
      if (p) lastProbe = { x: p.x, y: p.y, t: now };
    } else {
      lastProbe = { x: 0, y: 0, t: 0 };
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'TEXTAREA') return;
      unlock();
      const sc = window.game?.scene?.scenes?.[0];
      if (sc && wantsMove()) directNudge(sc);
    }
  });

  setInterval(tick, 50);

  function rafDrive() {
    if (wantsMove()) {
      const sc = window.game?.scene?.scenes?.[0];
      try { sc?._applyRawKeyMovement?.(); } catch (_) {}
    }
    requestAnimationFrame(rafDrive);
  }
  requestAnimationFrame(rafDrive);

  window.DenizenMovementGuard = { tick, unlock, wantsMove, directNudge };
  window.DenizenSetLightOffice = (on) => {
    const enabled = on !== false;
    window.__DenizenLightOffice = enabled;
    try { localStorage.setItem('denizen-light-office', enabled ? '1' : '0'); } catch (_) {}
    console.log('[Denizen] light office', enabled ? 'ON (player-first)' : 'OFF (full NPC sim)');
    return enabled;
  };
  try {
    const stored = localStorage.getItem('denizen-light-office');
    if (stored === '0') window.__DenizenLightOffice = false;
    else if (stored === '1') window.__DenizenLightOffice = true;
    else window.__DenizenLightOffice = true;
  } catch (_) {
    window.__DenizenLightOffice = true;
  }
})();
