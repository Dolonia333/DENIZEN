/**
 * Sticky back chrome when a tool is opened inside the phone Office Build iframe.
 * Load on tool pages: <script src="/src/phone-embed-back.js" defer></script>
 */
(function () {
  try {
    const path = String(window.location.pathname || '');
    if (/workflow-dashboard\.html$/i.test(path)) return;
    const params = new URLSearchParams(window.location.search);
    const embed = params.has('embed') || params.get('from') === 'phone';
    const inFrame = window.self !== window.top;
    if (!embed && !inFrame) return;
    if (document.getElementById('dzp-phone-embed-back')) return;

    const bar = document.createElement('div');
    bar.id = 'dzp-phone-embed-back';
    globalThis.DenizenSafeDom.setSafeHtml(bar, `
      <a class="dzp-back-link" href="/workflow-dashboard.html?embed=1">← Office Build</a>
      <span class="dzp-back-hint">Phone tool</span>
    `);
    const style = document.createElement('style');
    style.textContent = `
      #dzp-phone-embed-back {
        position: sticky;
        top: 0;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 12px;
        background: rgba(10, 14, 26, 0.96);
        border-bottom: 1px solid #243049;
        font-family: system-ui, sans-serif;
      }
      #dzp-phone-embed-back .dzp-back-link {
        color: #e94560;
        font-weight: 700;
        font-size: 13px;
        text-decoration: none;
      }
      #dzp-phone-embed-back .dzp-back-link:hover { color: #ff6b81; }
      #dzp-phone-embed-back .dzp-back-hint {
        color: #8b9bb8;
        font-size: 11px;
      }
      body.dzp-has-phone-back { padding-top: 0; }
    `;
    document.documentElement.classList.add('dzp-has-phone-back');
    const mount = () => {
      if (!document.body) return;
      if (!style.parentNode) document.head.appendChild(style);
      if (!bar.parentNode) document.body.insertBefore(bar, document.body.firstChild);
    };
    if (document.body) mount();
    else document.addEventListener('DOMContentLoaded', mount);
  } catch (_) { /* ignore */ }
})();
