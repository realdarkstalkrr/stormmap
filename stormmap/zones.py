"""No-go zones for route planning in and around Ukraine.

Primary source: DeepStateMap (deepstatemap.live), a Ukrainian open-source-intelligence
project that publishes the occupied-territory map daily as GeoJSON. Polygons are
rasterised onto a 0.01° grid (~1.1 km N–S × ~0.7 km E–W) so every route vertex can be
checked in O(1). On top of the occupied/contested areas the planner applies:

* a front-line safety buffer (default 30 km) around occupied and contested territory,
* a border buffer (default 20 km) on both sides of the Ukraine–Russia/Belarus border,
* a closed-border rule: no road link may cross between Ukraine and Russia/Belarus.

If the live feed cannot be fetched and nothing is cached, a deliberately over-cautious
coarse fallback polygon is used and flagged as such everywhere in the UI.
"""

import gzip
import json
import logging
import math
import os
import threading
import time
from array import array

from . import config
from .geo import countries
from .net import FetchError, fetch_json

log = logging.getLogger("stormmap.zones")

DEEPSTATE_URL = os.environ.get("STORMMAP_ZONES_URL", "https://deepstatemap.live/api/history/last")
ZONES_FILE = os.environ.get("STORMMAP_ZONES_FILE", "")  # optional local GeoJSON override
ZONES_TTL = 6 * 3600

# Raster covering Ukraine plus margin into Russia/Belarus/Moldova.
LAT0, LAT1, LON0, LON1 = 43.9, 53.6, 21.9, 41.5
RES = 0.01          # fine grid for the zones themselves (~1 km)
DRES = 0.02         # coarse grid for buffer distances (~2 km)
NLAT = int(round((LAT1 - LAT0) / RES))
NLON = int(round((LON1 - LON0) / RES))
DNLAT, DNLON = NLAT // 2, NLON // 2

FREE, OCCUPIED, CONTESTED, FRONT_BUFFER, BORDER_BUFFER = 0, 1, 2, 3, 4
CLASS_NAMES = {OCCUPIED: "Occupied territory", CONTESTED: "Contested / grey zone",
               FRONT_BUFFER: "Front-line safety buffer", BORDER_BUFFER: "Border danger zone"}
C_OTHER, C_UA, C_RUBY = 0, 1, 2

DEFAULT_FRONT_KM = float(os.environ.get("STORMMAP_FRONT_BUFFER_KM", "30"))
DEFAULT_BORDER_KM = float(os.environ.get("STORMMAP_BORDER_BUFFER_KM", "20"))

# Over-cautious coarse fallback (whole of the most affected regions), used ONLY when no
# live or cached Ukrainian data is available. It intentionally over-blocks.
FALLBACK_POLYGONS = [
    # Kherson / Zaporizhzhia / Donetsk / Luhansk oblasts and eastern Kharkiv oblast
    [(31.5, 46.2), (32.1, 46.7), (33.2, 47.3), (34.3, 47.5), (35.3, 47.9), (36.2, 48.1), (36.6, 48.7),
     (37.2, 49.2), (37.4, 49.7), (37.8, 50.1), (38.6, 50.4), (39.6, 50.1), (40.2, 49.6), (40.1, 48.9),
     (39.9, 48.2), (38.9, 47.8), (38.2, 47.1), (36.8, 46.6), (35.3, 46.4), (34.8, 46.1), (33.6, 46.0),
     (32.4, 46.0), (31.5, 46.2)],
    # Crimea
    [(32.4, 45.3), (33.35, 46.25), (34.9, 46.0), (36.7, 45.4), (35.5, 44.8), (33.9, 44.35), (33.3, 44.5), (32.4, 45.3)],
]

_state = {"data": None, "building": False, "error": None}
_lock = threading.Lock()


# ----------------------------------------------------------------------------------------
# Source parsing
# ----------------------------------------------------------------------------------------

OCC_WORDS = ("окуп", "occupied", "ордло", "ordlo", "оккуп", "окупов", "крим", "crimea")
GREY_WORDS = ("сір", "grey", "gray", "спірн", "contested", "невідом", "unknown", "сіра")
LIB_WORDS = ("звільн", "liberated", "deoccupied", "деокуп")


def _hex_rgb(s):
    try:
        s = str(s).strip().lstrip("#")
        if len(s) == 3:
            s = "".join(c * 2 for c in s)
        return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except (ValueError, IndexError):
        return None


def classify_feature(props):
    """Classify a DeepState (or generic) feature: OCCUPIED, CONTESTED or None."""
    props = props or {}
    text = " ".join(str(props.get(k, "")) for k in ("name", "title", "description", "status", "type")).lower()
    if any(w in text for w in LIB_WORDS):
        return None
    if any(w in text for w in OCC_WORDS):
        return OCCUPIED
    if any(w in text for w in GREY_WORDS):
        return CONTESTED
    status = str(props.get("zone", "")).lower()
    if status in ("occupied", "occupation"):
        return OCCUPIED
    rgb = _hex_rgb(props.get("fill") or props.get("fill-color") or props.get("color") or "")
    if rgb:
        r, g, b = rgb
        if r > 140 and g < 100 and b < 100:
            return OCCUPIED
        if abs(r - g) < 20 and abs(g - b) < 20 and 90 < r < 210:
            return CONTESTED
    return None


def _polys(geom):
    """Yield polygons as lists of rings of (lon, lat) from Polygon / MultiPolygon / GeometryCollection."""
    if not geom:
        return
    t = geom.get("type")
    if t == "Polygon":
        yield [[(c[0], c[1]) for c in ring] for ring in geom.get("coordinates", [])]
    elif t == "MultiPolygon":
        for poly in geom.get("coordinates", []):
            yield [[(c[0], c[1]) for c in ring] for ring in poly]
    elif t == "GeometryCollection":
        for g in geom.get("geometries", []):
            yield from _polys(g)


def parse_source(data):
    """Extract (class, polygon) pairs from a DeepState API response or plain GeoJSON."""
    fc = data
    if isinstance(data, dict) and "map" in data:
        fc = data["map"]
        if isinstance(fc, str):
            fc = json.loads(fc)
    feats = fc.get("features", []) if isinstance(fc, dict) else []
    out = []
    skipped = {}
    for f in feats:
        cls = classify_feature(f.get("properties"))
        if cls is None:
            geom_type = (f.get("geometry") or {}).get("type", "")
            if "Polygon" in geom_type:
                name = str((f.get("properties") or {}).get("name", ""))[:60] or "(unnamed)"
                skipped[name] = skipped.get(name, 0) + 1
            continue
        for poly in _polys(f.get("geometry")):
            if poly and len(poly[0]) >= 4:
                out.append((cls, poly))
    if skipped:
        # visible in /api/zones meta so a change in the source's naming scheme is noticed
        log.info("zones: ignored polygon features (not occupied/contested): %s", skipped)
    parse_source.last_skipped = skipped
    return out


parse_source.last_skipped = {}


def _load_source():
    """Return (polygons, meta). Order: local file → live DeepState → disk cache → fallback."""
    cache_path = config.CACHE_DIR / "zones-source.json.gz"
    if ZONES_FILE:
        with open(ZONES_FILE, encoding="utf-8") as f:
            polys = parse_source(json.load(f))
        return polys, {"source": f"Local file {os.path.basename(ZONES_FILE)}", "fallback": False, "updated": None}
    if not config.DEMO_MODE:
        try:
            data = fetch_json(DEEPSTATE_URL, timeout=30, retries=1)
            polys = parse_source(data)
            if not polys:
                raise FetchError("DeepState response contained no occupied-territory polygons")
            try:
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                with gzip.open(cache_path, "wt", encoding="utf-8") as f:
                    json.dump({"fetched": time.time(), "data": data}, f)
            except OSError as e:
                log.warning("zones cache write failed: %s", e)
            return polys, {"source": "DeepStateMap (deepstatemap.live)", "fallback": False,
                           "updated": data.get("datetime") or data.get("updatedAt") or data.get("id")}
        except (FetchError, ValueError) as e:
            log.warning("DeepState fetch failed: %s", e)
            try:
                with gzip.open(cache_path, "rt", encoding="utf-8") as f:
                    cached = json.load(f)
                polys = parse_source(cached["data"])
                if polys:
                    age_h = (time.time() - cached["fetched"]) / 3600
                    return polys, {"source": f"DeepStateMap (cached {age_h:.0f} h ago — live fetch failed)",
                                   "fallback": False, "stale": True, "updated": cached["data"].get("datetime")}
            except (OSError, ValueError, KeyError):
                pass
    polys = [(OCCUPIED, [ring]) for ring in FALLBACK_POLYGONS]
    return polys, {"source": "CONSERVATIVE FALLBACK — live Ukrainian data unavailable; coarse and over-blocking",
                   "fallback": True, "updated": None}


# ----------------------------------------------------------------------------------------
# Rasterisation & distance fields
# ----------------------------------------------------------------------------------------

def _fill_polygon(grid, nlat, nlon, lat0, lon0, res, rings, value, only_if=None):
    """Even-odd scanline fill of one polygon (with holes) into a bytearray raster."""
    rows = {}
    for ring in rings:
        n = len(ring)
        for k in range(n - 1):
            x0, y0 = ring[k]
            x1, y1 = ring[k + 1]
            if y0 == y1:
                continue
            if y0 > y1:
                x0, y0, x1, y1 = x1, y1, x0, y0
            j0 = max(0, int(math.ceil((y0 - lat0) / res - 0.5)))
            j1 = min(nlat - 1, int(math.floor((y1 - lat0) / res - 0.5)))
            for j in range(j0, j1 + 1):
                yc = lat0 + (j + 0.5) * res
                if y0 <= yc < y1:
                    rows.setdefault(j, []).append(x0 + (yc - y0) * (x1 - x0) / (y1 - y0))
    for j, xs in rows.items():
        xs.sort()
        base = j * nlon
        for a, b in zip(xs[0::2], xs[1::2]):
            i0 = max(0, int(math.ceil((a - lon0) / res - 0.5)))
            i1 = min(nlon - 1, int(math.floor((b - lon0) / res - 0.5)))
            if i1 < i0:
                continue
            if only_if is None:
                grid[base + i0:base + i1 + 1] = bytes([value]) * (i1 - i0 + 1)
            else:
                for i in range(i0, i1 + 1):
                    if grid[base + i] == only_if:
                        grid[base + i] = value


def _distance_field(seed, nlat, nlon, lat0, res, cap=120.0):
    """Two-pass chamfer distance (km) from seed cells, capped. Returns array('f')."""
    inf = cap
    d = array("f", [0.0 if s else inf for s in seed])
    dy = res * 111.32
    for j in range(nlat):
        coslat = math.cos(math.radians(lat0 + (j + 0.5) * res))
        dx = res * 111.32 * coslat
        dd = math.hypot(dx, dy)
        base = j * nlon
        prev = base - nlon
        for i in range(nlon):
            k = base + i
            v = d[k]
            if v == 0.0:
                continue
            if i > 0 and d[k - 1] + dx < v:
                v = d[k - 1] + dx
            if j > 0:
                if d[prev + i] + dy < v:
                    v = d[prev + i] + dy
                if i > 0 and d[prev + i - 1] + dd < v:
                    v = d[prev + i - 1] + dd
                if i < nlon - 1 and d[prev + i + 1] + dd < v:
                    v = d[prev + i + 1] + dd
            d[k] = v
    for j in range(nlat - 1, -1, -1):
        coslat = math.cos(math.radians(lat0 + (j + 0.5) * res))
        dx = res * 111.32 * coslat
        dd = math.hypot(dx, dy)
        base = j * nlon
        nxt = base + nlon
        for i in range(nlon - 1, -1, -1):
            k = base + i
            v = d[k]
            if v == 0.0:
                continue
            if i < nlon - 1 and d[k + 1] + dx < v:
                v = d[k + 1] + dx
            if j < nlat - 1:
                if d[nxt + i] + dy < v:
                    v = d[nxt + i] + dy
                if i < nlon - 1 and d[nxt + i + 1] + dd < v:
                    v = d[nxt + i + 1] + dd
                if i > 0 and d[nxt + i - 1] + dd < v:
                    v = d[nxt + i - 1] + dd
            d[k] = v
    return d


def _build():
    t0 = time.time()
    polys, meta = _load_source()

    # fine raster of occupied / contested territory
    zone = bytearray(NLAT * NLON)
    for cls, rings in polys:
        _fill_polygon(zone, NLAT, NLON, LAT0, LON0, RES, rings, cls)

    # coarse country raster (UA vs RU/BY) for the closed-border rule and border buffer
    country = bytearray(DNLAT * DNLON)
    geo = countries()
    for code, val in (("UA", C_UA), ("RU", C_RUBY), ("BY", C_RUBY)):
        for poly in geo.get(code, []):
            _fill_polygon(country, DNLAT, DNLON, LAT0, LON0, DRES, poly["rings"], val)

    # coarse seeds: any occupied/contested fine cell inside the coarse cell
    zseed = bytearray(DNLAT * DNLON)
    for j in range(NLAT):
        row = zone[j * NLON:(j + 1) * NLON]
        if not any(row):
            continue
        base = (j // 2) * DNLON
        for i, v in enumerate(row):
            if v:
                zseed[base + i // 2] = 1
    # UA cells touching RU/BY cells mark the border line
    bseed = bytearray(DNLAT * DNLON)
    for j in range(DNLAT):
        for i in range(DNLON):
            k = j * DNLON + i
            if country[k] != C_UA:
                continue
            for dj, di in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                jj, ii = j + dj, i + di
                if 0 <= jj < DNLAT and 0 <= ii < DNLON and country[jj * DNLON + ii] == C_RUBY:
                    bseed[k] = 1
                    break
    dfront = _distance_field(zseed, DNLAT, DNLON, LAT0, DRES)
    dborder = _distance_field(bseed, DNLAT, DNLON, LAT0, DRES)
    n_occ = sum(1 for v in zone if v == OCCUPIED)
    n_con = sum(1 for v in zone if v == CONTESTED)
    meta.update({
        "built": int(time.time()), "build_s": round(time.time() - t0, 1),
        "occupied_km2": round(n_occ * _cell_area_mid()), "contested_km2": round(n_con * _cell_area_mid()),
        "polygons": len(polys), "resolution_deg": RES,
        "ignored_polygon_names": dict(list(parse_source.last_skipped.items())[:12]),
        "precision_km": 20.0 if meta.get("fallback") else 1.1,
    })
    log.info("zones built from %s: %d polygons, %.0f km² occupied, %.1fs", meta["source"], len(polys), meta["occupied_km2"], time.time() - t0)
    geojson = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"zone": CLASS_NAMES[cls], "class": cls},
         "geometry": {"type": "Polygon", "coordinates": [[[round(x, 5), round(y, 5)] for x, y in ring] for ring in rings]}}
        for cls, rings in polys]}
    return {"zone": zone, "country": country, "dfront": dfront, "dborder": dborder,
            "meta": meta, "geojson": geojson, "masks": {}}


def _cell_area_mid():
    return (RES * 111.32) * (RES * 111.32 * math.cos(math.radians(48.5)))


def get(wait=True):
    """Return the built zone data, (re)building when stale. Thread-safe."""
    with _lock:
        d = _state["data"]
        fresh = d and time.time() - d["meta"]["built"] < ZONES_TTL
        if fresh:
            return d
        if d and not wait:
            return d
    with _lock:
        d = _state["data"]
        if d and time.time() - d["meta"]["built"] < ZONES_TTL:
            return d
        _state["data"] = _build()
        return _state["data"]


def warm():
    threading.Thread(target=lambda: get(), name="zones-warm", daemon=True).start()


# ----------------------------------------------------------------------------------------
# Queries
# ----------------------------------------------------------------------------------------

class Mask:
    """No-go classification for given buffers; O(1) point queries."""

    def __init__(self, data, front_km, border_km):
        self.d = data
        self.front = max(1.0, float(front_km))
        self.border = max(0.0, float(border_km))

    def cls(self, lat, lon):
        if not (LAT0 <= lat < LAT1 and LON0 <= lon < LON1):
            return FREE
        j = int((lat - LAT0) / RES)
        i = int((lon - LON0) / RES)
        z = self.d["zone"][j * NLON + i]
        if z:
            return z
        k = (j // 2) * DNLON + i // 2
        if k < len(self.d["dfront"]) and self.d["dfront"][k] < self.front:
            return FRONT_BUFFER
        if self.border > 0 and k < len(self.d["dborder"]) and self.d["dborder"][k] < self.border:
            return BORDER_BUFFER
        return FREE

    def country(self, lat, lon):
        if not (LAT0 <= lat < LAT1 and LON0 <= lon < LON1):
            return C_OTHER
        j = int((lat - LAT0) / DRES)
        i = int((lon - LON0) / DRES)
        if j >= DNLAT or i >= DNLON:
            return C_OTHER
        return self.d["country"][j * DNLON + i]

    def front_distance(self, lat, lon):
        if not (LAT0 <= lat < LAT1 and LON0 <= lon < LON1):
            return None
        j = int((lat - LAT0) / DRES)
        i = int((lon - LON0) / DRES)
        if j >= DNLAT or i >= DNLON:
            return None
        return float(self.d["dfront"][j * DNLON + i])

    def segment_ok(self, a, b, step_km=0.5):
        """True if the straight segment a→b (lat, lon) avoids no-go cells and closed borders."""
        dist = math.hypot((b[0] - a[0]) * 111.32, (b[1] - a[1]) * 111.32 * math.cos(math.radians(a[0])))
        n = max(1, int(dist / step_km))
        ca = self.country(*a)
        for s in range(n + 1):
            f = s / n
            lat = a[0] + (b[0] - a[0]) * f
            lon = a[1] + (b[1] - a[1]) * f
            if self.cls(lat, lon):
                return False
            c = self.country(lat, lon)
            if {ca, c} == {C_UA, C_RUBY}:
                return False  # UA ↔ RU/BY border is closed
        return True

    def check_path(self, coords, step_km=0.5):
        """Validate a polyline [(lat, lon), …]. Returns dict(ok, first_violation, min_front_km)."""
        min_front = None
        for k in range(len(coords) - 1):
            a, b = coords[k], coords[k + 1]
            if not self.segment_ok(a, b, step_km):
                # locate the first offending sample for the UI
                dist = math.hypot((b[0] - a[0]) * 111.32, (b[1] - a[1]) * 111.32 * math.cos(math.radians(a[0])))
                n = max(1, int(dist / step_km))
                bad = a
                for s in range(n + 1):
                    p = (a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n)
                    if self.cls(*p) or {self.country(*a), self.country(*p)} == {C_UA, C_RUBY}:
                        bad = p
                        break
                c = self.cls(*bad)
                return {"ok": False, "violation": [round(bad[0], 4), round(bad[1], 4)],
                        "reason": CLASS_NAMES.get(c, "Closed border (Ukraine ↔ Russia/Belarus)")}
            fd = self.front_distance(*a)
            if fd is not None and (min_front is None or fd < min_front):
                min_front = fd
        return {"ok": True, "min_front_km": None if min_front is None else round(min_front, 1)}

    def rle(self):
        """Run-length encoded class raster on the fine grid (for the browser)."""
        out = []
        cur, run = None, 0
        for j in range(NLAT):
            lat = LAT0 + (j + 0.5) * RES
            for i in range(NLON):
                v = self.cls(lat, LON0 + (i + 0.5) * RES)
                if v == cur:
                    run += 1
                else:
                    if cur is not None:
                        out += [cur, run]
                    cur, run = v, 1
        out += [cur, run]
        return out


def mask(front_km=DEFAULT_FRONT_KM, border_km=DEFAULT_BORDER_KM):
    d = get()
    key = (round(float(front_km)), round(float(border_km)))
    m = d["masks"].get(key)
    if m is None:
        m = Mask(d, *key)
        d["masks"][key] = m
    return m


def api_payload(front_km, border_km):
    d = get()
    m = mask(front_km, border_km)
    if not hasattr(m, "_rle"):
        m._rle = m.rle()
    return {
        "meta": d["meta"], "front_km": m.front, "border_km": m.border,
        "grid": {"lat0": LAT0, "lon0": LON0, "res": RES, "nlat": NLAT, "nlon": NLON},
        "rle": m._rle, "classes": CLASS_NAMES, "polygons": d["geojson"],
    }
