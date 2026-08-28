/**
 * Stamp `interact` verbs: the exterior compiler tags stamps with a verb, the
 * merge must carry it through the me→img resolve, and src/full-world.js must
 * have a handler for every verb that reaches the plan.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

const HANDLED = ['sit', 'read', 'shop', 'play', 'enter'];

test('full-world.js handles every interact verb the compiler emits', () => {
  const src = readFileSync(join(root, 'src', 'full-world.js'), 'utf8');
  for (const verb of HANDLED) {
    assert.match(src, new RegExp(`case '${verb}':`), `no handler for '${verb}'`);
  }
});

test('merged city plan keeps interact through the me→img resolve', () => {
  const plan = readJson('data/city-plan.json');
  const tagged = plan.stamps.filter((s) => s.interact);
  assert.ok(tagged.length > 0, 'no interactable stamps in the merged plan');
  for (const s of tagged) {
    assert.ok(HANDLED.includes(s.interact), `unhandled verb '${s.interact}'`);
    // The renderer needs art for the stamp before it can register a footprint.
    assert.ok(s.img, `interactable stamp lost its img: ${JSON.stringify(s)}`);
  }
});

test('generated d18 beach lounge verbs all survive into the plan', (t) => {
  const frag = 'data/city-specs/generated/d18-beach-lounge.json';
  if (!existsSync(join(root, frag))) return t.skip('fragment not compiled');
  const tally = (stamps) => stamps.reduce((acc, s) => {
    if (s.interact) acc[s.interact] = (acc[s.interact] || 0) + 1;
    return acc;
  }, {});
  const want = tally(readJson(frag).stamps);
  const got = tally(readJson('data/city-plan.json').stamps);
  for (const [verb, count] of Object.entries(want)) {
    assert.ok((got[verb] || 0) >= count,
      `plan has ${got[verb] || 0} '${verb}' stamps, fragment declares ${count}`);
  }
});

test('nearestInteractable finds the footprint the player stands next to', async () => {
  globalThis.window = globalThis.window || {};
  globalThis.document = globalThis.document || { documentElement: { dataset: {} } };
  await import('../src/full-world.js');
  const fw = globalThis.window.DenizenFullWorld;
  const { state, indexInteractables, nearestInteractable } = fw;

  const put = (interact, x, y, w = 32, h = 32) => state.interactables.push({
    x, y, w, h, cx: x + w / 2, baseY: y + h, interact, me: `me.test.${interact}`,
    img: `ext/singles/test/${interact}.png`, anchor: 'bl', sp: null,
  });
  state.interactables.length = 0;
  put('sit', 100, 100);
  put('shop', 900, 900);
  indexInteractables();

  assert.equal(nearestInteractable(120, 140)?.interact, 'sit');
  // Range is measured to the footprint, not its centre, and 48px is the reach.
  assert.equal(nearestInteractable(132, 132 + 40)?.interact, 'sit');
  assert.equal(nearestInteractable(500, 500), null);
  // Grid buckets are 128px, so a far object must not leak into a near lookup.
  assert.equal(nearestInteractable(905, 905)?.interact, 'shop');
});
