"""Model data service: grid fields, point soundings, meteograms, ensembles and outlooks."""

import gzip
import json
import logging
import math
import threading
import time
import urllib.parse
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from . import config, demo
from .derived import PARAMS, compute_point
from .geo import build_grid, country_at, nearest_city
from .net import FetchError, cache, fetch_json
from .sounding import analyze, profile_from_openmeteo

log = logging.getLogger("stormmap.forecast")

ROUND2 = {"stp", "scp", "ship", "ehi"}
VECTOR_KEYS = ["u10", "v10", "u850", "v850", "u500", "v500", "u250", "v250"]
THREAT_NAMES = ["None", "Thunder", "Marginal", "Slight", "Enhanced", "Moderate"]


def _check_model(model):
    if model not in config.MODELS:
        raise FetchError(f"Unknown model '{model}'", 400)


class RateBudget:
    """Paces Open-Meteo requests to stay inside the free-tier call budgets."""

    def __init__(self):
        self.events = deque()
        self.lock = threading.Lock()

    @staticmethod
    def weight(n_locations, n_vars, days=config.FORECAST_DAYS, models=1, members=1):
        return n_locations * max(1.0, n_vars / 10.0) * max(1.0, days / 14.0) * models * members

    def usage(self):
        now = time.time()
        with self.lock:
            return {
                "minute": round(sum(w for t, w in self.events if t > now - 60)),
                "hour": round(sum(w for t, w in self.events if t > now - 3600)),
                "day": round(sum(w for _, w in self.events)),
            }

    def acquire(self, weight):
        if config.OPEN_METEO_KEY or config.DEMO_MODE:
            return
        while True:
            with self.lock:
                now = time.time()
                while self.events and self.events[0][0] < now - 86400:
                    self.events.popleft()
                minute = [(t, w) for t, w in self.events if t > now - 60]
                used_min = sum(w for _, w in minute)
                used_hour = sum(w for t, w in self.events if t > now - 3600)
                used_day = sum(w for _, w in self.events)
                if used_day + weight > config.RATE_PER_DAY:
                    raise FetchError("Open-Meteo free daily call budget reached — wait, or set OPEN_METEO_API_KEY", 429)
                if used_hour + weight > config.RATE_PER_HOUR:
                    raise FetchError("Open-Meteo free hourly call budget reached — try again later", 429)
                if used_min + weight <= config.RATE_PER_MIN or not minute:
                    self.events.append((now, weight))
                    return
                wait = minute[0][0] + 60 - now
            time.sleep(min(max(wait, 0.5), 5.0))


budget = RateBudget()


def _om_url(base, params):
    if config.OPEN_METEO_KEY:
        params = dict(params, apikey=config.OPEN_METEO_KEY)
    return base + "?" + urllib.parse.urlencode(params, safe=",")


# ----------------------------------------------------------------------------------------
# Grid
# ----------------------------------------------------------------------------------------

def _fetch_chunk(model, coords):
    params = {
        "latitude": ",".join(f"{c[0]:.3f}" for c in coords),
        "longitude": ",".join(f"{c[1]:.3f}" for c in coords),
        "hourly": ",".join(config.GRID_VARS),
        "models": model,
        "forecast_days": config.FORECAST_DAYS,
        "timezone": "GMT",
        "timeformat": "unixtime",
        "wind_speed_unit": "ms",
    }
    budget.acquire(RateBudget.weight(len(coords), len(config.GRID_VARS)))
    data = fetch_json(_om_url(config.OPEN_METEO_FORECAST, params), timeout=60)
    if isinstance(data, dict):
        if data.get("error"):
            raise FetchError(data.get("reason", "Open-Meteo error"))
        data = [data]
    return data


def _load_grid(model, region):
    g = build_grid(region, config.GRID_MAX_POINTS)
    coords = g["coords"]
    t0 = time.time()
    if config.DEMO_MODE:
        results = demo.grid_response(coords, config.GRID_VARS)
    else:
        chunks = [coords[i:i + config.GRID_CHUNK] for i in range(0, len(coords), config.GRID_CHUNK)]
        results = [None] * len(coords)
        errors = []
        with ThreadPoolExecutor(max_workers=3) as ex:
            futs = {ex.submit(_fetch_chunk, model, ch): i for i, ch in enumerate(chunks)}
            for fut, ci in futs.items():
                try:
                    part = fut.result()
                except FetchError as e:
                    errors.append(str(e))
                    continue
                for j, item in enumerate(part):
                    results[ci * config.GRID_CHUNK + j] = item
        if all(r is None for r in results):
            raise FetchError("Model grid unavailable: " + (errors[0] if errors else "no data"))
        if errors:
            log.warning("grid %s/%s: %d chunk errors (%s)", model, region, len(errors), errors[0])

    times = None
    for r in results:
        if r and r.get("hourly", {}).get("time"):
            times = r["hourly"]["time"]
            break
    if not times:
        raise FetchError("Model returned no time axis")
    nt = len(times)

    # Derived parameters for every hour: hours[h][param] -> list over points
    keys = list(PARAMS) + VECTOR_KEYS
    hours = []
    for hi in range(nt):
        cols = {k: [] for k in keys}
        for r in results:
            if r is None:
                for k in keys:
                    cols[k].append(None)
                continue
            d = compute_point(r.get("hourly", {}), hi, r.get("elevation") or 0.0)
            for k in keys:
                v = d.get(k)
                if v is not None:
                    v = round(v, 2 if k in ROUND2 else 1)
                cols[k].append(v)
        hours.append(cols)
    available = [k for k in PARAMS if any(v is not None for h in hours[:12] for v in h[k])]
    log.info("grid %s/%s: %d points x %d h in %.1fs", model, region, len(coords), nt, time.time() - t0)
    return {
        "model": model, "region": region, "grid": {k: g[k] for k in ("step", "lat0", "lon0", "nlat", "nlon")},
        "idx": [iy * g["nlon"] + ix for iy, ix in g["points"]],
        "coords": coords, "times": times, "hours": hours, "fetched": int(time.time()),
        "available": available,
    }


def _disk_path(model, region):
    return config.CACHE_DIR / f"grid-{model}-{region}-{'x' if config.GRID_EXTENDED else 'c'}{config.GRID_MAX_POINTS}.json.gz"


def _load_grid_cached(model, region):
    """Grid loader with a disk cache so restarts do not re-spend the API budget."""
    if config.DEMO_MODE:
        return _load_grid(model, region)
    path = _disk_path(model, region)
    try:
        if path.exists() and time.time() - path.stat().st_mtime < config.GRID_TTL:
            with gzip.open(path, "rt") as f:
                g = json.load(f)
            g["coords"] = [tuple(c) for c in g["coords"]]
            log.info("grid %s/%s loaded from disk cache", model, region)
            return g
    except (OSError, ValueError) as e:
        log.warning("disk cache read failed (%s)", e)
    g = _load_grid(model, region)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with gzip.open(tmp, "wt") as f:
            json.dump(g, f, separators=(",", ":"))
        tmp.replace(path)
    except OSError as e:
        log.warning("disk cache write failed (%s)", e)
    return g


def get_grid(model, region):
    _check_model(model)
    if region != "ALL" and region not in config.COUNTRIES:
        raise FetchError(f"Unknown region '{region}'", 400)
    # expire relative to the fetch time, so disk-cached grids are not kept beyond GRID_TTL
    ttl = lambda g: max(60, config.GRID_TTL - (time.time() - g["fetched"]))  # noqa: E731
    return cache.get_or_load(("grid", model, region), ttl, lambda: _load_grid_cached(model, region))


def grid_hour(model, region, hour):
    g = get_grid(model, region)
    hour = max(0, min(int(hour), len(g["times"]) - 1))
    return {
        "model": model, "region": region, "grid": g["grid"], "idx": g["idx"], "times": g["times"],
        "hour": hour, "fetched": g["fetched"], "available": g["available"],
        "fields": g["hours"][hour],
    }


def grid_timeline(model, region):
    """Per-hour maxima across the region (for the time-slider sparkline)."""
    g = get_grid(model, region)
    out = {"times": g["times"], "threat": [], "cape": [], "scp": []}
    for h in g["hours"]:
        for k in ("threat", "cape", "scp"):
            vals = [v for v in h[k] if v is not None]
            out[k].append(max(vals) if vals else 0)
    return out


def _day_slices(times):
    days = {}
    for i, t in enumerate(times):
        d = time.strftime("%Y-%m-%d", time.gmtime(t))
        days.setdefault(d, []).append(i)
    return days


def outlook(model, region):
    """Automated convective outlook per UTC day plus ranked chase targets."""
    key = ("outlook", model, region)
    cached = cache.get(key)
    if cached:
        return cached
    g = get_grid(model, region)
    days = _day_slices(g["times"])
    npts = len(g["coords"])
    result = {"model": model, "region": region, "grid": g["grid"], "idx": g["idx"], "days": []}
    for day, hrs in days.items():
        cat = [0] * npts
        peak = [None] * npts
        for p in range(npts):
            best, best_h, best_score = 0, None, -1
            for hi in hrs:
                f = g["hours"][hi]
                lv = f["threat"][p] or 0
                score = lv * 10 + (f["scp"][p] or 0) + 2 * (f["stp"][p] or 0) + (f["ship"][p] or 0)
                if score > best_score:
                    best, best_h, best_score = lv, hi, score
            cat[p] = best
            peak[p] = (best_score, best_h)
        # per-country summary
        countries = {}
        for p, (lat, lon) in enumerate(g["coords"]):
            code = country_at(lat, lon)
            if not code:
                continue
            c = countries.setdefault(code, {"max": 0, "n": 0, "sev": 0, "cape": 0, "shr6": 0})
            c["n"] += 1
            c["max"] = max(c["max"], cat[p])
            if cat[p] >= 3:
                c["sev"] += 1
            hi = peak[p][1]
            if hi is not None:
                f = g["hours"][hi]
                c["cape"] = max(c["cape"], f["cape"][p] or 0)
                c["shr6"] = max(c["shr6"], f["shr6"][p] or 0)
        summary = []
        for code, c in sorted(countries.items(), key=lambda kv: -kv[1]["max"]):
            summary.append({
                "code": code, "name": config.COUNTRIES[code]["name"], "level": c["max"],
                "label": THREAT_NAMES[c["max"]], "severe_pct": round(100 * c["sev"] / max(c["n"], 1)),
                "max_cape": round(c["cape"]), "max_shear": round(c["shr6"], 1),
                "text": _summary_text(c),
            })
        # chase targets: best-scoring points, de-duplicated by distance
        ranked = sorted(range(npts), key=lambda p: -(peak[p][0] or 0))
        targets = []
        for p in ranked:
            score, hi = peak[p]
            if hi is None or score < 20:
                break
            lat, lon = g["coords"][p]
            if any(abs(lat - t["lat"]) < 1.2 and abs(lon - t["lon"]) < 1.8 for t in targets):
                continue
            f = g["hours"][hi]
            targets.append({
                "lat": lat, "lon": lon, "score": round(score, 1), "hour": hi, "time": g["times"][hi],
                "level": f["threat"][p], "label": THREAT_NAMES[f["threat"][p] or 0],
                "place": (nearest_city(lat, lon) or {}).get("label"), "country": country_at(lat, lon),
                "cape": f["cape"][p], "shr6": f["shr6"][p], "srh1": f["srh1"][p], "srh3": f["srh3"][p],
                "stp": f["stp"][p], "scp": f["scp"][p], "ship": f["ship"][p], "lcl": f["lcl"][p],
            })
            if len(targets) >= 10:
                break
        result["days"].append({"date": day, "hours": [hrs[0], hrs[-1]], "category": cat, "countries": summary, "targets": targets})
    cache.set(key, result, 600)
    return result


def _summary_text(c):
    lvl = c["max"]
    if lvl == 0:
        return "No significant convection expected."
    parts = [f"Peak CAPE ~{round(c['cape'], -1):.0f} J/kg, deep-layer shear ~{c['shr6']:.0f} m/s."]
    if lvl >= 5:
        parts.append("High-end event possible: intense supercells, very large hail, significant tornadoes and/or widespread wind damage.")
    elif lvl == 4:
        parts.append("Organised severe storms likely: supercells with large hail, damaging winds, tornadoes possible.")
    elif lvl == 3:
        parts.append("Scattered severe storms possible: large hail and damaging gusts.")
    elif lvl == 2:
        parts.append("Isolated strong storms; marginal hail/wind risk.")
    else:
        parts.append("General thunderstorms.")
    return " ".join(parts)


# ----------------------------------------------------------------------------------------
# Point products
# ----------------------------------------------------------------------------------------

def _check_latlon(lat, lon):
    lat, lon = float(lat), float(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise FetchError("Invalid coordinates", 400)
    return round(lat, 3), round(lon, 3)


def _load_point(model, lat, lon):
    lv = config.PRESSURE_LEVELS_SOUNDING
    hourly = list(config.POINT_SURFACE_VARS)
    for p in lv:
        hourly += [f"temperature_{p}hPa", f"relative_humidity_{p}hPa", f"wind_speed_{p}hPa",
                   f"wind_direction_{p}hPa", f"geopotential_height_{p}hPa"]
    if config.DEMO_MODE:
        return demo.point_response(lat, lon, lv)
    params = {
        "latitude": lat, "longitude": lon, "hourly": ",".join(hourly), "models": model,
        "forecast_days": config.FORECAST_DAYS, "timezone": "GMT", "timeformat": "unixtime",
        "wind_speed_unit": "ms",
    }
    budget.acquire(RateBudget.weight(1, len(hourly)))
    data = fetch_json(_om_url(config.OPEN_METEO_FORECAST, params), timeout=45)
    if data.get("error"):
        raise FetchError(data.get("reason", "Open-Meteo error"))
    return data


def _load_sounding(model, lat, lon):
    data = _load_point(model, lat, lon)
    times = data.get("hourly", {}).get("time", [])
    series = []
    analyses = {}
    for i in range(len(times)):
        prof = profile_from_openmeteo(data, i, config.PRESSURE_LEVELS_SOUNDING)
        if prof is None:
            series.append(None)
            continue
        ix, plot = analyze(prof)
        analyses[i] = (ix, plot)
        series.append({k: ix.get(k) for k in ("mlcape", "mucape", "sbcape", "mlcin", "srh1", "esrh", "ebwd", "shr6", "stp_eff", "scp", "ship", "hazard")})
    return {"data": data, "times": times, "series": series, "analyses": analyses}


def sounding(model, lat, lon, hour):
    _check_model(model)
    lat, lon = _check_latlon(lat, lon)
    s = cache.get_or_load(("snd", model, lat, lon), config.POINT_TTL, lambda: _load_sounding(model, lat, lon))
    if not s["analyses"]:
        raise FetchError(f"{config.MODELS[model]['name']} has no upper-air data at this point", 404)
    hour = max(0, min(int(hour), len(s["times"]) - 1))
    if hour not in s["analyses"]:
        hour = min(s["analyses"], key=lambda k: abs(k - hour))
    ix, plot = s["analyses"][hour]
    h = s["data"]["hourly"]
    sfc = {k: (h.get(k) or [None] * (hour + 1))[hour] for k in config.POINT_SURFACE_VARS}
    return {
        "model": model, "lat": lat, "lon": lon, "elevation": s["data"].get("elevation"),
        "place": nearest_city(lat, lon), "country": country_at(lat, lon),
        "times": s["times"], "hour": hour, "indices": ix, "plot": plot, "surface": sfc,
        "series": s["series"],
    }


def meteogram(models, lat, lon):
    lat, lon = _check_latlon(lat, lon)
    models = [m for m in models if m in config.MODELS][:8] or ["best_match"]

    def load():
        if config.DEMO_MODE:
            return demo.meteogram_response(lat, lon, models, config.METEOGRAM_VARS)
        params = {
            "latitude": lat, "longitude": lon, "hourly": ",".join(config.METEOGRAM_VARS),
            "models": ",".join(models), "forecast_days": 7, "timezone": "GMT",
            "timeformat": "unixtime", "wind_speed_unit": "ms",
        }
        budget.acquire(RateBudget.weight(1, len(config.METEOGRAM_VARS), days=7, models=len(models)))
        return fetch_json(_om_url(config.OPEN_METEO_FORECAST, params), timeout=45)

    data = cache.get_or_load(("mg", tuple(models), lat, lon), config.POINT_TTL, load)
    h = data.get("hourly", {})
    series = {}
    for m in models:
        series[m] = {}
        for v in config.METEOGRAM_VARS:
            arr = h.get(f"{v}_{m}") if len(models) > 1 else h.get(v)
            if arr is None:
                arr = h.get(v) if len(models) == 1 else None
            series[m][v] = arr
    return {"lat": lat, "lon": lon, "times": h.get("time", []), "models": models, "series": series,
            "place": nearest_city(lat, lon)}


def point_forecast(model, lat, lon):
    """7-day point forecast (hourly + daily) for the Ventusky-style forecast panel."""
    _check_model(model)
    lat, lon = _check_latlon(lat, lon)

    def load():
        if config.DEMO_MODE:
            return demo.forecast_response(lat, lon, config.FORECAST_HOURLY_VARS, config.FORECAST_DAILY_VARS)
        params = {
            "latitude": lat, "longitude": lon, "models": model,
            "hourly": ",".join(config.FORECAST_HOURLY_VARS), "daily": ",".join(config.FORECAST_DAILY_VARS),
            "forecast_days": 7, "timezone": "auto", "timeformat": "unixtime", "wind_speed_unit": "ms",
        }
        n_vars = len(config.FORECAST_HOURLY_VARS) + len(config.FORECAST_DAILY_VARS)
        budget.acquire(RateBudget.weight(1, n_vars, days=7))
        data = fetch_json(_om_url(config.OPEN_METEO_FORECAST, params), timeout=45)
        if data.get("error"):
            raise FetchError(data.get("reason", "Open-Meteo error"))
        return data

    data = cache.get_or_load(("fc", model, lat, lon), config.POINT_TTL, load)
    return {
        "model": model, "lat": lat, "lon": lon, "elevation": data.get("elevation"),
        "timezone": data.get("timezone"), "utc_offset": data.get("utc_offset_seconds", 0),
        "hourly": data.get("hourly", {}), "daily": data.get("daily", {}),
        "place": nearest_city(lat, lon), "country": country_at(lat, lon),
    }


def _percentile(sorted_vals, q):
    if not sorted_vals:
        return None
    k = (len(sorted_vals) - 1) * q
    f = math.floor(k)
    c = min(f + 1, len(sorted_vals) - 1)
    return sorted_vals[f] + (sorted_vals[c] - sorted_vals[f]) * (k - f)


PROB_THRESHOLDS = {
    "cape": [500, 1000, 2000],
    "precipitation": [1, 5, 10],
    "wind_gusts_10m": [15, 20, 25],
    "temperature_2m": [25, 30],
}


def ensemble(model, lat, lon):
    lat, lon = _check_latlon(lat, lon)
    if model not in config.ENSEMBLE_MODELS:
        raise FetchError("Unknown ensemble", 400)

    def load():
        if config.DEMO_MODE:
            return demo.ensemble_response(lat, lon, config.ENSEMBLE_VARS)
        params = {
            "latitude": lat, "longitude": lon, "hourly": ",".join(config.ENSEMBLE_VARS),
            "models": model, "forecast_days": 7, "timezone": "GMT", "timeformat": "unixtime",
            "wind_speed_unit": "ms",
        }
        budget.acquire(RateBudget.weight(1, len(config.ENSEMBLE_VARS), days=7, members=4))
        return fetch_json(_om_url(config.OPEN_METEO_ENSEMBLE, params), timeout=60)

    data = cache.get_or_load(("ens", model, lat, lon), config.POINT_TTL, load)
    h = data.get("hourly", {})
    times = h.get("time", [])
    out = {"model": model, "name": config.ENSEMBLE_MODELS[model], "lat": lat, "lon": lon, "times": times,
           "vars": {}, "place": nearest_city(lat, lon)}
    for v in config.ENSEMBLE_VARS:
        members = [arr for k, arr in h.items() if (k == v or k.startswith(v + "_member")) and arr]
        if not members:
            continue
        stats = {"p10": [], "p25": [], "p50": [], "p75": [], "p90": [], "max": [], "prob": {str(t): [] for t in PROB_THRESHOLDS.get(v, [])}}
        for i in range(len(times)):
            vals = sorted(m[i] for m in members if i < len(m) and m[i] is not None)
            for q, key in ((0.1, "p10"), (0.25, "p25"), (0.5, "p50"), (0.75, "p75"), (0.9, "p90")):
                x = _percentile(vals, q)
                stats[key].append(None if x is None else round(x, 1))
            stats["max"].append(vals[-1] if vals else None)
            for t in PROB_THRESHOLDS.get(v, []):
                stats["prob"][str(t)].append(round(100 * sum(1 for x in vals if x >= t) / len(vals)) if vals else None)
        stats["members"] = len(members)
        out["vars"][v] = stats
    if not out["vars"]:
        raise FetchError("Ensemble returned no data", 502)
    return out
