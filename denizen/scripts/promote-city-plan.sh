#!/usr/bin/env bash
# Promoted city-plan merge: all compiler-replaced districts + the safe pockets
# listed in data/city-specs/generated/manifest.json.
#
# D99 IS NOT MERGED, AND MUST NOT BE. compile-coverage-showcase.py parks every
# orphan me.* in "empty world space" to lift Tier A/B catalog coverage — that is
# a metrics device, not city design. It used to be merged, which put 683 exhibit
# stamps, 23 bare paving patches and 23 labels reading "CATALOG SHOWCASE —
# <BIOME>" into the played city across 13 zones: buildings lined up in rows on
# blank concrete, giant ice-cream cones, floating doors.
#
# This script used to strip d99 from the manifest, merge, rebuild d99, ADD IT
# BACK and merge again — so a single promote undid any showcase cleanup. It no
# longer touches the manifest at all: the manifest is the single source of truth
# for what merges, and it excludes d99. Run compile-coverage-showcase.py
# yourself when you want the coverage numbers; its fragment stays on disk and
# simply never reaches the plan.
#
# If a merge ever does reintroduce showcase-tagged elements, undo it with:
#   python3 scripts/strip-showcase-from-plan.py
set -euo pipefail
cd "$(dirname "$0")/.."

# python3 on the deploy box, python on a Windows dev checkout — resolve it so
# this is runnable (and therefore testable) in both places.
PY=$(command -v python3 || command -v python) || {
  echo "promote-city-plan: no python3/python on PATH" >&2; exit 1; }

"$PY" scripts/merge-city-plan.py --compiler-replaces HAND --include-pockets
"$PY" scripts/check-city-plan.py

# Belt and braces: the plan that ships must contain no showcase-tagged element,
# whatever a fragment or a future manifest edit did upstream.
"$PY" scripts/strip-showcase-from-plan.py

"$PY" scripts/build-ext-atlas.py
"$PY" scripts/build-day-night-variants.py
echo "promoted city plan OK"
