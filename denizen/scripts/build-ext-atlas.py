#!/usr/bin/env python3
"""Build a texture atlas for Modern Exteriors "singles" stamps used by the
current city plan, to cut down the number of PNG HTTP requests the browser
has to make.

Packs every unique `img` referenced by data/city-plan.json stamps into one
(or more, if it can't fit under --max-size) atlas page(s) using a simple
shelf bin-packing algorithm, and writes a frame-map manifest so a renderer
can look up `{x, y, w, h, page}` for any given singles path.

This tool only *builds* the atlas + manifest. Wiring full-world.js (or any
other renderer) to actually draw from the atlas instead of individual PNGs
is an intentional follow-up, not done here.

Usage:
  python3 scripts/build-ext-atlas.py
  python3 scripts/build-ext-atlas.py --plan data/city-specs/d7-park.json
  python3 scripts/build-ext-atlas.py --max-size 2048 --padding 1
  python3 scripts/build-ext-atlas.py --out-dir assets/limezu/ext-atlas

Output:
  assets/limezu/ext-atlas/atlas.png        (atlas_0.png, atlas_1.png, ... if
                                             more than one page is needed)
  assets/limezu/ext-atlas/atlas.json       frame map + page metadata
"""

import argparse
import json
import os
import sys
import time

from PIL import Image

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_PLAN = os.path.join(DEN, "data", "city-plan.json")
DEFAULT_CATALOG = os.path.join(DEN, "data", "limezu-visual-catalog", "placement-index.json")
DEFAULT_ASSETS_ROOT = os.path.join(DEN, "assets", "limezu")
DEFAULT_OUT_DIR = os.path.join(DEN, "assets", "limezu", "ext-atlas")


def collect_unique_imgs(plan_path):
    """Return the sorted set of unique `img` paths referenced by stamps in
    the plan. Sorted so packing order (and thus atlas layout) is stable
    across re-runs, which keeps diffs small."""
    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)
    stamps = plan.get("stamps", [])
    imgs = set()
    for s in stamps:
        img = s.get("img")
        if img:
            imgs.add(img)
    return sorted(imgs)


def load_catalog_ids(catalog_path):
    """Best-effort reverse lookup: img path -> a human-readable placement id
    (me.* or exs.*), pulled from the visual catalog placement index. Purely
    cosmetic metadata for atlas.json; packing itself only depends on the
    plan's img list."""
    ids = {}
    if not catalog_path or not os.path.isfile(catalog_path):
        return ids
    try:
        with open(catalog_path, encoding="utf-8") as f:
            catalog = json.load(f)
    except (OSError, ValueError):
        return ids
    for section in ("me", "exs"):
        for entry_id, entry in catalog.get(section, {}).items():
            img = entry.get("img")
            if img and img not in ids:
                ids[img] = entry_id
    return ids


def load_images(img_paths, assets_root):
    """Open every referenced PNG once and record its size. Skips (with a
    warning) any path that's missing on disk instead of hard failing, since
    a stale plan reference shouldn't block atlas builds for everything
    else."""
    items = []
    missing = []
    for img in img_paths:
        abs_path = os.path.join(assets_root, img.replace("/", os.sep))
        if not os.path.isfile(abs_path):
            missing.append(img)
            continue
        with Image.open(abs_path) as im:
            w, h = im.size
        items.append({"img": img, "path": abs_path, "w": w, "h": h})
    return items, missing


def shelf_pack(items, max_size, padding):
    """Simple shelf (row-based) bin packer.

    Sorts by height descending (tallest-first tends to minimize wasted
    shelf space for this kind of mixed sprite-sheet workload), then packs
    left-to-right / top-to-bottom, wrapping to a new shelf row when a page
    runs out of width and to a new page when it runs out of height.

    Returns (pages, placements) where:
      pages       = list of {"width": W, "height": H} bounding boxes used
      placements  = list of dicts (page, x, y, w, h) aligned with `items`
    """
    usable = max_size - 2 * padding
    ordered = sorted(range(len(items)), key=lambda i: (-items[i]["h"], -items[i]["w"]))

    placements = [None] * len(items)
    pages = []

    page_idx = -1
    x = y = shelf_h = page_used_w = 0

    def start_page():
        nonlocal page_idx, x, y, shelf_h, page_used_w
        page_idx += 1
        pages.append({"width": 0, "height": 0})
        x = padding
        y = padding
        shelf_h = 0
        page_used_w = 0

    start_page()

    for i in ordered:
        w, h = items[i]["w"], items[i]["h"]
        if w > usable or h > usable:
            print(
                f"warning: {items[i]['img']} is {w}x{h}, too large for a "
                f"single {max_size}x{max_size} page even alone; placing "
                f"anyway on its own oversized page",
                file=sys.stderr,
            )

        # Wrap to next shelf row if it doesn't fit on the current one.
        if x + w + padding > max_size and x > padding:
            x = padding
            y += shelf_h + padding
            shelf_h = 0

        # Start a new page if this shelf row doesn't fit vertically.
        if y + h + padding > max_size and y > padding:
            pages[page_idx]["width"] = page_used_w
            pages[page_idx]["height"] = y + shelf_h + padding if shelf_h else y
            start_page()

        placements[i] = {"page": page_idx, "x": x, "y": y, "w": w, "h": h}
        x += w + padding
        shelf_h = max(shelf_h, h)
        page_used_w = max(page_used_w, x)

    pages[page_idx]["width"] = min(max_size, max(page_used_w, padding))
    pages[page_idx]["height"] = min(max_size, y + shelf_h + padding)

    return pages, placements


def render_pages(items, placements, pages, padding):
    canvases = []
    for p in pages:
        w = max(1, p["width"])
        h = max(1, p["height"])
        canvases.append(Image.new("RGBA", (w, h), (0, 0, 0, 0)))

    for item, placement in zip(items, placements):
        with Image.open(item["path"]) as im:
            im = im.convert("RGBA")
            # No mask: frames never overlap, so we want a direct pixel copy
            # (including alpha) rather than PIL's alpha-blend-over-dest
            # behavior that `paste(im, box, mask=im)` would trigger.
            canvases[placement["page"]].paste(im, (placement["x"], placement["y"]))

    return canvases


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plan", default=DEFAULT_PLAN, help="City plan JSON to source stamp imgs from (default: data/city-plan.json)")
    ap.add_argument("--catalog", default=DEFAULT_CATALOG, help="Visual catalog placement-index.json used for id lookups (default: data/limezu-visual-catalog/placement-index.json)")
    ap.add_argument("--assets-root", default=DEFAULT_ASSETS_ROOT, help="Root dir that `img` paths are relative to (default: assets/limezu)")
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR, help="Output dir for atlas.png/atlas.json (default: assets/limezu/ext-atlas)")
    ap.add_argument("--max-size", type=int, default=4096, help="Max atlas page width/height in px (default: 4096)")
    ap.add_argument("--padding", type=int, default=2, help="Padding in px between packed frames (default: 2)")
    args = ap.parse_args()

    plan_path = os.path.abspath(args.plan)
    if not os.path.isfile(plan_path):
        print(f"error: plan not found: {plan_path}", file=sys.stderr)
        return 1

    imgs = collect_unique_imgs(plan_path)
    if not imgs:
        print("error: no stamp `img` references found in plan", file=sys.stderr)
        return 1

    catalog_ids = load_catalog_ids(args.catalog)
    items, missing = load_images(imgs, args.assets_root)
    if missing:
        print(f"warning: {len(missing)} img path(s) referenced by the plan are missing on disk, skipping:", file=sys.stderr)
        for m in missing[:20]:
            print(f"  - {m}", file=sys.stderr)
        if len(missing) > 20:
            print(f"  ... and {len(missing) - 20} more", file=sys.stderr)

    if not items:
        print("error: no packable images found", file=sys.stderr)
        return 1

    source_bytes = sum(os.path.getsize(it["path"]) for it in items)

    pages, placements = shelf_pack(items, args.max_size, args.padding)
    canvases = render_pages(items, placements, pages, args.padding)

    os.makedirs(args.out_dir, exist_ok=True)

    single_page = len(canvases) == 1
    page_files = []
    for idx, canvas in enumerate(canvases):
        filename = "atlas.png" if single_page else f"atlas_{idx}.png"
        out_path = os.path.join(args.out_dir, filename)
        canvas.save(out_path, optimize=True)
        page_files.append(filename)

    atlas_bytes = sum(os.path.getsize(os.path.join(args.out_dir, f)) for f in page_files)

    frames = {}
    for item, placement in zip(items, placements):
        entry = {
            "x": placement["x"],
            "y": placement["y"],
            "w": placement["w"],
            "h": placement["h"],
        }
        if not single_page:
            entry["page"] = placement["page"]
        img_id = catalog_ids.get(item["img"])
        if img_id:
            entry["id"] = img_id
        frames[item["img"]] = entry

    manifest = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_plan": os.path.relpath(plan_path, DEN).replace(os.sep, "/"),
        "assets_root": os.path.relpath(os.path.abspath(args.assets_root), DEN).replace(os.sep, "/"),
        "max_size": args.max_size,
        "padding": args.padding,
        "image_count": len(items),
        "missing_count": len(missing),
        "pages": [
            {
                "index": idx,
                "file": page_files[idx],
                "width": pages[idx]["width"],
                "height": pages[idx]["height"],
            }
            for idx in range(len(pages))
        ],
        "frames": frames,
    }

    manifest_path = os.path.join(args.out_dir, "atlas.json")
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    request_savings = len(items) - len(canvases)
    byte_delta = source_bytes - atlas_bytes
    sign = "saved" if byte_delta >= 0 else "grew by"

    print(f"{len(items)} images -> {len(canvases)} atlas page(s)")
    if missing:
        print(f"  ({len(missing)} plan img references skipped, missing on disk)")
    for idx, p in enumerate(pages):
        print(f"  page {idx}: {page_files[idx]} ({p['width']}x{p['height']})")
    print(f"HTTP requests: {len(items)} singles -> {len(canvases)} atlas page(s), {request_savings} fewer requests")
    print(
        f"bytes: {source_bytes:,} (originals) vs {atlas_bytes:,} (atlas) "
        f"-> {sign} {abs(byte_delta):,} bytes"
    )
    print(f"manifest: {os.path.relpath(manifest_path, DEN)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
