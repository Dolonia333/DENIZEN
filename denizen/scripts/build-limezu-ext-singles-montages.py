#!/usr/bin/env python3
"""Build numbered Singles montages for vision → me.* linking.

Usage:
  python3 scripts/build-limezu-ext-singles-montages.py
  python3 scripts/build-limezu-ext-singles-montages.py --theme 8_Worksite
  python3 scripts/build-limezu-ext-singles-montages.py --only-weak   # weak/unlinked only

Outputs (gitignored images + tracked index):
  data/limezu-visual-catalog/montages/<sheet>/mosaic_00.png
  data/limezu-visual-catalog/montages/<sheet>/index.json
  data/limezu-visual-catalog/montages-manifest.json
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
CAT = ROOT / "data/limezu-visual-catalog"
SINGLES_JSONL = CAT / "ext-singles-pixelperfect.jsonl"
OUT = CAT / "montages"

# Sheet stem → folder (same as catalog script)
EXT_MAP = {
    "1_Terrains_and_Fences": "1_terrains_and_fences",
    "2_City_Terrains": "2_city_terrains",
    "3_City_Props": "3_city_props",
    "4_Generic_Buildings": "4_generic_building",
    "5_Floor_Modular_Buildings": "5_floor_modular_building",
    "6_Garage_Sales": "6_garage_sales",
    "7_Villas": "7_villas",
    "8_Worksite": "8_worksite",
    "9_Shopping_Center_and_Markets": "9_shopping_center_and_markets",
    "10_Vehicles": "10_vehicles",
    "11_Camping": "11_camping",
    "12_Hotel_and_Hospital": "12_hotel_and_hospital",
    "13_School": "13_school",
    "14_Swimming_Pool": "14_swimming_pool",
    "15_Police_Station": "15_police_station",
    "16_Office": "16_office",
    "17_Garden": "17_garden",
    "18_Fire_Station": "18_fire_station",
    "19_Graveyard": "19_graveyard",
    "20_Subway_and_Train_Station": "20_subway_and_train_station",
    "21_Beach": "21_beach",
    "22_Post_Office": "22_post_office",
    "23_MIlitary_Base": "23_military_base",
    "24_Additional_Houses": "24_additional_houses",
}

THUMB = 72
COLS = 8
ROWS_PER = 6  # 48 cells / mosaic
LABEL_H = 16
BG = (28, 32, 40, 255)
BORDER = (70, 78, 92, 255)
TEXT = (230, 230, 230, 255)
WEAK_MAX_SCORE = 6.0


def load_rows() -> list[dict]:
    return [json.loads(l) for l in SINGLES_JSONL.read_text().splitlines() if l.strip()]


def is_weak(row: dict) -> bool:
    vl = row.get("vision_link")
    if not vl:
        return True
    return float(vl.get("score") or 0) < WEAK_MAX_SCORE


def make_mosaic(cells: list[dict], out_path: Path, start_index: int) -> None:
    n = len(cells)
    rows = (n + COLS - 1) // COLS
    cell_w, cell_h = THUMB, THUMB + LABEL_H
    img = Image.new("RGBA", (COLS * cell_w, rows * cell_h), BG)
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    for i, cell in enumerate(cells):
        col, row = i % COLS, i // COLS
        x, y = col * cell_w, row * cell_h
        path = ROOT / cell["path"]
        try:
            sp = Image.open(path).convert("RGBA")
            scale = min(THUMB / max(sp.width, 1), THUMB / max(sp.height, 1), 4.0)
            # nearest upscale for tiny sprites
            nw = max(1, int(sp.width * scale))
            nh = max(1, int(sp.height * scale))
            sp = sp.resize((nw, nh), Image.Resampling.NEAREST)
            px = x + (THUMB - nw) // 2
            py = y + (THUMB - nh) // 2
            # checker behind transparency
            for cy in range(y, y + THUMB, 8):
                for cx in range(x, x + THUMB, 8):
                    c = (48, 52, 60, 255) if ((cx + cy) // 8) % 2 == 0 else (36, 40, 48, 255)
                    draw.rectangle([cx, cy, min(cx + 7, x + THUMB - 1), min(cy + 7, y + THUMB - 1)], fill=c)
            img.paste(sp, (px, py), sp)
        except Exception:
            draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], fill=(60, 30, 30, 255))
        draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], outline=BORDER)
        label = str(start_index + i)
        draw.text((x + 2, y + THUMB + 1), label, fill=TEXT, font=font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(out_path, "PNG", optimize=True)


def process_sheet(sheet: str, rows: list[dict], only_weak: bool) -> dict:
    sheet_rows = [r for r in rows if r["sheet"] == sheet]
    # Order: sheet position when known, else basename
    def sort_key(r):
        y = r.get("sheet_y")
        x = r.get("sheet_x")
        if y is None:
            return (10**9, 10**9, r["basename"])
        return (y, x if x is not None else 10**9, r["basename"])

    sheet_rows.sort(key=sort_key)
    if only_weak:
        sheet_rows = [r for r in sheet_rows if is_weak(r)]

    out_dir = OUT / sheet
    if out_dir.exists():
        for old in out_dir.glob("mosaic_*.png"):
            old.unlink()

    batch = COLS * ROWS_PER
    mosaics = []
    index = {"sheet": sheet, "cells": {}, "mosaics": []}
    for bi, offset in enumerate(range(0, len(sheet_rows), batch)):
        chunk = sheet_rows[offset : offset + batch]
        start_i = offset + 1  # 1-based per sheet
        rel = f"data/limezu-visual-catalog/montages/{sheet}/mosaic_{bi:02d}.png"
        out_path = ROOT / rel
        make_mosaic(chunk, out_path, start_i)
        for j, cell in enumerate(chunk):
            num = str(start_i + j)
            index["cells"][num] = {
                "n": start_i + j,
                "id": cell["id"],
                "basename": cell["basename"],
                "path": cell["path"],
                "w": cell["w"],
                "h": cell["h"],
                "sheet_x": cell.get("sheet_x"),
                "sheet_y": cell.get("sheet_y"),
                "match_status": cell.get("match_status"),
                "prior_me_id": (cell.get("vision_link") or {}).get("me_id"),
                "prior_score": (cell.get("vision_link") or {}).get("score"),
                "mosaic": bi,
            }
        mosaics.append({"index": bi, "path": rel, "start": start_i, "count": len(chunk)})
        index["mosaics"].append(mosaics[-1])

    (out_dir / "index.json").write_text(json.dumps(index, indent=2) + "\n")
    # Also dump me.* vocabulary for this sheet (for vision prompts)
    labels_path = CAT / "sheets" / sheet / "labels.json"
    vocab = []
    if labels_path.exists():
        labs = json.loads(labels_path.read_text()).get("objects") or []
        vocab = [{"id": o.get("id"), "name": o.get("name"), "y_hint": o.get("y_hint"), "multi_tile": o.get("multi_tile")} for o in labs]
    (out_dir / "me-vocab.json").write_text(json.dumps({"sheet": sheet, "labels": vocab}, indent=2) + "\n")

    return {
        "sheet": sheet,
        "cell_count": len(sheet_rows),
        "mosaic_count": len(mosaics),
        "only_weak": only_weak,
        "mosaics": mosaics,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", help="Sheet stem, e.g. 8_Worksite")
    ap.add_argument("--only-weak", action="store_true")
    args = ap.parse_args()

    rows = load_rows()
    themes = EXT_MAP
    if args.theme:
        if args.theme not in EXT_MAP:
            raise SystemExit(f"Unknown theme {args.theme}")
        themes = {args.theme: EXT_MAP[args.theme]}

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "thumb": THUMB,
        "cols": COLS,
        "rows_per": ROWS_PER,
        "only_weak": args.only_weak,
        "sheets": [],
    }
    for sheet in themes:
        info = process_sheet(sheet, rows, args.only_weak)
        manifest["sheets"].append(info)
        print(f"{sheet}: {info['cell_count']} cells → {info['mosaic_count']} mosaics", flush=True)

    (CAT / "montages-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("wrote", CAT / "montages-manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
