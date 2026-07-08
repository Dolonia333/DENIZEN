'use strict';
/**
 * Capture the real Windows/macOS desktop as PNG (nut-js). For agent/MCP inspection.
 * Usage: node scripts/capture-desktop-screen.cjs
 */
require('../src/load-env');
const fs = require('node:fs');
const path = require('node:path');
const desktopAgent = require('../src/compute/desktop-agent');

async function main() {
  const outDir = path.join(__dirname, '..', 'reports', 'desktop');
  fs.mkdirSync(outDir, { recursive: true });
  const buf = await desktopAgent.takeScreenshot();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shotPath = path.join(outDir, `screen-${stamp}.png`);
  fs.writeFileSync(shotPath, buf);
  console.log(JSON.stringify({
    ok: true,
    screenshot: shotPath.replace(/\\/g, '/'),
    bytes: buf.length,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
