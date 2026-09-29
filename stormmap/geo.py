"""Geography helpers: country polygons, grid masks, nearest-city lookup."""

import json
import math
from functools import lru_cache

from .config import COUNTRIES, REGION_BOUNDS, STATIC_DIR

EARTH_R = 6371.0
COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


@lru_cache(maxsize=1)
def countries():
    """ISO code -> list of polygons (each a list of rings of (lon, lat)) with bbox."""
    data = json.loads((STATIC_DIR / "data" / "countries.geojson").read_text())
    out = {}
    for f in data["features"]:
        polys = []
        for poly in f["geometry"]["coordinates"]:
            xs = [c[0] for c in poly[0]]
            ys = [c[1] for c in poly[0]]
            polys.append({"rings": poly, "bbox": (min(xs), min(ys), max(xs), max(ys))})
        out[f["properties"]["code"]] = polys
    return out


@lru_cache(maxsize=1)
def cities():
    return json.loads((STATIC_DIR / "data" / "cities.json").read_text())


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def country_at(lat, lon):
    for code, polys in countries().items():
        for poly in polys:
            x0, y0, x1, y1 = poly["bbox"]
            if not (x0 <= lon <= x1 and y0 <= lat <= y1):
                continue
            if _in_ring(lon, lat, poly["rings"][0]) and not any(_in_ring(lon, lat, h) for h in poly["rings"][1:]):
                return code
    return None


def haversine(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def bearing(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass(deg):
    return COMPASS[int((deg + 11.25) // 22.5) % 16]


def nearest_city(lat, lon):
    best, best_d = None, 1e9
    for name, cc, clat, clon in cities():
        d = haversine(lat, lon, clat, clon)
        if d < best_d:
            best, best_d = (name, cc, clat, clon), d
    if not best:
        return None
    name, cc, clat, clon = best
    return {
        "name": name, "country": cc, "dist_km": round(best_d),
        "dir": compass(bearing(clat, clon, lat, lon)),
        "label": name if best_d < 8 else f"{round(best_d)} km {compass(bearing(clat, clon, lat, lon))} of {name}",
    }


def _frange(a, b, step):
    n = int(math.floor((b - a) / step + 1e-9)) + 1
    return [round(a + i * step, 4) for i in range(n)]


@lru_cache(maxsize=64)
def build_grid(region, max_points):
    """Return a rectangular grid definition with the subset of points to fetch.

    The mask keeps points inside (or within half a grid step of) the selected countries.
    """
    if region == "ALL":
        lat_min, lat_max, lon_min, lon_max = REGION_BOUNDS
        codes = list(COUNTRIES)
        step = 1.0
    else:
        c = COUNTRIES[region]
        lat_min, lat_max, lon_min, lon_max = c["bounds"]
        codes = [region]
        step = c["step"]
    polys = countries()

    def inside(lat, lon):
        for code in codes:
            for poly in polys.get(code, []):
                x0, y0, x1, y1 = poly["bbox"]
                if x0 <= lon <= x1 and y0 <= lat <= y1 and _in_ring(lon, lat, poly["rings"][0]):
                    return True
        return False

    while True:
        lat0 = math.floor(lat_min / step) * step
        lon0 = math.floor(lon_min / step) * step
        lats = _frange(lat0, lat_max + step, step)
        lons = _frange(lon0, lon_max + step, step)
        pts = []
        h = step * 0.5
        for iy, la in enumerate(lats):
            for ix, lo in enumerate(lons):
                if region == "ALL" and lo > REGION_BOUNDS[3] + h:
                    continue
                if any(inside(la + dy, lo + dx) for dy, dx in ((0, 0), (h, h), (h, -h), (-h, h), (-h, -h))):
                    pts.append((iy, ix))
        if len(pts) <= max_points:
            break
        step = round(step * 1.15, 3)
    return {
        "region": region, "step": step, "lat0": lats[0], "lon0": lons[0],
        "nlat": len(lats), "nlon": len(lons),
        "points": pts,
        "coords": [(lats[iy], lons[ix]) for iy, ix in pts],
    }
