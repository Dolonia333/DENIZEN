'use strict';

const path = require('node:path');

/**
 * Resolve Denizen server modules in dev (../src) and packaged builds (./src).
 */
function requireDenizenSrc(modulePath) {
  const name = String(modulePath || '').replace(/^\.\//, '').replace(/\.js$/, '');
  if (!name) throw new Error('requireDenizenSrc: module name required');

  const candidates = [
    path.join(__dirname, 'src', name),
    path.join(__dirname, '..', 'src', name),
  ];

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line import/no-dynamic-require, global-require
      return require(candidate);
    } catch (err) {
      lastErr = err;
      if (err?.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }

  throw lastErr || new Error(`Cannot find denizen src module: ${name}`);
}

module.exports = { requireDenizenSrc };
