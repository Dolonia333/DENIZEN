#!/usr/bin/env bash
# Promoted city-plan merge: all compiler-replaced districts + safe pockets + showcase.
# Showcase (d99) must be rebuilt AFTER pockets merge so zone carving sees their stamps.
set -euo pipefail
cd "$(dirname "$0")/.."
MANIFEST=data/city-specs/generated/manifest.json
BACKUP=/tmp/manifest-promote-backup.json
cp "$MANIFEST" "$BACKUP"
python3 - <<'PY'
import json
m = json.load(open("data/city-specs/generated/manifest.json"))
m["include"] = [x for x in m["include"] if x != "d99-catalog-showcase.json"]
json.dump(m, open("data/city-specs/generated/manifest.json", "w"), indent=1)
print("step 1: merge pockets without d99")
PY
python3 scripts/merge-city-plan.py --compiler-replaces HAND --include-pockets
python3 scripts/check-city-plan.py
python3 scripts/compile-coverage-showcase.py
python3 - <<'PY'
import json
m = json.load(open("data/city-specs/generated/manifest.json"))
if "d99-catalog-showcase.json" not in m["include"]:
    m["include"].append("d99-catalog-showcase.json")
json.dump(m, open("data/city-specs/generated/manifest.json", "w"), indent=1)
print("step 2: merge with refreshed d99 showcase")
PY
python3 scripts/merge-city-plan.py --compiler-replaces HAND --include-pockets
python3 scripts/check-city-plan.py
python3 scripts/build-ext-atlas.py
python3 scripts/build-day-night-variants.py
echo "promoted city plan OK"
