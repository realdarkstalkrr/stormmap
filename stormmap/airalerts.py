"""Ukrainian air-raid alerts (alerts.in.ua) and oblast boundaries.

* Alerts: https://api.alerts.in.ua — requires a free token (request it from the service);
  set ALERTS_IN_UA_TOKEN. Polled at most every 30 s (their recommended limit).
* Oblast boundaries: geoBoundaries (open data, no key), downloaded once and cached on disk.
  Without them the browser falls back to markers at the oblast centres.
"""

import gzip
import json
import logging
import os
import time

from . import config
from .net import FetchError, cache, fetch_json

log = logging.getLogger("stormmap.airalerts")

ALERTS_TOKEN = os.environ.get("ALERTS_IN_UA_TOKEN", "")
ALERTS_URL = os.environ.get("ALERTS_IN_UA_URL", "https://api.alerts.in.ua/v1/alerts/active.json")
GEOB_API = "https://www.geoboundaries.org/api/current/gbOpen/UKR/ADM1/"
OBLASTS_FILE = os.environ.get("STORMMAP_OBLASTS_FILE", "")

# key, Ukrainian name, English name, centre (lat, lon), English name stems for matching boundary files
OBLASTS = [
    ("kyiv-city", "м. Київ", "Kyiv City", 50.45, 30.52, ("kyiv city", "kiev city", "city of kyiv", "kyiv (city)", "kyiv, city")),
    ("sevastopol", "м. Севастополь", "Sevastopol", 44.60, 33.52, ("sevastop",)),
    ("crimea", "Автономна Республіка Крим", "Crimea", 45.00, 34.10, ("crimea", "krym")),
    ("vinnytsia", "Вінницька область", "Vinnytsia", 49.10, 28.60, ("vinnyts", "vinnits")),
    ("volyn", "Волинська область", "Volyn", 51.10, 25.10, ("volyn",)),
    ("dnipro", "Дніпропетровська область", "Dnipropetrovsk", 48.40, 34.90, ("dnipro",)),
    ("donetsk", "Донецька область", "Donetsk", 48.20, 37.70, ("donets",)),
    ("zhytomyr", "Житомирська область", "Zhytomyr", 50.60, 28.40, ("zhytom",)),
    ("zakarpattia", "Закарпатська область", "Zakarpattia", 48.40, 23.20, ("zakarpat", "transcarpath")),
    ("zaporizhzhia", "Запорізька область", "Zaporizhzhia", 47.40, 35.70, ("zapor",)),
    ("ivano-frankivsk", "Івано-Франківська область", "Ivano-Frankivsk", 48.70, 24.60, ("ivano",)),
    ("kyiv", "Київська область", "Kyiv Oblast", 50.30, 30.60, ("kyiv", "kiev", "kyivs")),
    ("kirovohrad", "Кіровоградська область", "Kirovohrad", 48.50, 32.30, ("kirovohrad", "kirovograd", "kropyvnyts")),
    ("luhansk", "Луганська область", "Luhansk", 48.90, 39.10, ("luhansk", "lugansk")),
    ("lviv", "Львівська область", "Lviv", 49.70, 24.00, ("lviv", "lvov")),
    ("mykolaiv", "Миколаївська область", "Mykolaiv", 47.30, 31.90, ("mykola", "nikola")),
    ("odesa", "Одеська область", "Odesa", 46.70, 30.10, ("odes",)),
    ("poltava", "Полтавська область", "Poltava", 49.60, 33.90, ("poltav",)),
    ("rivne", "Рівненська область", "Rivne", 51.00, 26.30, ("rivne", "rovno")),
    ("sumy", "Сумська область", "Sumy", 50.90, 34.00, ("sumy", "sums")),
    ("ternopil", "Тернопільська область", "Ternopil", 49.40, 25.60, ("ternop",)),
    ("kharkiv", "Харківська область", "Kharkiv", 49.60, 36.50, ("kharkiv", "kharkov")),
    ("kherson", "Херсонська область", "Kherson", 46.70, 33.50, ("kherson",)),
    ("khmelnytskyi", "Хмельницька область", "Khmelnytskyi", 49.50, 26.90, ("khmel",)),
    ("cherkasy", "Черкаська область", "Cherkasy", 49.20, 31.40, ("cherkas",)),
    ("chernivtsi", "Чернівецька область", "Chernivtsi", 48.30, 25.90, ("chernivt", "chernovt")),
    ("chernihiv", "Чернігівська область", "Chernihiv", 51.30, 32.00, ("chernih", "chernig")),
]
BY_KEY = {o[0]: o for o in OBLASTS}
TYPE_NAMES = {
    "air_raid": ("Air raid", "Повітряна тривога"), "artillery_shelling": ("Artillery shelling", "Загроза артобстрілу"),
    "urban_fights": ("Urban fighting", "Вуличні бої"), "chemical": ("Chemical threat", "Хімічна загроза"),
    "nuclear": ("Nuclear threat", "Радіаційна загроза"),
}


def _norm(s):
    return (s or "").lower().replace("’", "'").replace("ʼ", "'").strip()


def oblast_key_from_uk(name):
    """Map an alerts.in.ua oblast title (Ukrainian) to our key."""
    n = _norm(name)
    for key, uk, *_ in OBLASTS:
        if _norm(uk) == n:
            return key
    first = n.split(" ")[0] if n else ""
    for key, uk, *_ in OBLASTS:
        if first and _norm(uk).startswith(first) and not uk.startswith("м."):
            return key
    return None


def oblast_key_from_en(name):
    n = _norm(name)
    if n in ("kyiv", "kiev", "київ", "kyiv city", "m. kyiv"):
        return "kyiv-city"
    for key, _uk, en, _la, _lo, stems in OBLASTS:  # city entries first
        if any(st in n for st in stems):
            if key == "kyiv" and "city" in n:
                return "kyiv-city"
            return key
    return None


# ----------------------------------------------------------------------------------------
# Oblast boundaries
# ----------------------------------------------------------------------------------------

def _load_oblasts():
    path = config.CACHE_DIR / "ukr-adm1.geojson.gz"
    src = None
    if OBLASTS_FILE:
        with open(OBLASTS_FILE, encoding="utf-8") as f:
            src = json.load(f)
    elif path.exists():
        with gzip.open(path, "rt", encoding="utf-8") as f:
            src = json.load(f)
    elif not config.DEMO_MODE:
        meta = fetch_json(GEOB_API, timeout=30)
        url = meta.get("simplifiedGeometryGeoJSON") or meta.get("gjDownloadURL")
        if not url:
            raise FetchError("geoBoundaries: no download URL")
        src = fetch_json(url, timeout=60)
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(src, f)
    if not src:
        return None
    feats = []
    for f in src.get("features", []):
        p = f.get("properties", {})
        name = p.get("shapeName") or p.get("name") or p.get("NAME_1") or p.get("name_en") or ""
        key = oblast_key_from_en(name) or oblast_key_from_uk(p.get("name_uk") or p.get("name") or "")
        if not key:
            continue
        o = BY_KEY[key]
        feats.append({"type": "Feature", "geometry": f.get("geometry"),
                      "properties": {"key": key, "uk": o[1], "en": o[2]}})
    return {"type": "FeatureCollection", "features": feats}


def oblasts():
    def load():
        try:
            geo = _load_oblasts()
        except (FetchError, OSError, ValueError) as e:
            log.warning("oblast boundaries unavailable: %s", e)
            geo = None
        return {"geojson": geo, "centres": [{"key": k, "uk": uk, "en": en, "lat": la, "lon": lo} for k, uk, en, la, lo, _ in OBLASTS]}
    return cache.get_or_load(("oblasts",), 86400, load)


# ----------------------------------------------------------------------------------------
# Active alerts
# ----------------------------------------------------------------------------------------

def _parse(data):
    out = []
    for a in data.get("alerts", []) or []:
        if a.get("finished_at"):
            continue
        key = oblast_key_from_uk(a.get("location_oblast") or a.get("location_title"))
        atype = a.get("alert_type") or "air_raid"
        names = TYPE_NAMES.get(atype, (atype, atype))
        out.append({
            "oblast": key, "level": a.get("location_type") or "oblast",
            "title": a.get("location_title") or "", "oblast_title": a.get("location_oblast") or "",
            "type": atype, "type_en": names[0], "type_uk": names[1],
            "started": a.get("started_at"), "notes": a.get("notes"),
        })
    return out


def _demo_alerts():
    t = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 1500))
    return [
        {"oblast": "kharkiv", "level": "oblast", "title": "Харківська область", "oblast_title": "Харківська область",
         "type": "air_raid", "type_en": "Air raid", "type_uk": "Повітряна тривога", "started": t, "notes": None},
        {"oblast": "sumy", "level": "raion", "title": "Шосткинський район", "oblast_title": "Сумська область",
         "type": "air_raid", "type_en": "Air raid", "type_uk": "Повітряна тривога", "started": t, "notes": None},
        {"oblast": "donetsk", "level": "oblast", "title": "Донецька область", "oblast_title": "Донецька область",
         "type": "air_raid", "type_en": "Air raid", "type_uk": "Повітряна тривога", "started": t, "notes": None},
    ]


def active():
    """Active alerts summarised per oblast. status: ok | demo | disabled | error."""
    def load():
        if config.DEMO_MODE:
            return {"status": "demo", "source": "demo", "alerts": _demo_alerts(), "updated": int(time.time())}
        if not ALERTS_TOKEN:
            return {"status": "disabled", "source": "alerts.in.ua", "alerts": [], "updated": int(time.time()),
                    "note": "Set ALERTS_IN_UA_TOKEN to show live air-raid alerts."}
        try:
            data = fetch_json(ALERTS_URL, timeout=15, retries=1, headers={"Authorization": f"Bearer {ALERTS_TOKEN}"})
            return {"status": "ok", "source": "alerts.in.ua", "alerts": _parse(data), "updated": int(time.time())}
        except FetchError as e:
            return {"status": "error", "source": "alerts.in.ua", "alerts": [], "updated": int(time.time()), "note": str(e)}

    d = cache.get_or_load(("airalerts",), 30, load)
    per = {}
    for a in d["alerts"]:
        if not a["oblast"]:
            continue
        s = per.setdefault(a["oblast"], {"full": False, "partial": [], "types": set()})
        s["types"].add(a["type"])
        if a["level"] == "oblast":
            s["full"] = True
        else:
            s["partial"].append(a["title"])
    summary = {k: {"full": v["full"], "partial": v["partial"][:8], "types": sorted(v["types"])} for k, v in per.items()}
    return dict(d, oblasts=summary)
