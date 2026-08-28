import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const variants = JSON.parse(
  readFileSync(join(root, 'data/limezu-visual-catalog/day-night-variants.json'), 'utf8'),
);

assert.equal(variants.version, 1);
assert.deepEqual(variants.lit_phases, ['sunset', 'night']);
assert.ok(variants.by_basename.Street_Lamp_1?.type === 'anim');
assert.ok(variants.by_basename.Traffic_Light?.sheet.includes('Stoplight'));
assert.ok(variants.by_me['me.police.facade_narrow_blue']?.type === 'img');
assert.ok(variants.by_me['me.police.facade_narrow_red']?.img.includes('Highlight_2'));
assert.ok(variants.stats.plan_matches_total >= 250);

console.log('day-night-variants.test.mjs: ok');
