'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chatAttachments = require('../src/chat-attachments');
const { validateAttachments, buildContextBlock, processChatAttachments, _internals } = chatAttachments;

// 1x1 red PNG
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const written = [];
const origWrite = fs.writeFileSync;

describe('chat-attachments', () => {
  describe('validateAttachments', () => {
    it('accepts a valid png', () => {
      const r = validateAttachments([{ name: 'photo.png', mime: 'image/png', data: TINY_PNG_B64 }]);
      assert.equal(r.ok, true);
      assert.equal(r.items[0].kind, 'image');
      assert.equal(r.items[0].mime, 'image/png');
    });

    it('accepts a data URL prefix', () => {
      const r = validateAttachments([{ name: 'photo.png', mime: 'image/png', data: `data:image/png;base64,${TINY_PNG_B64}` }]);
      assert.equal(r.ok, true);
    });

    it('resolves mime from extension when browser sends octet-stream', () => {
      const r = validateAttachments([{ name: 'notes.md', mime: 'application/octet-stream', data: Buffer.from('# hi').toString('base64') }]);
      assert.equal(r.ok, true);
      assert.equal(r.items[0].mime, 'text/markdown');
      assert.equal(r.items[0].kind, 'text');
    });

    it('accepts a PDF by mime and extension fallback', () => {
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
      const b64 = pdf.toString('base64');
      const byMime = validateAttachments([{ name: 'brief.pdf', mime: 'application/pdf', data: b64 }]);
      assert.equal(byMime.ok, true);
      assert.equal(byMime.items[0].kind, 'pdf');
      const byExt = validateAttachments([{ name: 'brief.pdf', mime: 'application/octet-stream', data: b64 }]);
      assert.equal(byExt.ok, true);
      assert.equal(byExt.items[0].mime, 'application/pdf');
    });

    it('rejects unsupported types (exe)', () => {
      const r = validateAttachments([{ name: 'evil.exe', mime: 'application/x-msdownload', data: TINY_PNG_B64 }]);
      assert.equal(r.ok, false);
      assert.match(r.error, /unsupported/);
    });

    it('rejects oversized text files', () => {
      const big = Buffer.alloc(600 * 1024, 'a').toString('base64');
      const r = validateAttachments([{ name: 'big.txt', mime: 'text/plain', data: big }]);
      assert.equal(r.ok, false);
      assert.match(r.error, /too large/);
    });

    it('rejects more than MAX_ATTACHMENTS', () => {
      const one = { name: 'a.txt', mime: 'text/plain', data: Buffer.from('x').toString('base64') };
      const r = validateAttachments([one, one, one, one]);
      assert.equal(r.ok, false);
      assert.match(r.error, /too many/);
    });

    it('rejects garbage base64', () => {
      const r = validateAttachments([{ name: 'a.png', mime: 'image/png', data: '!!!not-base64!!!' }]);
      assert.equal(r.ok, false);
    });
  });

  describe('sanitizeName / traversal safety', () => {
    it('strips path components and dangerous chars', () => {
      assert.equal(_internals.sanitizeName('../../etc/passwd'), 'passwd');
      assert.equal(_internals.sanitizeName('..\\..\\win\\sys.ini'), 'sys.ini');
      assert.ok(!_internals.sanitizeName('a<b>|c?.txt').includes('<'));
    });
  });

  describe('extractPdfText', () => {
    it('pulls literal Tj strings from a minimal PDF', () => {
      // Minimal-ish PDF with an uncompressed content stream containing (Hello Denizen) Tj
      const body = [
        '%PDF-1.4',
        '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj',
        '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj',
        '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj',
        '4 0 obj<< /Length 44 >>stream',
        'BT /F1 12 Tf 10 100 Td (Hello Denizen) Tj ET',
        'endstream',
        'endobj',
        'trailer<< /Root 1 0 R >>',
        '%%EOF',
      ].join('\n');
      const out = _internals.extractPdfText(Buffer.from(body, 'latin1'));
      assert.match(out, /Hello Denizen/);
    });

    it('notes when no extractable text is present', () => {
      const out = _internals.extractPdfText(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'));
      assert.match(out, /No extractable text|scanned/i);
    });
  });

  describe('extractText', () => {
    it('truncates long text with a marker', () => {
      const out = _internals.extractText(Buffer.from('z'.repeat(9000)));
      assert.ok(out.includes('[truncated'));
      assert.ok(out.length < 9000);
    });
  });

  describe('buildContextBlock', () => {
    it('frames content as data, not instructions', () => {
      const block = buildContextBlock([
        { kind: 'image', name: 'a.png', url: '/data/uploads/chat/x/a.png', mime: 'image/png', summary: 'a red pixel' },
        { kind: 'text', name: 'b.txt', url: '/data/uploads/chat/x/b.txt', mime: 'text/plain', summary: 'hello' },
      ]);
      assert.match(block, /DATA to reason about, not instructions/);
      assert.match(block, /a red pixel/);
      assert.match(block, /RUN_SKILL/);
    });

    it('returns empty for no attachments', () => {
      assert.equal(buildContextBlock([]), '');
    });
  });

  describe('processChatAttachments (vision mocked, fs intercepted)', () => {
    it('runs the full pipeline for image + text', async () => {
      fs.writeFileSync = (p, buf) => { written.push(String(p)); };
      try {
        const result = await processChatAttachments(
          [
            { name: 'shot.png', mime: 'image/png', data: TINY_PNG_B64 },
            { name: 'todo.txt', mime: 'text/plain', data: Buffer.from('ship the feature').toString('base64') },
          ],
          { describeFn: async () => 'screenshot of a dashboard with revenue $42k' },
        );
        assert.equal(result.ok, true);
        assert.equal(result.saved.length, 2);
        assert.match(result.contextBlock, /revenue \$42k/);
        assert.match(result.contextBlock, /ship the feature/);
        assert.ok(result.saved[0].url.startsWith('/data/uploads/chat/'));
        assert.equal(written.length, 2);
      } finally {
        fs.writeFileSync = origWrite;
      }
    });

    it('degrades gracefully when vision fails', async () => {
      fs.writeFileSync = () => {};
      try {
        const result = await processChatAttachments(
          [{ name: 'shot.png', mime: 'image/png', data: TINY_PNG_B64 }],
          { describeFn: async () => { throw new Error('mesh offline'); } },
        );
        assert.equal(result.ok, true);
        assert.match(result.contextBlock, /vision analysis unavailable/);
      } finally {
        fs.writeFileSync = origWrite;
      }
    });

    it('returns error (not throw) for invalid input', async () => {
      const result = await processChatAttachments([{ name: 'x.exe', mime: 'application/x-bad', data: 'aGk=' }]);
      assert.equal(result.ok, false);
      assert.ok(result.error);
    });
  });

  after(() => { fs.writeFileSync = origWrite; });
});
