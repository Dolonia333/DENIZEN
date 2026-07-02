#!/usr/bin/env python3
"""Pull saved office placements from NAS into furniture_catalog_openplan.json."""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "denizen" / "data" / "furniture_catalog_openplan.json"
URL = os.environ.get("DENIZEN_URL", "https://denizen.dolonia.cloud").rstrip("/")


def main() -> int:
    req = urllib.request.Request(f"{URL}/api/layout", headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        layout = json.loads(resp.read().decode("utf-8"))

    placements = layout.get("placements")
    if not isinstance(placements, list) or not placements:
        print("No saved placements on server — move furniture in editor (E) then press X or run DenizenSaveLayout()", file=sys.stderr)
        return 1

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    catalog["placements"] = placements
    CATALOG.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {CATALOG} with {len(placements)} placements")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
