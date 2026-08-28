#!/usr/bin/env python3
"""Derive biome-specs/full/d{N}-*.json from a hand-authored district fragment.

Reads patches/labels from data/city-specs/d{N}-*.json, snaps a full-bbox spec
covering the real patch footprint, and writes a compiler-ready spec with
full_bbox: true. Run compile-exterior-district.py --qa on the output next.

Usage:
  python3 scripts/derive-full-district-spec.py --district 1
  python3 scripts/derive-full-district-spec.py --all
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
SPECS = DEN / "data" / "city-specs"
FULL = SPECS / "biome-specs" / "full"
RULES_PATH = DEN / "data" / "limezu-visual-catalog" / "placement-rules.json"
TILE = 16

# district number → hand file stem, biome, seed, optional extra landmarks/groups
DISTRICTS = {
    1: {
        "file": "d1-mainstreet.json",
        "biome": "urban_core",
        "palette": "neutral_urban",
        "palette_secondary": "warm_autumn",
        "seed": 101001,
    },
    2: {
        "file": "d2-shopping.json",
        "biome": "commercial",
        "palette": "festive_market",
        "palette_secondary": "warm_autumn",
        "seed": 102001,
    },
    3: {
        "file": "d3-station.json",
        "biome": "transit",
        "palette": "neutral_urban",
        "palette_secondary": "civic_blue",
        "seed": 103001,
    },
    4: {
        "file": "d4-foodmarket.json",
        "biome": "commercial",
        "palette": "festive_market",
        "palette_secondary": "warm_autumn",
        "seed": 104001,
    },
    5: {
        "file": "d5-civic.json",
        "biome": "civic",
        "palette": "civic_blue",
        "palette_secondary": "neutral_urban",
        "seed": 105001,
    },
    8: {
        "file": "d8-beach.json",
        "biome": "beach",
        "palette": "coastal",
        "palette_secondary": "festive_market",
        "seed": 108001,
        "max_bottom_y": 4400,
    },
    12: {
        "file": "d12-military.json",
        "biome": "military",
        "palette": "military_olive",
        "palette_secondary": "industrial_rust",
        "seed": 112001,
    },
    14: {
        "file": "d14-farm.json",
        "biome": "rural",
        "palette": "warm_autumn",
        "palette_secondary": "verdant",
        "seed": 114001,
    },
    15: {
        "file": "d15-downtown.json",
        "biome": "urban_core",
        "palette": "neutral_urban",
        "palette_secondary": "night_neon",
        "seed": 115001,
    },
}


def snap(v: int) -> int:
    return (v // TILE) * TILE


def patch_bbox(patches: list) -> tuple[int, int, int, int]:
    xs, ys = [], []
    for p in patches:
        xs += [p["x"], p["x"] + p["w"]]
        ys += [p["y"], p["y"] + p["h"]]
    x0, y0 = snap(min(xs)), snap(min(ys))
    x1, y1 = max(xs), max(ys)
    return x0, y0, snap(x1 - x0) or TILE, snap(y1 - y0) or TILE


def tile_to_surface(tile: str) -> str:
    return {"grass": "grass", "sidewalk": "sidewalk", "asphalt": "asphalt", "sand": "sand"}.get(tile, "grass")


def derive_surfaces(patches: list, bx: int, by: int, bw: int, bh: int) -> list:
    surfaces = []
    seen = set()
    for i, p in enumerate(patches):
        surf = tile_to_surface(p.get("tile", "grass"))
        rx, ry = p["x"] - bx, p["y"] - by
        rw, rh = p["w"], p["h"]
        key = (surf, rx, ry, rw, rh)
        if key in seen:
            continue
        seen.add(key)
        entry = {
            "surface": surf,
            "x": rx, "y": ry, "w": rw, "h": rh,
            "depth": p.get("depth", 0.9),
        }
        if i == 0:
            entry["_doc"] = "derived from hand district patches"
        surfaces.append(entry)
    if not surfaces:
        surfaces.append({"surface": "grass", "x": 0, "y": 0, "w": bw, "h": bh, "depth": 0.9})
    return surfaces


def derive_slots(biome: str, rules: dict, bw: int, bh: int) -> list:
    density = rules.get("biomes", {}).get(biome, {}).get("density", {})
    if not density:
        density = {"decor_small": "medium", "vegetation": "medium"}
    return [
        {
            "slot": "interior_fill",
            "name": "district_fill",
            "x": 16, "y": 16, "w": max(TILE, bw - 32), "h": max(TILE, bh - 32),
            "density": density,
            "_doc": f"auto-derived from placement-rules.biomes.{biome}.density",
        },
        {
            "slot": "path_edge",
            "name": "walk_edge",
            "surface": "sidewalk",
            "density": {"street_furn": "medium", "signage": "light", "vegetation": "light"},
        },
    ]


def label_from_frag(frag: dict) -> tuple[str, dict]:
    labels = frag.get("labels") or []
    if labels:
        l = labels[0]
        text = l.get("text", frag.get("district", "DISTRICT"))
        lx = l.get("x", 0)
        ly = l.get("y", 0)
        return text, {"x": max(16, lx - frag.get("bbox", {}).get("x", lx)), "y": max(16, ly - frag.get("bbox", {}).get("y", ly))}
    dist = frag.get("district", "District")
    return dist.split("(")[0].strip().upper(), {"x": 24, "y": 24}


def build_spec(num: int, meta: dict, rules: dict) -> dict:
    hand_path = SPECS / meta["file"]
    frag = json.loads(hand_path.read_text(encoding="utf-8"))
    patches = frag.get("patches") or []
    bx, by, bw, bh = patch_bbox(patches)
    max_bottom = meta.get("max_bottom_y")
    if max_bottom is not None and by + bh > max_bottom:
        bh = snap(max_bottom - by)
    biome = meta["biome"]
    label, label_at = label_from_frag(frag)
    # Recompute label_at relative to derived bbox
    if frag.get("labels"):
        l = frag["labels"][0]
        label_at = {"x": max(16, l["x"] - bx), "y": max(16, l["y"] - by)}

    spec_id = f"d{num}-compiled"
    out_name = f"d{num}-{biome}.json"

    spec = {
        "_doc": f"AUTO-DERIVED by scripts/derive-full-district-spec.py from {meta['file']}. "
                f"Compile: python3 scripts/compile-exterior-district.py "
                f"--spec data/city-specs/biome-specs/full/{out_name} --qa -v",
        "schema": "exterior-district-spec/1",
        "id": spec_id,
        "district": frag.get("district", f"D{num}"),
        "biome": biome,
        "palette": meta["palette"],
        "palette_secondary": meta.get("palette_secondary", "verdant"),
        "compiler": {
            "version": 1,
            "rules": "data/limezu-visual-catalog/placement-rules.json",
            "seed": meta["seed"],
            "coords": "local",
            "out": f"data/city-specs/generated/{spec_id}.json",
            "full_bbox": True,
        },
        "bbox": {"x": bx, "y": by, "w": bw, "h": bh},
        "label": label,
        "label_at": label_at,
        "surfaces": derive_surfaces(patches, bx, by, bw, bh),
        "slots": derive_slots(biome, rules, bw, bh),
        "interactions": {"sit": "auto", "read": "auto", "shop": "auto", "play": "auto", "enter": "auto"},
    }
    if meta.get("landmarks"):
        spec["landmarks"] = meta["landmarks"]
    if meta.get("groups"):
        spec["groups"] = meta["groups"]
    return spec, out_name


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--district", type=int, action="append", help="district number (repeatable)")
    ap.add_argument("--all", action="store_true", help="derive all configured districts")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    nums = sorted(DISTRICTS) if args.all else (args.district or [])
    if not nums:
        ap.error("pass --district N and/or --all")

    rules = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    FULL.mkdir(parents=True, exist_ok=True)

    for num in nums:
        if num not in DISTRICTS:
            print(f"skip d{num}: not configured")
            continue
        spec, out_name = build_spec(num, DISTRICTS[num], rules)
        out_path = FULL / out_name
        if args.dry_run:
            print(f"would write {out_path} bbox={spec['bbox']}")
            continue
        out_path.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {out_path} ({spec['bbox']['w']}x{spec['bbox']['h']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
