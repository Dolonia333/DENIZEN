'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  musicNowPlayingEmbed,
  musicControlRows,
  helpHubEmbed,
  helpHubRows,
  bar,
  formatDuration,
} = require('../src/core/ui-kit');
const { spacesHelpEmbed, spacesIntro } = require('../src/help-copy');

describe('UI kit', () => {
  it('formats duration and bars', () => {
    assert.equal(formatDuration(125000), '2:05');
    assert.match(bar(0.5, 10), /50%/);
  });

  it('builds music panel with components', () => {
    const emb = musicNowPlayingEmbed({
      track: { title: 'Test Song', author: 'A', length: 180000, uri: 'https://example.com' },
      queue: { tracks: [{ title: 'Next' }], volume: 70, loop: 'off', filter: 'none' },
    });
    assert.ok(emb.data.title);
    const rows = musicControlRows(false);
    assert.equal(rows.length, 3);
    assert.ok(rows[0].components.length >= 3);
  });

  it('builds help hub with select menu', () => {
    const emb = helpHubEmbed(',');
    assert.match(emb.data.title, /Denizen Spaces/i);
    assert.match(emb.data.description || '', /premium/i);
    const rows = helpHubRows();
    assert.equal(rows[0].components[0].data.custom_id, 'denizen_help_topic');
  });

  it('builds Spaces help embed with scannable fields', () => {
    const emb = spacesHelpEmbed({ prefix: ',', guildId: '99' });
    assert.equal(emb.data.title, 'Denizen Spaces');
    assert.ok((emb.data.description || '').length < 120);
    const names = (emb.data.fields || []).map((f) => f.name);
    assert.deepEqual(names.slice(0, 4), ['Map', 'Look', 'Pet', 'Live']);
    assert.match(emb.data.fields[0].value, /guildId=99/);
    const intro = spacesIntro({ guildId: '99' });
    assert.ok(intro.split('\n').length <= 2);
  });
});
