/**
 * Roki Market — phone app: watchlist, quotes, portfolio, trade suggestions.
 */
(function () {
  'use strict';

  const PANEL_ID = 'denizen-market-panel';
  const STYLE_ID = 'denizen-market-style';
  const FETCH_TIMEOUT_MS = 12000;

  let panelEl = null;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  async function fetchJson(path, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(path, { ...opts, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || 'request failed');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadData() {
    const [auth, watchlist, suggestions, quoteRes] = await Promise.all([
      fetchJson('/api/market/auth-status').catch(() => ({ authenticated: false })),
      fetchJson('/api/market/watchlist').catch(() => ({ symbols: [] })),
      fetchJson('/api/trade-suggestions').catch(() => ({ suggestions: [] })),
      fetchJson('/api/market/quote?symbols=NVDA,TSLA,AAPL').catch(() => []),
    ]);
    let portfolio = null;
    if (auth.authenticated) {
      portfolio = await fetchJson('/api/market/portfolio').catch(() => null);
    }
    const quotes = Array.isArray(quoteRes) ? quoteRes : (quoteRes.quotes || []);
    return { auth, watchlist, suggestions, quotes, portfolio };
  }

  function render(data) {
    const bp = data.portfolio?.data?.buying_power?.buying_power
      || data.portfolio?.buying_power?.buying_power;
    const cash = data.portfolio?.data?.cash || data.portfolio?.cash;
    const authLine = data.auth.authenticated
      ? `<span class="mk-ok">Robinhood connected</span>`
      : `<span class="mk-warn">Yahoo fallback — connect Robinhood via local OAuth</span>`;

    const quoteRows = (data.quotes || []).map((q) => `
      <div class="mk-row">
        <b>${esc(q.symbol)}</b>
        <span>$${esc(Number(q.price || 0).toFixed(2))}</span>
        <span class="${(q.changePercent || 0) >= 0 ? 'mk-up' : 'mk-down'}">
          ${q.changePercent != null ? `${q.changePercent > 0 ? '+' : ''}${q.changePercent}%` : '—'}
        </span>
        <small>${esc(q.source || '')}</small>
      </div>`).join('');

    const sugRows = (data.suggestions?.suggestions || data.suggestions || [])
      .filter((s) => s.status !== 'dismissed')
      .slice(0, 8)
      .map((s) => `
      <div class="mk-sug">
        <div><b>${esc(s.action || 'watch').toUpperCase()} ${esc(s.symbol)}</b>
          <small>${esc(s.at || s.created_at || '').slice(0, 10)}</small></div>
        <p>${esc(s.rationale || '')}</p>
        <button type="button" class="mk-dismiss" data-id="${esc(s.id)}">Dismiss</button>
      </div>`).join('') || '<p class="mk-muted">No pending suggestions — ask Roki in chat.</p>';

    return `
      <div class="mk-head">
        <h2>Roki Market</h2>
        <p>${authLine}</p>
        ${bp != null ? `<p class="mk-budget">Buying power: <b>$${esc(Number(bp).toFixed(2))}</b>${cash != null ? ` · Cash $${esc(cash)}` : ''}</p>` : ''}
      </div>
      <section>
        <h3>Watchlist</h3>
        <p class="mk-tags">${(data.watchlist.symbols || []).map((s) => `<span>${esc(s)}</span>`).join('') || '—'}</p>
      </section>
      <section>
        <h3>Quotes</h3>
        ${quoteRows || '<p class="mk-muted">No quotes</p>'}
      </section>
      <section>
        <h3>Suggestions <small>ideas only — not orders</small></h3>
        ${sugRows}
      </section>
      <p class="mk-foot">Execute trades in Robinhood or Cursor Robinhood MCP. Denizen never auto-trades.</p>
    `;
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${PANEL_ID}{display:none;position:fixed;z-index:9200;background:#0f172a;color:#e2e8f0;
        border:1px solid #334155;border-radius:14px;padding:16px;max-width:420px;width:min(92vw,420px);
        max-height:min(80vh,640px);overflow:auto;font:13px/1.45 system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.45)}
      #${PANEL_ID}.open{display:block}
      html.denizen-phone-mode #${PANEL_ID}{max-width:none;width:100%;max-height:none;height:100%;border-radius:0;border:0;box-shadow:none}
      html.denizen-phone-mode #${PANEL_ID}.open{display:block !important}
      #${PANEL_ID} h2{margin:0 0 6px;font-size:18px}
      #${PANEL_ID} h3{margin:14px 0 6px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em}
      #${PANEL_ID} section{margin-bottom:8px}
      #${PANEL_ID} .mk-ok{color:#4ade80}
      #${PANEL_ID} .mk-warn{color:#fbbf24}
      #${PANEL_ID} .mk-budget{background:#1e293b;padding:8px 10px;border-radius:8px;margin:8px 0}
      #${PANEL_ID} .mk-row{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;padding:6px 0;border-bottom:1px solid #1e293b}
      #${PANEL_ID} .mk-up{color:#4ade80}
      #${PANEL_ID} .mk-down{color:#f87171}
      #${PANEL_ID} .mk-tags span{display:inline-block;background:#1e293b;padding:4px 8px;border-radius:6px;margin:2px}
      #${PANEL_ID} .mk-sug{background:#1e293b;border-radius:8px;padding:10px;margin:8px 0}
      #${PANEL_ID} .mk-sug p{margin:6px 0;color:#cbd5e1}
      #${PANEL_ID} .mk-dismiss{background:#334155;border:0;color:#e2e8f0;padding:6px 10px;border-radius:6px;cursor:pointer}
      #${PANEL_ID} .mk-muted{color:#64748b}
      #${PANEL_ID} .mk-foot{font-size:11px;color:#64748b;margin-top:12px}
    `;
    document.head.appendChild(s);
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    ensureStyles();
    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.setAttribute('role', 'region');
    panelEl.setAttribute('aria-label', 'Roki Market');
    document.body.appendChild(panelEl);
    panelEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('.mk-dismiss');
      if (!btn) return;
      const id = btn.getAttribute('data-id');
      if (!id) return;
      btn.disabled = true;
      try {
        await fetchJson(`/api/trade-suggestions/${encodeURIComponent(id)}/dismiss`, { method: 'POST' });
        await refresh();
      } catch (_) {
        btn.disabled = false;
      }
    });
    return panelEl;
  }

  function setOpen(open) {
    const el = ensurePanel();
    el.classList.toggle('open', !!open);
    el.setAttribute('data-open', open ? '1' : '0');
    document.documentElement.classList.toggle('denizen-market-open', !!open);
  }

  async function refresh() {
    const el = ensurePanel();
    el.innerHTML = '<p class="mk-muted">Loading market data…</p>';
    try {
      const data = await loadData();
      el.innerHTML = render(data);
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'Market data timed out — try again' : (err?.message || 'Load failed');
      el.innerHTML = `<p class="mk-warn">${esc(msg)}</p>`;
    }
  }

  function show() {
    setOpen(true);
    refresh();
  }

  function hide() {
    setOpen(false);
  }

  // Eager init so phone UI finds #denizen-market-panel before open() runs.
  ensurePanel();

  window.DenizenMarketPanel = { show, hide, refresh };

  document.addEventListener('denizen-phone-app-close', (e) => {
    if (e?.detail?.appId === 'market') hide();
  });
})();
