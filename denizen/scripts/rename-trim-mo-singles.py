#!/usr/bin/env python3
"""Copy Modern Office numbered singles -> named/*.png using mo_singles_ai_labels.json, then trim alpha."""
from __future__ import annotations
import json, shutil
from pathlib import Path
try:
    from PIL import Image
except ImportError:
    raise SystemExit('pip install pillow')

ROOT = Path(__file__).resolve().parents[1]
labels = json.loads((ROOT / 'data/mo_singles_ai_labels.json').read_text())
src = ROOT / 'assets/modern_office/singles'
named = ROOT / 'assets/modern_office/named'
named.mkdir(parents=True, exist_ok=True)
used = set()
manifest = []
for i in range(1, 340):
    lab = labels[str(i)]
    name = lab['name']
    base = name
    n = 1
    while base in used:
        n += 1
        base = f'{name}_{n}'
    used.add(base)
    src_file = src / f'Modern_Office_Singles_32x32_{i}.png'
    dst = named / f'{base}.png'
    im = Image.open(src_file).convert('RGBA')
    bbox = im.getbbox()
    (im.crop(bbox) if bbox else im).save(dst)
    manifest.append({'num': i, 'name': base, 'file': dst.name, 'src': src_file.name, 'label': lab})
(ROOT / 'data/mo_named_manifest.json').write_text(json.dumps({'count': len(manifest), 'items': manifest}, indent=2) + '\n')
print(f'Wrote {len(manifest)} named trimmed sprites -> {named}')
