#!/usr/bin/env python3
"""Build day/night asset swap rules for the full-world city renderer.

Scans the visual catalog and city plan for props that should look different
between day and night — street lamps that glow, campfires that burn, traffic
lights that cycle, candles that flicker, police facades with lit windows, etc.

Writes:
  data/limezu-visual-catalog/day-night-variants.json

Usage:
  python3 scripts/build-day-night-variants.py
  python3 scripts/build-day-night-variants.py --plan data/city-plan.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter

DEN = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(DEN, "data", "limezu-visual-catalog")
DEFAULT_PLAN = os.path.join(DEN, "data", "city-plan.json")
OUT_PATH = os.path.join(CAT, "day-night-variants.json")
PLACEMENT_INDEX = os.path.join(CAT, "placement-index.json")

# Phases where lights should be ON (matches src/city-tod.js phaseName).
LIT_PHASES = ["sunset", "night"]

# basename substring → animated night sheet (fw/fh derived from asset dimensions).
STREET_LAMP_ANIMS = {
    "Street_Lamp_1": ("ext/animated/Street_Lamp_16x16.png", 80, 80, 4),
    "Street_Lamp_2": ("ext/animated/Street_Lamp_2_16x16.png", 80, 80, 4),
    "Street_Lamp_3": ("ext/animated/Street_Lamp_3_16x16.png", 64, 64, 4),
    "Street_Lamp_4": ("ext/animated/Street_Lamp_3_2_16x16.png", 64, 64, 4),
    "Street_Lamp_5": ("ext/animated/Street_Lamp_3_3_16x16.png", 64, 64, 4),
}

CAMPFIRE_ANIMS = {
    "Campfire_1": ("ext/animated/Campfire_16x16.png", 32, 32, 6),
    "Campfire_2": ("ext/animated/Campfire_16x16.png", 32, 32, 6),
    "Campfire_3": ("ext/animated/Campfire_2_16x16.png", 32, 32, 6),
    "Campfire_Marshmallow_1": ("ext/animated/Campfire_2_16x16.png", 32, 32, 6),
    "Campfire_Marshmallow_2": ("ext/animated/Campfire_2_16x16.png", 32, 32, 6),
}

LANTERN_ANIMS = {
    f"Lantern_{i}": (f"ext/animated/Camping_Lantern_{i}.png", 48, 48, 6)
    for i in range(1, 7)
}

TRAFFIC_LIGHT_ANIM = ("ext/animated/Stoplight_16x16.png", 33, 27, 4)

CANDLE_ANIMS = {
    "Small_Brown_Candle": ("ext/animated/Graveyard_Candle_1_16x16.png", 16, 16, 4),
    "Small_Red_Candle": ("ext/animated/Graveyard_Candle_2_16x16.png", 16, 16, 4),
    "Medium_Brown_Candle": ("ext/animated/Graveyard_Candle_3_16x16.png", 16, 16, 4),
    "Medium_Red_Candle": ("ext/animated/Graveyard_Candle_4_16x16.png", 16, 16, 4),
    "Big_Brown_Candle": ("ext/animated/Graveyard_Candle_5_16x16.png", 16, 16, 4),
    "Big_Red_Candle": ("ext/animated/Graveyard_Candle_6_16x16.png", 16, 16, 4),
    "Wall_Candle_Holder": ("ext/animated/Graveyard_Wall_Candle_16x16.png", 16, 16, 4),
    "Candle_Holder_Off": ("ext/animated/Graveyard_Candle_Standing_16x16.png", 16, 48, 4),
}

# me.* day stamp → night static img swap (highlight facades, led on/off, etc.)
ME_NIGHT_IMG = {
    "me.police.facade_narrow_blue": "me.police.facade_narrow_blue_highlight",
    "me.police.facade_narrow_red": "me.police.facade_narrow_red_highlight",
    "me.graveyard.candle_holder_off": "me.graveyard.candle_holder_on",
}

# Fallback night imgs when me-to-singles has no link yet.
ME_NIGHT_IMG_FALLBACK = {
    "me.police.facade_narrow_red_highlight":
        "ext/singles/15_police_station/ME_Singles_Police_Station_16x16_Police_Station_Small_Highlight_2.png",
    "me.graveyard.candle_holder_on":
        "ext/singles/19_graveyard/ME_Singles_Graveyard_16x16_Candle_Holder_On.png",
}

# Stamps placed as the lit/on variant but should show unlit during day.
DAY_OVERRIDE_ME = {
    "me.subway.led_light": "exs.20_subway_and_train_station.subway_and_train_station_led_light_off",
}


def anim_rule(sheet: str, fw: int, fh: int, fps: int = 4) -> dict:
    return {"type": "anim", "sheet": sheet, "fw": fw, "fh": fh, "fps": fps}


def img_rule(img: str) -> dict:
    return {"type": "img", "img": img}


def basename(path: str) -> str:
    return os.path.basename(path or "")


def match_basename_rules(name: str, table: dict) -> dict | None:
    stem = name.replace(".png", "")
    for key, spec in table.items():
        if key in stem:
            sheet, fw, fh, fps = spec
            return anim_rule(sheet, fw, fh, fps)
    return None


def rel_img(path: str) -> str:
    """assets/limezu/ext/... → ext/..."""
    prefix = "assets/limezu/"
    return path[len(prefix):] if path.startswith(prefix) else path


def load_placement_index() -> tuple[dict, dict]:
    """Return (me→img, exs→img) lookups from placement-index + me-to-singles."""
    me_img: dict[str, str] = {}
    exs_img: dict[str, str] = {}
    if os.path.isfile(PLACEMENT_INDEX):
        with open(PLACEMENT_INDEX, encoding="utf-8") as f:
            idx = json.load(f)
        for me_id, entry in idx.get("me", {}).items():
            img = entry.get("img")
            if img:
                me_img[me_id] = img
        for exs_id, entry in idx.get("exs", {}).items():
            img = entry.get("img")
            if img:
                exs_img[exs_id] = img
  # Fallback: first linked single per me.* (covers highlight variants missing from index).
    me_singles = os.path.join(CAT, "me-to-singles.json")
    if os.path.isfile(me_singles):
        with open(me_singles, encoding="utf-8") as f:
            catalog = json.load(f)
        for me_id, entries in catalog.get("links", {}).items():
            if me_id in me_img or not entries:
                continue
            first = entries[0]
            if isinstance(first, dict):
                path = first.get("path")
                if path:
                    me_img[me_id] = rel_img(path)
    return me_img, exs_img


def build_rules(me_img: dict, exs_img: dict) -> dict:
    by_img: dict[str, dict] = {}
    by_me: dict[str, dict] = {}
    by_basename: dict[str, dict] = {}

    for key, spec in STREET_LAMP_ANIMS.items():
        by_basename[key] = anim_rule(*spec)

    for key, spec in CAMPFIRE_ANIMS.items():
        by_basename[key] = anim_rule(*spec)

    for key, spec in LANTERN_ANIMS.items():
        by_basename[key] = anim_rule(*spec)

    for key, spec in CANDLE_ANIMS.items():
        by_basename[key] = anim_rule(*spec)

    by_basename["Traffic_Light"] = anim_rule(*TRAFFIC_LIGHT_ANIM)

    for day_me, night_me in ME_NIGHT_IMG.items():
        night_img = me_img.get(night_me) or ME_NIGHT_IMG_FALLBACK.get(night_me)
        if night_img:
            by_me[day_me] = img_rule(night_img)

    for me_id, exs_id in DAY_OVERRIDE_ME.items():
        day_img = exs_img.get(exs_id)
        if day_img:
            by_me[me_id] = {"type": "day_override", "day_img": day_img}

    # Resolve exs paths for led_light_on stamps placed in the plan.
    on_img = exs_img.get("exs.20_subway_and_train_station.subway_and_train_station_led_light_on")
    off_img = exs_img.get("exs.20_subway_and_train_station.subway_and_train_station_led_light_off")
    if on_img and off_img:
        by_img[on_img] = {"type": "day_override", "day_img": off_img}

    return {
        "version": 1,
        "lit_phases": LIT_PHASES,
        "by_img": by_img,
        "by_me": by_me,
        "by_basename": by_basename,
    }


def lookup_night_rule(stamp: dict, rules: dict) -> dict | None:
    img = stamp.get("img") or ""
    me = stamp.get("me") or ""
    if img in rules["by_img"]:
        return rules["by_img"][img]
    if me in rules["by_me"]:
        return rules["by_me"][me]
    base = basename(img)
    for key, rule in rules["by_basename"].items():
        if key in base:
            return rule
    return None


def scan_plan(plan_path: str, rules: dict) -> dict:
    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)
    matched = Counter()
    for s in plan.get("stamps", []):
        rule = lookup_night_rule(s, rules)
        if rule:
            kind = rule.get("type", "?")
            matched[kind] += 1
    return dict(matched)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--plan", default=DEFAULT_PLAN, help="City plan to scan for coverage stats")
    ap.add_argument("-o", "--out", default=OUT_PATH, help="Output JSON path")
    args = ap.parse_args()

    me_img, exs_img = load_placement_index()
    rules = build_rules(me_img, exs_img)
    stats = scan_plan(args.plan, rules) if os.path.isfile(args.plan) else {}

    rules["stats"] = {
        "basename_rules": len(rules["by_basename"]),
        "me_rules": len(rules["by_me"]),
        "img_rules": len(rules["by_img"]),
        "plan_matches": stats,
        "plan_matches_total": sum(stats.values()),
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(rules, f, indent=1)
        f.write("\n")

    print(f"Wrote {args.out}")
    print(
        f"  rules: {rules['stats']['basename_rules']} basename, "
        f"{rules['stats']['me_rules']} me, {rules['stats']['img_rules']} img"
    )
    if stats:
        print(f"  plan coverage: {rules['stats']['plan_matches_total']} stamps — {stats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
