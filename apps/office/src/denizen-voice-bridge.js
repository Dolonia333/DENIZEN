'use strict';

const { createSentenceStream, pickFiller } = require('./voice-sentence.js');

/**
 * Server-side voice chat streaming helpers for player_chat over /agent-ws.
 */

function sendWs(ws, payload) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (_) {
    return false;
  }
}

function emitVoiceFiller(ws, npcName, extra = null) {
  const text = pickFiller(npcName);
  sendWs(ws, { type: 'voice_chat_filler', npcName, text, ...(extra || {}) });
  return text;
}

/**
 * Wrap getPlayerResponse with streaming token + sentence events.
 * @param {object} deps
 * @param {import('ws').WebSocket} deps.ws
 * @param {string} deps.npcName
 * @param {object} deps.playerOpts — passed to getPlayerResponse
 * @param {Function} deps.getPlayerResponse — npcBrains.getPlayerResponse
 * @param {string} deps.message
 */
async function streamPlayerChatResponse(deps) {
  const { ws, npcName, playerOpts = {}, getPlayerResponse, message } = deps;
  emitVoiceFiller(ws, npcName);

  const sentenceStream = createSentenceStream((text, index) => {
    sendWs(ws, { type: 'voice_chat_sentence', npcName, text, index });
  });

  const streamHooks = {
    onToken: (token) => {
      sendWs(ws, { type: 'voice_chat_token', npcName, token });
      sentenceStream.push(token);
    },
    onSentence: (text, index) => {
      sendWs(ws, { type: 'voice_chat_sentence', npcName, text, index });
    },
  };

  const result = await getPlayerResponse(npcName, message, {
    ...playerOpts,
    stream: streamHooks,
  });

  sentenceStream.flush();
  sendWs(ws, {
    type: 'voice_chat_done',
    npcName,
    text: result?.text || '',
  });

  return result;
}

/**
 * For instant replies (greetings, scripted) — speak immediately in voice mode.
 */
function emitVoiceInstant(ws, npcName, text) {
  const t = String(text || '').trim();
  if (!t) return;
  sendWs(ws, { type: 'voice_chat_sentence', npcName, text: t, index: 0 });
  sendWs(ws, { type: 'voice_chat_done', npcName, text: t });
}

module.exports = {
  sendWs,
  emitVoiceFiller,
  streamPlayerChatResponse,
  emitVoiceInstant,
};
