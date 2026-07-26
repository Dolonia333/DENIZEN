/**
 * Roki Market — Robinhood-style desk with live Robinhood quotes/charts + Denizen paper ledger.
 * Live orders never fire from here.
 */
(function () {
  'use strict';

  const PANEL_ID = 'denizen-market-panel';
  const STYLE_ID = 'denizen-market-style';
  const FETCH_TIMEOUT_MS = 16000;
  const RANGES = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL'];
  const RH = {
    bg: '#000000',
    surface: '#0d0d0d',
    line: '#1e1e1e',
    text: '#ffffff',
    muted: '#8c8c8c',
    green: '#00c805',
    red: '#ff5000',
    accent: '#38bdf8',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    body: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };

  let panelEl = null;
  let busy = false;
  let state = {
    symbol: 'PAPER',
    range: '1D',
    chart: null,
    data: null,
  };

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function money(n, digits = 2) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return `$${x.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  function pct(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return `${x > 0 ? '+' : ''}${x.toFixed(2)}%`;
  }

  async function fetchJson(path, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(path, {
        // authHeaders() carries the signed CEO grant + session — the market
        // write routes and portfolio/positions reads are operator-gated.
        headers: {
          'Content-Type': 'application/json',
          ...(globalThis.DenizenVisitorSession?.authHeaders?.() || {}),
          ...(opts?.headers || {}),
        },
        ...opts,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'request failed');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadBase() {
    const [auth, watchlist, suggestions, paper] = await Promise.all([
      fetchJson('/api/market/auth-status').catch(() => ({ authenticated: false })),
      fetchJson('/api/market/watchlist').catch(() => ({ symbols: [] })),
      fetchJson('/api/trade-suggestions').catch(() => ({ suggestions: [] })),
      fetchJson('/api/market/paper').catch(() => null),
    ]);
    const defaults = ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'META', 'AMD', 'AMZN'];
    const symbols = Array.from(new Set([...(watchlist.symbols || []), ...defaults])).slice(0, 12);
    const quoteRes = await fetchJson(`/api/market/quote?symbols=${encodeURIComponent(symbols.join(','))}`).catch(() => []);
    let livePortfolio = null;
    if (auth.authenticated) {
      livePortfolio = await fetchJson('/api/market/portfolio').catch(() => null);
    }
    const quotes = Array.isArray(quoteRes) ? quoteRes : (quoteRes.quotes || []);
    return { auth, watchlist, suggestions, quotes, paper, livePortfolio };
  }

  async function loadChart(symbol, range) {
    if (symbol === 'PAPER') return null;
    return fetchJson(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`);
  }

  function areaChart(points, color, opts = {}) {
    const pts = (points || []).map((p) => Number(p.c ?? p.equity ?? p)).filter((n) => Number.isFinite(n));
    if (pts.length < 2) {
      return `<div class="rh-chart-empty">${esc(opts.empty || 'No chart data yet')}</div>`;
    }
    const w = 360;
    const h = 180;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = Math.max(0.01, max - min);
    const xy = pts.map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 16) - 8;
      return [x, y];
    });
    const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    const gid = `rhg_${Math.random().toString(36).slice(2, 8)}`;
    return `
      <svg class="rh-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#${gid})"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      </svg>`;
  }

  function heroFromState() {
    const paper = state.data?.paper || {};
    if (state.symbol === 'PAPER') {
      const curve = paper.equityCurve || [];
      const first = Number(curve[0]?.equity ?? paper.startingCash ?? 10000);
      const last = Number(paper.equity ?? first);
      const change = last - first;
      const changePercent = first ? (change / first) * 100 : 0;
      const up = change >= 0;
      return {
        title: 'Roki paper',
        subtitle: 'Fake money · live marks',
        price: last,
        change,
        changePercent,
        up,
        chartHtml: areaChart(curve.map((p) => ({ c: p.equity })), up ? RH.green : RH.red, {
          empty: 'Paper fills will draw this curve',
        }),
      };
    }
    const chart = state.chart;
    const q = (state.data?.quotes || []).find((x) => x.symbol === state.symbol);
    const price = chart?.price ?? q?.price;
    const change = chart?.change ?? q?.change;
    const changePercent = chart?.changePercent ?? q?.changePercent;
    const up = Number(changePercent || change || 0) >= 0;
    const src = chart?.source || q?.source || 'feed';
    const feedLabel = src === 'robinhood' ? 'Robinhood live' : `Feed · ${src}`;
    return {
      title: state.symbol,
      subtitle: feedLabel,
      price,
      change,
      changePercent,
      up,
      bid: chart?.bid ?? q?.bid,
      ask: chart?.ask ?? q?.ask,
      chartHtml: areaChart(chart?.points, up ? RH.green : RH.red, {
        empty: chart?.error || 'Loading chart…',
      }),
    };
  }

  function render(data) {
    state.data = data;
    const hero = heroFromState();
    const paper = data.paper || {};
    const tone = hero.up ? 'up' : 'down';
    const authLine = data.auth.authenticated
      ? 'Robinhood connected'
      : 'Connect Robinhood for live quotes';
    const quoteSource = (data.quotes || []).find((q) => q.source)?.source
      || state.chart?.source
      || 'none';
    const liveBadge = quoteSource === 'robinhood'
      ? '<span class="rh-live">LIVE · ROBINHOOD</span>'
      : `<span class="rh-muted">${esc(authLine)}</span>`;

    const listSyms = Array.from(new Set([
      ...(data.watchlist.symbols || []),
      ...(data.quotes || []).map((q) => q.symbol),
      ...(paper.positions || []).map((p) => p.symbol),
    ].filter(Boolean))).slice(0, 14);

    const quoteMap = Object.fromEntries((data.quotes || []).map((q) => [q.symbol, q]));
    const stockRows = listSyms.map((sym) => {
      const q = quoteMap[sym] || {};
      const up = Number(q.changePercent || 0) >= 0;
      const active = state.symbol === sym ? 'is-active' : '';
      return `
        <button type="button" class="rh-stock ${active}" data-pick="${esc(sym)}">
          <div class="rh-stock-left">
            <b>${esc(sym)}</b>
            <small>${esc((q.name || '').split(' ').slice(0, 3).join(' ') || 'Equity')}</small>
          </div>
          <div class="rh-stock-right">
            <b>${money(q.price)}</b>
            <span class="${up ? 'rh-up' : 'rh-down'}">${q.changePercent != null ? pct(q.changePercent) : '—'}</span>
          </div>
        </button>`;
    }).join('') || '<p class="rh-muted">Add tickers to the watchlist</p>';

    const posRows = (paper.positions || []).map((p) => `
      <button type="button" class="rh-stock" data-pick="${esc(p.symbol)}">
        <div class="rh-stock-left">
          <b>${esc(p.symbol)}</b>
          <small>${esc(p.qty)} shares · avg ${money(p.avgCost)}</small>
        </div>
        <div class="rh-stock-right">
          <b>${money(p.marketValue)}</b>
          <span class="${p.pnl >= 0 ? 'rh-up' : 'rh-down'}">${money(p.pnl)} · ${pct(p.pnlPct)}</span>
        </div>
      </button>`).join('') || '<p class="rh-muted">No paper positions yet</p>';

    const rangeBtns = RANGES.map((r) => `
      <button type="button" class="rh-range ${state.range === r ? 'is-on' : ''} ${tone === 'up' ? 'tone-up' : 'tone-down'}" data-range="${r}">${r}</button>
    `).join('');

    const tradeRows = (paper.trades || []).slice(0, 8).map((t) => `
      <div class="rh-trade">
        <div><b class="${t.side === 'buy' ? 'rh-up' : 'rh-down'}">${esc(String(t.side || '').toUpperCase())}</b> ${esc(t.symbol)} · ${esc(t.qty)} @ ${money(t.price)}</div>
        <small>${esc(String(t.at || '').replace('T', ' ').slice(0, 16))}</small>
      </div>`).join('') || '<p class="rh-muted">No paper fills yet</p>';

    const sugRows = (data.suggestions?.suggestions || data.suggestions || [])
      .filter((s) => s.status !== 'dismissed')
      .slice(0, 6)
      .map((s) => {
        const canPaper = /^(buy|sell)$/i.test(s.action || '');
        return `
        <div class="rh-sug">
          <div class="rh-sug-top"><b>${esc(s.action || 'watch').toUpperCase()} ${esc(s.symbol)}</b></div>
          <p>${esc(s.rationale || '')}</p>
          <div class="rh-actions">
            ${canPaper ? `<button type="button" class="rh-btn" data-paper-sug="${esc(s.id)}">Paper fill</button>` : ''}
            <button type="button" class="rh-btn ghost" data-dismiss="${esc(s.id)}">Dismiss</button>
          </div>
        </div>`;
      }).join('') || '<p class="rh-muted">Ask Roki for a trade idea</p>';

    const canTrade = state.symbol !== 'PAPER';
    const q = quoteMap[state.symbol] || {};

    return `
      <div class="rh-top">
        <div class="rh-stamp">DENIZEN · ROKI</div>
        <button type="button" class="rh-icon-btn" data-refresh aria-label="Refresh">↻</button>
      </div>

      <button type="button" class="rh-account-chip ${state.symbol === 'PAPER' ? 'is-on' : ''}" data-pick="PAPER">
        Investing · Paper
      </button>

      <section class="rh-hero">
        <div class="rh-sym">${esc(hero.title)}</div>
        <div class="rh-price">${money(hero.price)}</div>
        <div class="rh-chg ${tone === 'up' ? 'rh-up' : 'rh-down'}">
          ${money(hero.change)} (${pct(hero.changePercent)})
          <span class="rh-muted"> · ${esc(state.range)}</span>
        </div>
        <p class="rh-sub">${esc(hero.subtitle)}${hero.bid != null ? ` · Bid ${money(hero.bid)} Ask ${money(hero.ask)}` : ''} · ${liveBadge}</p>
      </section>

      <section class="rh-chart-wrap tone-${tone}">
        ${hero.chartHtml}
      </section>

      <div class="rh-ranges">${rangeBtns}</div>

      ${canTrade ? `
      <div class="rh-tradebar">
        <button type="button" class="rh-cta sell" data-paper="sell" data-symbol="${esc(state.symbol)}" data-price="${esc(q.price)}">Sell</button>
        <button type="button" class="rh-cta buy" data-paper="buy" data-symbol="${esc(state.symbol)}" data-price="${esc(q.price)}">Buy</button>
      </div>` : `
      <div class="rh-bp">
        <div><span>Buying power</span><b>${money(paper.buyingPower ?? paper.cash)}</b></div>
        <div><span>Cash</span><b>${money(paper.cash)}</b></div>
        <button type="button" class="rh-btn ghost" data-paper-reset>Reset $10k</button>
      </div>`}

      <section class="rh-sec">
        <h3>Stocks</h3>
        <div class="rh-list">${stockRows}</div>
        <form class="rh-add" data-watch-add>
          <input name="symbol" maxlength="8" placeholder="Add symbol" autocomplete="off" />
          <button type="submit" class="rh-btn">Add</button>
        </form>
      </section>

      <section class="rh-sec">
        <h3>Positions</h3>
        <div class="rh-list">${posRows}</div>
      </section>

      <section class="rh-sec">
        <h3>Roki ideas</h3>
        ${sugRows}
      </section>

      <section class="rh-sec">
        <h3>Paper activity</h3>
        ${tradeRows}
      </section>

      <p class="rh-foot">Paper only — Denizen never places live Robinhood orders from this desk.</p>
    `;
  }

  function ensureStyles() {
    let s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement('style');
      s.id = STYLE_ID;
      document.head.appendChild(s);
    }
    s.textContent = `
      #${PANEL_ID}{
        display:none;position:fixed;z-index:9200;inset:auto;
        background:${RH.bg};color:${RH.text};
        border:1px solid ${RH.line};border-radius:16px;
        box-shadow:0 24px 80px rgba(0,0,0,.65);
        padding:14px 14px 22px;max-width:420px;width:min(96vw,420px);
        max-height:min(88vh,760px);overflow:auto;font:13px/1.4 ${RH.body};
        -webkit-overflow-scrolling:touch;
      }
      #${PANEL_ID}.open{display:block}
      html.denizen-phone-mode #${PANEL_ID}{
        max-width:none;width:100%;max-height:none;height:100%;
        border-radius:0;border:0;box-shadow:none;padding:12px 14px 28px;
      }
      html.denizen-phone-mode #${PANEL_ID}.open{display:block !important}
      #${PANEL_ID} .rh-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      #${PANEL_ID} .rh-stamp{
        font:${RH.mono};font-size:9px;font-weight:800;letter-spacing:.14em;
        color:#031018;background:${RH.accent};padding:3px 8px;border-radius:999px;
      }
      #${PANEL_ID} .rh-icon-btn{
        border:0;background:transparent;color:${RH.muted};font-size:18px;cursor:pointer;padding:4px 8px;
      }
      #${PANEL_ID} .rh-account-chip{
        border:0;background:transparent;color:${RH.muted};font-size:13px;font-weight:600;
        padding:0;margin:0 0 10px;cursor:pointer;
      }
      #${PANEL_ID} .rh-account-chip.is-on{color:${RH.text}}
      #${PANEL_ID} .rh-hero .rh-sym{font-size:15px;font-weight:600;margin-bottom:2px}
      #${PANEL_ID} .rh-price{font-size:34px;font-weight:700;letter-spacing:-.03em;line-height:1.05}
      #${PANEL_ID} .rh-chg{font-size:14px;font-weight:600;margin-top:4px}
      #${PANEL_ID} .rh-sub{margin:6px 0 0;color:${RH.muted};font-size:12px}
      #${PANEL_ID} .rh-up{color:${RH.green}}
      #${PANEL_ID} .rh-down{color:${RH.red}}
      #${PANEL_ID} .rh-live{
        display:inline-block;font:${RH.mono};font-size:9px;font-weight:800;letter-spacing:.1em;
        color:#031018;background:${RH.green};padding:2px 7px;border-radius:999px;
      }
      #${PANEL_ID} .rh-chart-wrap{margin:8px -6px 4px;height:180px}
      #${PANEL_ID} .rh-chart-svg{width:100%;height:180px;display:block}
      #${PANEL_ID} .rh-chart-empty{
        height:180px;display:flex;align-items:center;justify-content:center;
        color:${RH.muted};border-bottom:1px solid ${RH.line};
      }
      #${PANEL_ID} .rh-ranges{
        display:flex;gap:2px;justify-content:space-between;padding:8px 0 12px;
        border-bottom:1px solid ${RH.line};margin-bottom:12px;
      }
      #${PANEL_ID} .rh-range{
        flex:1;border:0;background:transparent;color:${RH.muted};
        font-size:11px;font-weight:700;padding:8px 0;border-radius:999px;cursor:pointer;
      }
      #${PANEL_ID} .rh-range.is-on.tone-up{background:rgba(0,200,5,.15);color:${RH.green}}
      #${PANEL_ID} .rh-range.is-on.tone-down{background:rgba(255,80,0,.15);color:${RH.red}}
      #${PANEL_ID} .rh-tradebar{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:4px 0 16px}
      #${PANEL_ID} .rh-cta{
        border:0;border-radius:999px;padding:14px 12px;font-size:15px;font-weight:700;cursor:pointer;color:#000;
      }
      #${PANEL_ID} .rh-cta.buy{background:${RH.green}}
      #${PANEL_ID} .rh-cta.sell{background:${RH.red};color:#fff}
      #${PANEL_ID} .rh-bp{
        display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;
        padding:12px 0 16px;border-bottom:1px solid ${RH.line};margin-bottom:8px;
      }
      #${PANEL_ID} .rh-bp span{display:block;color:${RH.muted};font-size:11px;margin-bottom:2px}
      #${PANEL_ID} .rh-bp b{font-size:15px}
      #${PANEL_ID} .rh-sec{margin-top:18px}
      #${PANEL_ID} .rh-sec h3{
        margin:0 0 8px;font-size:18px;font-weight:700;letter-spacing:-.02em;
      }
      #${PANEL_ID} .rh-stock{
        width:100%;display:flex;justify-content:space-between;gap:12px;align-items:center;
        border:0;border-bottom:1px solid ${RH.line};background:transparent;color:${RH.text};
        text-align:left;padding:12px 2px;cursor:pointer;
      }
      #${PANEL_ID} .rh-stock.is-active{background:rgba(255,255,255,.04)}
      #${PANEL_ID} .rh-stock-left b,#${PANEL_ID} .rh-stock-right b{display:block;font-size:15px}
      #${PANEL_ID} .rh-stock-left small{color:${RH.muted};font-size:11px}
      #${PANEL_ID} .rh-stock-right{text-align:right}
      #${PANEL_ID} .rh-stock-right span{font-size:12px;font-weight:600}
      #${PANEL_ID} .rh-add{display:flex;gap:8px;margin-top:10px}
      #${PANEL_ID} .rh-add input{
        flex:1;background:${RH.surface};border:1px solid ${RH.line};color:${RH.text};
        border-radius:999px;padding:10px 14px;text-transform:uppercase;font:${RH.mono};
      }
      #${PANEL_ID} .rh-btn{
        border:0;border-radius:999px;padding:9px 14px;font-weight:700;cursor:pointer;
        background:${RH.green};color:#000;font-size:12px;
      }
      #${PANEL_ID} .rh-btn.ghost{background:${RH.surface};color:${RH.text};border:1px solid ${RH.line}}
      #${PANEL_ID} .rh-sug{padding:10px 0;border-bottom:1px solid ${RH.line}}
      #${PANEL_ID} .rh-sug p{margin:6px 0;color:#cfcfcf;font-size:13px}
      #${PANEL_ID} .rh-actions{display:flex;gap:8px;flex-wrap:wrap}
      #${PANEL_ID} .rh-trade{padding:8px 0;border-bottom:1px solid ${RH.line};font-size:13px}
      #${PANEL_ID} .rh-trade small{color:${RH.muted}}
      #${PANEL_ID} .rh-foot{
        margin-top:18px;color:${RH.muted};font-size:11px;line-height:1.45;
        border-top:1px solid ${RH.line};padding-top:12px;
      }
    `;
  }

  async function refresh(opts = {}) {
    const el = ensurePanel();
    if (!opts.silent) el.innerHTML = '<p class="rh-muted" style="padding:24px">Loading market…</p>';
    try {
      const data = await loadBase();
      if (state.symbol !== 'PAPER') {
        try {
          state.chart = await loadChart(state.symbol, state.range);
        } catch (err) {
          state.chart = { points: [], error: err.message, symbol: state.symbol, changePercent: 0 };
        }
      } else {
        state.chart = null;
      }
      el.innerHTML = render(data);
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'Timed out — try again' : (err?.message || 'Load failed');
      el.innerHTML = `<p class="rh-down" style="padding:16px">${esc(msg)}</p><button type="button" class="rh-btn" data-refresh>Retry</button>`;
    }
  }

  async function withBusy(fn) {
    if (busy) return;
    busy = true;
    try { await fn(); }
    finally { busy = false; }
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    ensureStyles();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'region');
    panelEl.setAttribute('aria-label', 'Roki Market');
    document.body.appendChild(panelEl);

    panelEl.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      withBusy(async () => {
        if (t.closest('[data-refresh]')) {
          await refresh();
          return;
        }
        const pick = t.closest('[data-pick]');
        if (pick) {
          state.symbol = pick.getAttribute('data-pick');
          await refresh({ silent: true });
          return;
        }
        const rangeBtn = t.closest('[data-range]');
        if (rangeBtn) {
          state.range = rangeBtn.getAttribute('data-range');
          await refresh({ silent: true });
          return;
        }
        const dismiss = t.closest('[data-dismiss]');
        if (dismiss) {
          await fetchJson(`/api/trade-suggestions/${encodeURIComponent(dismiss.getAttribute('data-dismiss'))}/dismiss`, { method: 'POST' });
          await refresh({ silent: true });
          return;
        }
        const paperSug = t.closest('[data-paper-sug]');
        if (paperSug) {
          await fetchJson(`/api/market/paper/from-suggestion/${encodeURIComponent(paperSug.getAttribute('data-paper-sug'))}`, { method: 'POST' });
          await refresh({ silent: true });
          return;
        }
        if (t.closest('[data-paper-reset]')) {
          if (!window.confirm('Reset Roki paper account to $10,000?')) return;
          await fetchJson('/api/market/paper/reset', { method: 'POST', body: '{}' });
          state.symbol = 'PAPER';
          await refresh({ silent: true });
          return;
        }
        const paperBtn = t.closest('[data-paper]');
        if (paperBtn) {
          const side = paperBtn.getAttribute('data-paper');
          const symbol = paperBtn.getAttribute('data-symbol');
          const price = Number(paperBtn.getAttribute('data-price'));
          await fetchJson('/api/market/paper/order', {
            method: 'POST',
            body: JSON.stringify({
              side,
              symbol,
              price,
              notional: side === 'buy' ? 250 : undefined,
              rationale: `Manual paper ${side} from Roki Market`,
              npc: 'Operator',
            }),
          });
          await refresh({ silent: true });
        }
      }).catch((err) => {
        const el = ensurePanel();
        const note = document.createElement('p');
        note.className = 'rh-down';
        note.style.padding = '8px 0';
        note.textContent = err?.message || 'Action failed';
        el.prepend(note);
      });
    });

    panelEl.addEventListener('submit', (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement) || !form.matches('[data-watch-add]')) return;
      e.preventDefault();
      const input = form.querySelector('input[name="symbol"]');
      const symbol = String(input?.value || '').trim().toUpperCase();
      if (!symbol) return;
      withBusy(async () => {
        await fetchJson('/api/market/watchlist', {
          method: 'POST',
          body: JSON.stringify({ action: 'add', symbol }),
        });
        state.symbol = symbol;
        await refresh({ silent: true });
      }).catch(() => {});
    });

    return panelEl;
  }

  function setOpen(open) {
    const el = ensurePanel();
    el.classList.toggle('open', !!open);
    el.setAttribute('data-open', open ? '1' : '0');
    document.documentElement.classList.toggle('denizen-market-open', !!open);
  }

  function show() {
    setOpen(true);
    refresh();
  }

  function hide() {
    setOpen(false);
  }

  ensurePanel();
  window.DenizenMarketPanel = { show, hide, refresh };
  document.addEventListener('denizen-phone-app-close', (e) => {
    if (e?.detail?.appId === 'market') hide();
  });
})();
