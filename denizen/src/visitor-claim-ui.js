/**
 * Proximity claim UI — claim an NPC as your personal assistant when facing them.
 * Attaches to globalThis.DenizenVisitorClaimUI (no imports).
 */
(function () {
  'use strict';

  const POLL_MS = 500;
  const STYLE_ID = 'denizen-visitor-claim-ui-style';
  const BTN_ID = 'denizen-visitor-claim-btn';
  const CHIP_ID = 'denizen-visitor-assistant-chip';
  const TOAST_ID = 'denizen-visitor-claim-toast';

  let playerChat = null;
  let scene = null;
  let pollTimer = null;
  let claimBtn = null;
  let assistantChip = null;
  let focusModal = null;
  let claiming = false;
  let keyListener = null;
  let pendingClaim = null;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      #${BTN_ID} {
        position: fixed;
        z-index: 100150;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.96);
        color: #fde68a;
        border: 1px solid #1f2937;
        border-radius: 999px;
        padding: 10px 18px;
        font: 13px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        display: none;
        touch-action: manipulation;
        white-space: nowrap;
        max-width: calc(100vw - 24px);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${BTN_ID}:hover { background: #1e293b; border-color: #4ade80; }
      #${CHIP_ID} {
        display: none;
        margin-left: 8px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(74, 222, 128, 0.15);
        border: 1px solid rgba(74, 222, 128, 0.4);
        color: #4ade80;
        font-size: 10px;
        font-weight: bold;
        vertical-align: middle;
      }
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
      }
      #${TOAST_ID}.show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      #denizen-visitor-focus-modal {
        position: fixed;
        inset: 0;
        z-index: 100550;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.88);
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      #denizen-visitor-focus-modal .vis-card {
        background: #020617;
        border: 1px solid #1f2937;
        border-radius: 10px;
        padding: 20px 24px;
        width: min(380px, calc(100vw - 32px));
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
      }
      #denizen-visitor-focus-modal h3 {
        margin: 0 0 8px;
        font-size: 14px;
        color: #e2e8f0;
      }
      #denizen-visitor-focus-modal p {
        margin: 0 0 12px;
        font-size: 11px;
        color: #94a3b8;
      }
      #denizen-visitor-focus-input {
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
      #denizen-visitor-focus-input:focus { border-color: #4ade80; }
      #denizen-visitor-focus-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      #denizen-visitor-focus-actions button {
        font: inherit;
        font-size: 11px;
        font-weight: bold;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        border: 1px solid #1f2937;
      }
      #denizen-visitor-focus-skip {
        background: #1e293b;
        color: #94a3b8;
      }
      #denizen-visitor-focus-ok {
        background: #4ade80;
        color: #0f172a;
        border-color: transparent;
      }
    `;
    document.head.appendChild(s);
  }

  function positionClaimBtn() {
    if (!claimBtn) return;
    const gc = document.getElementById('game-container');
    const safeTop = 12;
    if (!gc) {
      claimBtn.style.top = `calc(${safeTop}px + env(safe-area-inset-top, 0px))`;
      return;
    }
    const rect = gc.getBoundingClientRect();
    const bodyPad = parseFloat(getComputedStyle(document.body).paddingTop) || 0;
    const minTop = Math.max(safeTop + bodyPad, 12);
    claimBtn.style.top = `${Math.max(minTop, rect.top - 48)}px`;
  }

  function ensureClaimBtn() {
    if (claimBtn) return claimBtn;
    injectStyles();
    claimBtn = document.createElement('button');
    claimBtn.id = BTN_ID;
    claimBtn.type = 'button';
    document.body.appendChild(claimBtn);
    window.addEventListener('resize', positionClaimBtn);
    return claimBtn;
  }

  function showToast(text) {
    injectStyles();
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = TOAST_ID;
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  function npcDisplayName(textureKey) {
    const roster = globalThis.DenizenNpcRoster;
    if (roster?.keyToDisplay?.[textureKey]) return roster.keyToDisplay[textureKey];
    return playerChat?._getNpcName?.(textureKey) || textureKey.replace(/^xp_/, '');
  }

  function askFocus(npcName) {
    return new Promise((resolve) => {
      if (focusModal) focusModal.remove();
      focusModal = document.createElement('div');
      focusModal.id = 'denizen-visitor-focus-modal';
      focusModal.innerHTML = `
        <div class="vis-card">
          <h3>Claim ${npcName} as your assistant</h3>
          <p>What should they help you with? (optional)</p>
          <input id="denizen-visitor-focus-input" type="text" maxlength="200" placeholder="e.g. job search, sprint planning…" />
          <div id="denizen-visitor-focus-actions">
            <button type="button" id="denizen-visitor-focus-skip">Skip</button>
            <button type="button" id="denizen-visitor-focus-ok">Claim</button>
          </div>
        </div>
      `;
      document.body.appendChild(focusModal);
      const input = focusModal.querySelector('#denizen-visitor-focus-input');
      const finish = (val) => {
        focusModal.remove();
        focusModal = null;
        resolve(val);
      };
      focusModal.querySelector('#denizen-visitor-focus-skip').addEventListener('click', () => finish(null));
      focusModal.querySelector('#denizen-visitor-focus-ok').addEventListener('click', () => {
        finish(String(input.value || '').trim() || null);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(String(input.value || '').trim() || null);
        if (e.key === 'Escape') finish(null);
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  function updateAssistantChip() {
    const sess = globalThis.DenizenVisitorSession;
    const headerTarget = document.getElementById('player-chat-target');
    if (!headerTarget) return;

    let chip = document.getElementById(CHIP_ID);
    if (!chip) {
      chip = document.createElement('span');
      chip.id = CHIP_ID;
      headerTarget.parentNode?.insertBefore(chip, headerTarget.nextSibling);
      assistantChip = chip;
    }

    const asst = sess?.getAssistant?.();
    if (!asst?.npc_key) {
      chip.style.display = 'none';
      chip.textContent = '';
      return;
    }

    const name = asst.assistant_name
      || npcDisplayName(sess.npcKeyToTextureKey(asst.npc_key))
      || asst.npc_key;
    chip.style.display = 'inline';
    chip.textContent = `Your assistant: ${name}`;
  }

  async function onClaimClick(npcKey, textureKey, displayName) {
    if (claiming) return;
    claiming = true;
    try {
      const focus = await askFocus(displayName);
      const sess = globalThis.DenizenVisitorSession;
      await sess.claimNpc(npcKey, { assistantName: displayName, focus });
      await sess.refreshAssistant();
      showToast(`${displayName} is now your assistant!`);
      updateAssistantChip();
      globalThis.DenizenVisitorAssistantLabels?.refresh?.();
      globalThis.DenizenVisitorNpcTeamUI?.refresh?.().catch?.(() => null);
      globalThis.DenizenVisitorMcpConnectUI?.offerAfterClaim?.(npcKey, displayName);
      hideClaimBtn();
    } catch (err) {
      showToast(err?.message || 'Could not claim assistant');
      console.warn('[DenizenVisitorClaimUI] claim failed:', err);
    } finally {
      claiming = false;
    }
  }

  function hideClaimBtn() {
    if (claimBtn) claimBtn.style.display = 'none';
    pendingClaim = null;
  }

  function showClaimBtn(label, npcKey, textureKey, displayName) {
    const btn = ensureClaimBtn();
    btn.textContent = label;
    btn.style.display = 'block';
    positionClaimBtn();
    pendingClaim = { npcKey, textureKey, displayName };
    btn.onclick = () => onClaimClick(npcKey, textureKey, displayName);
  }

  function isTypingInInput() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  function onClaimKeydown(e) {
    if (e.key !== 'c' && e.key !== 'C') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingInInput()) return;
    if (!pendingClaim || !claimBtn || claimBtn.style.display === 'none') return;
    e.preventDefault();
    onClaimClick(pendingClaim.npcKey, pendingClaim.textureKey, pendingClaim.displayName);
  }

  function ensureKeyListener() {
    if (keyListener) return;
    keyListener = onClaimKeydown;
    document.addEventListener('keydown', keyListener);
  }

  function removeKeyListener() {
    if (!keyListener) return;
    document.removeEventListener('keydown', keyListener);
    keyListener = null;
  }

  function tick() {
    if (!playerChat || !scene?.player) {
      hideClaimBtn();
      return;
    }

    const sess = globalThis.DenizenVisitorSession;
    if (!sess) return;

    updateAssistantChip();

    const assistant = sess.getAssistant?.();
    if (assistant?.npc_key) {
      hideClaimBtn();
      return;
    }

    const facingNpc = playerChat._findFacingNpc?.();
    if (!facingNpc?.texture?.key) {
      hideClaimBtn();
      return;
    }

    const textureKey = facingNpc.texture.key;
    const npcKey = sess.textureKeyToNpcKey(textureKey);
    if (sess.isProtectedNpc?.(textureKey)) {
      hideClaimBtn();
      return;
    }

    const displayName = npcDisplayName(textureKey);
    showClaimBtn(
      `⭐ Claim ${displayName} as my assistant`,
      npcKey,
      textureKey,
      displayName,
    );
  }

  const DenizenVisitorClaimUI = {
    attach(pc, sc) {
      playerChat = pc;
      scene = sc;
      injectStyles();
      updateAssistantChip();
      ensureKeyListener();

      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(tick, POLL_MS);
      tick();

      globalThis.DenizenVisitorSession?.init?.().then(() => {
        updateAssistantChip();
        tick();
      }).catch(() => {});

      console.log('[DenizenVisitorClaimUI] attached — press C while facing an NPC to claim');
    },

    detach() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      removeKeyListener();
      hideClaimBtn();
      playerChat = null;
      scene = null;
    },
  };

  globalThis.DenizenVisitorClaimUI = DenizenVisitorClaimUI;
})();
