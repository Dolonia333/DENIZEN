#!/usr/bin/env python3
"""W0-C: Identify stamp-group candidates from multi_tile me.* labels.

Criteria: me.* where multi_tile == true AND its linked exs.* siblings
(from me-to-singles.json) are >= 2 AND those siblings fall within the
same sheet band (the sheet's own 768px vision-labeling band) as the me
label itself -- i.e. the underlying Singles genuinely co-locate into one
physical multi-piece composition on the contact sheet, not a scattered
palette-variant family.

Ranks candidates by a composite score (piece count, spatial compactness
/ fill-ratio of the sibling bbox, and keyword signals in notes/name that
indicate an assembled multi-part scene) and emits the top 50 with a
suggested grp.* id, a piece list (exs ids + tile-unit relative offsets
inferred from sheet_x/sheet_y when the bbox is compact), biome, and
priority.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "data/limezu-visual-catalog"

def load_registry():
    recs = []
    with open(CATALOG / "registry.jsonl") as f:
        for line in f:
            line = line.strip()
            if line:
                recs.append(json.loads(line))
    return recs

def load_links():
    with open(CATALOG / "me-to-singles.json") as f:
        return json.load(f)["links"]

def load_band_bounds():
    """sheet -> [(y0,y1), ...] straight from each sheet's meta.json bands[]."""
    bounds = {}
    for meta_path in sorted((CATALOG / "sheets").glob("*/meta.json")):
        meta = json.loads(meta_path.read_text())
        sheet = meta["sheet"]
        bounds[sheet] = [(b["y0"], b["y1"]) for b in meta["bands"]]
    return bounds

ASSEMBLY_KEYWORDS = [
    "modular", "structure", "complete", "set", "left", "middle", "right",
    "corner", "edge", "assembly", "composition", "composed", "assembled",
    "structure_1", "structure_2", "front", "back", "top", "bottom",
    "court", "field", "stairs", "railing", "counter", "bar",
]

def keyword_score(me_rec):
    text = " ".join([
        me_rec.get("name", ""),
        me_rec.get("notes", ""),
        " ".join(me_rec.get("tags", [])),
    ]).lower()
    hits = sum(1 for kw in ASSEMBLY_KEYWORDS if kw in text)
    return hits

def slug_to_grp_id(me_id):
    # me.<theme>.<slug> -> grp.<theme>.<slug>
    parts = me_id.split(".", 2)
    if len(parts) == 3:
        return "grp." + parts[1] + "." + parts[2]
    return "grp." + me_id.split(".", 1)[-1]

def band_for_y(bounds_list, y0, y1):
    """Return band index whose [y0,y1) range fully/mostly contains [y0,y1)."""
    mid = (y0 + y1) / 2.0
    for idx, (by0, by1) in enumerate(bounds_list):
        if by0 <= mid < by1:
            return idx
    return None

def main():
    recs = load_registry()
    links = load_links()
    band_bounds = load_band_bounds()

    by_id = {r["id"]: r for r in recs}
    multi_tile_recs = [r for r in recs if r.get("multi_tile")]

    candidates = []
    for r in multi_tile_recs:
        me_id = r["id"]
        sheet = r["sheet"]
        sibs = links.get(me_id, [])
        if len(sibs) < 2:
            continue

        bounds_list = band_bounds.get(sheet, [])
        me_band = r.get("band")
        me_band_range = bounds_list[me_band] if (me_band is not None and me_band < len(bounds_list)) else None

        # Verify siblings co-locate within the *same* sheet band as the me label.
        sib_bands = []
        for s in sibs:
            sy0 = s.get("sheet_y")
            sh = s.get("h", 0)
            if sy0 is None:
                continue
            b = band_for_y(bounds_list, sy0, sy0 + sh)
            sib_bands.append(b)

        if not sib_bands:
            continue

        # "same sheet band" = majority of siblings land in the me label's own band
        # (falls back to majority-vote band if me_band missing/out of range).
        if me_band_range is not None:
            same_band_count = sum(1 for b in sib_bands if b == me_band)
        else:
            from collections import Counter
            common_band, cnt = Counter(sib_bands).most_common(1)[0]
            same_band_count = cnt
            me_band = common_band

        if same_band_count < 2:
            continue

        coherent_sibs = [s for s, b in zip(sibs, sib_bands) if b == me_band]
        if len(coherent_sibs) < 2:
            coherent_sibs = sibs  # fall back to full sibling set

        xs0 = [s["sheet_x"] for s in coherent_sibs if s.get("sheet_x") is not None]
        ys0 = [s["sheet_y"] for s in coherent_sibs if s.get("sheet_y") is not None]
        xs1 = [s["sheet_x"] + s.get("w", 0) for s in coherent_sibs if s.get("sheet_x") is not None]
        ys1 = [s["sheet_y"] + s.get("h", 0) for s in coherent_sibs if s.get("sheet_y") is not None]
        if not xs0 or not ys0:
            continue

        min_x, max_x = min(xs0), max(xs1)
        min_y, max_y = min(ys0), max(ys1)
        bbox_w = max(max_x - min_x, 16)
        bbox_h = max(max_y - min_y, 16)
        area_bbox = bbox_w * bbox_h
        area_sum = sum(s.get("w", 0) * s.get("h", 0) for s in coherent_sibs)
        fill_ratio = min(1.0, area_sum / area_bbox) if area_bbox else 0.0

        piece_count = len(coherent_sibs)
        kw_score = keyword_score(r)

        # composite score: pieces matter most, then compactness, then keyword signal
        score = (piece_count * 3.0) + (fill_ratio * 6.0) + (kw_score * 1.0)

        pieces = []
        for s in sorted(coherent_sibs, key=lambda s: (s.get("sheet_y") or 0, s.get("sheet_x") or 0)):
            if s.get("sheet_x") is None or s.get("sheet_y") is None:
                pieces.append({
                    "exs": s["id"],
                    "basename": s["basename"],
                    "w": s.get("w"),
                    "h": s.get("h"),
                    "dx_tiles": None,
                    "dy_tiles": None,
                    "offset_basis": "unknown",
                })
                continue
            dx_px = s["sheet_x"] - min_x
            dy_px = s["sheet_y"] - min_y
            pieces.append({
                "exs": s["id"],
                "basename": s["basename"],
                "w": s.get("w"),
                "h": s.get("h"),
                "dx_tiles": round(dx_px / 16.0, 2),
                "dy_tiles": round(dy_px / 16.0, 2),
                "offset_basis": "sheet_relative",
            })

        theme = me_id.split(".")[1] if me_id.count(".") >= 2 else "misc"
        priority_raw = score

        candidates.append({
            "me_id": me_id,
            "grp_id": slug_to_grp_id(me_id),
            "name": r.get("name"),
            "sheet": sheet,
            "band": me_band,
            "category": r.get("category"),
            "biome": theme,
            "tags": r.get("tags", []),
            "surface": r.get("surface"),
            "facing": r.get("facing"),
            "notes": r.get("notes"),
            "piece_count": piece_count,
            "fill_ratio": round(fill_ratio, 3),
            "keyword_score": kw_score,
            "score": round(score, 2),
            "footprint_tiles": {
                "w": round(bbox_w / 16.0, 2),
                "h": round(bbox_h / 16.0, 2),
            },
            "pieces": pieces,
        })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    for i, c in enumerate(candidates):
        c["rank"] = i + 1

    top50 = candidates[:50]

    # priority tiers computed *within* the returned top-50, so the field is
    # actionable for W1-C authoring order (top 10 = high, next 20 = medium, rest = low)
    for i, c in enumerate(top50):
        if i < 10:
            c["priority"] = "high"
        elif i < 30:
            c["priority"] = "medium"
        else:
            c["priority"] = "low"

    out = {
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "method": "multi_tile me.* whose linked exs.* siblings (>=2) co-locate in the same "
                  "768px sheet vision-labeling band; ranked by piece_count*3 + fill_ratio*6 + keyword_score",
        "total_multi_tile_me": len(multi_tile_recs),
        "total_candidates_found": len(candidates),
        "returned": len(top50),
        "candidates": top50,
    }

    out_path = CATALOG / "group-candidates.json"
    out_path.write_text(json.dumps(out, indent=2))
    print("total_multi_tile_me", len(multi_tile_recs))
    print("total_candidates_found", len(candidates))
    print("returned", len(top50))
    print("wrote", out_path)

if __name__ == "__main__":
    main()
