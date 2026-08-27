#!/usr/bin/env python3
"""Harden Singles → me.* links via spatial join + optional vision overrides.

Usage:
  python3 scripts/link-limezu-singles-to-me.py
  python3 scripts/link-limezu-singles-to-me.py --vision-dir data/limezu-visual-catalog/montages

Reads:
  ext-singles-pixelperfect.jsonl
  sheets/*/labels.json
  optional montages/<sheet>/vision-links.json  (from vision pass)

Writes:
  ext-singles-pixelperfect.jsonl          (updated vision_link)
  me-to-singles.json                      (reverse index)
  ext-singles-link-report.json
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAT = ROOT / "data/limezu-visual-catalog"
JSONL = CAT / "ext-singles-pixelperfect.jsonl"

THEME_STOP = {
    "singles", "me", "modern", "exteriors", "theme", "16x16", "png",
    "terrains", "fences", "city", "props", "generic", "buildings", "building",
    "floor", "modular", "garage", "sales", "villas", "worksite", "shopping",
    "center", "markets", "vehicles", "camping", "hotel", "hospital", "school",
    "swimming", "pool", "police", "station", "office", "garden", "fire",
    "graveyard", "subway", "train", "beach", "post", "military", "base",
    "additional", "houses", "and", "the", "with", "for", "from",
}


def toks(text: str) -> set[str]:
    return {
        t
        for t in re.split(r"[^a-z0-9]+", (text or "").lower())
        if len(t) >= 3 and t not in THEME_STOP
    }


def load_labels(sheet: str) -> list[dict]:
    p = CAT / "sheets" / sheet / "labels.json"
    if not p.exists():
        return []
    return list(json.loads(p.read_text()).get("objects") or [])


def spatial_score(row: dict, lab: dict) -> float:
    y = row.get("sheet_y")
    if y is None or not lab.get("y_hint"):
        return 0.0
    y0, y1 = lab["y_hint"]
    # Expand slightly — y_hint is approximate from vision bands
    pad = 40
    if y0 - pad <= y <= y1 + pad:
        mid = (y0 + y1) / 2
        dist = abs(y - mid)
        span = max(y1 - y0, 1)
        return 2.0 + max(0.0, 2.0 * (1.0 - dist / max(span, 80)))
    return 0.0


def token_score(row: dict, lab: dict) -> float:
    name_toks = toks(row.get("basename", "")) | toks(row.get("id", ""))
    if not name_toks:
        return 0.0
    lab_toks = toks(lab.get("id", "")) | toks(lab.get("name", ""))
    notes = (lab.get("notes") or "").lower()
    score = 4.0 * len(name_toks & lab_toks)
    stem = Path(row["basename"]).stem.lower()
    if stem in notes or row["basename"].lower() in notes:
        score += 10.0
    for t in name_toks:
        if len(t) >= 4 and t in notes:
            score += 1.5
    return score


def confidence_for(score: float, has_spatial: bool, source: str) -> str:
    if source == "vision":
        return "vision"
    if score >= 12 and has_spatial:
        return "high"
    if score >= 8:
        return "high"
    if score >= 5:
        return "medium"
    if score >= 4:
        return "weak"
    return "none"


def best_link(row: dict, labels: list[dict]) -> dict | None:
    best = None
    best_score = 0.0
    best_spatial = 0.0
    for lab in labels:
        ts = token_score(row, lab)
        ss = spatial_score(row, lab)
        # Prefer labels with both signals; don't let pure spatial win alone
        score = ts + (ss if ts > 0 else ss * 0.25)
        if score > best_score:
            best_score = score
            best = lab
            best_spatial = ss
    if best is None or best_score < 4.0:
        return None
    # Require object-token overlap unless very strong notes hit
    name_toks = toks(row.get("basename", ""))
    lab_toks = toks(best.get("id", "")) | toks(best.get("name", ""))
    if best_score < 8.0 and not (name_toks & lab_toks):
        return None
    conf = confidence_for(best_score, best_spatial > 0, "spatial_filename")
    return {
        "me_id": best.get("id"),
        "me_name": best.get("name"),
        "score": round(best_score, 2),
        "multi_tile": bool(best.get("multi_tile")),
        "confidence": conf,
        "source": "spatial_filename",
        "spatial": round(best_spatial, 2),
    }


def load_vision_overrides(vision_root: Path | None) -> dict[str, dict]:
    """Map single id → {me_id, ...} from montages/<sheet>/vision-links.json."""
    out: dict[str, dict] = {}
    if not vision_root or not vision_root.exists():
        return out
    for p in sorted(vision_root.glob("*/vision-links.json")):
        data = json.loads(p.read_text())
        sheet = data.get("sheet") or p.parent.name
        index_path = p.parent / "index.json"
        index = json.loads(index_path.read_text()) if index_path.exists() else {"cells": {}}
        cells = index.get("cells") or {}
        # formats: {"links": {"12": "me.foo.bar"}} or {"links": [{"n":12,"me_id":"..."}]}
        links = data.get("links") or {}
        if isinstance(links, list):
            iterable = []
            for item in links:
                n = str(item.get("n") or item.get("cell") or "")
                me = item.get("me_id") or item.get("id")
                iterable.append((n, me, item))
        else:
            iterable = [(str(k), v if isinstance(v, str) else (v or {}).get("me_id"), v) for k, v in links.items()]
        for n, me_id, raw in iterable:
            if not me_id or me_id in ("null", "none", "-"):
                continue
            cell = cells.get(n) or cells.get(str(int(n))) if n.isdigit() else None
            if not cell:
                continue
            sid = cell["id"]
            out[sid] = {
                "me_id": me_id,
                "me_name": (raw.get("me_name") if isinstance(raw, dict) else None),
                "score": 20.0,
                "multi_tile": bool(raw.get("multi_tile")) if isinstance(raw, dict) else False,
                "confidence": "vision",
                "source": "vision",
                "mosaic_cell": int(n) if str(n).isdigit() else n,
                "sheet": sheet,
            }
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--vision-dir",
        default=str(CAT / "montages"),
        help="Directory with per-sheet vision-links.json overrides",
    )
    ap.add_argument("--no-vision", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(l) for l in JSONL.read_text().splitlines() if l.strip()]
    vision = {} if args.no_vision else load_vision_overrides(Path(args.vision_dir))
    labels_by_sheet: dict[str, list] = {}
    conf_counts = Counter()
    source_counts = Counter()
    me_to_singles: dict[str, list] = defaultdict(list)

    for row in rows:
        sheet = row["sheet"]
        if sheet not in labels_by_sheet:
            labels_by_sheet[sheet] = load_labels(sheet)

        if row["id"] in vision:
            link = vision[row["id"]]
            # fill me_name from vocab if missing
            if not link.get("me_name"):
                for lab in labels_by_sheet[sheet]:
                    if lab.get("id") == link["me_id"]:
                        link["me_name"] = lab.get("name")
                        link["multi_tile"] = bool(lab.get("multi_tile"))
                        break
        else:
            link = best_link(row, labels_by_sheet[sheet])

        row["vision_link"] = link
        if link:
            conf_counts[link.get("confidence", "unknown")] += 1
            source_counts[link.get("source", "unknown")] += 1
            me_to_singles[link["me_id"]].append(
                {
                    "id": row["id"],
                    "basename": row["basename"],
                    "path": row["path"],
                    "sheet_x": row.get("sheet_x"),
                    "sheet_y": row.get("sheet_y"),
                    "w": row["w"],
                    "h": row["h"],
                    "confidence": link.get("confidence"),
                    "source": link.get("source"),
                }
            )
        else:
            conf_counts["none"] += 1

    with JSONL.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    reverse = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "me_count": len(me_to_singles),
        "linked_singles": sum(len(v) for v in me_to_singles.values()),
        "links": {k: v for k, v in sorted(me_to_singles.items())},
    }
    (CAT / "me-to-singles.json").write_text(json.dumps(reverse, indent=2) + "\n")

    # Update summary
    summary_path = CAT / "ext-singles-pixelperfect-summary.json"
    summary = json.loads(summary_path.read_text()) if summary_path.exists() else {}
    summary["vision_linked"] = sum(1 for r in rows if r.get("vision_link"))
    summary["link_confidence"] = dict(conf_counts)
    summary["link_source"] = dict(source_counts)
    summary["me_ids_with_singles"] = len(me_to_singles)
    summary_path.write_text(json.dumps(summary, indent=2) + "\n")

    report = {
        "generated_at": reverse["generated_at"],
        "single_count": len(rows),
        "linked": summary["vision_linked"],
        "confidence": dict(conf_counts),
        "source": dict(source_counts),
        "me_ids_with_singles": len(me_to_singles),
        "vision_overrides_applied": len(vision),
    }
    (CAT / "ext-singles-link-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
