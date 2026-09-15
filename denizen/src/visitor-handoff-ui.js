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
  const seenConnectionRequestIds = new Set();
  let wsListenerBound = false;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID} {
        margin: 0;
        padding: 4px 8px;
        border-radius: 4px;
        background: rgba(96, 165, 250, 0.12);
        border: 1px solid rgba(96, 165, 250, 0.35);
        color: #93c5fd;
        font: 700 9px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        letter-spacing: 0.04em;
        cursor: pointer;
        flex-shrink: 0;
        white-space: nowrap;
        touch-action: manipulation;
      }
      #${BTN_ID}:hover { background: rgba(96, 165, 250, 0.22); border-color: #60a5fa; }
      html.denizen-touch #${BTN_ID} {
        padding: 6px 8px;
        min-height: 32px;
      }
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
        width: min(520px, calc(100vw - 32px));
        max-height: min(86vh, 760px);
        overflow: auto;
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
      #denizen-handoff-message,
      #denizen-connection-email,
      #denizen-connection-note {
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
      #denizen-connection-note {
        min-height: 56px;
        resize: vertical;
      }
      #denizen-handoff-recipient:focus,
      #denizen-handoff-message:focus,
      #denizen-connection-email:focus,
      #denizen-connection-note:focus { border-color: #4ade80; }
      #denizen-connection-panel {
        margin: 4px 0 14px;
        padding: 12px;
        border: 1px solid #1f2937;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.68);
      }
      .denizen-connection-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
      }
      .denizen-connection-title {
        color: #e2e8f0;
        font-size: 11px;
        font-weight: bold;
      }
      .denizen-connection-muted {
        color: #64748b;
        font-size: 10px;
      }
      .denizen-connection-list {
        display: grid;
        gap: 6px;
        margin: 0 0 10px;
      }
      .denizen-connection-row {
        display: grid;
        gap: 3px;
        padding: 8px;
        border: 1px solid #1f2937;
        border-radius: 6px;
        background: #0f172a;
      }
      .denizen-connection-row strong {
        color: #e2e8f0;
        font-size: 11px;
      }
      .denizen-connection-row span {
        color: #94a3b8;
        font-size: 10px;
      }
      .denizen-connection-row-actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
        margin-top: 4px;
      }
      .denizen-connection-row-actions button,
      #denizen-connection-request-btn {
        border-radius: 6px;
        border: 1px solid #334155;
        background: #1e293b;
        color: #cbd5e1;
        cursor: pointer;
        font: inherit;
        font-size: 10px;
        font-weight: bold;
        padding: 6px 10px;
      }
      .denizen-connection-row-actions button[data-action="accept"],
      #denizen-connection-request-btn {
        background: #4ade80;
        border-color: transparent;
        color: #0f172a;
      }
      #denizen-connection-request-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
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
    handoffBtn = document.createElement('button');
    handoffBtn.id = BTN_ID;
    handoffBtn.type = 'button';
    handoffBtn.textContent = 'Hand off';
    handoffBtn.title = 'Hand off context to Lucy, CEO, or a teammate';
    handoffBtn.addEventListener('click', () => openModal());
    const actions = document.getElementById('player-chat-header-actions');
    const closeBtn = document.getElementById('player-chat-close-btn');
    if (actions) {
      actions.insertBefore(handoffBtn, closeBtn || null);
    } else {
      const header = document.getElementById('player-chat-header');
      if (header && closeBtn) header.insertBefore(handoffBtn, closeBtn);
      else header?.appendChild(handoffBtn) || document.body.appendChild(handoffBtn);
    }
    return handoffBtn;
  }

  async function buildRecipientOptions(selectEl, connectionData = null) {
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
        const teamName = tm.npc_team_name || tm.npcTeamName || null;
        const teamMembers = Number(tm.npc_team_members ?? tm.npcTeamMembers ?? 0) || 0;
        const online = tm.online === true;
        const o = document.createElement('option');
        o.value = `session:${sid}`;
        const npcLabel = teamName
          ? `${teamName}${teamMembers ? ` · ${teamMembers} NPCs` : ''}`
          : (asst ? `${asst}` : 'NPC team not set');
        o.textContent = `${online ? '🟢 ' : ''}${name} (${npcLabel})`;
        if (online) o.className = 'online-teammate';
        selectEl.appendChild(o);
      });
    } catch (err) {
      console.warn('[DenizenVisitorHandoffUI] listTeammates failed:', err?.message || err);
    }

    try {
      const data = connectionData || await sess?.listConnections?.();
      const accepted = Array.isArray(data?.connections) ? data.connections : [];
      const group = document.createElement('optgroup');
      group.label = 'Accepted connections';
      let count = 0;
      accepted.forEach((conn) => {
        const sid = conn.target_session_id || conn.targetSessionId;
        if (!sid || sid === sess?.getSessionId?.()) return;
        if (!conn.can_message) return;
        const name = conn.other_display_name || conn.target_display_name || 'Connection';
        const asst = conn.assistant_name || conn.assistant_npc || 'assistant';
        const o = document.createElement('option');
        o.value = `session:${sid}`;
        o.dataset.connection = '1';
        o.dataset.canMessage = '1';
        o.textContent = `${name} (connection - ${asst})`;
        group.appendChild(o);
        count += 1;
      });
      if (count) selectEl.appendChild(group);
    } catch (err) {
      console.warn('[DenizenVisitorHandoffUI] listConnections failed:', err?.message || err);
    }
  }

  function parseRecipient(value) {
    if (value === 'lucy') return { toNpc: 'lucy' };
    if (value === 'ceo') return { toCeo: true };
    if (value.startsWith('session:')) return { toSessionId: value.slice(8) };
    return { toDisplayName: value };
  }

  async function loadConnectionData() {
    try {
      const data = await globalThis.DenizenVisitorSession?.listConnections?.();
      return data || { connections: [], incoming: [], outgoing: [] };
    } catch (err) {
      return {
        error: err?.message || String(err),
        connections: [],
        incoming: [],
        outgoing: [],
      };
    }
  }

  function connectionLabel(conn) {
    const name = conn?.other_display_name || conn?.target_display_name || 'Connection';
    const email = conn?.other_email ? ` - ${conn.other_email}` : '';
    return `${name}${email}`;
  }

  function appendConnectionRow(listEl, conn, { kind, onAccept, onDecline, onBlock } = {}) {
    const row = document.createElement('div');
    row.className = 'denizen-connection-row';
    const title = document.createElement('strong');
    title.textContent = connectionLabel(conn);
    const detail = document.createElement('span');
    if (kind === 'incoming') {
      detail.textContent = conn.request_message || 'Wants to connect assistants across teams.';
    } else if (kind === 'outgoing') {
      detail.textContent = 'Waiting for them to accept.';
    } else if (conn.can_message) {
      detail.textContent = `Ready for assistant messages${conn.assistant_name ? ` via ${conn.assistant_name}` : ''}.`;
    } else {
      detail.textContent = 'Accepted, waiting for their office session.';
    }
    row.appendChild(title);
    row.appendChild(detail);
    if (kind === 'incoming') {
      const actions = document.createElement('div');
      actions.className = 'denizen-connection-row-actions';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.dataset.action = 'accept';
      accept.textContent = 'Accept';
      accept.addEventListener('click', onAccept);
      const decline = document.createElement('button');
      decline.type = 'button';
      decline.dataset.action = 'decline';
      decline.textContent = 'Decline';
      decline.addEventListener('click', onDecline);
      actions.appendChild(decline);
      actions.appendChild(accept);
      row.appendChild(actions);
    } else if (kind === 'accepted' && typeof onBlock === 'function') {
      const actions = document.createElement('div');
      actions.className = 'denizen-connection-row-actions';
      const block = document.createElement('button');
      block.type = 'button';
      block.dataset.action = 'block';
      block.textContent = 'Block';
      block.addEventListener('click', onBlock);
      actions.appendChild(block);
      row.appendChild(actions);
    }
    listEl.appendChild(row);
  }

  async function refreshConnectionPanel(panelEl, selectEl) {
    const data = await loadConnectionData();
    await buildRecipientOptions(selectEl, data);
    renderConnectionPanel(panelEl, selectEl, data);
    return data;
  }

  function renderConnectionPanel(panelEl, selectEl, data) {
    if (!panelEl) return;
    const listEl = panelEl.querySelector('.denizen-connection-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    if (data?.error) {
      const row = document.createElement('div');
      row.className = 'denizen-connection-row';
      const detail = document.createElement('span');
      detail.textContent = data.error;
      row.appendChild(detail);
      listEl.appendChild(row);
      return;
    }

    const incoming = Array.isArray(data?.incoming) ? data.incoming : [];
    const outgoing = Array.isArray(data?.outgoing) ? data.outgoing : [];
    const accepted = Array.isArray(data?.connections) ? data.connections : [];

    incoming.forEach((conn) => {
      appendConnectionRow(listEl, conn, {
        kind: 'incoming',
        onAccept: async () => {
          try {
            await globalThis.DenizenVisitorSession?.respondConnection?.(conn.id, 'accept');
            showToast('Connection accepted');
            await refreshConnectionPanel(panelEl, selectEl);
          } catch (err) {
            showToast(err?.message || 'Could not accept connection');
          }
        },
        onDecline: async () => {
          try {
            await globalThis.DenizenVisitorSession?.respondConnection?.(conn.id, 'decline');
            showToast('Connection declined');
            await refreshConnectionPanel(panelEl, selectEl);
          } catch (err) {
            showToast(err?.message || 'Could not decline connection');
          }
        },
      });
    });
    outgoing.forEach((conn) => appendConnectionRow(listEl, conn, { kind: 'outgoing' }));
    accepted.forEach((conn) => appendConnectionRow(listEl, conn, {
      kind: 'accepted',
      onBlock: async () => {
        try {
          await globalThis.DenizenVisitorSession?.respondConnection?.(conn.id, 'block');
          showToast('Connection blocked');
          await refreshConnectionPanel(panelEl, selectEl);
        } catch (err) {
          showToast(err?.message || 'Could not block connection');
        }
      },
    }));

    if (!incoming.length && !outgoing.length && !accepted.length) {
      const empty = document.createElement('div');
      empty.className = 'denizen-connection-muted';
      empty.textContent = 'No outside-team requests pending.';
      listEl.appendChild(empty);
    }
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
    : 'Your assistant will message their assistant across your team or accepted outside-team connections.'}</p>
        <label for="denizen-handoff-recipient">Recipient</label>
        <select id="denizen-handoff-recipient"></select>
        <div id="denizen-connection-panel">
          <div class="denizen-connection-head">
            <div class="denizen-connection-title">Outside your team</div>
            <div class="denizen-connection-muted">Requests require acceptance</div>
          </div>
          <div class="denizen-connection-list"></div>
          <label for="denizen-connection-email">Email</label>
          <input id="denizen-connection-email" type="email" maxlength="320" placeholder="teammate@company.com">
          <label for="denizen-connection-note">Request note</label>
          <textarea id="denizen-connection-note" maxlength="1000" placeholder="I have a question for your team when you have a moment."></textarea>
          <button type="button" id="denizen-connection-request-btn">Request connection</button>
        </div>
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
    const panelEl = modalEl.querySelector('#denizen-connection-panel');
    const emailEl = modalEl.querySelector('#denizen-connection-email');
    const noteEl = modalEl.querySelector('#denizen-connection-note');
    const requestBtn = modalEl.querySelector('#denizen-connection-request-btn');
    let connectionData = prefill.replyTo ? null : await loadConnectionData();
    await buildRecipientOptions(selectEl, connectionData);
    if (prefill.replyTo && panelEl) {
      panelEl.hidden = true;
    } else {
      renderConnectionPanel(panelEl, selectEl, connectionData);
    }

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

    requestBtn?.addEventListener('click', async () => {
      const email = String(emailEl?.value || '').trim();
      if (!email) {
        emailEl?.focus();
        return;
      }
      requestBtn.disabled = true;
      try {
        await globalThis.DenizenVisitorSession?.requestConnection?.({
          targetEmail: email,
          message: noteEl?.value || '',
        });
        if (emailEl) emailEl.value = '';
        if (noteEl) noteEl.value = '';
        showToast('Connection request sent');
        connectionData = await refreshConnectionPanel(panelEl, selectEl);
      } catch (err) {
        showToast(err?.message || 'Connection request failed');
      } finally {
        requestBtn.disabled = false;
      }
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
          if (payload.toSessionId) {
            const selected = selectEl.selectedOptions?.[0];
            if (selected?.dataset?.connection === '1' && selected?.dataset?.canMessage !== '1') {
              showToast('Their office is offline — wait until they open Denizen.');
              return;
            }
          }
          if (sess?.isCeoMode?.()) {
            await sess.sendCeoHandoff(payload);
          } else if (payload.toSessionId) {
            await sess.sendOfficeBus({
              toSessionId: payload.toSessionId,
              message,
              intent: 'sync',
            });
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
    if (handoff?.handoff) handoff = handoff.handoff;
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
    await pollConnectionRequests();
  }

  async function pollConnectionRequests() {
    const sess = globalThis.DenizenVisitorSession;
    if (!sess?.getSessionId?.()) return;
    try {
      const data = await sess.listConnections?.();
      const incoming = Array.isArray(data?.incoming) ? data.incoming : [];
      incoming.forEach((conn) => {
        if (!conn?.id || seenConnectionRequestIds.has(conn.id)) return;
        seenConnectionRequestIds.add(conn.id);
        const from = conn.other_display_name || conn.other_email || 'Someone';
        showToast(`Connection request from ${from}`, {
          actions: [{ label: 'Open', onClick: () => openModal() }],
        });
      });
    } catch (_) {
      /* profile-less sessions can still use same-team handoffs */
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
          if (msg.type === 'assistant_handoff' || msg.type === 'office_bus_message') {
            DenizenVisitorHandoffUI.showIncoming(msg.handoff || msg);
          } else if (msg.type === 'visitor_connection_update') {
            const conn = msg.connection || {};
            const event = msg.event || 'update';
            if (event === 'incoming_request') {
              const from = conn.other_display_name || conn.other_email || 'Someone';
              showToast(`Connection request from ${from}`, {
                actions: [{ label: 'Open', onClick: () => openModal() }],
              });
            } else if (event === 'accepted') {
              showToast('Connection accepted — you can message their assistant');
            } else if (event === 'declined') {
              showToast('Connection request declined');
            } else if (event === 'blocked') {
              showToast('Connection blocked');
            }
            if (modalEl) {
              const panelEl = modalEl.querySelector('#denizen-connection-panel');
              const selectEl = modalEl.querySelector('#denizen-handoff-recipient');
              if (panelEl && selectEl) refreshConnectionPanel(panelEl, selectEl).catch(() => null);
            }
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
