'use strict';

const fs = require('node:fs');

const BOUNDARY = 'denizenframe';
const POLL_MS = 80;

/** Tiny gray JPEG placeholder shown before the first real frame arrives. */
const IDLE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
  'base64',
);

/**
 * MJPEG multipart stream — browsers treat this like live video when used as img src.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {{ streamFile: string, isLive?: () => boolean }} opts
 */
function serveLucyMjpegStream(req, res, opts) {
  const streamFile = opts.streamFile;
  const isLive = typeof opts.isLive === 'function' ? opts.isLive : () => true;

  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Connection: 'keep-alive',
  });

  let closed = false;
  let lastMtime = 0;

  const writeFrame = (data) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${data.length}\r\n\r\n`);
      res.write(data);
      res.write('\r\n');
    } catch (_) {
      closed = true;
    }
  };

  const tick = () => {
    if (closed || res.writableEnded) return;
    try {
      if (fs.existsSync(streamFile)) {
        const stat = fs.statSync(streamFile);
        if (stat.mtimeMs > lastMtime) {
          lastMtime = stat.mtimeMs;
          writeFrame(fs.readFileSync(streamFile));
          return;
        }
      }
      if (!isLive() && lastMtime > 0) {
        closed = true;
        try { res.end(); } catch (_) {}
        return;
      }
      if (lastMtime === 0) writeFrame(IDLE_JPEG);
    } catch (_) {}
  };

  req.on('close', () => { closed = true; });
  req.on('aborted', () => { closed = true; });

  writeFrame(IDLE_JPEG);
  const timer = setInterval(tick, POLL_MS);
  req.on('close', () => clearInterval(timer));
}

module.exports = { serveLucyMjpegStream, BOUNDARY };
