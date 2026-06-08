#!/usr/bin/env python3
"""Build clean openplan objects catalog from sheet extract + placement mappings."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXTRACT_PATH = ROOT / "out" / "sheet_extract" / "modern_office_black_shadow_32.objects.json"
CATALOG_PATH = ROOT / "data" / "furniture_catalog_openplan.json"
OUT_OBJECTS_PATH = ROOT / "data" / "furniture_catalog_openplan_v2.objects.json"
OUT_MIGRATION_PATH = ROOT / "data" / "catalog_id_migration.json"

SHEET = "mo_black_shadow_32"
SUBCROP_AREA_RATIO = 0.82  # old rect much smaller than containing extract => keep sub-crop


def rect_tuple(r: dict) -> tuple[int, int, int, int]:
    return (int(r["x"]), int(r["y"]), int(r["w"]), int(r["h"]))


def iou(a: dict, b: dict) -> float:
    ax, ay, aw, ah = a["x"], a["y"], a["w"], a["h"]
    bx, by, bw, bh = b["x"], b["y"], b["w"], b["h"]
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    if inter == 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / union


def area(r: dict) -> int:
    return r["w"] * r["h"]


def contains(outer: dict, inner: dict) -> bool:
    return (
        inner["x"] >= outer["x"]
        and inner["y"] >= outer["y"]
        and inner["x"] + inner["w"] <= outer["x"] + outer["w"]
        and inner["y"] + inner["h"] <= outer["y"] + outer["h"]
        and rect_tuple(outer) != rect_tuple(inner)
    )


def get_extract_rect(obj: dict) -> dict:
    return obj.get("rectSnapped") or obj["rect"]


def infer_type_action(old: dict | None, w: int, h: int, grid: dict | None) -> tuple[str, str | None, float]:
    if old:
        return old.get("type", "furniture"), old.get("action"), float(old.get("depth", 1.5))

    gw = grid["w"] if grid else max(1, w // 32)
    gh = grid["h"] if grid else max(1, h // 32)
    gy = grid["y"] if grid else 0

    if 12 <= gy <= 13:
        return "decor", None, 1.55
    if 8 <= gy <= 10 and w == 32 and h == 64:
        return "seat", "seat", 1.6
    if w == 32 and h == 64:
        return "seat", "seat", 1.6
    if w == 32 and h == 32:
        return "decor", None, 2.0
    if gy >= 26 and w >= 96:
        return "partition", None, 1.7
    if gw >= 3 and gh <= 2:
        return "surface", "use_computer", 1.5
    if gh >= 3 and gw <= 2:
        return "surface", "use_computer", 1.5
    if gy >= 26 and h <= 32 and w >= 64:
        return "surface", "use_computer", 1.5
    if gy >= 14 and gy <= 16 and h <= 64:
        return "decor", None, 2.0
    if gy >= 18 and gy <= 24:
        return "furniture", None, 1.5
    if h <= 32 and w >= 64:
        return "decor", None, 1.2
    if gw >= 4 or (gw >= 2 and gh >= 3):
        return "furniture", None, 1.5
    return "furniture", None, 1.5


def region_category(grid: dict | None, w: int, h: int, y: int) -> str:
    gy = grid["y"] if grid else y // 32
    gx = grid["x"] if grid else 0
    gw = grid["w"] if grid else max(1, w // 32)
    gh = grid["h"] if grid else max(1, h // 32)

    if gy <= 3:
        if gw >= 3:
            return "desk"
        if gh >= 3:
            return "desk_vertical"
        return "desk_corner"
    if 8 <= gy <= 10:
        if gw >= 5:
            return "chair_row"
        if gw == 1 and gh == 2:
            side = ["front", "side_right", "side_left", "back"][gx % 4]
            return f"chair_{side}"
        return "chair_boss"
    if 12 <= gy <= 13:
        return "plant"
    if 14 <= gy <= 16:
        if h >= 64:
            return "paper_stack"
        return "paper"
    if 17 <= gy <= 18:
        return "whiteboard"
    if 18 <= gy <= 24:
        if gw >= 2:
            return "sofa"
        return "lounge"
    if 23 <= gy <= 25:
        return "vending"
    if 26 <= gy <= 32:
        if gw >= 4:
            return "cubicle_divider"
        if h <= 32 and w >= 64:
            return "desk_cubicle"
        return "cubicle"
    if gy >= 33:
        if gw >= 3 and gh <= 2:
            return "desk_setup"
        return "office_prop"
    if w <= 32 and h <= 32:
        return "decor"
    return "furniture"


def heuristic_name(grid: dict | None, w: int, h: int, y: int) -> str:
    cat = region_category(grid, w, h, y)
    gy = grid["y"] if grid else y // 32
    gx = grid["x"] if grid else 0
    gw = grid["w"] if grid else max(1, w // 32)
    gh = grid["h"] if grid else max(1, h // 32)

    if cat == "chair_front":
        colors = ["black", "orange", "blue", "white"]
        return f"chair_{colors[gy % 4]}_front"
    if cat == "chair_back":
        return "chair_black_back"
    if cat == "chair_side_right":
        return "chair_black_side_right"
    if cat == "chair_side_left":
        return "chair_black_side_left"
    if cat == "chair_row":
        return f"waiting_row_{gw}"
    if cat == "desk":
        return f"desk_horizontal_{gw}x{gh}"
    if cat == "desk_vertical":
        return f"desk_vertical_{gw}x{gh}"
    if cat == "desk_cubicle":
        orient = "front" if gy >= 31 else "back"
        return f"desk_cubicle_{orient}"
    if cat == "desk_setup":
        return f"desk_setup_{gw}x{gh}"
    if cat == "plant":
        kinds = ["tall", "potted", "snake"]
        return f"plant_{kinds[gy % 3]}"
    if cat == "sofa":
        parts = ["left", "middle", "right", "corner"]
        return f"sofa_{parts[gx % 4]}"
    if cat == "whiteboard":
        return f"whiteboard_{gw}x{gh}"
    if cat == "cubicle_divider":
        return f"partition_cubicle_{gw}x{gh}"
    if cat == "vending":
        return f"vending_{gw}x{gh}"
    return f"{cat}_g{gx}_{gy}_{gw}x{gh}"


def sanitize_id(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[^a-z0-9_]+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_")
    return name or "unnamed"


def make_catalog_entry(rect: dict, old: dict | None, grid: dict | None, note: str) -> dict:
    w, h = rect["w"], rect["h"]
    typ, action, depth = infer_type_action(old, w, h, grid)
    entry: dict = {
        "sheet": SHEET,
        "x": rect["x"],
        "y": rect["y"],
        "w": w,
        "h": h,
        "origin": "bottom",
        "depth": depth,
        "display_w": w,
        "display_h": h,
        "type": typ,
        "_note": note,
    }
    if action:
        entry["action"] = action
    if old and old.get("parent_offset_y") is not None:
        entry["parent_offset_y"] = old["parent_offset_y"]
    return entry


def find_best_extract_match(
    old_rect: dict, extract_objs: list[dict]
) -> tuple[dict | None, str, float, dict | None]:
    exact_key = rect_tuple(old_rect)
    for obj in extract_objs:
        er = get_extract_rect(obj)
        if rect_tuple(er) == exact_key:
            return er, "exact", 1.0, obj

    best_rect = None
    best_obj = None
    best_kind = ""
    best_score = 0.0

    for obj in extract_objs:
        er = get_extract_rect(obj)
        if contains(er, old_rect):
            score = area(old_rect) / area(er)
            if score > best_score:
                best_score = score
                best_rect = er
                best_obj = obj
                best_kind = "contains"
        else:
            score = iou(old_rect, er)
            if score > best_score:
                best_score = score
                best_rect = er
                best_obj = obj
                best_kind = "iou"

    return best_rect, best_kind, best_score, best_obj


def needs_subcrop(old_rect: dict, match_rect: dict | None, kind: str, score: float) -> bool:
    if match_rect is None:
        return True
    if kind == "exact":
        return False
    if kind == "contains" and score < SUBCROP_AREA_RATIO:
        return True
    if kind == "iou" and score < 0.92:
        return True
    return False


def main() -> None:
    extract_data = json.loads(EXTRACT_PATH.read_text(encoding="utf-8"))
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))

    extract_objs = extract_data["objects"]
    old_objects: dict = catalog["objects"]
    placement_ids = sorted({p["id"] for p in catalog["placements"]})

    extract_by_rect = {rect_tuple(get_extract_rect(o)): o for o in extract_objs}

    rect_to_new_id: dict[tuple, str] = {}
    used_ids: set[str] = set()
    migration: dict[str, str] = {}
    unresolved: list[str] = []
    custom_rects: dict[tuple, tuple[str, dict, dict | None, str]] = {}

    def claim_id(base: str) -> str:
        base = sanitize_id(base)
        if base not in used_ids:
            used_ids.add(base)
            return base
        n = 2
        while f"{base}_{n}" in used_ids:
            n += 1
        cid = f"{base}_{n}"
        used_ids.add(cid)
        return cid

    def assign_extract_rect(key: tuple, name: str) -> str:
        if key in rect_to_new_id:
            return rect_to_new_id[key]
        new_id = claim_id(name)
        rect_to_new_id[key] = new_id
        return new_id

    old_to_target: dict[str, tuple[str, dict, bool]] = {}

    # Pass A: placement-used IDs — preserve sub-crops when needed
    for old_id in placement_ids:
        if old_id not in old_objects:
            unresolved.append(old_id)
            continue
        old = old_objects[old_id]
        old_rect = {"x": old["x"], "y": old["y"], "w": old["w"], "h": old["h"]}
        match_rect, kind, score, _ = find_best_extract_match(old_rect, extract_objs)

        if needs_subcrop(old_rect, match_rect, kind, score):
            key = rect_tuple(old_rect)
            new_id = claim_id(old_id)
            note = old.get("_note") or f"Sub-crop preserved for placement id {old_id}"
            custom_rects[key] = (new_id, old_rect, old, note)
            old_to_target[old_id] = (new_id, old_rect, True)
            migration[old_id] = new_id
        elif match_rect:
            key = rect_tuple(match_rect)
            new_id = assign_extract_rect(key, old_id)
            old_to_target[old_id] = (new_id, match_rect, False)
            migration[old_id] = new_id
        else:
            unresolved.append(old_id)

    # Pass B: remaining legacy IDs map to best extract rect (no extra subcrops)
    for old_id, old in old_objects.items():
        if old_id in migration:
            continue
        old_rect = {"x": old["x"], "y": old["y"], "w": old["w"], "h": old["h"]}
        match_rect, kind, score, _ = find_best_extract_match(old_rect, extract_objs)
        if match_rect and (kind == "exact" or score >= 0.5):
            key = rect_tuple(match_rect)
            new_id = assign_extract_rect(key, old_id)
            old_to_target[old_id] = (new_id, match_rect, False)
            migration[old_id] = new_id

    # Name remaining extract rects with heuristics
    for obj in extract_objs:
        er = get_extract_rect(obj)
        key = rect_tuple(er)
        if key in rect_to_new_id:
            continue
        grid = obj.get("grid")
        base = heuristic_name(grid, er["w"], er["h"], er["y"])
        rect_to_new_id[key] = claim_id(base)

    # Build output: all extract rects + custom subcrops
    out_objects: dict = {}

    for obj in extract_objs:
        er = get_extract_rect(obj)
        key = rect_tuple(er)
        obj_id = rect_to_new_id.get(key)
        if not obj_id or obj_id in out_objects:
            continue

        old_match = None
        note = f"Auto-extract {obj.get('name', '?')} at grid {obj.get('grid')}"
        for old_id, (new_id, _, is_sub) in old_to_target.items():
            if new_id == obj_id and not is_sub:
                old_match = old_objects[old_id]
                note = old_match.get("_note") or f"Matched legacy id {old_id}"
                break

        out_objects[obj_id] = make_catalog_entry(er, old_match, obj.get("grid"), note)

    for key, (obj_id, rect, old, note) in custom_rects.items():
        if obj_id in out_objects:
            continue
        out_objects[obj_id] = make_catalog_entry(rect, old, None, note)

    # Stats: extract-only overlaps (excluding subcrops contained in composites)
    extract_entries = [
        v for k, v in out_objects.items() if rect_tuple(v) in extract_by_rect
    ]
    partial_overlaps = 0
    for i, a in enumerate(extract_entries):
        for b in extract_entries[i + 1 :]:
            if iou(a, b) > 0 and not (contains(a, b) or contains(b, a)):
                partial_overlaps += 1

    out_payload = {
        "info": {
            "purpose": "Open office furniture catalog v2 — clean rects from sheet extract plus placement sub-crops.",
            "source_extract": str(EXTRACT_PATH.relative_to(ROOT)).replace("\\", "/"),
            "source_catalog": "furniture_catalog_openplan.json",
            "sheet": SHEET,
            "origin": "bottom-center anchor.",
            "object_count": len(out_objects),
            "extract_object_count": len(extract_objs),
            "subcrop_count": len(custom_rects),
            "placement_priority_ids": placement_ids,
        },
        "objects": dict(sorted(out_objects.items())),
    }

    placement_migration = {k: v for k, v in migration.items() if k in placement_ids}

    migration_payload = {
        "info": {
            "from": "furniture_catalog_openplan.json",
            "to": "furniture_catalog_openplan_v2.objects.json",
            "description": "Maps legacy catalog object IDs to v2 snake_case IDs.",
        },
        "migration": dict(sorted(migration.items())),
        "placement_migration": dict(sorted(placement_migration.items())),
        "unresolved_placement_ids": unresolved,
        "stats": {
            "migration_count": len(migration),
            "placement_migration_count": len(placement_migration),
            "placement_unique_ids": len(placement_ids),
            "placement_resolved": len(placement_ids) - len(unresolved),
            "subcrop_preserved": len(custom_rects),
        },
    }

    OUT_OBJECTS_PATH.write_text(
        json.dumps(out_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    OUT_MIGRATION_PATH.write_text(
        json.dumps(migration_payload, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUT_OBJECTS_PATH} ({len(out_objects)} objects)")
    print(f"  extract base: {len(extract_objs)}, subcrops: {len(custom_rects)}")
    print(f"Wrote {OUT_MIGRATION_PATH} ({len(migration)} mappings, {len(placement_migration)} placement)")
    print(f"Unresolved placement IDs: {unresolved}")
    print(f"Extract-entry partial overlaps: {partial_overlaps}")


if __name__ == "__main__":
    main()
