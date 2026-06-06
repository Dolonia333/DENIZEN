/**
 * Visitor handoff UI — send assistant context to Lucy, CEO, or teammates.
 * Attaches to globalThis.DenizenVisitorHandoffUI (no imports).
 */
(function () {
  'use strict';

  const STYLE_ID = 'denizen-visitor-handoff-ui-style';
  const BTN_ID = 'denizen-visitor-handoff-btn';
  const MODAL_ID = 'denizen-visitor-handoff-modal';
  const TOAST_ID = 'denizen-visitor-handoff-toast';
  const POLL_MS = 12000;

  let playerChat = null;
  let pollTimer = null;
  let handoffBtn = null;
  let modalEl = null;
  let submitting = false;
  const seenHandoffIds = new Set();
  let wsListenerBound = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID} {
        margin-left: 8px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(96, 165, 250, 0.12);
        border: 1px solid rgba(96, 165, 250, 0.35);
        color: #93c5fd;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        vertical-align: middle;
      }
      #${BTN_ID}:hover { background: rgba(96, 165, 250, 0.22); border-color: #60a5fa; }
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 100560;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.88);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #${MODAL_ID} .vis-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 20px 24px;
        width: min(420px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      }
      #${MODAL_ID} h3 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #e2e8f0;
      }
      #${MODAL_ID} p {
        margin: 0 0 12px;
        font-size: 11px;
        color: #94a3b8;
      }
      #${MODAL_ID} label {
        display: block;
        font-size: 10px;
        color: #64748b;
        margin-bottom: 4px;
      }
      #denizen-handoff-recipient,
      #denizen-handoff-message {
        width: 100%;
        box-sizing: border-box;
        background: #1e293b;
        border: 1px solid #1f2937;
        border-radius: 6px;
        color: #e2e8f0;
        padding: 10px 12px;
        font: inherit;
        font-size: 12px;
        outline: none;
        margin-bottom: 12px;
      }
      #denizen-handoff-message {
        min-height: 96px;
        resize: vertical;
      }
      #denizen-handoff-recipient:focus,
      #denizen-handoff-message:focus { border-color: #4ade80; }
      #denizen-handoff-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      #denizen-handoff-actions button {
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        border: 1px solid #1f2937;
      }
      #denizen-handoff-cancel {
        background: #1e293b;
        color: #94a3b8;
      }
      #denizen-handoff-send {
        background: #4ade80;
        color: #0f172a;
        border-color: transparent;
      }
      #denizen-handoff-send:disabled { opacity: 0.5; cursor: not-allowed; }
      #${TOAST_ID} {
        position: fixed;
        z-index: 100600;
        top: calc(12px + env(safe-area-inset-top, 0px));
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
        background: #020617;
        border: 1px solid #1f2937;
        color: #e2e8f0;
        padding: 10px 18px;
        border-radius: 8px;
        font: 12px ui-monospace, monospace;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.25s, transform 0.25s;
        max-width: min(92vw, 420px);
      }
      #${TOAST_ID}.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
        pointer-events: auto;
      }
      #${TOAST_ID} .handoff-toast-actions {
        display: flex;
        gap: 8px;
        margin-top: 8px;
        justify-content: flex-end;
      }
      #${TOAST_ID} .handoff-toast-reply {
        background: #4ade80;
        color: #0f172a;
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
      }
      #denizen-handoff-recipient option.online-teammate {
        color: #86efac;
      }
      .denizen-handoff-log-reply {
        margin-left: 8px;
        padding: 1px 8px;
        border-radius: 999px;
        background: rgba(74, 222, 128, 0.15);
        border: 1px solid rgba(74, 222, 128, 0.4);
        color: #86efac;
        font: inherit;
        font-size: 10px;
        font-weight: bold;
        cursor: pointer;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(s);
  }

  function showToast(text, { actions } = {}) {
    injectStyles();
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = text;
    el.appendChild(msg);
    if (actions?.length) {
      const row = document.createElement('div');
      row.className = 'handoff-toast-actions';
      actions.forEach(({ label, onClick }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'handoff-toast-reply';
        btn.textContent = label;
        btn.addEventListener('click', () => {
          el.classList.remove('show');
          onClick?.();
        });
        row.appendChild(btn);
      });
      el.appendChild(row);
    }
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), actions?.length ? 12000 : 3200);
  }

  function ensureHandoffBtn() {
    if (handoffBtn) return handoffBtn;
    const sess = globalThis.DenizenVisitorSession;
    if (sess?.isCeoMode?.()) return null;
    injectStyles();
    const header = document.getElementById('player-chat-header');
    const targetWrap = header?.querySelector('div');
    handoffBtn = document.createElement('button');
    handoffBtn.id = BTN_ID;
    handoffBtn.type = 'button';
    handoffBtn.textContent = '↗ Hand off';
    handoffBtn.title = 'Hand off context to Lucy, CEO, or a teammate';
    handoffBtn.addEventListener('click', () => openModal());
    if (targetWrap) {
      targetWrap.appendChild(handoffBtn);
    } else if (header) {
      header.appendChild(handoffBtn);
    } else {
      document.body.appendChild(handoffBtn);
    }
    return handoffBtn;
  }

  async function buildRecipientOptions(selectEl) {
    const sess = globalThis.DenizenVisitorSession;
    selectEl.innerHTML = '';
    const defaults = [
      { value: 'lucy', label: "Lucy (CEO's personal assistant)" },
      ...(globalThis.DenizenVisitorCapabilities?.canHandoffToCeo?.()
        ? [{ value: 'ceo', label: 'CEO team' }]
        : []),
    ];
    defaults.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      selectEl.appendChild(o);
    });

    try {
      const teammates = await sess?.listTeammates?.() || [];
      teammates.forEach((tm) => {
        const sid = tm.session_id || tm.id;
        if (!sid || sid === sess?.getSessionId?.()) return;
        const name = tm.display_name || tm.displayName || 'Teammate';
        const asst = tm.assistant_name || tm.npc_key || '';
        const online = tm.online === true;
        const o = document.createElement('option');
        o.value = `session:${sid}`;
        o.textContent = `${online ? '🟢 ' : ''}${asst ? `${name} (${asst})` : name}`;
        if (online) o.className = 'online-teammate';
        selectEl.appendChild(o);
      });
    } catch (err) {
      console.warn('[DenizenVisitorHandoffUI] listTeammates failed:', err?.message || err);
    }
  }

  function parseRecipient(value) {
    if (value === 'lucy') return { toNpc: 'lucy' };
    if (value === 'ceo') return { toCeo: true };
    if (value.startsWith('session:')) return { toSessionId: value.slice(8) };
    return { toDisplayName: value };
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  async function openModal(prefill = {}) {
    if (modalEl) return;
    injectStyles();
    modalEl = document.createElement('div');
    modalEl.id = MODAL_ID;
    modalEl.innerHTML = `
      <div class="vis-card">
        <h3>${prefill.replyTo ? 'Reply to handoff' : 'Hand off to someone'}</h3>
        <p>${prefill.replyTo
    ? 'Send a reply back to the teammate who handed this off.'
    : 'Your assistant will pass context along — Lucy, the CEO team, or a teammate.'}</p>
        <label for="denizen-handoff-recipient">Recipient</label>
        <select id="denizen-handoff-recipient"></select>
        <label for="denizen-handoff-message">Message</label>
        <textarea id="denizen-handoff-message" maxlength="2000" placeholder="What should they know?"></textarea>
        <div id="denizen-handoff-actions">
          <button type="button" id="denizen-handoff-cancel">Cancel</button>
          <button type="button" id="denizen-handoff-send">${prefill.replyTo ? 'Send reply' : 'Send handoff'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);

    const selectEl = modalEl.querySelector('#denizen-handoff-recipient');
    const msgEl = modalEl.querySelector('#denizen-handoff-message');
    const sendBtn = modalEl.querySelector('#denizen-handoff-send');
    await buildRecipientOptions(selectEl);

    if (prefill.toSessionId) {
      selectEl.value = `session:${prefill.toSessionId}`;
      if (selectEl.value !== `session:${prefill.toSessionId}`) {
        const o = document.createElement('option');
        o.value = `session:${prefill.toSessionId}`;
        o.textContent = prefill.toDisplayName || 'Teammate';
        selectEl.appendChild(o);
        selectEl.value = o.value;
      }
      if (prefill.replyTo) selectEl.disabled = true;
    }
    if (prefill.message) msgEl.value = prefill.message;

    modalEl.querySelector('#denizen-handoff-cancel').addEventListener('click', closeModal);
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeModal();
    });

    const submit = async () => {
      if (submitting) return;
      const message = String(msgEl.value || '').trim();
      if (!message) {
        msgEl.focus();
        return;
      }
      submitting = true;
      sendBtn.disabled = true;
      try {
        const sess = globalThis.DenizenVisitorSession;
        if (prefill.replyHandoff) {
          await sess?.sendHandoffReply?.(prefill.replyHandoff, message);
        } else {
          const payload = { message, ...parseRecipient(selectEl.value) };
          if (sess?.isCeoMode?.()) {
            await sess.sendCeoHandoff(payload);
          } else {
            await sess.sendHandoff(payload);
          }
        }
        showToast(prefill.replyTo ? 'Reply sent' : 'Handoff sent');
        closeModal();
      } catch (err) {
        showToast(err?.message || 'Handoff failed');
      } finally {
        submitting = false;
        sendBtn.disabled = false;
      }
    };

    sendBtn.addEventListener('click', submit);
    msgEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
    setTimeout(() => msgEl.focus(), 50);
  }

  function openReplyModal(handoff) {
    const toSessionId = handoff?.from_session_id || handoff?.fromSessionId;
    if (!toSessionId) {
      showToast('Cannot reply — no sender session');
      return;
    }
    openModal({
      replyTo: true,
      replyHandoff: handoff,
      toSessionId,
      toDisplayName: handoffFromName(handoff),
    });
  }

  function handoffFromName(handoff) {
    return handoff.from_display_name
      || handoff.fromDisplayName
      || handoff.from_name
      || 'Someone';
  }

  function handoffNpcName(handoff) {
    return handoff.from_npc || handoff.fromNpc || 'NPC';
  }

  async function ingestHandoff(handoff, { markRead = true } = {}) {
    if (!handoff) return;
    const id = handoff.id || handoff.handoff_id;
    if (id && seenHandoffIds.has(id)) return;
    if (id) seenHandoffIds.add(id);

    const from = handoffFromName(handoff);
    const npc = handoffNpcName(handoff);
    const message = String(handoff.message || '').trim();
    if (!message) return;

    const canReply = !!(handoff.from_session_id || handoff.fromSessionId);
    showToast(`Handoff from ${from}`, {
      actions: canReply ? [{ label: 'Reply', onClick: () => openReplyModal(handoff) }] : undefined,
    });
    playerChat?._addToLog?.('System', `Handoff from ${from}'s ${npc}: ${message}`);

    if (markRead && id) {
      try {
        await globalThis.DenizenVisitorSession?.markHandoffRead?.(id);
      } catch (err) {
        console.warn('[DenizenVisitorHandoffUI] markHandoffRead failed:', err?.message || err);
      }
    }
  }

  async function pollPending() {
    const sess = globalThis.DenizenVisitorSession;
    if (!sess?.getSessionId?.()) return;
    try {
      const pending = await sess.pollHandoffs();
      if (!Array.isArray(pending)) return;
      for (const handoff of pending) {
        await ingestHandoff(handoff, { markRead: true });
      }
    } catch (err) {
      console.warn('[DenizenVisitorHandoffUI] pollHandoffs failed:', err?.message || err);
    }
  }

  function wireWsListener() {
    if (wsListenerBound) return;
    const attach = (ws) => {
      if (!ws || ws._denizenHandoffListener) return;
      ws._denizenHandoffListener = true;
      ws.addEventListener('message', (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === 'assistant_handoff') {
            DenizenVisitorHandoffUI.showIncoming(msg);
          }
        } catch (_) {}
      });
    };
    attach(window.__DenizenAgentWs);
    wsListenerBound = true;
    const origConnect = window.AgentOfficeManager?.prototype?.connect;
    if (typeof origConnect === 'function' && !origConnect._handoffPatched) {
      window.AgentOfficeManager.prototype.connect = function patchedConnect(...args) {
        origConnect.apply(this, args);
        if (this.ws) attach(this.ws);
      };
      window.AgentOfficeManager.prototype.connect._handoffPatched = true;
    }
  }

  const DenizenVisitorHandoffUI = {
    attach(pc) {
      playerChat = pc;
      injectStyles();
      ensureHandoffBtn();
      wireWsListener();

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollPending, POLL_MS);
      globalThis.DenizenVisitorSession?.init?.().then(pollPending).catch(() => {});

      console.log('[DenizenVisitorHandoffUI] attached');
    },

    showIncoming(handoff) {
      ingestHandoff(handoff, { markRead: true });
    },

    openReply(handoff) {
      openReplyModal(handoff);
    },

    detach() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      closeModal();
      playerChat = null;
    },
  };

  globalThis.DenizenVisitorHandoffUI = DenizenVisitorHandoffUI;
})();
