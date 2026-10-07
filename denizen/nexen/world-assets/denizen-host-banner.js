/* Preview banner for NEXEN shells hosted on Denizen without a private FastAPI backend. */
(function () {
  'use strict';
  if (document.getElementById('nexen-denizen-banner')) return;
  var bar = document.createElement('div');
  bar.id = 'nexen-denizen-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:sticky',
    'top:0',
    'z-index:9999',
    'padding:10px 14px',
    'font:600 12px/1.5 Segoe UI,system-ui,sans-serif',
    'color:#ffefd2',
    'background:linear-gradient(90deg,#5a3a12ee,#2a1a0cee)',
    'border-bottom:1px solid #ffcf9b55',
    'display:flex',
    'gap:12px',
    'align-items:center',
    'justify-content:space-between',
    'flex-wrap:wrap',
  ].join(';');
  bar.innerHTML = '<span><strong>Preview</strong> — layout only on Denizen. Tasks &amp; requests that save live on <a href="/nexen/" style="color:#c8f0ff">Today</a>.</span>'
    + '<a href="/nexen/" style="color:#0b2a49;background:linear-gradient(140deg,#c8f0ff,#62a9ef);padding:6px 10px;border-radius:8px;text-decoration:none;font-size:11px;font-weight:700">Open working hub</a>';
  document.documentElement.prepend(bar);
})();
