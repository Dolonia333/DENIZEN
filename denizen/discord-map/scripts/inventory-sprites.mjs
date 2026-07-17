#!/usr/bin/env node
/**
 * Inventory Pixel Spaces / Full / PacksExtra assets vs game.js usage.
 *
 * Usage (from repo denizen/ or discord-map/):
 *   node discord-map/scripts/inventory-sprites.mjs
 *   node scripts/inventory-sprites.mjs
 *
 * Writes:
 *   discord-map/SPRITE_INVENTORY.md
 *   discord-map/sprite-inventory.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_ROOT = path.resolve(__dirname, '..');
const GAME_JS = path.join(MAP_ROOT, 'game.js');
const OUT_MD = path.join(MAP_ROOT, 'SPRITE_INVENTORY.md');
const OUT_JSON = path.join(MAP_ROOT, 'sprite-inventory.json');

const PACK_ROOTS = [
  { id: 'PixelSpaces', dir: path.join(MAP_ROOT, 'PixelSpaces'), license: 'Pixel Spaces base pack' },
  { id: 'PixelSpacesFull', dir: path.join(MAP_ROOT, 'PixelSpacesFull'), license: 'Pixel Spaces Full Pack' },
  { id: 'PacksExtra', dir: path.join(MAP_ROOT, 'PacksExtra'), license: 'Third-party free packs (see readmes)' },
];

function walkPngs(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /\.png$/i.test(e.name)) {
        out.push({
          full,
          rel: path.relative(MAP_ROOT, full).split(path.sep).join('/'),
          name: e.name,
          dir: path.relative(root, path.dirname(full)).split(path.sep).join('/') || '.',
        });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function topFolder(relFromPack) {
  if (!relFromPack || relFromPack === '.') return '(root)';
  return relFromPack.split('/')[0];
}

function extractGameUsage(gameSrc) {
  // Asset keys: foodBurger: `...`, bench: `${PACK}/...`
  const assetKeys = new Set();
  const pathRefs = new Set();
  const keyRe = /^\s{2,6}([A-Za-z0-9_]+):\s*[`'"]([^`'"]+)[`'"]/gm;
  let m;
  while ((m = keyRe.exec(gameSrc))) {
    assetKeys.add(m[1]);
    pathRefs.add(m[2]);
  }
  // Template strings with pack roots
  const tmplRe = /\$\{(?:PACK|FULL|PACKS_EXTRA|EXP)\}[^`'\n]+/g;
  while ((m = tmplRe.exec(gameSrc))) {
    pathRefs.add(m[0]);
  }
  // Bare relative pack paths in strings
  const bareRe = /[`'"](\.\/(?:PixelSpaces|PixelSpacesFull|PacksExtra)[^`'"]+\.png)[`'"]/gi;
  while ((m = bareRe.exec(gameSrc))) {
    pathRefs.add(m[1]);
  }
  // Filename mentions (for matching unused by basename)
  const fileMentions = new Set();
  const fileRe = /([A-Za-z0-9_\- ]+\.png)/g;
  while ((m = fileRe.exec(gameSrc))) {
    fileMentions.add(m[1].toLowerCase());
  }
  // FOOD_KEYS array, NPC sheets, etc.
  const arrKeyRe = /'([A-Za-z0-9_]+)'/g;
  const foodBlock = gameSrc.match(/FOOD_KEYS\s*=\s*\[([\s\S]*?)\]/);
  if (foodBlock) {
    let fm;
    while ((fm = arrKeyRe.exec(foodBlock[1]))) assetKeys.add(fm[1]);
  }
  return { assetKeys: [...assetKeys].sort(), pathRefs: [...pathRefs], fileMentions };
}

function categorizeRel(rel) {
  const r = rel.toLowerCase();
  if (r.includes('/emotes/') || r.includes('\\emotes\\')) return 'emotes';
  if (r.includes('/chat bubbles/') || r.includes('chat_bubbles')) return 'chat_bubbles';
  if (r.includes('/ui/') || r.includes('/icons/')) return 'ui_icons';
  if (r.includes('/npcs/')) return 'npcs';
  if (r.includes('/furniture/')) return 'furniture';
  if (r.includes('/objects/')) return 'objects';
  if (r.includes('/backgrounds/')) return 'backgrounds';
  if (r.includes('/infrastructure/')) return 'infrastructure';
  if (r.includes('/expansions/')) return 'expansions';
  if (r.includes('pixelplatter') || r.includes('food') || r.includes('fruit_')) return 'food';
  if (r.includes('/cats/') || r.includes('/dogs/') || r.includes('pet')) return 'pets';
  if (r.includes('spritesheet') || r.includes('tileset')) return 'sheets_tilesets';
  return 'other';
}

function main() {
  if (!fs.existsSync(GAME_JS)) {
    console.error('game.js not found at', GAME_JS);
    process.exit(1);
  }
  const gameSrc = fs.readFileSync(GAME_JS, 'utf8');
  const usage = extractGameUsage(gameSrc);

  const packs = [];
  let total = 0;
  let usedEst = 0;
  let unusedEst = 0;
  const byCategory = {};
  const unusedByCategory = {};

  for (const pack of PACK_ROOTS) {
    const files = walkPngs(pack.dir);
    const byTop = {};
    const used = [];
    const unused = [];
    for (const f of files) {
      total += 1;
      const cat = categorizeRel(f.rel);
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      const top = topFolder(f.dir);
      byTop[top] = (byTop[top] || 0) + 1;
      const base = f.name.toLowerCase();
      const isUsed = usage.fileMentions.has(base)
        || usage.pathRefs.some((p) => p.toLowerCase().includes(base.replace(/\.png$/, '')) && p.toLowerCase().includes(f.name.split('.')[0].toLowerCase().slice(0, 12)))
        || [...usage.fileMentions].some((m) => base.includes(m.replace('.png', '')) || m.includes(base.replace('.png', '')));
      // Simpler: basename match in game.js text
      const mentioned = gameSrc.toLowerCase().includes(f.name.toLowerCase())
        || gameSrc.toLowerCase().includes(f.name.toLowerCase().replace(/ /g, '_'))
        || gameSrc.toLowerCase().includes(f.name.toLowerCase().replace(/ /g, ''));
      // Also match path segments from ASSETS (e.g. Burger.png from foodBurger path)
      const stem = f.name.replace(/\.png$/i, '');
      const stemHit = gameSrc.includes(stem)
        || gameSrc.includes(stem.replace(/ /g, '_'))
        || gameSrc.includes(stem.replace(/ /g, ''));
      if (mentioned || stemHit) {
        used.push(f);
        usedEst += 1;
      } else {
        unused.push(f);
        unusedEst += 1;
        unusedByCategory[cat] = (unusedByCategory[cat] || 0) + 1;
      }
    }
    packs.push({
      id: pack.id,
      license: pack.license,
      total: files.length,
      used: used.length,
      unused: unused.length,
      byTop,
      usedSample: used.slice(0, 30).map((f) => f.rel),
      unusedSample: unused.slice(0, 80).map((f) => f.rel),
      unusedAll: unused.map((f) => f.rel),
    });
  }

  // High-value unused lists for polish work
  const fullUnused = packs.find((p) => p.id === 'PixelSpacesFull')?.unusedAll || [];
  const emotesUnused = fullUnused.filter((r) => /\/UI\/Emotes\//i.test(r));
  const chatUnused = fullUnused.filter((r) => /Chat Bubbles/i.test(r));
  const expansionUnused = fullUnused.filter((r) => /\/Expansions\//i.test(r));
  const foodUnused = (packs.find((p) => p.id === 'PacksExtra')?.unusedAll || [])
    .filter((r) => /PixelPlatter/i.test(r));

  const report = {
    generatedAt: new Date().toISOString(),
    mapRoot: MAP_ROOT,
    totals: { pngFiles: total, roughlyUsed: usedEst, roughlyUnused: unusedEst },
    byCategory,
    unusedByCategory,
    gameAssetKeyCount: usage.assetKeys.length,
    gameAssetKeys: usage.assetKeys,
    packs: packs.map(({ unusedAll, ...rest }) => rest),
    polishTargets: {
      emotes: emotesUnused,
      chatBubbles: chatUnused,
      expansions: expansionUnused.slice(0, 200),
      foodMaybeUnused: foodUnused,
    },
  };

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push('# Discord Spaces — Sprite inventory');
  lines.push('');
  lines.push(`Generated: **${report.generatedAt}**`);
  lines.push('');
  lines.push('Regenerate: `node discord-map/scripts/inventory-sprites.mjs`');
  lines.push('');
  lines.push('> Matching is **filename/stem heuristic** against `game.js` text. Some used assets are referenced only via catalog keys — treat “unused” as a **candidate list**, not absolute truth.');
  lines.push('');
  lines.push('## Totals');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|------:|`);
  lines.push(`| PNG files under packs | ${total} |`);
  lines.push(`| Roughly referenced in game.js | ${usedEst} |`);
  lines.push(`| Roughly unused candidates | ${unusedEst} |`);
  lines.push(`| ASSETS-style keys parsed from game.js | ${usage.assetKeys.length} |`);
  lines.push('');
  lines.push('## By pack');
  lines.push('');
  for (const p of packs) {
    lines.push(`### ${p.id}`);
    lines.push('');
    lines.push(`- **License / source:** ${p.license}`);
    lines.push(`- **PNG files:** ${p.total} (used ~${p.used} · unused candidates ~${p.unused})`);
    lines.push('- **Top-level folders:**');
    for (const [k, v] of Object.entries(p.byTop).sort((a, b) => b[1] - a[1])) {
      lines.push(`  - \`${k}\`: ${v}`);
    }
    lines.push('');
  }
  lines.push('## By category (all packs)');
  lines.push('');
  lines.push('| Category | PNGs | Unused candidates |');
  lines.push('|----------|-----:|------------------:|');
  for (const cat of Object.keys(byCategory).sort()) {
    lines.push(`| ${cat} | ${byCategory[cat]} | ${unusedByCategory[cat] || 0} |`);
  }
  lines.push('');
  lines.push('## High-value unused candidates (polish backlog)');
  lines.push('');
  lines.push('### Emotes (PixelSpacesFull/UI/Emotes)');
  lines.push('');
  if (emotesUnused.length) emotesUnused.forEach((r) => lines.push(`- \`${r}\``));
  else lines.push('- (none detected as unused — check game.js emote map)');
  lines.push('');
  lines.push('### Chat bubbles');
  lines.push('');
  if (chatUnused.length) chatUnused.forEach((r) => lines.push(`- \`${r}\``));
  else lines.push('- (none or all referenced)');
  lines.push('');
  lines.push('### Expansions (first 80 unused)');
  lines.push('');
  expansionUnused.slice(0, 80).forEach((r) => lines.push(`- \`${r}\``));
  if (expansionUnused.length > 80) lines.push(`- … +${expansionUnused.length - 80} more (see JSON)`);
  lines.push('');
  lines.push('### PacksExtra food (if any unreferenced)');
  lines.push('');
  if (foodUnused.length) foodUnused.forEach((r) => lines.push(`- \`${r}\``));
  else lines.push('- All Pixel Platter basenames appear referenced (or none present).');
  lines.push('');
  lines.push('## Pack layout (how to organize / find art)');
  lines.push('');
  lines.push('```');
  lines.push('discord-map/');
  lines.push('  PixelSpaces/           # Base pack — NPCs, core furniture, street BG');
  lines.push('    NPCs/Male|Female/    # 30 sheets · 32×32 · 8×14 pose grid');
  lines.push('    Furniture/           # Bathroom Bedroom Kitchen Living Room');
  lines.push('    Objects/             # Props');
  lines.push('    Backgrounds/         # Mountains trees houses street dressing');
  lines.push('    Infrastructure/      # Doors elevators roofs stairs');
  lines.push('  PixelSpacesFull/       # Full pack + expansions + UI');
  lines.push('    Individual Assets/   # Often preferred over base (more variants)');
  lines.push('    Expansions/          # Cafe Halloween Hospital Police … themed sets');
  lines.push('    UI/Emotes/           # Heart wave anger etc.');
  lines.push('    UI/Chat Bubbles/');
  lines.push('    UI/Icons/');
  lines.push('    Tilesets & SpriteSheets/');
  lines.push('  PacksExtra/            # Third-party free (pets, food)');
  lines.push('    Cats/ Dogs/          # Paws & Whiskers free (NON-COMMERCIAL)');
  lines.push('    PixelPlatter/        # Food plate sprites');
  lines.push('```');
  lines.push('');
  lines.push('## How game.js maps art');
  lines.push('');
  lines.push('1. `ASSETS` object maps **logical keys** → relative PNG paths.');
  lines.push('2. `preload` loads every `ASSETS` entry as a Phaser texture key.');
  lines.push('3. Room kits (`KITS`, `THEME_KITS`, `decorateRoom`) pick keys by channel theme.');
  lines.push('4. `furn()` / `placeFood()` place sprites with foot/bottom origin on floor lines.');
  lines.push('5. NPC sheets: `NPC_SHEETS` + `NPC_POSE_DEFS` (walk idle sit lie eat wave …).');
  lines.push('6. Pets: `PET_SHEETS` 8-dir walk on row 0.');
  lines.push('7. Food: `FOOD_KEYS` + `seedFoodOnAllTables()` + `actorEatFood()`.');
  lines.push('');
  lines.push('## Machine-readable');
  lines.push('');
  lines.push('See `sprite-inventory.json` for full samples and expansion lists.');
  lines.push('');

  fs.writeFileSync(OUT_MD, lines.join('\n'));
  console.log(`Wrote ${OUT_MD}`);
  console.log(`Wrote ${OUT_JSON}`);
  console.log(JSON.stringify(report.totals, null, 2));
  console.log('Emotes unused:', emotesUnused.length);
  console.log('Expansion unused candidates:', expansionUnused.length);
}

main();
