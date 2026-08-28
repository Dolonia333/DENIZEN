#!/usr/bin/env python3
"""W5-B (Wave 5 prep, offline) — montage QA for compiled exterior districts.

Denizen's visual-agent pass on compiled districts (Wave 5, "montage QA")
can't run without the MCP bridge, so this gives every
`data/city-specs/generated/d*.json` fragment (compiler output, W2-A onward) a
render + defect pass that runs entirely offline:

  1. Resolve `me`/`exs`/`prefer` -> `img` the same way merge-city-plan.py does
     (scripts/resolve_limezu_me_stamps.py), since compiled fragments carry
     catalog ids only.
  2. Render a preview PNG via render-city-preview.py's `render()` — the exact
     same compositor the game and the eyeball-QA workflow use. Falls back to
     a stitched grid of the fragment's unique stamp thumbnails if the full
     render throws (e.g. a stamp resolved to a missing/corrupt PNG).
  3. Run check-city-plan.py's defect checks (OVERLAP / FLOATING / ROADBLOCK /
     OFFWORLD / BADANIM / MISSING, plus BIOME_MISMATCH / GROUP_SOLO advisory)
     against the resolved fragment in isolation, reusing its functions
     directly so the two tools can never drift apart on what counts as a
     defect.

Writes data/limezu-visual-catalog/montage-qa-report.json:
  stamp/anim counts, biome, unique me.*/Singles, per-fragment defect summary,
  and the preview PNG path (gitignored, regenerable — same convention as
  data/limezu-visual-catalog/montages/**).

Usage:
  python3 scripts/montage-qa-compiled-districts.py
  python3 scripts/montage-qa-compiled-districts.py --no-render     # skip PNGs (faster)
  python3 scripts/montage-qa-compiled-districts.py --strict-biome  # BIOME_MISMATCH also fails the gate

Exit code 1 if any fragment has a hard defect (OVERLAP / FLOATING /
ROADBLOCK / OFFWORLD / BADANIM / MISSING / UNRESOLVED), matching
check-city-plan.py's hard/advisory split.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DEN = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
ASSETS = DEN / "assets" / "limezu"
CAT = DEN / "data" / "limezu-visual-catalog"
GENERATED_DIR = DEN / "data" / "city-specs" / "generated"
OUT_REPORT = CAT / "montage-qa-report.json"
PREVIEW_DIR = CAT / "montages" / "qa-compiled-districts"  # gitignored (montages/**/*.png)

HARD_KINDS = {"OVERLAP", "FLOATING", "ROADBLOCK", "OFFWORLD", "BADANIM", "MISSING", "UNRESOLVED"}

# Canonical played-world bounds (merge-city-plan.py / data/city-plan.json).
DEFAULT_WORLD = {"w": 6656, "h": 6400}
CITY_PLAN = DEN / "data" / "city-plan.json"

THUMB = 64
COLS = 10


def load_world_size() -> dict:
    """Played-world bounds for OFFWORLD checks on isolated fragments."""
    if CITY_PLAN.is_file():
        try:
            ws = json.loads(CITY_PLAN.read_text(encoding="utf-8")).get("worldSize") or {}
            if ws.get("w") and ws.get("h"):
                return {"w": int(ws["w"]), "h": int(ws["h"])}
        except Exception:
            pass
    return dict(DEFAULT_WORLD)


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


# Reuse the exact same functions the standalone QA gate uses, instead of
# duplicating overlap/floating math — see module docstring.
ccp = _load_module("check_city_plan_mod", SCRIPTS_DIR / "check-city-plan.py")
rcp = _load_module("render_city_preview_mod", SCRIPTS_DIR / "render-city-preview.py")

sys.path.insert(0, str(SCRIPTS_DIR))
from resolve_limezu_me_stamps import load_index, resolve_stamps  # noqa: E402


def resolve_fragment(frag: dict, index: dict) -> tuple[dict, list[str]]:
    """Deep-copy + resolve me/exs -> img (mirrors compile-exterior-district.py
    --qa's `qa_plan`, generalized to every generated fragment at once)."""
    resolved = copy.deepcopy(frag)
    resolved["stamps"], errors = resolve_stamps(resolved.get("stamps", []), index)
    return resolved, errors


def collect_defects(resolved: dict, catalog: dict, basename_to_me: dict, districts: list,
                     strict_biome: bool) -> dict:
    """Faithful re-implementation of check-city-plan.py main()'s defect
    collection, calling its own helpers (sprite_rect / overlap_area /
    resolve_me / biome_for_stamp) so a defect here means the same thing it
    would if you ran `python3 scripts/check-city-plan.py <fragment>` by hand
    (once the fragment's me/exs are resolved to img, which the CLI can't do
    on its own for a bare compiled fragment)."""
    defects: list[dict] = []
    dims: dict = {}
    stamps = resolved.get("stamps", [])
    rects = []
    world_w = resolved.get("worldSize", {}).get("w", DEFAULT_WORLD["w"])
    world_h = resolved.get("worldSize", {}).get("h", DEFAULT_WORLD["h"])

    for s in stamps:
        if not s.get("img"):
            defects.append({"kind": "UNRESOLVED", "a": s.get("me") or s.get("exs") or "?",
                             "b": "me/exs did not resolve to img"})
            continue
        r = ccp.sprite_rect(s, dims)
        if r is None:
            defects.append({"kind": "MISSING", "a": s["img"], "b": ""})
            continue
        rects.append((s, r))
        if r[0] < 0 or r[1] < 0 or r[0] + r[2] > world_w or r[1] + r[3] > world_h:
            defects.append({"kind": "OFFWORLD", "a": s["img"], "b": f"rect {r}"})

    solid_rects = [(s, r) for s, r in rects if s.get("solid")]
    for i in range(len(solid_rects)):
        for j in range(i + 1, len(solid_rects)):
            s1, r1 = solid_rects[i]
            s2, r2 = solid_rects[j]
            oa = ccp.overlap_area(r1, r2)
            smaller = min(r1[2] * r1[3], r2[2] * r2[3])
            if smaller and oa / smaller > 0.35:
                defects.append({
                    "kind": "OVERLAP",
                    "a": f"{os.path.basename(s1['img'])} @({s1['x']},{s1['y']})",
                    "b": f"vs {os.path.basename(s2['img'])} @({s2['x']},{s2['y']}) {int(100 * oa / smaller)}%",
                })

    nature = ("tree", "bush", "rock", "flower", "plant", "grass", "hedge")
    grounds = [(p["x"], p["y"], p["w"], p["h"]) for p in resolved.get("patches", [])]
    for r in resolved.get("roads", []):
        grounds.append((r["x"] - 16, r["y"] - 16, r["w"] + 32, r["h"] + 32))
    for s, rct in rects:
        if not s.get("solid"):
            continue
        name = s["img"].lower()
        if any(n in name for n in nature):
            continue
        bx = rct[0] + rct[2] // 2
        by = rct[1] + rct[3] - 4
        if not any(gx <= bx <= gx + gw and gy <= by <= gy + gh for gx, gy, gw, gh in grounds):
            defects.append({"kind": "FLOATING", "a": os.path.basename(s["img"]),
                             "b": f"base ({bx},{by}) on bare grass"})

    for r in resolved.get("roads", []):
        lane = (r["x"], r["y"], r["w"], r["h"])
        for sol in resolved.get("solids", []):
            srect = (sol["x"], sol["y"], sol.get("w", 0), sol.get("h", 0))
            if ccp.overlap_area(lane, srect) > 24 * 24:
                defects.append({"kind": "ROADBLOCK", "a": f"solid {srect}", "b": f"covers road {lane}"})

    for a in resolved.get("anims", []) + resolved.get("animBands", []) + resolved.get("vehicles", []):
        sheet = a.get("sheet")
        if not sheet:
            continue
        p = ASSETS / sheet
        try:
            with Image.open(p) as im:
                w, h = im.size
        except Exception:
            defects.append({"kind": "MISSING", "a": sheet, "b": ""})
            continue
        fw, fh = a.get("fw", 16), a.get("fh", 16)
        if w % fw or h % fh:
            defects.append({"kind": "BADANIM", "a": sheet, "b": f"{w}x{h} not divisible by {fw}x{fh}"})

    biome_defects: list[dict] = []
    group_defects: list[dict] = []
    if catalog:
        plan_biome = resolved.get("biome")
        for s in stamps:
            me_id = ccp.resolve_me(s, basename_to_me)
            if not me_id:
                continue
            rec = catalog.get(me_id)
            if not rec:
                continue
            if rec.get("group_only") and not s.get("grp"):
                group_defects.append({
                    "kind": "GROUP_SOLO", "a": me_id,
                    "b": f"stamped solo @({s.get('x')},{s.get('y')}) but catalog marks it group_only",
                })
            biome = ccp.biome_for_stamp(s, plan_biome, districts)
            if biome is None:
                continue
            allowed = rec.get("biomes_allowed") or [rec.get("biome_primary")]
            if biome not in allowed:
                biome_defects.append({
                    "kind": "BIOME_MISMATCH", "a": me_id,
                    "b": f"district biome '{biome}' not in {allowed} @({s.get('x')},{s.get('y')})",
                })

    if strict_biome:
        defects.extend(biome_defects)

    return {"hard": defects, "biome_advisory": biome_defects, "group_advisory": group_defects}


def stitch_thumbnails(resolved: dict, out_path: Path) -> bool:
    """Fallback preview: a numbered grid of the fragment's unique stamp
    thumbnails (same visual idiom as build-limezu-ext-singles-montages.py's
    mosaics), used only if render-city-preview.py's full compositor throws."""
    seen: dict[str, Path] = {}
    for s in resolved.get("stamps", []):
        img = s.get("img")
        if img and img not in seen:
            seen[img] = ASSETS / img
    cells = list(seen.items())
    if not cells:
        return False

    rows = (len(cells) + COLS - 1) // COLS
    label_h = 14
    cell_w, cell_h = THUMB, THUMB + label_h
    canvas = Image.new("RGBA", (COLS * cell_w, rows * cell_h), (28, 32, 40, 255))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    for i, (img_rel, path) in enumerate(cells):
        col, row = i % COLS, i // COLS
        x, y = col * cell_w, row * cell_h
        try:
            sp = Image.open(path).convert("RGBA")
            scale = min(THUMB / max(sp.width, 1), THUMB / max(sp.height, 1), 4.0)
            nw, nh = max(1, int(sp.width * scale)), max(1, int(sp.height * scale))
            sp = sp.resize((nw, nh), Image.Resampling.NEAREST)
            canvas.paste(sp, (x + (THUMB - nw) // 2, y + (THUMB - nh) // 2), sp)
        except Exception:
            draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], fill=(60, 30, 30, 255))
        draw.rectangle([x, y, x + THUMB - 1, y + THUMB - 1], outline=(70, 78, 92, 255))
        draw.text((x + 2, y + THUMB + 1), os.path.basename(img_rel)[:16], fill=(230, 230, 230, 255), font=font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    return True


def render_preview(resolved: dict, out_path: Path) -> str:
    """Try the real compositor first; stitched thumbnails only as a fallback.
    Returns "full", "stitched", or "failed"."""
    try:
        img = rcp.render(resolved)
        if img.width > 1600:
            scale = 1600 / img.width
            img = img.resize((int(img.width * scale), int(img.height * scale)), Image.NEAREST)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        img.save(out_path)
        return "full"
    except Exception as e:
        print(f"    render() failed ({e}); falling back to stitched thumbnails", file=sys.stderr)
        if stitch_thumbnails(resolved, out_path):
            return "stitched"
        return "failed"


def qa_fragment(fp: Path, index: dict, catalog: dict, basename_to_me: dict, districts: list,
                 strict_biome: bool, do_render: bool, world_size: dict) -> dict:
    frag = json.loads(fp.read_text(encoding="utf-8"))
    resolved, resolve_errors = resolve_fragment(frag, index)
    if not resolved.get("worldSize"):
        resolved["worldSize"] = dict(world_size)

    result = collect_defects(resolved, catalog, basename_to_me, districts, strict_biome)
    for err in resolve_errors:
        result["hard"].append({"kind": "UNRESOLVED", "a": err, "b": "resolve_stamps error"})

    stamps = resolved.get("stamps", [])
    unique_me = {s.get("me") for s in stamps if s.get("me")}
    unique_singles = {s.get("exs") for s in stamps if s.get("exs")} | \
        {s.get("img") for s in stamps if s.get("img") and not s.get("exs")}

    preview_path = None
    render_method = "skipped"
    if do_render:
        out_path = PREVIEW_DIR / f"{fp.stem}.png"
        render_method = render_preview(resolved, out_path)
        if render_method != "failed":
            preview_path = str(out_path.relative_to(DEN))

    defect_counts: dict[str, int] = {}
    for d in result["hard"]:
        defect_counts[d["kind"]] = defect_counts.get(d["kind"], 0) + 1
    hard_defect_count = sum(defect_counts.values())

    return {
        "file": str(fp.relative_to(DEN)),
        "id": frag.get("id", fp.stem),
        "district": frag.get("district"),
        "biome": frag.get("biome"),
        "stamp_count": len(stamps),
        "anim_count": len(resolved.get("anims", [])),
        "anim_band_count": len(resolved.get("animBands", [])),
        "unique_me_count": len(unique_me),
        "unique_singles_count": len(unique_singles),
        "coverage": (frag.get("_compiled") or {}).get("coverage"),
        "defect_counts": defect_counts,
        "hard_defect_count": hard_defect_count,
        "hard_defects": result["hard"][:40],
        "biome_advisory_count": len(result["biome_advisory"]),
        "group_advisory_count": len(result["group_advisory"]),
        "preview_png": preview_path,
        "render_method": render_method,
        "exit_code": 1 if hard_defect_count else 0,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-render", action="store_true", help="skip preview PNGs (faster; report only)")
    ap.add_argument("--strict-biome", action="store_true",
                     help="BIOME_MISMATCH contributes to the exit code (default: advisory only)")
    args = ap.parse_args()

    index = load_index()
    catalog = ccp.load_enriched_catalog()
    basename_to_me = ccp.load_basename_to_me()
    districts = ccp.load_district_biomes()
    world_size = load_world_size()

    fragments = sorted(GENERATED_DIR.glob("d*.json")) if GENERATED_DIR.is_dir() else []
    if not fragments:
        print(f"no fragments found under {GENERATED_DIR.relative_to(DEN)}")

    results = []
    for fp in fragments:
        print(f"checking {fp.relative_to(DEN)} ...")
        results.append(qa_fragment(fp, index, catalog, basename_to_me, districts,
                                    args.strict_biome, do_render=not args.no_render,
                                    world_size=world_size))

    total_hard = sum(r["hard_defect_count"] for r in results)
    fragments_with_defects = [r["id"] for r in results if r["hard_defect_count"]]

    report = {
        "_doc": (
            "GENERATED by scripts/montage-qa-compiled-districts.py (W5-B, Wave 5 "
            "prep — offline, no Denizen MCP visual-agent pass yet). Per-fragment "
            "render + check-city-plan.py defect summary for every "
            "data/city-specs/generated/d*.json compiled district. Re-run after "
            "any compile-exterior-district.py re-compile."
        ),
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        "strict_biome": args.strict_biome,
        "rendered": not args.no_render,
        "fragment_count": len(results),
        "hard_defect_total": total_hard,
        "fragments_with_hard_defects": fragments_with_defects,
        "fragments": results,
    }
    OUT_REPORT.parent.mkdir(parents=True, exist_ok=True)
    OUT_REPORT.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    print()
    print("=" * 78)
    print("MONTAGE QA — compiled districts")
    print("=" * 78)
    for r in results:
        status = "OK" if not r["hard_defect_count"] else f"DEFECTS({r['hard_defect_count']})"
        biome_label = r["biome"] or "-"
        print(f"  {r['id']:<28} biome={biome_label:<12} stamps={r['stamp_count']:<4} "
              f"unique_me={r['unique_me_count']:<4} unique_singles={r['unique_singles_count']:<4} "
              f"render={r['render_method']:<9} {status}")
    print("-" * 78)
    print(f"{len(results)} fragments checked, {total_hard} hard defect(s) total")
    if fragments_with_defects:
        print(f"fragments with defects: {fragments_with_defects}")
    print(f"wrote {OUT_REPORT.relative_to(DEN)}")

    return 1 if total_hard else 0


if __name__ == "__main__":
    raise SystemExit(main())
