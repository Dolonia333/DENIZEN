'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

describe('denizen-mentor-dialogue', () => {
  it('creates session and peer replies', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mentor-'));
    const modPath = path.join(__dirname, '..', 'src', 'denizen-mentor-dialogue.js');
    delete require.cache[require.resolve(modPath)];
    const mentor = require(modPath);
    mentor.setDialoguePathForTests(path.join(tmp, 'mentor-dialogue.jsonl'));

    const session = mentor.createSession({
      npcName: 'Bob',
      topic: 'test',
      question: 'How to research OMES?',
    });
    assert.ok(session.id);
    assert.equal(session.npc_key, 'bob');

    const grok = mentor.addPeerReply(session.id, 'grok', 'Start with solicitation delta checks.');
    assert.equal(grok.ok, true);

    const claude = mentor.addPeerReply(session.id, 'claude', 'Structure notes by risk and owner.');
    assert.equal(claude.ok, true);

    const fin = mentor.finalizeSession(session.id);
    assert.equal(fin.ok, true);
    assert.ok(fin.session.synthesis.includes('Grok'));
    assert.ok(fin.session.synthesis.includes('Claude'));
  });
});
