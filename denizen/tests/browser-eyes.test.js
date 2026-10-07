'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const browserEyes = require('../src/browser-eyes');

describe('browser-eyes', () => {
  let tmpHome;
  let framePath;
  const inputs = [];

  before(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'denizen-eyes-'));
    process.env.JELLY_HOME = tmpHome;
    const canvas = path.join(tmpHome, 'canvas');
    const browser = path.join(tmpHome, 'browser');
    fs.mkdirSync(canvas, { recursive: true });
    fs.mkdirSync(browser, { recursive: true });
    // Minimal JPEG (1x1)
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
      'base64',
    );
    framePath = path.join(canvas, 'lucy-mirror-live.jpg');
    fs.writeFileSync(framePath, jpeg);
    fs.writeFileSync(
      path.join(browser, 'lucy-mirror-state.json'),
      JSON.stringify({
        url: 'https://example.com',
        title: 'Example',
        query: 'test',
        viewportWidth: 1280,
        viewportHeight: 800,
        lastActivity: 'loaded',
        updatedAt: Date.now(),
      }),
    );
    browserEyes.configure({
      writeBrowserInput: (cmd) => { inputs.push(cmd); return true; },
      isBrowserLive: () => true,
      openBrowser: async (_k, opts) => ({ ok: true, summary: `open ${opts.url || opts.query || 'blank'}` }),
      getPublicBaseUrl: () => 'https://denizen.test',
    });
  });

  after(() => {
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) {}
  });

  it('screenshot returns markdown url and optional base64', () => {
    const shot = browserEyes.browserScreenshot('lucy', { includeBase64: true, baseUrl: 'https://denizen.test' });
    assert.equal(shot.ok, true);
    assert.equal(shot.url, 'https://example.com');
    assert.match(shot.screenshot_url, /^https:\/\/denizen\.test\/api\/npc-sync\/browser-frame\?token=/);
    assert.match(shot.screenshot_markdown, /!\[lucy browser\]/);
    assert.ok(shot.screenshot_jpeg_base64);
    assert.match(shot.hint, /YOU are the eyes/i);
  });

  it('frame token serves bytes', () => {
    const shot = browserEyes.browserScreenshot('lucy', { includeBase64: false, baseUrl: 'https://denizen.test' });
    const token = new URL(shot.screenshot_url).searchParams.get('token');
    const frame = browserEyes.readFrameBytesForToken(token);
    assert.ok(frame);
    assert.equal(frame.mime, 'image/jpeg');
    assert.ok(frame.buf.length > 20);
  });

  it('browserAct queues click', async () => {
    inputs.length = 0;
    const r = await browserEyes.browserAct('lucy', { type: 'click', x: 100, y: 200 });
    assert.equal(r.ok, true);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].type, 'click');
    assert.equal(inputs[0].x, 100);
  });

  it('browserOpen calls openBrowser', async () => {
    const r = await browserEyes.browserOpen('lucy', { url: 'https://example.com/jobs' });
    assert.equal(r.ok, true);
    assert.match(r.next, /browserScreenshot/);
  });
});
