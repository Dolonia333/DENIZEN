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
    assert.match(emb.data.title, /hub/i);
    const rows = helpHubRows();
    assert.equal(rows[0].components[0].data.custom_id, 'denizen_help_topic');
  });
});
