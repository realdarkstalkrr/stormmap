"""Forecaster-approved storm warnings and their distribution via Telegram.

Warnings are drafted in the browser from a tracked storm, reviewed/edited by a human and
published with the admin token (STORMMAP_ADMIN_TOKEN). Published warnings:
  * appear on every viewer's map (GET /api/warn/active),
  * are posted to a Telegram channel (TELEGRAM_CHANNEL) and
  * are sent to bot subscribers whose saved location is inside, or within their chosen
    radius of, the warning polygon.

Subscribers talk to the bot (TELEGRAM_BOT_TOKEN, free from @BotFather):
  /start, send location, /town <name>, /radius <km>, /lang uk|en, /status, /warnings, /stop
Without a bot token everything runs as a dry run (messages are logged, not sent).
"""

import hmac
import json
import logging
import math
import os
import secrets
import threading
import time
import urllib.request

from . import config
from .geo import cities
from .net import FetchError, USER_AGENT

log = logging.getLogger("stormmap.publish")

ADMIN_TOKEN = os.environ.get("STORMMAP_ADMIN_TOKEN", "")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHANNEL = os.environ.get("TELEGRAM_CHANNEL", "")
MAX_BODY = 64 * 1024
SEVERITIES = ("moderate", "severe", "extreme")

_lock = threading.Lock()


def _path(name):
    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if config.DEMO_MODE:  # never mix demo warnings/subscribers with the real ones
        name = "demo-" + name
    return config.CACHE_DIR / name


def _load(name, default):
    try:
        with open(_path(name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def _save(name, obj):
    tmp = _path(name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    tmp.replace(_path(name))


def admin_ok(token):
    expected = ADMIN_TOKEN or ("demo" if config.DEMO_MODE else "")
    return bool(expected) and bool(token) and hmac.compare_digest(str(token), expected)


# ----------------------------------------------------------------------------------------
# Geometry
# ----------------------------------------------------------------------------------------

def _inside(lat, lon, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi:
            inside = not inside
        j = i
    return inside


def distance_to_polygon_km(lat, lon, poly):
    if _inside(lat, lon, poly):
        return 0.0
    kx = 111.32 * math.cos(math.radians(lat))
    ky = 111.32
    best = 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ax, ay = (a[1] - lon) * kx, (a[0] - lat) * ky
        bx, by = (b[1] - lon) * kx, (b[0] - lat) * ky
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy + 1e-12)))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


# ----------------------------------------------------------------------------------------
# Warning store
# ----------------------------------------------------------------------------------------

def _clean_warning(w):
    poly = w.get("polygon")
    if not isinstance(poly, list) or not 3 <= len(poly) <= 300:
        raise FetchError("Warning polygon must have 3–300 points", 400)
    try:
        poly = [[round(float(p[0]), 4), round(float(p[1]), 4)] for p in poly]
    except (TypeError, ValueError, IndexError):
        raise FetchError("Bad polygon coordinates", 400)
    if not all(-90 <= p[0] <= 90 and -180 <= p[1] <= 180 for p in poly):
        raise FetchError("Polygon out of range", 400)
    sev = w.get("severity", "severe")
    if sev not in SEVERITIES:
        raise FetchError("Bad severity", 400)
    now = time.time()
    expires = float(w.get("expires") or now + 3600)
    if not now < expires <= now + 6 * 3600:
        raise FetchError("Expiry must be within the next 6 hours", 400)
    texts = {k: str(w.get(k) or "")[:2000] for k in ("text_uk", "text_en")}
    if not texts["text_uk"] and not texts["text_en"]:
        raise FetchError("Warning text is empty", 400)
    return {
        "polygon": poly, "severity": sev, "expires": int(expires), "created": int(now),
        "title_uk": str(w.get("title_uk") or "")[:200], "title_en": str(w.get("title_en") or "")[:200],
        "text_uk": texts["text_uk"], "text_en": texts["text_en"],
        "cell": str(w.get("cell") or "")[:40], "towns": [str(t)[:80] for t in (w.get("towns") or [])[:40]],
    }


def active_warnings():
    with _lock:
        ws = _load("warnings.json", [])
        now = time.time()
        live = [w for w in ws if w["expires"] > now and not w.get("cancelled")]
        if len(live) != len(ws):
            _save("warnings.json", live)
    return live


def publish(w):
    w = _clean_warning(w)
    with _lock:
        ws = [x for x in _load("warnings.json", []) if x["expires"] > time.time() and not x.get("cancelled")]
        w["id"] = f"SM-{time.strftime('%d%H%M', time.gmtime())}-{secrets.token_hex(2).upper()}"
        ws.append(w)
        _save("warnings.json", ws)
    targets = _match_subscribers(w)
    threading.Thread(target=_broadcast, args=(w, targets), name="tg-broadcast", daemon=True).start()
    return {"id": w["id"], "channel": bool(CHANNEL), "subscribers": len(targets), "dry_run": not BOT_TOKEN}


def cancel(wid):
    with _lock:
        ws = _load("warnings.json", [])
        hit = None
        for w in ws:
            if w.get("id") == wid:
                w["cancelled"] = True
                hit = w
        _save("warnings.json", ws)
    if not hit:
        raise FetchError("Unknown warning id", 404)
    threading.Thread(target=_broadcast_cancel, args=(hit, _match_subscribers(hit)), daemon=True).start()
    return {"id": wid, "cancelled": True}


# ----------------------------------------------------------------------------------------
# Telegram
# ----------------------------------------------------------------------------------------

def _tg(method, payload, timeout=20):
    if not BOT_TOKEN:
        log.info("[telegram dry-run] %s %s", method, json.dumps(payload, ensure_ascii=False)[:300])
        return {"ok": True, "dry_run": True}
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:  # noqa: BLE001 - network errors must not kill the bot thread
        log.warning("telegram %s failed: %s", method, e)
        return {"ok": False}


def send(chat_id, text, **extra):
    return _tg("sendMessage", dict({"chat_id": chat_id, "text": text[:4096], "disable_web_page_preview": True}, **extra))


def _subs():
    return _load("telegram_subscribers.json", {})


def _save_subs(s):
    with _lock:
        _save("telegram_subscribers.json", s)


def _match_subscribers(w):
    out = []
    for cid, s in _subs().items():
        if s.get("lat") is None:
            continue
        if distance_to_polygon_km(s["lat"], s["lon"], w["polygon"]) <= float(s.get("radius", 30)):
            out.append((cid, s.get("lang", "uk")))
    return out


def _warning_text(w, lang):
    t = w["text_uk"] if lang == "uk" and w["text_uk"] else (w["text_en"] or w["text_uk"])
    return t


def _broadcast(w, targets):
    if CHANNEL:
        both = "\n\n".join(x for x in (w["text_uk"], w["text_en"]) if x)
        send(CHANNEL, both)
    for cid, lang in targets:
        send(cid, _warning_text(w, lang))
        time.sleep(0.05)  # stay far below Telegram's 30 msg/s limit


def _broadcast_cancel(w, targets):
    msg = {"uk": "✅ Попередження StormMap скасовано / завершено.", "en": "✅ StormMap warning cancelled / ended."}
    if CHANNEL:
        send(CHANNEL, f"{msg['uk']}\n{msg['en']}\n{w.get('title_uk') or w.get('title_en') or ''}")
    for cid, lang in targets:
        send(cid, msg.get(lang, msg["en"]))
        time.sleep(0.05)


# ---------------- bot conversation ----------------

UK_NAMES = {}


def _uk_names():
    global UK_NAMES
    if not UK_NAMES:
        try:
            with open(config.STATIC_DIR / "data" / "cities_uk.json", encoding="utf-8") as f:
                UK_NAMES = json.load(f)
        except (OSError, ValueError):
            UK_NAMES = {}
    return UK_NAMES


def find_town(q):
    ql = q.strip().lower()
    if not ql:
        return None
    uk = _uk_names()
    for name, cc, la, lo in cities():
        if name.lower() == ql or uk.get(name, "").lower() == ql:
            return name, uk.get(name, name), la, lo
    for name, cc, la, lo in cities():
        if name.lower().startswith(ql) or uk.get(name, "").lower().startswith(ql):
            return name, uk.get(name, name), la, lo
    return None


TXT = {
    "welcome": {
        "uk": "Вітаю! Це бот штормових попереджень StormMap (неофіційний).\n\nНадішліть свою геолокацію кнопкою нижче або напишіть /town <місто>, щоб отримувати попередження про небезпечні грози поблизу.\n\n/radius <км> — радіус (типово 30 км)\n/lang en — English\n/warnings — активні попередження\n/stop — відписатися\n\nОфіційні попередження: Укргідрометцентр, ДСНС. Під час повітряної тривоги — в укриття!",
        "en": "Hi! This is the StormMap severe-storm warning bot (unofficial).\n\nShare your location with the button below or type /town <city> to get warnings about dangerous storms near you.\n\n/radius <km> — radius (default 30 km)\n/lang uk — українська\n/warnings — active warnings\n/stop — unsubscribe\n\nOfficial warnings: Ukrhydrometcenter, State Emergency Service. During an air-raid alert go to a shelter!",
    },
    "saved": {"uk": "✅ Збережено: {place}, радіус {r} км.", "en": "✅ Saved: {place}, radius {r} km."},
    "notown": {"uk": "Не знайшов таке місто. Спробуйте іншу назву або надішліть геолокацію.", "en": "Town not found. Try another name or share your location."},
    "stopped": {"uk": "Ви відписалися. /start — щоб підписатися знову.", "en": "Unsubscribed. /start to subscribe again."},
    "status": {"uk": "Місце: {place}\nРадіус: {r} км\nМова: українська", "en": "Place: {place}\nRadius: {r} km\nLanguage: English"},
    "nostatus": {"uk": "Ви ще не вказали місце. Надішліть геолокацію або /town <місто>.", "en": "No place set yet. Share your location or /town <city>."},
    "nowarn": {"uk": "Зараз немає активних попереджень StormMap.", "en": "No active StormMap warnings right now."},
    "radius": {"uk": "Радіус має бути від 5 до 150 км.", "en": "Radius must be 5–150 km."},
}


def _t(key, lang, **kw):
    return TXT[key].get(lang, TXT[key]["en"]).format(**kw)


def handle_update(u):
    """Process one Telegram update (message) — pure logic, returns list of (chat_id, text, extra)."""
    msg = u.get("message") or {}
    chat = str((msg.get("chat") or {}).get("id") or "")
    if not chat:
        return []
    subs = _subs()
    s = subs.get(chat, {"lang": "uk" if (msg.get("from") or {}).get("language_code", "uk") in ("uk", "ru") else "en", "radius": 30})
    lang = s.get("lang", "uk")
    replies = []
    loc = msg.get("location")
    text = (msg.get("text") or "").strip()
    if loc:
        s.update(lat=round(loc["latitude"], 4), lon=round(loc["longitude"], 4), place=f"{loc['latitude']:.3f}, {loc['longitude']:.3f}")
        subs[chat] = s
        replies.append((chat, _t("saved", lang, place=s["place"], r=s["radius"]), {"reply_markup": {"remove_keyboard": True}}))
    elif text.startswith("/start") or text.startswith("/help"):
        subs[chat] = s
        kb = {"keyboard": [[{"text": "📍 Надіслати геолокацію / Share location", "request_location": True}]], "resize_keyboard": True, "one_time_keyboard": True}
        replies.append((chat, _t("welcome", lang), {"reply_markup": kb}))
    elif text.startswith("/town"):
        town = find_town(text[5:])
        if not town:
            replies.append((chat, _t("notown", lang), {}))
        else:
            s.update(lat=town[2], lon=town[3], place=town[1] if lang == "uk" else town[0])
            subs[chat] = s
            replies.append((chat, _t("saved", lang, place=s["place"], r=s["radius"]), {}))
    elif text.startswith("/radius"):
        try:
            r = float(text[7:].strip())
            if not 5 <= r <= 150:
                raise ValueError
            s["radius"] = r
            subs[chat] = s
            replies.append((chat, _t("saved", lang, place=s.get("place", "—"), r=r), {}))
        except ValueError:
            replies.append((chat, _t("radius", lang), {}))
    elif text.startswith("/lang"):
        lang = "en" if "en" in text[5:].lower() else "uk"
        s["lang"] = lang
        subs[chat] = s
        replies.append((chat, _t("status", lang, place=s.get("place", "—"), r=s.get("radius", 30)), {}))
    elif text.startswith("/status"):
        replies.append((chat, _t("status", lang, place=s["place"], r=s.get("radius", 30)) if s.get("place") else _t("nostatus", lang), {}))
    elif text.startswith("/warnings"):
        ws = active_warnings()
        if not ws:
            replies.append((chat, _t("nowarn", lang), {}))
        for w in ws[:5]:
            replies.append((chat, _warning_text(w, lang), {}))
    elif text.startswith("/stop"):
        subs.pop(chat, None)
        replies.append((chat, _t("stopped", lang), {}))
    _save_subs(subs)
    return replies


def _bot_loop():
    offset = 0
    log.info("Telegram bot polling started")
    while True:
        try:
            res = _tg("getUpdates", {"offset": offset, "timeout": 50, "allowed_updates": ["message"]}, timeout=60)
            for u in res.get("result", []) if res.get("ok") else []:
                offset = max(offset, u["update_id"] + 1)
                for chat, text, extra in handle_update(u):
                    send(chat, text, **extra)
            if not res.get("ok"):
                time.sleep(10)
        except Exception as e:  # noqa: BLE001 - keep the bot alive
            log.warning("bot loop error: %s", e)
            time.sleep(10)


def start_bot():
    if BOT_TOKEN:
        threading.Thread(target=_bot_loop, name="telegram-bot", daemon=True).start()


def status():
    return {"publishing": bool(ADMIN_TOKEN) or config.DEMO_MODE, "telegram": bool(BOT_TOKEN), "channel": bool(CHANNEL),
            "subscribers": len(_subs()), "demo": config.DEMO_MODE}
