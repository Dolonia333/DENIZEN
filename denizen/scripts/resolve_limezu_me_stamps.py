#!/usr/bin/env python3
"""Resolve exterior LimeZu catalog ids (me.* / exs.*) → stamp img paths.

Build-time only. Used by merge-city-plan.py so Phaser keeps dumb PNG stamps.

Usage:
  python3 scripts/resolve-limezu-me-stamps.py              # write placement-index.json
  python3 scripts/resolve-limezu-me-stamps.py --check-stamp '{"me":"me.beach.palm_tree"}'
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

DEN = Path(__file__).resolve().parents[1]
CAT = DEN / "data" / "limezu-visual-catalog"
ME_TO = CAT / "me-to-singles.json"
JSONL = CAT / "ext-singles-pixelperfect.jsonl"
OUT_INDEX = CAT / "placement-index.json"

CONF_RANK = {"vision": 3, "high": 3, "medium": 2, "weak": 1, "none": 0}


def path_to_img(path: str) -> str:
    """assets/limezu/ext/singles/... → ext/singles/..."""
    p = path.replace("\\", "/")
    prefix = "assets/limezu/"
    if p.startswith(prefix):
        return p[len(prefix) :]
    if p.startswith("ext/"):
        return p
    return p


def load_exs_index() -> dict[str, dict]:
    out = {}
    if not JSONL.exists():
        return out
    for line in JSONL.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        out[row["id"]] = row
    return out


def pick_variant(variants: list[dict], prefer: str | None = None, variant: int | None = None) -> dict:
    if not variants:
        raise ValueError("no variants")
    if prefer:
        pref = prefer.lower()
        for v in variants:
            if pref in (v.get("basename") or "").lower() or pref in (v.get("path") or "").lower():
                return v
    if variant is not None:
        return variants[int(variant) % len(variants)]
    # Prefer high/vision confidence, then unique-looking (longer basename often = complete)
    ranked = sorted(
        variants,
        key=lambda v: (
            CONF_RANK.get(v.get("confidence") or "none", 0),
            len(v.get("basename") or ""),
        ),
        reverse=True,
    )
    return ranked[0]


def build_placement_index() -> dict:
    me_data = json.loads(ME_TO.read_text()) if ME_TO.exists() else {"links": {}}
    links = me_data.get("links") or {}
    exs = load_exs_index()
    index = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "pack": "limezu_modern_exteriors",
        "me_count": 0,
        "exs_count": len(exs),
        "me": {},
        "exs": {},
    }
    for me_id, variants in links.items():
        if not variants:
            continue
        chosen = pick_variant(variants)
        imgs = [path_to_img(v["path"]) for v in variants if v.get("path")]
        index["me"][me_id] = {
            "img": path_to_img(chosen["path"]),
            "exs": chosen.get("id"),
            "confidence": chosen.get("confidence"),
            "variant_count": len(variants),
        }
    for exs_id, row in exs.items():
        index["exs"][exs_id] = {
            "img": path_to_img(row["path"]),
            "me_id": (row.get("vision_link") or {}).get("me_id"),
            "w": row.get("w"),
            "h": row.get("h"),
        }
    index["me_count"] = len(index["me"])
    return index


_INDEX_CACHE: dict | None = None


def load_index() -> dict:
    global _INDEX_CACHE
    if _INDEX_CACHE is not None:
        return _INDEX_CACHE
    if OUT_INDEX.exists():
        _INDEX_CACHE = json.loads(OUT_INDEX.read_text())
    else:
        _INDEX_CACHE = build_placement_index()
    return _INDEX_CACHE


def resolve_stamp(stamp: dict, index: dict | None = None) -> dict:
    """Return a copy of stamp with img filled from me / exs. Leaves me/exs as metadata."""
    index = index or load_index()
    out = dict(stamp)
    me = out.get("me")
    exs = out.get("exs")
    prefer = out.get("prefer")
    variant = out.get("variant")

    if exs:
        entry = (index.get("exs") or {}).get(exs)
        if not entry:
            # fall back to scanning me variants
            raise KeyError(f"unknown exs id: {exs}")
        out["img"] = entry["img"]
        if not out.get("me") and entry.get("me_id"):
            out["me"] = entry["me_id"]
        return out

    if me:
        entry = (index.get("me") or {}).get(me)
        if not entry:
            raise KeyError(f"unknown me id: {me}")
        if prefer or variant is not None:
            # need full variant list from me-to-singles
            me_data = json.loads(ME_TO.read_text())
            variants = (me_data.get("links") or {}).get(me) or []
            chosen = pick_variant(variants, prefer=prefer, variant=variant)
            out["img"] = path_to_img(chosen["path"])
            out["exs"] = chosen.get("id")
        else:
            out["img"] = entry["img"]
            if entry.get("exs"):
                out["exs"] = entry["exs"]
        return out

    if not out.get("img"):
        raise KeyError("stamp needs img, me, or exs")
    return out


def resolve_stamps(stamps: list[dict], index: dict | None = None) -> tuple[list[dict], list[str]]:
    """Resolve me/exs in place (preserves object identity for merge pruning)."""
    index = index or load_index()
    errors = []
    for i, s in enumerate(stamps):
        if not (s.get("me") or s.get("exs")):
            continue
        try:
            resolved = resolve_stamp(s, index)
            s.clear()
            s.update(resolved)
        except Exception as e:
            errors.append(f"stamp[{i}]: {e}")
    return stamps, errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-stamp", help="JSON stamp object to resolve")
    ap.add_argument("--no-write", action="store_true", help="Do not rewrite placement-index.json")
    args = ap.parse_args()

    index = build_placement_index()
    if not args.no_write:
        OUT_INDEX.write_text(json.dumps(index, indent=2) + "\n")
        print(
            f"wrote {OUT_INDEX.relative_to(DEN)}: "
            f"{index['me_count']} me → img, {index['exs_count']} exs"
        )

    if args.check_stamp:
        stamp = json.loads(args.check_stamp)
        print(json.dumps(resolve_stamp(stamp, index), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
