'use strict';

/**
 * Sentence chunking for streaming voice — shared by server + browser.
 */

const SENTENCE_END = /([.!?…]+["')\]]*\s+|\n+)/;

function trimSentence(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Push streaming delta; invoke onSentence for each completed sentence.
 * @returns {{ buffer: string, sentenceIndex: number }}
 */
function createSentenceStream(onSentence) {
  let buffer = '';
  let sentenceIndex = 0;

  function emitSentence(text) {
    const t = trimSentence(text);
    if (!t) return;
    onSentence(t, sentenceIndex);
    sentenceIndex += 1;
  }

  return {
    push(delta) {
      buffer += String(delta || '');
      let match;
      while ((match = buffer.match(SENTENCE_END))) {
        const end = match.index + match[0].length;
        const chunk = buffer.slice(0, end);
        buffer = buffer.slice(end);
        emitSentence(chunk);
      }
    },
    flush() {
      if (trimSentence(buffer)) emitSentence(buffer);
      buffer = '';
    },
    getBuffer() { return buffer; },
  };
}

const FILLERS = [
  'One sec.',
  'Let me think.',
  'Got it.',
  'Hmm.',
  'Okay.',
  'Sure.',
];

function pickFiller(npcName) {
  const name = String(npcName || 'NPC');
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return FILLERS[hash % FILLERS.length];
}

module.exports = { createSentenceStream, pickFiller, trimSentence };
