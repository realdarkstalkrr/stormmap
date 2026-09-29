"""Potential mine / UXO contamination areas (user-supplied GeoJSON).

Ukraine publishes maps of potentially contaminated territory (mine action authorities,
State Emergency Service, humanitarian demining organisations). Export such a map as
GeoJSON and point STORMMAP_MINES_FILE at it (or drop it at static/data/mines.geojson).
The app then warns when your position or a planned route is inside these areas.
It never blocks routes: main roads through them are generally cleared, but leaving the
paved surface is not safe.
"""

import json
import os

from . import config

MINES_FILE = os.environ.get("STORMMAP_MINES_FILE", "")
_cache = {}


def load():
    path = MINES_FILE or str(config.STATIC_DIR / "data" / "mines.geojson")
    if not os.path.exists(path):
        return {"loaded": False, "source": None, "geojson": None,
                "note": "No mine-contamination map loaded. Set STORMMAP_MINES_FILE to an official GeoJSON export."}
    mtime = os.path.getmtime(path)
    if _cache.get("key") != (path, mtime):  # re-read only when the file changes
        with open(path, encoding="utf-8") as f:
            gj = json.load(f)
        feats = [f for f in gj.get("features", []) if (f.get("geometry") or {}).get("type") in ("Polygon", "MultiPolygon")]
        _cache.update(key=(path, mtime), value={"loaded": True, "source": os.path.basename(path),
                                                 "geojson": {"type": "FeatureCollection", "features": feats}, "count": len(feats)})
    return _cache["value"]
