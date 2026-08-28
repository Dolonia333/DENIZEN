#!/usr/bin/env python3
"""Pixel-perfect inventory of Modern Exteriors Singles + exact sheet locations.

Official LimeZu Singles PNGs are the ground-truth cutouts. This script:

  1. Measures every single (canvas size, alpha content-bbox, opaque frac, sha1)
  2. Exact template-matches each single onto its theme contact sheet PNG
  3. Optionally joins nearby vision `me.*` labels by Y band / filename hints
  4. Writes jsonl + summary under data/limezu-visual-catalog/

Usage:
  python3 scripts/catalog-limezu-ext-singles-pixelperfect.py
  python3 scripts/catalog-limezu-ext-singles-pixelperfect.py --theme 8_Worksite
  python3 scripts/catalog-limezu-ext-singles-pixelperfect.py --skip-match   # inventory only
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
THEMES_DIR = ROOT / "assets/limezu/ext/themes"
SINGLES_ROOT = ROOT / "assets/limezu/ext/singles"
OUT_DIR = ROOT / "data/limezu-visual-catalog"
LABELS_DIR = OUT_DIR / "sheets"

# Sheet stem → singles folder (matches slice-limezu-sheets-for-vision.py)
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

ALPHA_ON = 8  # treat alpha > this as opaque for matching / bbox

# Theme / pack noise — ignore when joining singles → vision me.* ids
THEME_STOP = {
    "singles", "me", "modern", "exteriors", "theme", "16x16", "png",
    "terrains", "fences", "city", "props", "generic", "buildings", "building",
    "floor", "modular", "garage", "sales", "villas", "worksite", "shopping",
    "center", "markets", "vehicles", "camping", "hotel", "hospital", "school",
    "swimming", "pool", "police", "station", "office", "garden", "fire",
    "graveyard", "subway", "train", "beach", "post", "military", "base",
    "additional", "houses", "and", "the", "with", "for", "from",
}


def slug_from_basename(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"^ME_Singles_", "", stem, flags=re.I)
    stem = re.sub(r"^\d+_", "", stem)
    stem = re.sub(r"_16x16_", "_", stem)
    stem = re.sub(r"_16x16$", "", stem)
    stem = re.sub(r"[^a-zA-Z0-9]+", "_", stem).strip("_").lower()
    return stem or "sprite"


def content_bbox(alpha: np.ndarray) -> list[int] | None:
    ys, xs = np.where(alpha)
    if len(xs) == 0:
        return None
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    return [x0, y0, x1, y1]


def inventory_single(path: Path, theme_folder: str, sheet: str) -> dict:
    im = Image.open(path).convert("RGBA")
    arr = np.asarray(im)
    h, w = arr.shape[:2]
    alpha = arr[:, :, 3] > ALPHA_ON
    opaque_n = int(alpha.sum())
    bbox = content_bbox(alpha)
    if bbox:
        cw, ch = bbox[2] - bbox[0], bbox[3] - bbox[1]
    else:
        cw = ch = 0
    sha = hashlib.sha1(arr.tobytes()).hexdigest()
    return {
        "id": f"exs.{theme_folder}.{slug_from_basename(path.name)}",
        "basename": path.name,
        "path": str(path.relative_to(ROOT)).replace("\\", "/"),
        "theme_folder": theme_folder,
        "sheet": sheet,
        "w": w,
        "h": h,
        "content_bbox": bbox,
        "content_w": cw,
        "content_h": ch,
        "opaque_px": opaque_n,
        "opaque_frac": round(opaque_n / max(w * h, 1), 6),
        "full_opaque": bool(opaque_n == w * h),
        "aligned_16": bool(w % 16 == 0 and h % 16 == 0),
        "sha1": sha,
        "likely_fragment": bool(w <= 16 and h <= 32) or bool(w <= 32 and h <= 16),
    }


def pack_rgb(rgb: np.ndarray) -> np.ndarray:
    """HxW uint32 packed RGB."""
    r = rgb[:, :, 0].astype(np.uint32)
    g = rgb[:, :, 1].astype(np.uint32)
    b = rgb[:, :, 2].astype(np.uint32)
    return (r << 16) | (g << 8) | b


def find_exact_placements(
    sheet_rgba: np.ndarray,
    single_rgba: np.ndarray,
    max_hits: int = 64,
) -> list[dict]:
    """Exact RGB match under single alpha mask. Returns list of {x,y,exact}."""
    sh, sw = sheet_rgba.shape[:2]
    th, tw = single_rgba.shape[:2]
    if th > sh or tw > sw:
        return []

    alpha = single_rgba[:, :, 3] > ALPHA_ON
    if not alpha.any():
        return []

    sheet_rgb = pack_rgb(sheet_rgba[:, :, :3])
    tpl_rgb = pack_rgb(single_rgba[:, :, :3])

    ys, xs = np.where(alpha)
    # Prefer a rare opaque color as anchor for fewer candidates
    colors = tpl_rgb[alpha]
    # sample up to 4096 opaque pixels for uniqueness stats
    if colors.size > 4096:
        step = colors.size // 4096
        sample = colors[::step]
    else:
        sample = colors
    uniq, counts = np.unique(sample, return_counts=True)
    rare = uniq[np.argmin(counts)]
    # pick first opaque pixel with that rare color
    mask_rare = alpha & (tpl_rgb == rare)
    ay, ax = np.argwhere(mask_rare)[0]

    target = int(tpl_rgb[ay, ax])
    # Candidate top-lefts where sheet matches anchor
    cand_y, cand_x = np.where(sheet_rgb == target)
    # Convert anchor hits → top-left
    tl_x = cand_x - int(ax)
    tl_y = cand_y - int(ay)
    valid = (tl_x >= 0) & (tl_y >= 0) & (tl_x + tw <= sw) & (tl_y + th <= sh)
    tl_x = tl_x[valid]
    tl_y = tl_y[valid]

    hits: list[dict] = []
    seen: set[tuple[int, int]] = set()
    # Limit verification when anchor is too common (solid tiles)
    if tl_x.size > 20000:
        # denser second anchor
        mask2 = alpha & (tpl_rgb != rare)
        if mask2.any():
            colors2 = tpl_rgb[mask2]
            uniq2, counts2 = np.unique(colors2[:: max(1, colors2.size // 2048)], return_counts=True)
            rare2 = uniq2[np.argmin(counts2)]
            ay2, ax2 = np.argwhere(alpha & (tpl_rgb == rare2))[0]
            target2 = int(tpl_rgb[ay2, ax2])
            # filter first candidates by second anchor
            keep = []
            for x0, y0 in zip(tl_x.tolist(), tl_y.tolist()):
                if sheet_rgb[y0 + ay2, x0 + ax2] == target2:
                    keep.append((x0, y0))
                    if len(keep) > 5000:
                        break
            tl_pairs = keep
        else:
            tl_pairs = list(zip(tl_x[:5000].tolist(), tl_y[:5000].tolist()))
    else:
        tl_pairs = list(zip(tl_x.tolist(), tl_y.tolist()))

    opaque_y = ys
    opaque_x = xs
    tpl_vals = tpl_rgb[opaque_y, opaque_x]

    for x0, y0 in tl_pairs:
        key = (x0, y0)
        if key in seen:
            continue
        seen.add(key)
        patch = sheet_rgb[y0 : y0 + th, x0 : x0 + tw]
        if np.array_equal(patch[opaque_y, opaque_x], tpl_vals):
            hits.append({"x": int(x0), "y": int(y0), "exact": True})
            if len(hits) >= max_hits:
                break
    return hits


def load_vision_labels(sheet: str) -> list[dict]:
    path = LABELS_DIR / sheet / "labels.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text())
    return list(data.get("objects") or [])


def hint_tokens(text: str) -> set[str]:
    return {
        t
        for t in re.split(r"[^a-z0-9]+", (text or "").lower())
        if len(t) >= 3 and t not in THEME_STOP
    }


def best_vision_link(row: dict, labels: list[dict]) -> dict | None:
    """Heuristic join: object tokens in filename ↔ me.* label (theme words ignored)."""
    if not labels:
        return None
    name_toks = hint_tokens(row["basename"]) | hint_tokens(slug_from_basename(row["basename"]))
    if not name_toks:
        return None
    best = None
    best_score = 0.0
    y = row.get("sheet_y")
    stem = Path(row["basename"]).stem.lower()
    for lab in labels:
        score = 0.0
        lab_toks = hint_tokens(lab.get("id", "")) | hint_tokens(lab.get("name", ""))
        notes = (lab.get("notes") or "").lower()
        overlap = name_toks & lab_toks
        score += 4.0 * len(overlap)
        if stem in notes or row["basename"].lower() in notes:
            score += 10.0
        for t in name_toks:
            if len(t) >= 4 and t in notes:
                score += 1.5
        if y is not None and lab.get("y_hint"):
            y0, y1 = lab["y_hint"]
            if y0 <= y <= y1:
                score += 1.0
        if score > best_score:
            best_score = score
            best = lab
    if best is None or best_score < 4.0:
        return None
    obj_overlap = name_toks & (
        hint_tokens(best.get("id", "")) | hint_tokens(best.get("name", ""))
    )
    if best_score < 8.0 and not obj_overlap:
        return None
    return {
        "me_id": best.get("id"),
        "me_name": best.get("name"),
        "score": round(best_score, 2),
        "multi_tile": bool(best.get("multi_tile")),
    }


def process_theme(sheet: str, folder: str, skip_match: bool, link_vision: bool) -> tuple[list[dict], dict]:
    singles_dir = SINGLES_ROOT / folder
    sheet_path = THEMES_DIR / f"{sheet}.png"
    if not singles_dir.exists():
        raise FileNotFoundError(singles_dir)
    if not sheet_path.exists():
        raise FileNotFoundError(sheet_path)

    paths = sorted(singles_dir.glob("*.png"))
    sheet_rgba = None
    if not skip_match:
        sheet_rgba = np.asarray(Image.open(sheet_path).convert("RGBA"))

    labels = load_vision_labels(sheet) if link_vision else []
    rows: list[dict] = []
    stats = Counter()
    t0 = time.time()

    for i, p in enumerate(paths):
        row = inventory_single(p, folder, sheet)
        stats["singles"] += 1
        if skip_match:
            row["sheet_matches"] = []
            row["match_status"] = "skipped"
        else:
            single_rgba = np.asarray(Image.open(p).convert("RGBA"))
            hits = find_exact_placements(sheet_rgba, single_rgba)
            row["sheet_matches"] = hits
            if not hits:
                row["match_status"] = "unmatched"
                stats["unmatched"] += 1
            elif len(hits) == 1:
                row["match_status"] = "unique"
                stats["unique"] += 1
            else:
                row["match_status"] = "multi"
                stats["multi"] += 1
            row["sheet_x"] = hits[0]["x"] if hits else None
            row["sheet_y"] = hits[0]["y"] if hits else None

        if link_vision:
            link = best_vision_link(row, labels)
            row["vision_link"] = link
            if link:
                stats["vision_linked"] += 1

        rows.append(row)
        if (i + 1) % 100 == 0 or i + 1 == len(paths):
            elapsed = time.time() - t0
            print(
                f"  {sheet}: {i+1}/{len(paths)} "
                f"unique={stats['unique']} multi={stats['multi']} "
                f"unmatched={stats['unmatched']} ({elapsed:.1f}s)",
                flush=True,
            )

    summary = {
        "sheet": sheet,
        "theme_folder": folder,
        "singles": len(rows),
        "unique_match": stats["unique"],
        "multi_match": stats["multi"],
        "unmatched": stats["unmatched"],
        "vision_linked": stats["vision_linked"],
        "elapsed_s": round(time.time() - t0, 2),
    }
    return rows, summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--theme", help="Sheet stem only, e.g. 8_Worksite")
    ap.add_argument("--skip-match", action="store_true")
    ap.add_argument("--no-vision-link", action="store_true")
    ap.add_argument(
        "--out-jsonl",
        default=str(OUT_DIR / "ext-singles-pixelperfect.jsonl"),
    )
    ap.add_argument(
        "--out-summary",
        default=str(OUT_DIR / "ext-singles-pixelperfect-summary.json"),
    )
    args = ap.parse_args()

    themes = EXT_MAP
    if args.theme:
        if args.theme not in EXT_MAP:
            # allow folder name
            rev = {v: k for k, v in EXT_MAP.items()}
            if args.theme in rev:
                themes = {rev[args.theme]: args.theme}
            else:
                raise SystemExit(f"Unknown theme {args.theme}")
        else:
            themes = {args.theme: EXT_MAP[args.theme]}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    by_sheet: dict = {}
    t_all = time.time()

    for sheet, folder in themes.items():
        print(f"== {sheet} → {folder}", flush=True)
        rows, summary = process_theme(
            sheet,
            folder,
            skip_match=args.skip_match,
            link_vision=not args.no_vision_link,
        )
        all_rows.extend(rows)
        by_sheet[sheet] = summary
        print(
            f"  done: {summary['singles']} singles, "
            f"unique={summary['unique_match']} multi={summary['multi_match']} "
            f"unmatched={summary['unmatched']} linked={summary['vision_linked']} "
            f"in {summary['elapsed_s']}s",
            flush=True,
        )

    out_jsonl = Path(args.out_jsonl)
    with out_jsonl.open("w") as f:
        for row in all_rows:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    match_status = Counter(r.get("match_status") for r in all_rows)
    sizes = Counter(f"{r['w']}x{r['h']}" for r in all_rows)
    matched = match_status.get("unique", 0) + match_status.get("multi", 0)
    summary = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "pack": "limezu_modern_exteriors",
        "single_count": len(all_rows),
        "sheet_count": len(by_sheet),
        "match_status": dict(match_status),
        "matched_exact": matched,
        "match_rate": round(matched / max(len(all_rows), 1), 4),
        "vision_linked": sum(1 for r in all_rows if r.get("vision_link")),
        "aligned_16_all": all(r["aligned_16"] for r in all_rows) if all_rows else True,
        "content_bbox_all": sum(1 for r in all_rows if r.get("content_bbox")),
        "top_sizes": sizes.most_common(20),
        "by_sheet": by_sheet,
        "elapsed_s": round(time.time() - t_all, 2),
        "outputs": {
            "jsonl": str(out_jsonl.relative_to(ROOT)),
            "summary": str(Path(args.out_summary).relative_to(ROOT))
            if Path(args.out_summary).is_absolute()
            or str(args.out_summary).startswith("data/")
            else args.out_summary,
        },
        "notes": (
            "Singles PNGs are LimeZu's official pixel-perfect cutouts. "
            "sheet_matches are exact RGB placements of the full single canvas "
            "(including transparent padding) on the theme contact sheet. "
            "unmatched usually means a Singles-only color/variant not stamped on the contact sheet."
        ),
    }
    Path(args.out_summary).write_text(json.dumps(summary, indent=2) + "\n")
    print(
        f"\nWrote {len(all_rows)} rows → {out_jsonl}\n"
        f"Summary → {args.out_summary}\n"
        f"Status: {dict(match_status)} linked={summary['vision_linked']} "
        f"in {summary['elapsed_s']}s",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
