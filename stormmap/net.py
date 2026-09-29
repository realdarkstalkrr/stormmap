"""HTTP client helpers and a small TTL cache with single-flight loading."""

import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import __version__

log = logging.getLogger("stormmap.net")
USER_AGENT = f"StormMap/{__version__} (+https://github.com/realdarkstalkrr/stormmap)"


class FetchError(Exception):
    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.status = status


def fetch_bytes(url, timeout=30, retries=2, headers=None):
    hdrs = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
    if headers:
        hdrs.update(headers)
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), r.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            body = e.read()[:400].decode("utf-8", "replace")
            last = FetchError(f"HTTP {e.code} from {urllib.parse.urlsplit(url).netloc}: {body}", e.code)
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(2 ** attempt * (3 if e.code == 429 else 1))
                continue
            raise last
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = FetchError(f"Network error for {urllib.parse.urlsplit(url).netloc}: {e}", 502)
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
    raise last


def fetch_json(url, **kw):
    body, _ = fetch_bytes(url, **kw)
    try:
        return json.loads(body)
    except ValueError as e:
        raise FetchError(f"Invalid JSON from {urllib.parse.urlsplit(url).netloc}: {e}")


class TTLCache:
    """Thread-safe cache; concurrent misses for the same key share one loader call."""

    def __init__(self, max_items=512):
        self._data = {}
        self._locks = {}
        self._guard = threading.Lock()
        self.max_items = max_items

    def get(self, key):
        with self._guard:
            item = self._data.get(key)
        if item and item[0] > time.time():
            return item[1]
        return None

    def set(self, key, value, ttl):
        with self._guard:
            if len(self._data) >= self.max_items:
                oldest = sorted(self._data.items(), key=lambda kv: kv[1][0])[: max(1, self.max_items // 10)]
                for k, _ in oldest:
                    self._data.pop(k, None)
            self._data[key] = (time.time() + ttl, value)

    def get_or_load(self, key, ttl, loader, stale_ok=True):
        val = self.get(key)
        if val is not None:
            return val
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            val = self.get(key)
            if val is not None:
                return val
            try:
                val = loader()
            except FetchError:
                if stale_ok:
                    with self._guard:
                        item = self._data.get(key)
                    if item:
                        log.warning("serving stale cache for %s", key)
                        return item[1]
                raise
            self.set(key, val, ttl(val) if callable(ttl) else ttl)
            return val


cache = TTLCache()
