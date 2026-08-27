#!/usr/bin/env python3
"""Slice LimeZu theme contact sheets into vision-readable bands.

Usage:
  python3 scripts/slice-limezu-sheets-for-vision.py
  python3 scripts/slice-limezu-sheets-for-vision.py --pack interiors
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BAND_H = 768

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


def slice_pack(themes_dir: Path, out_root: Path, pack: str, singles_map: dict) -> list:
    out = out_root / "sheets"
    out.mkdir(parents=True, exist_ok=True)
    manifest = []
    for sheet in sorted(themes_dir.glob("*.png")):
        im = Image.open(sheet).convert("RGBA")
        w, h = im.size
        bg = Image.new("RGBA", (w, h), (40, 44, 52, 255))
        bg.alpha_composite(im)
        rgb = bg.convert("RGB")
        stem = sheet.stem
        sheet_dir = out / stem
        sheet_dir.mkdir(exist_ok=True)
        ov_w = 512 if w <= 600 else 480
        ov_h = max(200, int(h * (ov_w / w)))
        overview = rgb.resize((ov_w, min(ov_h, 2400)), Image.Resampling.NEAREST)
        overview_path = sheet_dir / "_overview.jpg"
        overview.save(overview_path, quality=85, optimize=True)
        bands = []
        for i, y0 in enumerate(range(0, h, BAND_H)):
            y1 = min(h, y0 + BAND_H)
            band = rgb.crop((0, y0, w, y1))
            band2 = band.resize((band.width * 2, band.height * 2), Image.Resampling.NEAREST)
            bp = sheet_dir / f"band_{i:02d}_y{y0}-{y1}.jpg"
            band2.save(bp, quality=90, optimize=True)
            bands.append({
                "index": i, "y0": y0, "y1": y1,
                "path": str(bp.relative_to(ROOT)), "px_size": list(band2.size),
            })
        singles_key = singles_map.get(stem, stem.lower())
        singles_dir = f"assets/limezu/ext/singles/{singles_key}" if pack == "exteriors" else f"assets/limezu/singles/{singles_key}"
        n = len(list(Path(ROOT / singles_dir).glob("*.png"))) if (ROOT / singles_dir).exists() else 0
        entry = {
            "sheet": stem,
            "pack": pack,
            "source": str(sheet.relative_to(ROOT)),
            "size": [w, h],
            "overview": str(overview_path.relative_to(ROOT)),
            "bands": bands,
            "singles_dir": singles_dir,
            "singles_count": n,
        }
        (sheet_dir / "meta.json").write_text(json.dumps(entry, indent=2))
        manifest.append(entry)
        print(f"{stem}: {w}x{h} -> {len(bands)} bands, {n} singles")
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", choices=["exteriors", "interiors", "all"], default="exteriors")
    args = ap.parse_args()
    out_root = ROOT / "data" / "limezu-visual-catalog"
    all_manifest = []
    if args.pack in ("exteriors", "all"):
        all_manifest += slice_pack(
            ROOT / "assets/limezu/ext/themes", out_root, "exteriors", EXT_MAP,
        )
    if args.pack in ("interiors", "all"):
        # interiors themes → singles folder names are approximate
        interior_map = {}
        all_manifest += slice_pack(
            ROOT / "assets/limezu/themes", out_root, "interiors", interior_map,
        )
    (out_root / "sheets-manifest.json").write_text(json.dumps({
        "band_height_px": BAND_H,
        "sheet_count": len(all_manifest),
        "sheets": all_manifest,
    }, indent=2))
    print("wrote", out_root / "sheets-manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
