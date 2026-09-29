"""HTTP server: JSON API + static single-page app (stdlib only)."""

import gzip
import json
import logging
import math
import mimetypes
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__, config, demo, forecast, routing, sources, zones
from .derived import PARAMS
from .net import FetchError

log = logging.getLogger("stormmap.http")

mimetypes.add_type("application/geo+json", ".geojson")
mimetypes.add_type("text/javascript", ".js")


def _meta():
    return {
        "version": __version__, "demo": config.DEMO_MODE,
        "countries": {k: {"name": v["name"], "bounds": v["bounds"], "warnings": bool(v["meteoalarm"])} for k, v in config.COUNTRIES.items()},
        "region_bounds": config.REGION_BOUNDS, "center": config.MAP_CENTER,
        "models": config.MODELS, "ensembles": config.ENSEMBLE_MODELS,
        "params": {k: {"label": v[0], "unit": v[1], "desc": v[2], "kind": v[3]} for k, v in PARAMS.items()},
        "server_time": int(time.time()),
        "grid_extended": config.GRID_EXTENDED, "api_key": bool(config.OPEN_METEO_KEY),
        "budget": forecast.budget.usage(),
    }


def _q(qs, name, default=None, required=False):
    v = qs.get(name, [default])[0]
    if required and v in (None, ""):
        raise FetchError(f"Missing parameter '{name}'", 400)
    return v


def _float(qs, name):
    try:
        return float(_q(qs, name, required=True))
    except ValueError:
        raise FetchError(f"Parameter '{name}' must be a number", 400)


def _float_or(qs, name, default):
    v = _q(qs, name)
    if v in (None, ""):
        return float(default)
    try:
        x = float(v)
    except ValueError:
        raise FetchError(f"Parameter '{name}' must be a number", 400)
    if not math.isfinite(x):
        raise FetchError(f"Parameter '{name}' must be finite", 400)
    return x


def _point(qs, name):
    try:
        lat, lon = (float(x) for x in _q(qs, name, required=True).split(","))
    except ValueError:
        raise FetchError(f"Parameter '{name}' must be 'lat,lon'", 400)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise FetchError(f"Parameter '{name}' out of range", 400)
    return lat, lon


def route_api(path, qs):
    """Returns (status, content_type, body_bytes_or_obj, cache_seconds)."""
    if path == "/api/meta":
        return 200, "json", _meta(), 0
    if path == "/api/grid":
        return 200, "json", forecast.grid_hour(_q(qs, "model", "best_match"), _q(qs, "region", "ALL"), int(_q(qs, "hour", "0"))), 60
    if path == "/api/timeline":
        return 200, "json", forecast.grid_timeline(_q(qs, "model", "best_match"), _q(qs, "region", "ALL")), 60
    if path == "/api/outlook":
        return 200, "json", forecast.outlook(_q(qs, "model", "best_match"), _q(qs, "region", "ALL")), 60
    if path == "/api/sounding":
        t_sfc = _float_or(qs, "t", None) if _q(qs, "t") not in (None, "") else None
        td_sfc = _float_or(qs, "td", None) if _q(qs, "td") not in (None, "") else None
        return 200, "json", forecast.sounding(_q(qs, "model", "best_match"), _float(qs, "lat"), _float(qs, "lon"),
                                              int(_q(qs, "hour", "0")), t_sfc, td_sfc), 60
    if path == "/api/sounding/export":
        t_sfc = _float_or(qs, "t", None) if _q(qs, "t") not in (None, "") else None
        td_sfc = _float_or(qs, "td", None) if _q(qs, "td") not in (None, "") else None
        name, mime, text = forecast.sounding_export(_q(qs, "model", "best_match"), _float(qs, "lat"), _float(qs, "lon"),
                                                    int(_q(qs, "hour", "0")), _q(qs, "fmt", "sharppy"), t_sfc, td_sfc)
        return 200, mime, text.encode(), 0, {"Content-Disposition": f'attachment; filename="{name}"'}
    if path == "/api/timeheight":
        return 200, "json", forecast.time_height(_q(qs, "model", "best_match"), _float(qs, "lat"), _float(qs, "lon")), 60
    if path == "/api/xsection":
        return 200, "json", forecast.xsection(_q(qs, "model", "best_match"), _point(qs, "a"), _point(qs, "b"),
                                              int(_q(qs, "hour", "0")), int(_float_or(qs, "n", 25))), 60
    if path == "/api/forecast":
        return 200, "json", forecast.point_forecast(_q(qs, "model", "best_match"), _float(qs, "lat"), _float(qs, "lon")), 300
    if path == "/api/meteogram":
        models = [m for m in (_q(qs, "models", "best_match") or "").split(",") if m]
        return 200, "json", forecast.meteogram(models, _float(qs, "lat"), _float(qs, "lon")), 300
    if path == "/api/ensemble":
        return 200, "json", forecast.ensemble(_q(qs, "model", "icon_seamless"), _float(qs, "lat"), _float(qs, "lon")), 300
    if path == "/api/radar/frames":
        return 200, "json", sources.radar_frames(), 30
    if path.startswith("/api/radar/tile/"):
        parts = path[len("/api/radar/tile/"):].split("/")
        if len(parts) != 3 or not parts[2].endswith(".png"):
            raise FetchError("Bad tile path", 400)
        z, x, y = parts[0], parts[1], parts[2][:-4]
        body = sources.radar_tile(_q(qs, "path", required=True), z, x, y, _q(qs, "size", "256"), _q(qs, "color", "2"))
        return 200, "image/png", body, 600
    if path == "/api/zones":
        return 200, "json", zones.api_payload(_float_or(qs, "front", zones.DEFAULT_FRONT_KM), _float_or(qs, "border", zones.DEFAULT_BORDER_KM)), 300
    if path == "/api/route":
        a, b = _point(qs, "from"), _point(qs, "to")
        return 200, "json", routing.safe_route(a, b, _float_or(qs, "front", zones.DEFAULT_FRONT_KM),
                                               _float_or(qs, "border", zones.DEFAULT_BORDER_KM), _float_or(qs, "speed", 80)), 0
    if path == "/api/intercept":
        o = _point(qs, "from")
        cell = {"lat": _float(qs, "lat"), "lon": _float(qs, "lon"), "u": _float_or(qs, "u", 0), "v": _float_or(qs, "v", 0),
                "radius_km": _float_or(qs, "r", 10)}
        mode = _q(qs, "mode", "flank")
        return 200, "json", routing.intercept(o, cell, _float_or(qs, "front", zones.DEFAULT_FRONT_KM),
                                              _float_or(qs, "border", zones.DEFAULT_BORDER_KM), _float_or(qs, "speed", 80),
                                              mode if mode in ("flank", "track") else "flank"), 0
    if path == "/api/obs":
        return 200, "json", sources.observations(), 120
    if path == "/api/warnings":
        return 200, "json", sources.warnings(), 120
    if path == "/api/geocode":
        return 200, "json", sources.geocode(_q(qs, "q", "")), 3600
    if path == "/api/demo/strikes":
        if not config.DEMO_MODE:
            raise FetchError("Demo mode is off", 404)
        return 200, "json", {"strikes": demo.strikes(int(_q(qs, "since", "0")))}, 0
    raise FetchError("Not found", 404)


class Handler(BaseHTTPRequestHandler):
    server_version = f"StormMap/{__version__}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        log.debug("%s - %s", self.address_string(), fmt % args)

    def _send(self, status, ctype, body, cache_s=0, extra=None):
        if ctype == "json":
            body = json.dumps(body, separators=(",", ":"), allow_nan=False, default=str).encode()
            ctype = "application/json; charset=utf-8"
        gz = (len(body) > 1400 and "gzip" in (self.headers.get("Accept-Encoding") or "")
              and not ctype.startswith("image/"))
        if gz:
            body = gzip.compress(body, 5)
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", f"public, max-age={cache_s}" if cache_s else "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        t0 = time.time()
        url = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(url.path)
        qs = urllib.parse.parse_qs(url.query)
        try:
            if path.startswith("/api/"):
                res = route_api(path, qs)
                status, ctype, body, cache_s = res[:4]
                self._send(status, ctype, body, cache_s, res[4] if len(res) > 4 else None)
            else:
                self._static(path)
        except FetchError as e:
            self._send(e.status if 400 <= e.status < 600 else 502, "json", {"error": str(e)})
        except (ValueError, KeyError) as e:
            self._send(400, "json", {"error": f"Bad request: {e}"})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:  # noqa: BLE001 - last-resort handler
            log.error("unhandled error for %s\n%s", self.path, traceback.format_exc())
            try:
                self._send(500, "json", {"error": f"Internal error: {type(e).__name__}"})
            except OSError:
                pass
        finally:
            dt = (time.time() - t0) * 1000
            if path.startswith("/api/") and not path.startswith("/api/radar/tile"):
                log.info("%s %s %.0f ms", self.command, self.path[:120], dt)

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        root = config.STATIC_DIR.resolve()
        target = (root / path.lstrip("/")).resolve()
        if root not in target.parents:
            self._send(404, "json", {"error": "Not found"})
            return
        if not target.is_file():
            if "." in path.rsplit("/", 1)[-1]:
                self._send(404, "json", {"error": "Not found"})
                return
            target = root / "index.html"  # SPA fallback
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/json", "application/geo+json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        cache_s = 3600 if "/vendor/" in path or "/data/" in path else 0
        self._send(200, ctype, target.read_bytes(), cache_s)


def serve(host=None, port=None):
    host = host or config.HOST
    port = port or config.PORT
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    zones.warm()
    if config.WARM_CACHE and not config.DEMO_MODE:
        def warm():
            try:
                forecast.get_grid("best_match", "ALL")
            except FetchError as e:
                log.warning("cache warm-up failed: %s", e)
        threading.Thread(target=warm, name="warm-cache", daemon=True).start()
    shown = "localhost" if host in ("0.0.0.0", "") else host
    log.info("StormMap %s listening on http://%s:%d%s", __version__, shown, port, "  [DEMO MODE]" if config.DEMO_MODE else "")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
