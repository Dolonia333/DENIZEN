/**
 * Denizen scene runtime — shared Phaser 3 kernel.
 *
 * Classic IIFE → window.DenizenSceneRuntime (same pattern as
 * DenizenMapEngine / DenizenDeviceProfile). Load before office-scene.js.
 *
 * See docs/SCENE_RUNTIME.md for the frozen public contract.
 */
(function () {
  'use strict';

  const LAYERS = Object.freeze({
    GROUND: 0,
    WALL: 10,
    FURNITURE: 20,
    ACTORS: 30,
    HUD: 1000,
  });

  const CULL_CHUNK = 512;

  const FROZEN_COMMANDS = Object.freeze([
    'spawn',
    'navigate',
    'walkTo',
    'use',
    'interact',
    'speak',
    'broadcast',
    'setBlockers',
  ]);

  // ── Boot / renderer ──────────────────────────────────────────────────────

  /** Canvas default; pass ?webgl=1 to opt into WebGL / AUTO. */
  function preferCanvasRenderer() {
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get('webgl') === '1') return false;
    } catch (_) { /* ignore */ }
    return true;
  }

  /**
   * Build the shared Phaser.Game config used by the office (and reusable by
   * other surfaces that want the same pixel-art Arcade defaults).
   *
   * @param {object} opts
   * @param {Function|Function[]} opts.scene — Phaser scene class(es)
   * @param {HTMLElement|string} [opts.parent]
   * @param {number} [opts.width=1280]
   * @param {number} [opts.height=720]
   * @param {string} [opts.backgroundColor='#020617']
   * @param {boolean} [opts.forceCanvas] — override preferCanvasRenderer
   * @param {object} [opts.perf] — DenizenDeviceProfile.lightPerf() result
   * @param {object} [opts.extra] — merged onto the config
   */
  function buildGameConfig(opts = {}) {
    const useCanvas = opts.forceCanvas != null
      ? !!opts.forceCanvas
      : preferCanvasRenderer();
    const perf = opts.perf
      || (typeof window.DenizenDeviceProfile?.lightPerf === 'function'
        ? window.DenizenDeviceProfile.lightPerf()
        : { light: false, targetFps: 0 });

    try {
      window.__DenizenLightPerf = !!perf.light;
      if (perf.light) console.log('[SceneRuntime] light profile ON', perf);
    } catch (_) { /* ignore */ }

    const config = {
      type: useCanvas
        ? (typeof Phaser !== 'undefined' ? Phaser.CANVAS : 0)
        : (typeof Phaser !== 'undefined' ? Phaser.AUTO : 0),
      width: opts.width != null ? opts.width : 1280,
      height: opts.height != null ? opts.height : 720,
      parent: opts.parent != null
        ? opts.parent
        : (document.getElementById('game-container') || 'game-container'),
      backgroundColor: opts.backgroundColor || '#020617',
      pixelArt: opts.pixelArt != null ? opts.pixelArt : true,
      scale: Object.assign({ pauseOnBlur: false }, opts.scale || {}),
      roundPixels: opts.roundPixels != null ? opts.roundPixels : true,
      loader: Object.assign({
        maxParallelDownloads: 4,
        maxRetries: 2,
        timeout: 20000,
      }, opts.loader || {}),
      physics: opts.physics || {
        default: 'arcade',
        arcade: { debug: false },
      },
      scene: opts.scene,
    };

    if (perf.targetFps && perf.targetFps > 0) {
      config.fps = { target: perf.targetFps, min: 20, forceSetTimeOut: false };
    }

    if (opts.extra && typeof opts.extra === 'object') {
      Object.assign(config, opts.extra);
    }

    return { config, useCanvas, perf };
  }

  /**
   * Create Phaser.Game with Canvas fallback. Sets window.game by default.
   *
   * @param {object} opts — see buildGameConfig; plus:
   * @param {string} [opts.bootFlag='__DenizenOfficeBooting']
   * @param {string} [opts.gameKey='game'] — window[gameKey] assignment
   * @param {Function} [opts.onError]
   * @param {boolean} [opts.skipIfExists=true]
   * @returns {Phaser.Game|null}
   */
  function boot(opts = {}) {
    const bootFlag = opts.bootFlag || '__DenizenOfficeBooting';
    const gameKey = opts.gameKey || 'game';
    const skipIfExists = opts.skipIfExists !== false;

    if (skipIfExists && (window[gameKey] || window[bootFlag])) return window[gameKey] || null;
    window[bootFlag] = true;

    const showBootError = (msg) => {
      window[bootFlag] = false;
      console.error('[SceneRuntime]', msg);
      if (typeof opts.onError === 'function') {
        try { opts.onError(msg); } catch (_) { /* ignore */ }
        return;
      }
      const banner = document.getElementById('denizen-load-banner');
      if (!banner) return;
      banner.style.display = '';
      banner.style.background = 'rgba(127, 29, 29, 0.95)';
      banner.style.color = '#fecaca';
      banner.innerHTML = `<strong>Office failed</strong> — ${msg} <span id="denizen-boot-tag">(boot runtime)</span>`;
    };

    if (typeof Phaser === 'undefined') {
      showBootError('Phaser is undefined after script load. Soften Brave Shields, then hard-refresh.');
      return null;
    }

    const parentEl = opts.parent != null
      ? opts.parent
      : document.getElementById('game-container');
    if (!parentEl && !(opts.parent === 'game-container' || opts.allowMissingParent)) {
      // String parent is ok for Phaser; only fail when neither element nor string.
      if (opts.parent == null) {
        showBootError('Missing #game-container in the page.');
        return null;
      }
    }

    const { config, useCanvas } = buildGameConfig(opts);
    let game = null;
    try {
      game = new Phaser.Game(config);
      window[gameKey] = game;
      console.log('[SceneRuntime] Phaser.Game created', Phaser.VERSION, useCanvas ? 'CANVAS' : 'AUTO');
      try { window.__DenizenChatBootstrap?.setLoadPct?.(1); } catch (_) { /* ignore */ }
    } catch (err) {
      try {
        config.type = Phaser.CANVAS;
        game = new Phaser.Game(config);
        window[gameKey] = game;
        console.warn('[SceneRuntime] WebGL failed; fell back to Canvas', err?.message || err);
      } catch (err2) {
        showBootError(`Phaser.Game crashed: ${err2?.message || err2}`);
        return null;
      }
    }
    return game;
  }

  // ── Layers ───────────────────────────────────────────────────────────────

  function depthFor(layerName) {
    const key = String(layerName || '').toUpperCase();
    return Object.prototype.hasOwnProperty.call(LAYERS, key) ? LAYERS[key] : LAYERS.FURNITURE;
  }

  function applyLayer(gameObject, layerName) {
    if (!gameObject || typeof gameObject.setDepth !== 'function') return gameObject;
    gameObject.setDepth(depthFor(layerName));
    return gameObject;
  }

  // ── Chunk culling (generalized from full-world.js) ───────────────────────

  /**
   * Bucket static display-list objects by install-time position. Movers must
   * be listed in opts.movers (identity Set / array) — type checks alone miss
   * Image-based vehicles.
   *
   * Attaches state on the scene: _denizenCullBuckets, _denizenCullActive,
   * _denizenCullSig, _denizenCullAlways.
   *
   * @param {Phaser.Scene} scene
   * @param {object} [opts]
   * @param {Iterable} [opts.movers] — game objects that must never be culled
   * @param {number} [opts.chunkSize=512]
   * @param {boolean} [opts.excludeSprites=true] — treat Sprite type as movers
   */
  function installChunkCulling(scene, opts = {}) {
    if (!scene || scene._denizenCullBuckets) return scene._denizenCullMeta || null;
    const chunk = opts.chunkSize != null ? Number(opts.chunkSize) : CULL_CHUNK;
    const buckets = new Map();
    const always = [];
    const moving = new Set(opts.movers || []);
    const excludeSprites = opts.excludeSprites !== false;

    for (const o of scene.children.list) {
      if (!o || o.visible === false) continue;
      if (
        moving.has(o)
        || (excludeSprites && o.type === 'Sprite')
        || (o.width || 0) > chunk
        || (o.height || 0) > chunk
      ) {
        always.push(o);
        continue;
      }
      const k = `${Math.floor(o.x / chunk)},${Math.floor(o.y / chunk)}`;
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(o);
    }

    scene._denizenCullBuckets = buckets;
    scene._denizenCullActive = new Set();
    scene._denizenCullChunk = chunk;
    scene._denizenCullAlways = always.length;
    for (const b of buckets.values()) {
      for (const o of b) o.visible = false;
    }
    updateChunkCulling(scene, true);
    const meta = {
      buckets: buckets.size,
      always: always.length,
      chunk,
    };
    scene._denizenCullMeta = meta;
    return meta;
  }

  function updateChunkCulling(scene, force) {
    const buckets = scene && scene._denizenCullBuckets;
    if (!buckets) return;
    const chunk = scene._denizenCullChunk || CULL_CHUNK;
    const view = scene.cameras.main.worldView;
    const x0 = Math.floor((view.x - chunk) / chunk);
    const x1 = Math.floor((view.right + chunk) / chunk);
    const y0 = Math.floor((view.y - chunk) / chunk);
    const y1 = Math.floor((view.bottom + chunk) / chunk);
    const sig = `${x0},${x1},${y0},${y1}`;
    if (!force && sig === scene._denizenCullSig) return;
    scene._denizenCullSig = sig;

    const next = new Set();
    for (let cy = y0; cy <= y1; cy += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const k = `${cx},${cy}`;
        if (buckets.has(k)) next.add(k);
      }
    }
    const active = scene._denizenCullActive || new Set();
    for (const k of active) {
      if (!next.has(k)) for (const o of buckets.get(k)) o.visible = false;
    }
    for (const k of next) {
      if (!active.has(k)) for (const o of buckets.get(k)) o.visible = true;
    }
    scene._denizenCullActive = next;
  }

  // ── Atlas helpers ────────────────────────────────────────────────────────

  /** Stable texture key for a relative image path (matches full-world planKey). */
  function atlasPlanKey(imgPath) {
    return 'cp_' + String(imgPath || '').replace(/[^a-zA-Z0-9]/g, '_');
  }

  function atlasQueryEnabled() {
    try {
      return new URLSearchParams(window.location.search).get('atlas') !== '0';
    } catch (_) {
      return true;
    }
  }

  /**
   * Register frames from a Phaser-loaded atlas JSON onto a single texture.
   * Page-0 only (multi-page atlases fall back to individual loads).
   *
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {string} opts.textureKey — e.g. 'fw_ext_atlas'
   * @param {string} opts.jsonKey — e.g. 'fw_ext_atlas_json'
   * @param {Function} [opts.frameKey] — map manifest key → texture frame name
   * @returns {{ enabled: boolean, registered: number, skippedOtherPage: number }}
   */
  function setupAtlas(scene, opts = {}) {
    const textureKey = opts.textureKey || 'fw_ext_atlas';
    const jsonKey = opts.jsonKey || 'fw_ext_atlas_json';
    const frameKeyFn = typeof opts.frameKey === 'function' ? opts.frameKey : atlasPlanKey;
    const stateKey = `_denizenAtlas_${textureKey}`;

    if (scene[stateKey]?.done) {
      return scene[stateKey].result;
    }

    const result = { enabled: false, registered: 0, skippedOtherPage: 0 };
    scene[stateKey] = { done: true, result };

    if (!atlasQueryEnabled()) {
      console.log('[SceneRuntime] atlas: disabled via ?atlas=0');
      return result;
    }
    if (!scene.textures.exists(textureKey)) {
      console.warn(`[SceneRuntime] atlas: ${textureKey} missing — individual loads`);
      return result;
    }
    const manifest = scene.cache.json.get(jsonKey);
    const frames = manifest?.frames;
    if (!frames) {
      console.warn(`[SceneRuntime] atlas: ${jsonKey} missing/invalid`);
      return result;
    }

    const tex = scene.textures.get(textureKey);
    Object.entries(frames).forEach(([img, f]) => {
      if (f.page) { result.skippedOtherPage += 1; return; }
      const key = frameKeyFn(img);
      if (!tex.has(key)) {
        tex.add(key, 0, f.x, f.y, f.w, f.h);
        result.registered += 1;
      }
    });
    result.enabled = true;
    scene[stateKey].enabled = true;
    console.log(
      `[SceneRuntime] atlas: ready — ${result.registered} frame(s) on ${textureKey}` +
      (result.skippedOtherPage ? ` (${result.skippedOtherPage} on other page(s))` : ''),
    );
    return result;
  }

  /** Frame key for img if atlas is enabled and packed; otherwise null. */
  function atlasFrameKey(scene, img, opts = {}) {
    const textureKey = opts.textureKey || 'fw_ext_atlas';
    const stateKey = `_denizenAtlas_${textureKey}`;
    if (!scene?.[stateKey]?.enabled && !scene?.[stateKey]?.result?.enabled) return null;
    const key = (typeof opts.frameKey === 'function' ? opts.frameKey : atlasPlanKey)(img);
    const tex = scene.textures.exists(textureKey) ? scene.textures.get(textureKey) : null;
    return tex && tex.has(key) ? key : null;
  }

  // ── Command bus ──────────────────────────────────────────────────────────

  const handlers = new Map();
  let defaultHandler = null;

  function registerCommand(name, fn) {
    const key = String(name || '');
    if (!FROZEN_COMMANDS.includes(key) && !key.startsWith('_')) {
      console.warn(`[SceneRuntime] registering non-frozen command "${key}"`);
    }
    if (typeof fn !== 'function') throw new TypeError('command handler must be a function');
    handlers.set(key, fn);
    return () => { if (handlers.get(key) === fn) handlers.delete(key); };
  }

  function setDefaultCommandHandler(fn) {
    defaultHandler = typeof fn === 'function' ? fn : null;
  }

  /**
   * Dispatch a frozen scene command.
   * @returns {*} handler result, or { ok:false, error } if unknown / thrown
   */
  function dispatch(cmd, payload) {
    const name = String(cmd || '');
    const fn = handlers.get(name) || defaultHandler;
    if (!fn) {
      return { ok: false, error: `unknown command: ${name}`, command: name };
    }
    try {
      const result = fn(payload || {}, name);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: true, command: name, result };
    } catch (err) {
      console.error('[SceneRuntime] command failed', name, err);
      return { ok: false, error: err?.message || String(err), command: name };
    }
  }

  /** Pair aliases so registering one wires the other when unset. */
  const ALIAS_PAIRS = [
    ['navigate', 'walkTo'],
    ['use', 'interact'],
  ];

  function registerCommandWithAliases(name, fn) {
    const unreg = registerCommand(name, fn);
    for (const [a, b] of ALIAS_PAIRS) {
      if (name === a && !handlers.has(b)) registerCommand(b, fn);
      if (name === b && !handlers.has(a)) registerCommand(a, fn);
    }
    return unreg;
  }

  /** Convenience aliases matching the frozen contract. */
  const commands = {
    list: () => FROZEN_COMMANDS.slice(),
    register: registerCommandWithAliases,
    setDefault: setDefaultCommandHandler,
    dispatch,
    spawn: (p) => dispatch('spawn', p),
    navigate: (p) => dispatch('navigate', p),
    walkTo: (p) => dispatch('walkTo', p),
    use: (p) => dispatch('use', p),
    interact: (p) => dispatch('interact', p),
    speak: (p) => dispatch('speak', p),
    broadcast: (p) => dispatch('broadcast', p),
    setBlockers: (p) => dispatch('setBlockers', p),
  };

  // ── Discord adapter stub ─────────────────────────────────────────────────

  /**
   * Thin adapter: map frozen commands onto the Discord Spaces Phaser scene
   * when `window.__DenizenMapGame` is live. Does not rewrite discord-map/game.js.
   */
  const discordAdapter = {
    /** @returns {Phaser.Scene|null} */
    getScene() {
      try {
        const game = window.__DenizenMapGame;
        if (!game?.scene) return null;
        const scenes = game.scene.getScenes?.(true) || [];
        return scenes[0] || game.scene.scenes?.[0] || null;
      } catch (_) {
        return null;
      }
    },

    isLive() {
      return !!this.getScene();
    },

    /**
     * Best-effort dispatch against Discord map scene methods when present.
     * Returns { ok:false, deferred:true } when the map is not loaded.
     */
    dispatch(cmd, payload = {}) {
      const scene = this.getScene();
      if (!scene) {
        return { ok: false, deferred: true, error: 'discord map not booted', command: cmd };
      }
      const name = String(cmd || '');
      try {
        switch (name) {
          case 'spawn':
            if (typeof scene.spawnChar === 'function' && payload.x != null) {
              const sp = scene.spawnChar(
                Number(payload.x),
                Number(payload.y) || 0,
                payload.sheet || payload.key,
                payload.idle || null,
                payload.label || null,
                payload.depth != null ? payload.depth : LAYERS.ACTORS,
                payload.opts || {},
              );
              return { ok: true, command: name, result: sp };
            }
            return { ok: false, error: 'spawnChar unavailable', command: name };
          case 'navigate':
          case 'walkTo':
            // Discord uses floor-graph BFS — expose when scene offers walkTo/pathTo.
            if (typeof scene.walkTo === 'function') {
              return { ok: true, command: name, result: scene.walkTo(payload) };
            }
            if (typeof scene.pathTo === 'function') {
              return { ok: true, command: name, result: scene.pathTo(payload) };
            }
            return { ok: false, deferred: true, error: 'discord navigate not exposed', command: name };
          case 'use':
          case 'interact':
            if (typeof scene.interact === 'function') {
              return { ok: true, command: name, result: scene.interact(payload) };
            }
            return { ok: false, deferred: true, error: 'discord interact not exposed', command: name };
          case 'speak':
            if (typeof scene.setEnterHint === 'function' && payload.text) {
              scene.setEnterHint(String(payload.text));
              return { ok: true, command: name };
            }
            return { ok: false, deferred: true, error: 'discord speak not exposed', command: name };
          case 'broadcast':
            try {
              window.dispatchEvent(new CustomEvent('denizen-discord-broadcast', { detail: payload }));
            } catch (_) { /* ignore */ }
            return { ok: true, command: name };
          case 'setBlockers':
            return { ok: false, deferred: true, error: 'discord setBlockers not exposed', command: name };
          default:
            return { ok: false, error: `unknown command: ${name}`, command: name };
        }
      } catch (err) {
        return { ok: false, error: err?.message || String(err), command: name };
      }
    },

    /** Register discordAdapter.dispatch as default when map is the active surface. */
    installAsDefault() {
      setDefaultCommandHandler((payload, name) => this.dispatch(name, payload));
    },
  };

  // ── Public export ────────────────────────────────────────────────────────

  window.DenizenSceneRuntime = {
    version: 1,
    LAYERS,
    CULL_CHUNK,
    FROZEN_COMMANDS,
    preferCanvasRenderer,
    buildGameConfig,
    boot,
    depthFor,
    applyLayer,
    installChunkCulling,
    updateChunkCulling,
    atlasPlanKey,
    atlasQueryEnabled,
    setupAtlas,
    atlasFrameKey,
    commands,
    registerCommand: registerCommandWithAliases,
    dispatch,
    discordAdapter,
  };
})();
