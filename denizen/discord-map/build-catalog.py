#!/usr/bin/env python3
"""Generate world-catalog.json — a machine-readable inventory of every
Pixel Spaces sprite plus the layout/animation conventions the Discord map
uses, so an external map generator / world builder (e.g. a local AI) can
recreate or extend the world without reading game.js.

Usage:  py -3.12 build-catalog.py   (run from denizen/discord-map/)
Output: world-catalog.json next to this script.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("PIL required: py -3.12 -m pip install pillow", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent
PACKS = {
    "PixelSpaces": "free-pack subset served at ./PixelSpaces",
    "PixelSpacesFull": "full pack + expansions served at ./PixelSpacesFull",
}

# ——— conventions the runtime (game.js) relies on ———————————————————————
CONVENTIONS = {
    "render": {
        "scale": 2,
        "note": "all sprites drawn at 2x with NEAREST filtering; world units below are source pixels unless suffixed _px2 (screen px)",
        "groundY": 318,
        "canvas": {"width": 980, "height": 420},
    },
    "building": {
        "width": 290,
        "museumWidth": 340,
        "roomInnerWidth": 258,
        "roomPadX": 16,
        "doorStripH": 54,
        "floorBandH": 8,
        "roofCapH": 12,
        "roomHeights": {"small": 84, "large": 102, "museumSmall": 90, "museumLarge": 112},
        "layoutBands": {
            "elevatorLane": [14, 58],
            "elevatorShaftX": 36,
            "anchorFurniture": [66, 130],
            "activityCluster": [130, 210],
            "rightWall": [210, 252],
        },
        "rooftop": "walkable floor at buildingTop+6, reached via the elevator lane from the top room; decorated with roofVents1/2 + treeRoof2",
        "entrances": "two street doors at left+42 and left+bw-48; wood doors auto-open within 26px, elevator entrances animate closed->slightly->open by distance band (42/16px)",
    },
    "roomItemFormat": {
        "f": "['f', keyOrVariantArray, dx, scale?, dyLift?] floor object, bottom-anchored at floorY-dyLift",
        "w": "['w', keyOrVariantArray, dx, dyFromRoomTop, scale?] wall/hanging object, top-anchored",
        "npc": "['npc', seedString, dx] full-body cast member (idle loop), sheet picked by hash(seed)",
        "glow": "['glow', colorHex, alpha] breathing room-light rectangle",
        "variantArrays": "when key is an array, variant = arr[(hash(channelId)+itemIndex*13+5) % len] — stable per room, differs between rooms",
    },
    "channelMapping": {
        "grouping": "one building per Discord category; channels are stacked rooms (2 per themed building, 4 per plain building); voice-only categories get the voice lounge",
        "roomKey": "ch_<discordChannelId> — presence occupants spawn onto that room's slot points",
        "themeKeywords": {
            "cafe": "cafe|coffee|food|kitchen",
            "gamer": "game|gaming|arcade|clip|media",
            "hospital": "support|help|health|med|hospital",
            "museum": "art|gallery|showcase|museum|history",
            "police": "mod|admin|staff|report|police|security",
            "fire": "alert|incident|fire|urgent|emergency",
            "halloween": "meme|spook|horror|halloween|off-?topic",
            "winterzone(outdoor)": "winter|xmas|christmas|holiday|snow",
            "digzone(outdoor)": "dig|archaeo|fossil|excavat|research|lab",
        },
        "fallback": "round-robin over ['plain','plain',cafe,gamer,hospital,museum,police,fire,halloween]",
    },
    "interactables": {
        "seats_px2_surface": {
            "couch*": 10, "stool*": 12, "officechair*": 12, "throne*": 12,
            "waitChair*": 12, "chairHalloween": 12, "benchWood": 10,
        },
        "beds_px2_surface": {
            "bed*": 12, "bedHosp": 12, "bunkBottom": 12, "tableSurgery": 14, "coffin": 12,
        },
        "controls": "E or Up sits/lies when within radius (seat 16px, bed 22px); any of Down/E/Up stands",
    },
}

ANIMATIONS = {
    "mainNpcSheets": {
        "glob": "PixelSpaces/NPCs/{Male,Female}/NPC 1-15.png",
        "grid": {"cellW": 32, "cellH": 32, "cols": 8, "rows": 14},
        "frameIndex": "row * 8 + col",
        "footOriginY": 0.75,
        "rows": [
            {"row": 0, "name": "move", "frames": 4, "fps": 8, "loop": True},
            {"row": 1, "name": "idle", "frames": 3, "fps": 2, "loop": True},
            {"row": 2, "name": "jump", "frames": 2, "fps": 6},
            {"row": 3, "name": "sit", "frames": 3, "fps": 10},
            {"row": 4, "name": "sit_idle", "frames": 3, "fps": 2, "loop": True},
            {"row": 5, "name": "sit_finish", "frames": 3, "fps": 12},
            {"row": 6, "name": "lie_down", "frames": 6, "fps": 10},
            {"row": 7, "name": "lie_finish", "frames": 6, "fps": 12},
            {"row": 8, "name": "eating", "frames": 2, "fps": 4, "repeat": 2},
            {"row": 9, "name": "eating_sit", "frames": 2, "fps": 4, "repeat": 3},
            {"row": 10, "name": "hurt", "frames": 3, "fps": 8},
            {"row": 11, "name": "shrug", "frames": 7, "fps": 9},
            {"row": 12, "name": "snicker", "frames": 2, "fps": 4, "repeat": 2},
            {"row": 13, "name": "wave", "frames": 4, "fps": 8},
        ],
        "warning": "each row also contains a text label drawn in the cell after the last real frame — never include it in an animation",
        "runtime": "all rows are registered by game.js; decorative cast uses furniture-aware walk/sit/lie/eat/social routines, live Discord members use standing social poses",
    },
    "expansionNpcSheets": {
        "glob": "PixelSpacesFull/Expansions/*/NPCs/*.png (and Cafe/Pre-made NPCs)",
        "grid": {"cellW": 16, "cellH": 16, "cols": 10, "rows": 6},
        "rows": [
            {"row": 0, "name": "move", "frames": 4},
            {"row": 1, "name": "idle", "frames": 3},
            {"row": 2, "name": "jump", "frames": 2},
        ],
        "warning": "portrait-bust style (head+shoulders only, ~2 cells tall) — NOT full-body; the map uses the 32x32 cast for people and treats these as unused",
    },
    "elevator": {
        "frames": ["Elevator_closed", "Elevator_slightlyOpened", "Elevator_opened"],
        "size": [26, 23],
        "usage": "proximity bands outdoors (42px slightly / 16px open); ride sequence slightly->open(90ms)->closed(520ms)",
    },
}


def categorize(rel: str) -> str:
    parts = rel.split("/")
    if parts[0] == "Expansions":
        return f"expansion:{parts[1]}"
    if "NPC" in rel or "/NPCs/" in rel or "Pre-made" in rel:
        return "npc"
    for tag in ("Backgrounds", "Infrastructure", "Furniture", "Objects", "UI",
                "Tilesets & SpriteSheets", "Individual Assets"):
        if tag in parts:
            return tag.lower().replace(" & ", "-").replace(" ", "-")
    return "misc"


def main() -> int:
    assets = []
    for pack in PACKS:
        base = ROOT / pack
        if not base.is_dir():
            print(f"skip missing pack {pack}", file=sys.stderr)
            continue
        for p in sorted(base.rglob("*.png")):
            rel = p.relative_to(base).as_posix()
            try:
                with Image.open(p) as im:
                    w, h = im.size
            except Exception as e:  # noqa: BLE001
                print(f"unreadable {p}: {e}", file=sys.stderr)
                continue
            assets.append({
                "pack": pack,
                "path": rel,
                "url": f"./{pack}/{rel}",
                "w": w,
                "h": h,
                "category": categorize(rel),
            })

    # Which assets does game.js actually reference?
    src = (ROOT / "game.js").read_text(encoding="utf-8")
    used_urls = set()
    for m in re.finditer(r"`\$\{(PACK|FULL|IA|EXP|LR|KIT|BR|OBJ|OBR|INF|BG)\}/([^`]+)`", src):
        prefix = {
            "PACK": "./PixelSpaces", "FULL": "./PixelSpacesFull",
            "IA": "./PixelSpacesFull/Individual Assets",
            "EXP": "./PixelSpacesFull/Expansions",
            "LR": "./PixelSpaces/Furniture/Living Room",
            "KIT": "./PixelSpaces/Furniture/Kitchen",
            "BR": "./PixelSpaces/Furniture/Bedroom",
            "OBJ": "./PixelSpaces/Objects/Living Room",
            "OBR": "./PixelSpaces/Objects/Bedroom",
            "INF": "./PixelSpaces/Infrastructure",
            "BG": "./PixelSpaces/Backgrounds",
        }[m.group(1)]
        used_urls.add(f"{prefix}/{m.group(2)}")
    for a in assets:
        a["usedByMap"] = a["url"] in used_urls

    catalog = {
        "$schema": "denizen-world-catalog/v1",
        "source": "Pixel Spaces asset pack by Netherzapdos (netherzapdos.itch.io/pixel-spaces); catalog generated by build-catalog.py",
        "license": "pack license: commercial use OK, no resale/redistribution of raw assets, no AI-generated content based on the assets",
        "conventions": CONVENTIONS,
        "animations": ANIMATIONS,
        "counts": {
            "assets": len(assets),
            "usedByMap": sum(1 for a in assets if a["usedByMap"]),
        },
        "assets": assets,
    }
    out = ROOT / "world-catalog.json"
    out.write_text(json.dumps(catalog, indent=1), encoding="utf-8")
    print(f"wrote {out.name}: {catalog['counts']['assets']} assets "
          f"({catalog['counts']['usedByMap']} used by the map)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
