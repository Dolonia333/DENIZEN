/**
 * CSS day/night for #denizen-night-city — driven by WorldClock hour (0–24).
 * Full loop: day → sunset → night (alive + twinkle) → pre-dawn → sunrise → morning → …
 */
(function () {
  'use strict';

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpHex(a, b, t) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
    const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
    const r = Math.round(lerp(ar, br, t));
    const g = Math.round(lerp(ag, bg, t));
    const bl = Math.round(lerp(ab, bb, t));
    return `#${((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1)}`;
  }

  function clamp01(t) {
    return Math.max(0, Math.min(1, t));
  }

  function phaseName(h) {
    if (h >= 4.5 && h < 8) return 'sunrise';
    if (h >= 8 && h < 17) return 'day';
    if (h >= 17 && h < 21) return 'sunset';
    return 'night';
  }

  /**
   * Continuous 24h loop. Night peaks, then climbs back into morning.
   * Pre-dawn starts earlier so the return to morning is obvious.
   */
  function sample(hRaw) {
    const h = ((hRaw % 24) + 24) % 24;
    const keys = [
      { h: 0, top: '#050a14', mid: '#030810', bot: '#020617', horizon: 'rgba(40,70,120,0.10)', stars: 0.72, win: 1.0, haze: 0.9, sunOp: 0, sun: '#fde68a', glow: 'rgba(56,189,248,0.10)', accent: 'rgba(125,211,252,0.55)', tint: 'brightness(1)', hazeColor: 'rgba(2,8,18,0.55)' },
      { h: 3, top: '#0a1020', mid: '#081018', bot: '#040812', horizon: 'rgba(80,100,160,0.14)', stars: 0.55, win: 0.82, haze: 0.75, sunOp: 0.05, sun: '#fdba74', glow: 'rgba(251,146,60,0.12)', accent: 'rgba(253,186,116,0.45)', tint: 'brightness(0.98)', hazeColor: 'rgba(10,12,24,0.5)' },
      // Pre-dawn — sky warms so morning is unmistakable
      { h: 4.2, top: '#2a1830', mid: '#4a2018', bot: '#0c101c', horizon: 'rgba(251,146,60,0.22)', stars: 0.28, win: 0.48, haze: 0.5, sunOp: 0.25, sun: '#fdba74', glow: 'rgba(251,146,60,0.28)', accent: 'rgba(253,186,116,0.65)', tint: 'brightness(0.92)', hazeColor: 'rgba(50,22,12,0.35)' },
      { h: 5.5, top: '#f97316', mid: '#fb923c', bot: '#7c3aed', horizon: 'rgba(251,146,60,0.42)', stars: 0.06, win: 0.2, haze: 0.28, sunOp: 0.9, sun: '#fdba74', glow: 'rgba(251,146,60,0.42)', accent: 'rgba(253,186,116,0.8)', tint: 'brightness(0.82)', hazeColor: 'rgba(67,20,7,0.28)' },
      { h: 7, top: '#38bdf8', mid: '#7dd3fc', bot: '#fda4af', horizon: 'rgba(125,211,252,0.3)', stars: 0, win: 0.06, haze: 0.18, sunOp: 1, sun: '#fef08a', glow: 'rgba(56,189,248,0.24)', accent: 'rgba(56,189,248,0.55)', tint: 'brightness(0.76)', hazeColor: 'rgba(2,8,18,0.22)' },
      { h: 9, top: '#0ea5e9', mid: '#38bdf8', bot: '#e0f2fe', horizon: 'rgba(14,165,233,0.2)', stars: 0, win: 0.03, haze: 0.15, sunOp: 1, sun: '#fef9c3', glow: 'rgba(125,211,252,0.18)', accent: 'rgba(56,189,248,0.45)', tint: 'brightness(0.72)', hazeColor: 'rgba(2,8,18,0.2)' },
      { h: 12, top: '#0284c7', mid: '#38bdf8', bot: '#f0f9ff', horizon: 'rgba(14,165,233,0.16)', stars: 0, win: 0.02, haze: 0.12, sunOp: 1, sun: '#fefce8', glow: 'rgba(125,211,252,0.16)', accent: 'rgba(56,189,248,0.4)', tint: 'brightness(0.68)', hazeColor: 'rgba(2,8,18,0.15)' },
      { h: 16, top: '#38bdf8', mid: '#7dd3fc', bot: '#fdba74', horizon: 'rgba(251,146,60,0.18)', stars: 0, win: 0.04, haze: 0.18, sunOp: 0.95, sun: '#fde68a', glow: 'rgba(251,146,60,0.22)', accent: 'rgba(251,146,60,0.5)', tint: 'brightness(0.75)', hazeColor: 'rgba(40,20,10,0.2)' },
      { h: 17.5, top: '#fb923c', mid: '#f97316', bot: '#7c3aed', horizon: 'rgba(249,115,22,0.32)', stars: 0.02, win: 0.12, haze: 0.28, sunOp: 0.85, sun: '#fb923c', glow: 'rgba(249,115,22,0.35)', accent: 'rgba(251,146,60,0.7)', tint: 'brightness(0.82)', hazeColor: 'rgba(67,20,7,0.35)' },
      { h: 19, top: '#7c3aed', mid: '#ea580c', bot: '#1e1b4b', horizon: 'rgba(167,139,250,0.28)', stars: 0.2, win: 0.5, haze: 0.45, sunOp: 0.45, sun: '#f97316', glow: 'rgba(249,115,22,0.3)', accent: 'rgba(251,146,60,0.6)', tint: 'brightness(0.9)', hazeColor: 'rgba(30,15,40,0.4)' },
      { h: 21, top: '#1e1b4b', mid: '#0f172a', bot: '#020617', horizon: 'rgba(99,102,241,0.18)', stars: 0.55, win: 0.9, haze: 0.7, sunOp: 0.05, sun: '#c4b5fd', glow: 'rgba(129,140,248,0.22)', accent: 'rgba(165,180,252,0.55)', tint: 'brightness(1)', hazeColor: 'rgba(2,8,18,0.55)' },
      { h: 22.5, top: '#0a1020', mid: '#050a14', bot: '#020617', horizon: 'rgba(56,120,180,0.12)', stars: 0.75, win: 1.0, haze: 0.88, sunOp: 0, sun: '#fde68a', glow: 'rgba(56,189,248,0.12)', accent: 'rgba(125,211,252,0.55)', tint: 'brightness(1)', hazeColor: 'rgba(2,8,18,0.6)' },
      { h: 24, top: '#050a14', mid: '#030810', bot: '#020617', horizon: 'rgba(40,70,120,0.10)', stars: 0.72, win: 1.0, haze: 0.9, sunOp: 0, sun: '#fde68a', glow: 'rgba(56,189,248,0.10)', accent: 'rgba(125,211,252,0.55)', tint: 'brightness(1)', hazeColor: 'rgba(2,8,18,0.55)' },
    ];

    let i = 0;
    while (i < keys.length - 1 && h >= keys[i + 1].h) i++;
    const a = keys[i];
    const b = keys[Math.min(i + 1, keys.length - 1)];
    const span = Math.max(0.0001, b.h - a.h);
    const t = clamp01((h - a.h) / span);
    const pick = (ka, kb) => (t < 0.5 ? ka : kb);

    let sunX = 50;
    let sunY = 82;
    if (h >= 4.2 && h <= 21) {
      const u = (h - 4.2) / (21 - 4.2);
      sunX = lerp(8, 92, u);
      if (h <= 12) {
        sunY = lerp(78, 14, Math.sin(Math.PI * 0.5 * clamp01((h - 4.2) / 7.8)));
      } else {
        sunY = lerp(14, 78, clamp01((h - 12) / 9));
      }
    } else if (h < 4.2) {
      sunX = 6;
      sunY = 88;
    } else {
      sunX = 94;
      sunY = 88;
    }

    return {
      phase: phaseName(h),
      skyTop: lerpHex(a.top, b.top, t),
      skyMid: lerpHex(a.mid, b.mid, t),
      skyBot: lerpHex(a.bot, b.bot, t),
      horizonMix: pick(a.horizon, b.horizon),
      stars: lerp(a.stars, b.stars, t),
      windows: lerp(a.win, b.win, t),
      haze: lerp(a.haze, b.haze, t),
      sunOp: lerp(a.sunOp, b.sunOp, t),
      sunColor: pick(a.sun, b.sun),
      frameGlow: pick(a.glow, b.glow),
      frameAccent: pick(a.accent, b.accent),
      tint: pick(a.tint, b.tint),
      sunX,
      sunY,
      hazeColor: pick(a.hazeColor, b.hazeColor),
    };
  }

  function ensureHud() {
    let el = document.getElementById('denizen-tod-hud');
    if (el) return el;
    const frame = document.getElementById('game-frame');
    if (!frame) return null;
    el = document.createElement('div');
    el.id = 'denizen-tod-hud';
    el.setAttribute('aria-live', 'polite');
    const slot = document.getElementById('denizen-frame-clock-slot');
    (slot || frame).appendChild(el);
    return el;
  }

  function updateHud(hour, minute, phase) {
    const el = ensureHud();
    if (!el) return;
    const hh = String(Math.floor(hour) % 24).padStart(2, '0');
    const mm = String(Math.floor(minute) % 60).padStart(2, '0');
    const label = phase === 'sunrise' ? 'sunrise'
      : phase === 'sunset' ? 'sunset'
      : phase === 'day' ? 'day'
      : 'night';
    el.dataset.phase = phase;
    globalThis.DenizenSafeDom.setSafeHtml(el, `<span class="tod-time">${hh}:${mm}</span><span class="tod-phase">${label}</span>`);
  }

  const WIN_TILE_W = 920; // must match .dz-skyline background-size width

  /** Tile inlined windows SVG to match buildings: 920px × 100% stretch, left-bottom. */
  function paintWindowTiles(host, svgText) {
    const w = Math.max(window.innerWidth || 1280, host.clientWidth || 0);
    const n = Math.max(1, Math.ceil(w / WIN_TILE_W) + 1);
    host.classList.add('dz-windows-tiled');
    host.style.backgroundImage = 'none';
    host.replaceChildren();
    for (let i = 0; i < n; i++) {
      const tile = document.createElement('div');
      tile.className = 'dz-win-tile';
      globalThis.DenizenSafeDom.setSafeHtml(tile, svgText);
      const root = tile.querySelector('svg');
      if (root) {
        // Same stretch as CSS background-size: 920px 100%
        root.setAttribute('preserveAspectRatio', 'none');
        root.setAttribute('width', String(WIN_TILE_W));
        root.setAttribute('height', '100%');
      }
      host.appendChild(tile);
    }
  }

  /** Inline the windows SVG so per-window CSS twinkle animations actually run. */
  function mountTwinkleWindows() {
    const host = document.querySelector('#denizen-night-city .dz-windows');
    if (!host || host.dataset.twinkleMounted === '1') return;
    host.dataset.twinkleMounted = '1';
    fetch('/assets/night-city-windows.svg?v=align4')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((svg) => {
        host._twinkleSvg = svg;
        paintWindowTiles(host, svg);
        if (!host._twinkleResizeBound) {
          host._twinkleResizeBound = true;
          let t = 0;
          window.addEventListener('resize', () => {
            clearTimeout(t);
            t = setTimeout(() => {
              if (host._twinkleSvg) paintWindowTiles(host, host._twinkleSvg);
            }, 120);
          });
        }
      })
      .catch(() => {
        host.dataset.twinkleMounted = '0';
        host.classList.remove('dz-windows-tiled');
        host.style.backgroundImage = '';
      });
  }

  function apply(hour, minute) {
    const h = (Number(hour) || 0) + (Number(minute) || 0) / 60;
    const s = sample(h);
    const city = document.getElementById('denizen-night-city');
    const root = document.documentElement;
    const targets = [city, root].filter(Boolean);
    const vars = {
      '--sky-top': s.skyTop,
      '--sky-mid': s.skyMid,
      '--sky-bot': s.skyBot,
      '--horizon-glow': s.horizonMix,
      '--sun-x': `${s.sunX.toFixed(2)}%`,
      '--sun-y': `${s.sunY.toFixed(2)}%`,
      '--sun-color': s.sunColor,
      '--sun-glow': s.frameGlow,
      '--sun-opacity': String(s.sunOp.toFixed(3)),
      '--star-opacity': String(s.stars.toFixed(3)),
      '--window-opacity': String(s.windows.toFixed(3)),
      '--haze-opacity': String(s.haze.toFixed(3)),
      '--haze-color': s.hazeColor,
      '--building-tint': s.tint,
      '--frame-glow': s.frameGlow,
      '--frame-accent': s.frameAccent,
    };
    for (const el of targets) {
      for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
      if (el === city) el.dataset.tod = s.phase;
    }
    root.dataset.tod = s.phase;
    updateHud(Number(hour) || 0, Number(minute) || 0, s.phase);
    return s;
  }

  function boot() {
    mountTwinkleWindows();
    apply(17, 0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DenizenCityTod = { apply, sample, phaseName, mountTwinkleWindows };
})();
