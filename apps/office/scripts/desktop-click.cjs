'use strict';
/**
 * Click (or type) on the real desktop, then capture a follow-up screenshot.
 * Usage: node scripts/desktop-click.cjs <action> [jsonPayload]
 *   action: click | double_click | type | key
 *   payload: {"x":100,"y":200} or {"text":"hello"} or {"key":"enter"}
 */
require('../src/load-env');
const fs = require('node:fs');
const path = require('node:path');
const desktopAgent = require('../src/compute/desktop-agent');

const action = process.argv[2] || 'click';
let payload = {};
if (process.argv[3]) {
  try { payload = JSON.parse(process.argv[3]); } catch (err) {
    console.error(JSON.stringify({ ok: false, error: `invalid JSON: ${err.message}` }));
    process.exit(1);
  }
}

async function main() {
  await desktopAgent.executeAction({ action, ...payload });
  await new Promise((r) => setTimeout(r, 400));
  const buf = await desktopAgent.takeScreenshot();
  const outDir = path.join(__dirname, '..', 'reports', 'desktop');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const shotPath = path.join(outDir, `after-${action}-${stamp}.png`);
  fs.writeFileSync(shotPath, buf);
  console.log(JSON.stringify({
    ok: true,
    action,
    screenshot: shotPath.replace(/\\/g, '/'),
    bytes: buf.length,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
  process.exit(1);
});
