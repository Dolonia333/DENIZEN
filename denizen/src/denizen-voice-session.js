/**
 * Denizen Voice Session — immersive voice call mode (ChatGPT-style loop).
 *
 * - Hands-free VAD via DenizenVoiceInput
 * - Streaming LLM tokens + sentence TTS
 * - Barge-in (interrupt NPC speech)
 * - Focus audio mode during call
 */
(function () {
  'use strict';

  let active = false;
  let npcName = null;
  let npcKey = null;
  let streamingText = '';
  let priorAudioMode = null;
  let currentTurnId = null;
  let turnCounter = 0;
  let lastFirstTokenAt = 0;

  function nextTurnId() {
    turnCounter += 1;
    return `vt_${Date.now()}_${turnCounter}`;
  }

  function getWs() {
    return window.__DenizenAgentWs || globalThis.DenizenCofounderWS;
  }

  function sendCancel(reason = 'barge_in') {
    const ws = getWs();
    if (!currentTurnId || ws?.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({
        type: 'player_chat_cancel',
        turn_id: currentTurnId,
        reason,
      }));
    } catch (_) {}
  }

  function beginTurn(turnId) {
    currentTurnId = turnId;
    lastFirstTokenAt = 0;
    playback()?.setActiveTurn?.(turnId);
  }

  function endTurn(turnId) {
    if (!turnId || turnId !== currentTurnId) return;
    currentTurnId = null;
    playback()?.setActiveTurn?.(null);
  }

  function playback() {
    return window.DenizenVoicePlayback;
  }

  function isActive() {
    return active;
  }

  function getNpcName() {
    return npcName;
  }

  function resolveTargetNpc() {
    const chat = window.__DenizenPlayerChat;
    if (chat?._lastTargetKey && chat?._nameToKey) {
      const key = chat._lastTargetKey;
      const name = Object.entries(chat._nameToKey || {}).find(([, v]) => v === key)?.[0]
        || chat._lastUserChatTarget;
      if (name) return { key, name };
    }
    const assistant = globalThis.DenizenVisitorSession?.getAssistant?.();
    if (assistant?.npc_key) {
      const roster = globalThis.DenizenNpcRoster;
      const name = roster?.keyToDisplay?.[assistant.npc_key] || assistant.npc_key;
      return { key: assistant.npc_key, name };
    }
    return { key: 'lucy', name: 'Lucy' };
  }

  function start(opts = {}) {
    const target = opts.npcName
      ? { name: opts.npcName, key: opts.npcKey || opts.npcName.toLowerCase() }
      : resolveTargetNpc();
    npcName = target.name;
    npcKey = target.key;
    active = true;
    streamingText = '';
    currentTurnId = null;
    priorAudioMode = window.DenizenProximityAudio?.getAudioMode?.() || 'ambient';
    playback()?.setVoiceCallActive?.(true);
    try { window.DenizenProximityAudio?.setActiveConvoNpc?.(npcName, 120000); } catch (_) {}
    try { window.DenizenVoiceInput?.setHandsFree?.(true); } catch (_) {}
    document.dispatchEvent(new CustomEvent('denizen-voice-session', { detail: { active: true, npcName } }));
    return { npcName, npcKey };
  }

  function stop() {
    if (!active) return;
    active = false;
    streamingText = '';
    sendCancel('session_stop');
    currentTurnId = null;
    playback()?.stopAll?.();
    playback()?.setVoiceCallActive?.(false);
    try { window.DenizenVoiceInput?.setHandsFree?.(false); } catch (_) {}
    if (priorAudioMode && window.DenizenProximityAudio?.setAudioMode) {
      try { window.DenizenProximityAudio.setAudioMode(priorAudioMode); } catch (_) {}
    }
    priorAudioMode = null;
    npcName = null;
    npcKey = null;
    document.dispatchEvent(new CustomEvent('denizen-voice-session', { detail: { active: false } }));
  }

  function toggle(opts = {}) {
    if (active) stop();
    else start(opts);
    return active;
  }

  function onMicStart() {
    sendCancel('barge_in');
    playback()?.stopAll?.();
    document.dispatchEvent(new CustomEvent('denizen:voice-user-speech-start', {
      detail: { turnId: currentTurnId || null },
    }));
  }

  function onUserSpeechStart() {
    onMicStart();
  }

  function handleWsMessage(msg) {
    if (!msg || !active) return false;
    const turnId = msg.turn_id || null;
    if (turnId && currentTurnId && turnId !== currentTurnId) return true;
    const name = msg.npcName || npcName;
    if (msg.type === 'voice_chat_filler') {
      playback()?.enqueueFiller?.(name, msg.text);
      return true;
    }
    if (msg.type === 'voice_chat_token') {
      if (turnId && !currentTurnId) beginTurn(turnId);
      streamingText += String(msg.token || '');
      if (!lastFirstTokenAt) {
        lastFirstTokenAt = Date.now();
        document.dispatchEvent(new CustomEvent('denizen:voice-latency', {
          detail: { metric: 'first_token_ms', value: 1 },
        }));
      }
      document.dispatchEvent(new CustomEvent('denizen-voice-stream', {
        detail: { npcName: name, token: msg.token, text: streamingText, partial: true, turnId },
      }));
      document.dispatchEvent(new CustomEvent('denizen:voice-assistant-thinking', {
        detail: { npcName: name, turnId },
      }));
      return true;
    }
    if (msg.type === 'voice_chat_sentence') {
      if (turnId && !currentTurnId) beginTurn(turnId);
      playback()?.enqueue?.(name, msg.text, { turnId });
      document.dispatchEvent(new CustomEvent('denizen-voice-stream', {
        detail: { npcName: name, sentence: msg.text, text: streamingText, partial: false, turnId },
      }));
      return true;
    }
    if (msg.type === 'voice_chat_done') {
      if (turnId && !currentTurnId) beginTurn(turnId);
      streamingText = String(msg.text || streamingText);
      document.dispatchEvent(new CustomEvent('denizen-voice-stream', {
        detail: { npcName: name, text: streamingText, done: true, turnId },
      }));
      endTurn(turnId);
      return true;
    }
    if (msg.type === 'player_chat_cancelled') {
      if (!turnId || turnId === currentTurnId) {
        playback()?.stopAll?.();
        endTurn(turnId || currentTurnId);
      }
      return true;
    }
    return false;
  }

  function sendUtterance(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    streamingText = '';
    onMicStart();
    const turnId = nextTurnId();
    beginTurn(turnId);

    const chat = window.__DenizenPlayerChat;
    if (chat?.sendMessage) {
      chat._voiceMode = true;
      chat._voiceTurnId = turnId;
      chat.sendMessage(trimmed);
      chat._voiceMode = false;
      chat._voiceTurnId = null;
      return;
    }

    const ws = getWs();
    if (ws?.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'player_chat',
        npcName: npcName || 'Lucy',
        npcKey: npcKey,
        text: trimmed,
        voice_mode: true,
        session_id: globalThis.DenizenVisitorSession?.getSessionId?.() || null,
        turn_id: turnId,
      }));
    }
  }

  window.DenizenVoiceSession = {
    start,
    stop,
    toggle,
    isActive,
    getNpcName,
    handleWsMessage,
    sendUtterance,
    onMicStart,
    onUserSpeechStart,
  };
})();
