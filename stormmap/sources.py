"""Observation feeds: RainViewer radar mosaic, MeteoAlarm warnings, geocoding."""

import calendar
import re
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

from . import config, demo
from .net import FetchError, TTLCache, cache, fetch_bytes, fetch_json

tile_cache = TTLCache(max_items=4000)

_PATH_RE = re.compile(r"^/v2/(radar|satellite)/[A-Za-z0-9_\-]+$")
_DEMO_PATH_RE = re.compile(r"^/demo/(\d+)$")


def radar_frames():
    if config.DEMO_MODE:
        times = demo.radar_times()
        return {"host": "", "demo": True, "radar": [{"time": t, "path": f"/demo/{t}"} for t in times],
                "nowcast": [], "satellite": [], "scheme": 2}

    def load():
        data = fetch_json(config.RAINVIEWER_MAPS, timeout=15)
        host = data.get("host", "")
        if not host.startswith("https://") or not urllib.parse.urlsplit(host).netloc.endswith("rainviewer.com"):
            raise FetchError("Unexpected radar host")
        radar = data.get("radar", {})
        return {
            "host": host, "demo": False,
            "radar": radar.get("past", []), "nowcast": radar.get("nowcast", []),
            "satellite": data.get("satellite", {}).get("infrared", []),
            "generated": data.get("generated"), "scheme": 2,
        }

    return cache.get_or_load(("rv-maps",), 60, load)


def radar_tile(path, z, x, y, size=256, color=2):
    """Proxy a RainViewer tile so the browser can read its pixels (same-origin) for cell tracking."""
    z, x, y, size, color = int(z), int(x), int(y), int(size), int(color)
    if not (0 <= z <= 12 and 0 <= x < 2 ** z and 0 <= y < 2 ** z) or size not in (256, 512) or not 0 <= color <= 8:
        raise FetchError("Bad tile request", 400)
    key = (path, z, x, y, size, color)
    hit = tile_cache.get(key)
    if hit is not None:
        return hit
    m = _DEMO_PATH_RE.match(path)
    if config.DEMO_MODE and m:
        body = demo.radar_tile(int(m.group(1)), z, x, y, size)
    else:
        if not _PATH_RE.match(path):
            raise FetchError("Bad tile path", 400)
        host = radar_frames()["host"]
        url = f"{host}{path}/{size}/{z}/{x}/{y}/{color}/1_1.png"
        body, ctype = fetch_bytes(url, timeout=15, retries=1)
        if not ctype.startswith("image/"):
            raise FetchError("Radar tile unavailable", 502)
    tile_cache.set(key, body, 1800)
    return body


# ----------------------------------------------------------------------------------------
# MeteoAlarm
# ----------------------------------------------------------------------------------------

LEVEL_COLORS = {1: "green", 2: "yellow", 3: "orange", 4: "red"}


def _param(info, name):
    for p in info.get("parameter", []) or []:
        if p.get("valueName") == name:
            return p.get("value", "")
    return ""


def _pick_info(infos):
    for info in infos:
        if str(info.get("language", "")).lower().startswith("en"):
            return info
    return infos[0] if infos else {}


def _parse_meteoalarm(code, data):
    now = time.time()
    out = []
    for w in data.get("warnings", []) or []:
        alert = w.get("alert", {})
        info = _pick_info(alert.get("info", []) or [])
        if not info:
            continue
        level_raw = _param(info, "awareness_level")
        type_raw = _param(info, "awareness_type")
        try:
            level = int(level_raw.split(";")[0])
        except (ValueError, IndexError):
            level = {"Minor": 1, "Moderate": 2, "Severe": 3, "Extreme": 4}.get(info.get("severity"), 1)
        wtype = type_raw.split(";")[-1].strip() if type_raw else info.get("event", "")
        expires = info.get("expires")
        try:
            if expires and calendar.timegm(time.strptime(expires[:19], "%Y-%m-%dT%H:%M:%S")) < now - 86400:
                continue
        except ValueError:
            pass
        areas = [a.get("areaDesc", "") for a in info.get("area", []) or []]
        out.append({
            "country": code, "level": level, "color": LEVEL_COLORS.get(level, "yellow"),
            "type": wtype, "event": info.get("event", ""), "headline": info.get("headline", ""),
            "description": (info.get("description") or "")[:600],
            "onset": info.get("onset") or info.get("effective"), "expires": expires,
            "areas": areas[:12], "n_areas": len(areas), "severity": info.get("severity"),
        })
    return out


def _load_country_warnings(code):
    slug = config.COUNTRIES[code]["meteoalarm"]
    data = fetch_json(config.METEOALARM_FEED.format(slug=slug), timeout=20)
    return _parse_meteoalarm(code, data)


def warnings():
    def load():
        codes = [c for c, v in config.COUNTRIES.items() if v["meteoalarm"]]
        result = {"warnings": [], "status": {}}
        if config.DEMO_MODE:
            result["warnings"] = [
                {"country": "PL", "level": 3, "color": "orange", "type": "Thunderstorm", "event": "Severe thunderstorms",
                 "headline": "Orange thunderstorm warning", "description": "Demo warning: thunderstorms with hail up to 4 cm and gusts to 100 km/h.",
                 "onset": None, "expires": None, "areas": ["lubelskie", "podkarpackie"], "n_areas": 2, "severity": "Severe"},
                {"country": "RO", "level": 2, "color": "yellow", "type": "Thunderstorm", "event": "Thunderstorms",
                 "headline": "Yellow code: instability", "description": "Demo warning: heavy showers and lightning.",
                 "onset": None, "expires": None, "areas": ["Moldova"], "n_areas": 1, "severity": "Moderate"},
            ]
            for c in codes:
                result["status"][c] = "demo"
            return result
        with ThreadPoolExecutor(max_workers=4) as ex:
            futs = {c: ex.submit(_load_country_warnings, c) for c in codes}
            for c, f in futs.items():
                try:
                    ws = f.result()
                    result["warnings"].extend(ws)
                    result["status"][c] = "ok"
                except FetchError as e:
                    result["status"][c] = f"error: {e}"[:160]
        for c, v in config.COUNTRIES.items():
            if not v["meteoalarm"]:
                result["status"][c] = "no MeteoAlarm feed"
        result["warnings"].sort(key=lambda w: (-w["level"], w["country"]))
        return result

    return cache.get_or_load(("warnings",), 600, load)


def geocode(q):
    q = (q or "").strip()
    if len(q) < 2:
        return {"results": []}

    def load():
        if config.DEMO_MODE:
            from .geo import cities
            ql = q.lower()
            return {"results": [{"name": n, "country_code": c, "latitude": la, "longitude": lo}
                                for n, c, la, lo in cities() if ql in n.lower()][:10]}
        url = config.OPEN_METEO_GEOCODE + "?" + urllib.parse.urlencode({"name": q, "count": 20, "language": "en", "format": "json"})
        data = fetch_json(url, timeout=10)
        res = [r for r in data.get("results", []) or [] if r.get("country_code") in config.COUNTRIES]
        return {"results": [{"name": r.get("name"), "country_code": r.get("country_code"), "admin1": r.get("admin1"),
                             "latitude": r.get("latitude"), "longitude": r.get("longitude")} for r in res[:10]]}

    return cache.get_or_load(("geo", q.lower()), 86400, load)
