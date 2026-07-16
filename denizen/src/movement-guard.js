/**
 * Movement guard — keeps player movement alive when Phaser input/physics stall.
 * Uses velocity first; only position-nudges when physics is actually dead (not when blocked by walls).
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
      const chatInput = document.getElementById('player-chat-input');
      if (chatInput && document.activeElement === chatInput) return;
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

  /** True when Arcade is stopping the player against a wall/desk. */
  function isCollisionStopped(sc) {
    const body = sc?.player?.body;
    if (!body || !body.enable) return false;
    const b = body.blocked || {};
    const t = body.touching || {};
    return !!(b.left || b.right || b.up || b.down || t.left || t.right || t.up || t.down);
  }

  /** Physics looks dead (not merely blocked by a collider). */
  function physicsLooksDead(sc) {
    if (!sc?.player?.body) return true;
    if (!sc.player.body.enable) return true;
    if (sc.physics?.world?.isPaused) return true;
    return false;
  }

  function unlock() {
    if (window.__DenizenEditorActive) return;
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

  /** Last resort — move the sprite directly when physics/input are dead. Never use to clip through walls. */
  function directNudge(sc, dt = 0.016) {
    if (!sc?.player || document.documentElement.dataset.denizenModal === 'open') return;
    if (isCollisionStopped(sc)) return;
    if (!physicsLooksDead(sc) && sc.player.body) {
      // Prefer velocity; only teleport if body truly can't move
      try { sc._applyRawKeyMovement?.(); } catch (_) {}
      return;
    }
    const r = window.__DenizenRawMoveKeys || {};
    const speed = (typeof sc._playerMoveSpeed === 'function' ? sc._playerMoveSpeed() : 220);
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
    const chatInput = document.getElementById('player-chat-input');
    if (chatInput && document.activeElement === chatInput) return;
    sc.playerLocked = false;
    sc._playerOnPhone = false;
    sc._playerSitting = false;
    if (sc._restorePlayerWalkSprite) sc._restorePlayerWalkSprite(20);
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
      const chatOpen = document.documentElement.classList.contains('denizen-chat-open');
      const chatInput = document.getElementById('player-chat-input');
      const chatFieldFocused = chatInput && el === chatInput;
      if (isField && !loginModalOpen
        && !document.documentElement.classList.contains('denizen-phone-open')
        && !chatOpen
        && !chatFieldFocused) {
        try { el.blur(); } catch (_) {}
        try {
          game.input?.keyboard?.enableGlobalCapture?.();
          game.canvas?.focus?.({ preventScroll: true });
        } catch (_) {}
      }

      if (blocked) {
        // Map editor locks the player on purpose — don't fight it.
        if (window.__DenizenEditorActive) return;
        sc.playerLocked = false;
        sc._playerOnPhone = false;
        sc._playerSitting = false;
        sc._phonePhase = 'none';
        sc._sitPhase = 'none';
        if (sc._restorePlayerWalkSprite) sc._restorePlayerWalkSprite(20);
        try { sc._applyRawKeyMovement?.(); } catch (_) {}
      } else if (sc.player?.body) {
        try { sc._applyRawKeyMovement?.(); } catch (_) {}
      }

      const p = sc.player;
      const now = performance.now();
      if (p && lastProbe.t) {
        const moved = Math.hypot(p.x - lastProbe.x, p.y - lastProbe.y);
        // Stuck against a wall/desk is expected — do NOT teleport through it.
        if (moved < 1.5 && (now - lastProbe.t) > 100 && !isCollisionStopped(sc) && physicsLooksDead(sc)) {
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
      if (sc && wantsMove()) {
        try { sc._applyRawKeyMovement?.(); } catch (_) {}
      }
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

  window.DenizenMovementGuard = { tick, unlock, wantsMove, directNudge, isCollisionStopped };
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
    else window.__DenizenLightOffice = false;
  } catch (_) {
    window.__DenizenLightOffice = false;
  }
})();
