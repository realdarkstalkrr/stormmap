"""Road routing and storm-intercept planning that respects no-go zones.

Road routes come from an OSRM server (default: the public OSRM demo; set
STORMMAP_OSRM_URL to your own instance for heavy use). OSRM cannot avoid areas by
itself, so every candidate route is validated against the zone raster (0.5 km steps)
and, when needed, re-planned through safe via-points. If no road service is reachable
(offline / demo), an approximate network of straight links between towns is used and
the result is clearly labelled as not following real roads.
"""

import heapq
import logging
import math
import os
import time
import urllib.parse

from . import config, zones
from .geo import cities, compass, bearing, haversine, nearest_city
from .net import FetchError, cache, fetch_json

log = logging.getLogger("stormmap.routing")

OSRM_URL = os.environ.get("STORMMAP_OSRM_URL", "https://router.project-osrm.org").rstrip("/")
ROAD_FACTOR = 1.3        # straight-line → road distance for the approximate network
APPROX_SPEED_KMH = 70.0


def _latlon_str(p):
    return f"{p[1]:.5f},{p[0]:.5f}"


# ----------------------------------------------------------------------------------------
# OSRM
# ----------------------------------------------------------------------------------------

def _osrm_route(points, alternatives=False):
    coords = ";".join(_latlon_str(p) for p in points)
    params = {"overview": "full", "geometries": "geojson", "steps": "true", "alternatives": "3" if alternatives else "false"}
    url = f"{OSRM_URL}/route/v1/driving/{coords}?" + urllib.parse.urlencode(params)
    key = ("osrm", coords, alternatives)
    data = cache.get_or_load(key, 1800, lambda: fetch_json(url, timeout=20, retries=1), stale_ok=False)
    if data.get("code") != "Ok":
        raise FetchError(f"OSRM: {data.get('message') or data.get('code')}", 502)
    out = []
    for r in data.get("routes", []):
        geom = [(c[1], c[0]) for c in r["geometry"]["coordinates"]]
        steps = []
        for leg in r.get("legs", []):
            for s in leg.get("steps", []):
                m = s.get("maneuver", {})
                if s.get("distance", 0) < 30 and m.get("type") not in ("arrive", "depart"):
                    continue
                steps.append({
                    "type": m.get("type"), "modifier": m.get("modifier"), "name": s.get("name") or s.get("ref") or "",
                    "ref": s.get("ref"), "distance_km": round(s.get("distance", 0) / 1000, 1),
                    "duration_min": round(s.get("duration", 0) / 60, 1),
                })
        out.append({"geometry": geom, "distance_km": r["distance"] / 1000, "duration_min": r["duration"] / 60,
                    "steps": steps, "source": "osrm"})
    return out


def _osrm_table(origin, targets):
    coords = ";".join(_latlon_str(p) for p in [origin] + targets)
    url = f"{OSRM_URL}/table/v1/driving/{coords}?sources=0&annotations=duration,distance"
    data = fetch_json(url, timeout=20, retries=1)
    if data.get("code") != "Ok":
        raise FetchError(f"OSRM table: {data.get('message') or data.get('code')}", 502)
    durs = data["durations"][0][1:]
    dists = (data.get("distances") or [[None] * (len(targets) + 1)])[0][1:]
    return [None if d is None else d / 60 for d in durs], [None if d is None else d / 1000 for d in dists]


def _simplify(geom, max_pts=1500):
    if len(geom) <= max_pts:
        return geom
    step = len(geom) / max_pts
    out = [geom[int(i * step)] for i in range(max_pts)]
    out.append(geom[-1])
    return out


# ----------------------------------------------------------------------------------------
# Approximate network (offline / demo): straight links between towns
# ----------------------------------------------------------------------------------------

_approx_cache = {}


def _approx_graph(m):
    key = (id(m.d), m.front, m.border)
    g = _approx_cache.get(key)
    if g:
        return g
    nodes = [(c[2], c[3]) for c in cities() if not m.cls(c[2], c[3])]
    names = [c[0] for c in cities() if not m.cls(c[2], c[3])]
    adj = {i: [] for i in range(len(nodes))}
    for i, a in enumerate(nodes):
        near = sorted(range(len(nodes)), key=lambda j: haversine(*a, *nodes[j]))[1:7]
        for j in near:
            d = haversine(*a, *nodes[j])
            if d > 450 or not m.segment_ok(a, nodes[j], step_km=1.0):
                continue
            adj[i].append((j, d * ROAD_FACTOR))
            adj[j].append((i, d * ROAD_FACTOR))
    g = {"nodes": nodes, "names": names, "adj": adj}
    _approx_cache.clear()
    _approx_cache[key] = g
    return g


def _dijkstra(g, extra, src):
    """Shortest distances from src over graph g plus `extra` edges {node: [(nbr, km)]}."""
    dist = {src: 0.0}
    prev = {}
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, 1e18):
            continue
        for v, w in g["adj"].get(u, []) + extra.get(u, []):
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    return dist, prev


def _attach(g, m, p, idx, extra):
    """Connect an arbitrary point (id idx) to its nearest reachable graph nodes."""
    ranked = sorted(range(len(g["nodes"])), key=lambda j: haversine(*p, *g["nodes"][j]))[:6]
    for j in ranked:
        q = g["nodes"][j]
        d = haversine(*p, *q)
        if d < 250 and m.segment_ok(p, q, step_km=1.0):
            extra.setdefault(idx, []).append((j, d * ROAD_FACTOR))
            extra.setdefault(j, []).append((idx, d * ROAD_FACTOR))


def _approx_route(m, a, b, speed_kmh):
    g = _approx_graph(m)
    A, B = -1, -2
    extra = {}
    _attach(g, m, a, A, extra)
    _attach(g, m, b, B, extra)
    direct = haversine(*a, *b)
    if m.segment_ok(a, b, step_km=1.0):
        extra.setdefault(A, []).append((B, direct * ROAD_FACTOR))
    dist, prev = _dijkstra(g, extra, A)
    if B not in dist:
        return None
    path, u = [], B
    while u != A:
        path.append(u)
        u = prev[u]
    path.append(A)
    path.reverse()
    pts = [a if n == A else b if n == B else g["nodes"][n] for n in path]
    km = dist[B]
    steps = []
    for n in path[1:-1]:
        steps.append({"type": "waypoint", "modifier": None, "name": f"via {g['names'][n]}", "distance_km": None, "duration_min": None})
    return {"geometry": pts, "distance_km": km, "duration_min": km / speed_kmh * 60, "steps": steps, "source": "approx"}


def _approx_times(m, origin, targets, speed_kmh):
    g = _approx_graph(m)
    extra = {}
    _attach(g, m, origin, -1, extra)
    for k, t in enumerate(targets):
        idx = -10 - k
        _attach(g, m, t, idx, extra)
        if m.segment_ok(origin, t, step_km=1.0):
            extra.setdefault(-1, []).append((idx, haversine(*origin, *t) * ROAD_FACTOR))
    dist, _ = _dijkstra(g, extra, -1)
    kms = [dist.get(-10 - k) for k in range(len(targets))]
    return [None if d is None else d / speed_kmh * 60 for d in kms], kms


# ----------------------------------------------------------------------------------------
# Safe routing
# ----------------------------------------------------------------------------------------

def _decorate(route, m, check):
    geom = route["geometry"]
    route.update({
        "distance_km": round(route["distance_km"], 1), "duration_min": round(route["duration_min"], 1),
        "geometry": [[round(p[0], 5), round(p[1], 5)] for p in _simplify(geom)],
        "safety": check,
    })
    return route


def _via_candidates(m, a, b, limit=5):
    """Safe towns that make a sensible detour between a and b."""
    direct = haversine(*a, *b)
    ca = m.country(*a)
    cands = []
    for name, cc, la, lo in cities():
        if m.cls(la, lo):
            continue
        cw = m.country(la, lo)
        if {ca, cw} == {zones.C_UA, zones.C_RUBY}:
            continue
        extra = haversine(*a, la, lo) + haversine(la, lo, *b) - direct
        if extra < max(40, direct * 0.9):
            cands.append((extra, (la, lo), name))
    cands.sort()
    return cands[:limit]


def safe_route(a, b, front_km, border_km, speed_kmh=80.0, prefer_approx=False):
    """Fastest route from a to b that stays out of no-go zones. Raises FetchError if impossible."""
    m = zones.mask(front_km, border_km)
    for label, p in (("Start", a), ("Destination", b)):
        c = m.cls(*p)
        if c:
            raise FetchError(f"{label} lies inside a no-go area ({zones.CLASS_NAMES[c]}).", 422)
    tried, errors = 0, []
    if not (config.DEMO_MODE or prefer_approx):
        try:
            for r in _osrm_route([a, b], alternatives=True):
                tried += 1
                chk = m.check_path(r["geometry"])
                if chk["ok"]:
                    return _decorate(r, m, chk)
                errors.append(chk)
            best = None
            for _, w, name in _via_candidates(m, a, b):
                try:
                    for r in _osrm_route([a, w, b]):
                        tried += 1
                        chk = m.check_path(r["geometry"])
                        if chk["ok"] and (best is None or r["duration_min"] < best[0]["duration_min"]):
                            r["via"] = name
                            best = (r, chk)
                except FetchError as e:
                    log.warning("via %s failed: %s", name, e)
                time.sleep(0.25)  # be gentle with the public OSRM server
            if best:
                return _decorate(best[0], m, best[1])
            raise FetchError(f"No safe road route found ({tried} candidates crossed no-go areas, e.g. {errors[0]['reason'] if errors else 'n/a'}).", 422)
        except FetchError as e:
            if e.status == 422:
                raise
            log.warning("OSRM unavailable (%s) — using approximate network", e)
    r = _approx_route(m, a, b, speed_kmh)
    if not r:
        raise FetchError("No safe connection found in the approximate network.", 422)
    chk = m.check_path(r["geometry"])
    r["approx_note"] = "Approximate: straight links between towns — no road data available (offline or routing server unreachable)."
    return _decorate(r, m, chk)


# ----------------------------------------------------------------------------------------
# Storm intercept
# ----------------------------------------------------------------------------------------

def _offset(lat, lon, east_km, north_km):
    return lat + north_km / 111.32, lon + east_km / (111.32 * math.cos(math.radians(lat)))


def intercept(origin, cell, front_km, border_km, speed_kmh=80.0, mode="flank", lead_min=10):
    """Plan a road intercept of a moving storm cell.

    cell: dict(lat, lon, u, v [m/s], radius_km). The target is the storm's forecast
    position (right/south-east flank offset in 'flank' mode, away from the hail core)
    at the earliest time the chaser can arrive `lead_min` minutes ahead of the storm.
    """
    m = zones.mask(front_km, border_km)
    if m.cls(*origin):
        raise FetchError(f"Your position is inside a no-go area ({zones.CLASS_NAMES[m.cls(*origin)]}).", 422)
    u, v = float(cell.get("u") or 0), float(cell.get("v") or 0)
    spd = math.hypot(u, v)
    r_km = float(cell.get("radius_km") or 10)
    flank = r_km + 12 if mode == "flank" else 0.0
    horizon = list(range(10, 181, 10))
    targets, storm_pos = [], []
    enters_nogo = None
    for t in horizon:
        slat, slon = _offset(cell["lat"], cell["lon"], u * t * 0.06, v * t * 0.06)
        storm_pos.append((slat, slon))
        if enters_nogo is None and m.cls(slat, slon):
            enters_nogo = t
        if spd > 0.5 and flank:
            # right of motion: rotate (u, v) by -90° → (v, -u)
            tlat, tlon = _offset(slat, slon, v / spd * flank, -u / spd * flank)
        else:
            tlat, tlon = slat, slon
        targets.append((tlat, tlon))

    source = "approx"
    durs = kms = None
    if not config.DEMO_MODE:
        try:
            durs, kms = _osrm_table(origin, targets)
            source = "osrm"
        except FetchError as e:
            log.warning("OSRM table unavailable (%s) — approximate network", e)
    if durs is None:
        durs, kms = _approx_times(m, origin, targets, speed_kmh)

    tried = []
    for k, t in enumerate(horizon):
        tgt = targets[k]
        if m.cls(*tgt) or durs[k] is None:
            continue
        if durs[k] + lead_min > t:
            continue
        try:
            route = safe_route(origin, tgt, front_km, border_km, speed_kmh, prefer_approx=(source == "approx"))
        except FetchError as e:
            tried.append(f"+{t} min: {e}")
            continue
        if route["duration_min"] + lead_min > t:
            tried.append(f"+{t} min: safe route too slow ({route['duration_min']:.0f} min)")
            continue
        now = time.time()
        return {
            "ok": True, "mode": mode, "minutes": t, "target": [round(tgt[0], 4), round(tgt[1], 4)],
            "target_place": nearest_city(*tgt), "storm_at_target_time": [round(storm_pos[k][0], 4), round(storm_pos[k][1], 4)],
            "arrive_min": round(route["duration_min"], 1), "margin_min": round(t - route["duration_min"], 1),
            "arrive_ts": int(now + route["duration_min"] * 60), "storm_ts": int(now + t * 60),
            "storm_speed_kmh": round(spd * 3.6), "storm_heading": round((math.degrees(math.atan2(u, v)) + 360) % 360),
            "storm_heading_text": compass((math.degrees(math.atan2(u, v)) + 360) % 360),
            "approach_bearing": round(bearing(*origin, *tgt)), "enters_nogo_min": enters_nogo,
            "route": route, "notes": tried[:5],
        }
    return {"ok": False, "reason": "Storm cannot be intercepted safely within 3 hours from your position.",
            "enters_nogo_min": enters_nogo, "notes": tried[:5]}
