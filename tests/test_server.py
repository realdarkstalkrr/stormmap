"""End-to-end API tests against the server in demo mode (no network access needed)."""

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

os.environ["STORMMAP_DEMO"] = "1"
os.environ.setdefault("STORMMAP_CACHE_DIR", tempfile.mkdtemp())

from http.server import ThreadingHTTPServer  # noqa: E402

from stormmap import app, forecast, geo  # noqa: E402


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def get(self, path):
        with urllib.request.urlopen(self.base + path, timeout=120) as r:
            body = r.read()
            return r.status, r.headers.get("Content-Type"), body

    def get_json(self, path):
        status, _, body = self.get(path)
        return status, json.loads(body)

    def test_meta(self):
        _, m = self.get_json("/api/meta")
        self.assertEqual(set(m["countries"]), {"UA", "RU", "TR", "RO", "BG", "SK", "PL", "FI", "DE", "BY"})
        self.assertIn("ecmwf_ifs025", m["models"])
        self.assertTrue(m["demo"])

    def test_grid_and_outlook(self):
        _, g = self.get_json("/api/grid?model=gfs_seamless&region=PL&hour=14")
        self.assertEqual(len(g["idx"]), len(g["fields"]["cape"]))
        self.assertEqual(len(g["times"]), 72)
        self.assertIn("threat", g["available"])
        _, o = self.get_json("/api/outlook?model=gfs_seamless&region=PL")
        self.assertEqual(len(o["days"]), 3)
        self.assertEqual(len(o["days"][0]["category"]), len(o["idx"]))
        _, t = self.get_json("/api/timeline?model=gfs_seamless&region=PL")
        self.assertEqual(len(t["threat"]), 72)

    def test_sounding(self):
        _, s = self.get_json("/api/sounding?model=icon_seamless&lat=49.0&lon=31.0&hour=13")
        self.assertEqual(s["hour"], 13)
        self.assertIn("mlcape", s["indices"])
        self.assertEqual(s["country"], "UA")
        self.assertEqual(len(s["series"]), 72)

    def test_point_forecast(self):
        _, f = self.get_json("/api/forecast?model=best_match&lat=52.2&lon=21.0")
        self.assertEqual(len(f["daily"]["temperature_2m_max"]), 7)
        self.assertEqual(len(f["hourly"]["weather_code"]), len(f["hourly"]["time"]))
        self.assertEqual(f["country"], "PL")

    def test_meteogram_and_ensemble(self):
        _, m = self.get_json("/api/meteogram?models=gfs_seamless,icon_seamless&lat=50&lon=20")
        self.assertEqual(len(m["series"]["gfs_seamless"]["cape"]), len(m["times"]))
        _, e = self.get_json("/api/ensemble?model=icon_seamless&lat=50&lon=20")
        self.assertEqual(e["vars"]["cape"]["members"], 21)
        self.assertEqual(len(e["vars"]["cape"]["p50"]), len(e["times"]))

    def test_radar_proxy(self):
        _, f = self.get_json("/api/radar/frames")
        path = f["radar"][-1]["path"]
        status, ctype, body = self.get(f"/api/radar/tile/5/18/10.png?path={path}&size=256")
        self.assertEqual(ctype, "image/png")
        self.assertTrue(body.startswith(b"\x89PNG"))

    def test_zones_route_intercept_api(self):
        _, z = self.get_json("/api/zones?front=30&border=20")
        g = z["grid"]
        self.assertEqual(sum(z["rle"][1::2]), g["nlat"] * g["nlon"])
        self.assertTrue(z["meta"]["fallback"])  # demo mode: conservative fallback, clearly flagged
        _, r = self.get_json("/api/route?from=50.45,30.52&to=48.46,35.05")
        self.assertTrue(r["safety"]["ok"])
        _, x = self.get_json("/api/intercept?from=49.44,32.06&lat=49.0&lon=30.6&u=12&v=8&r=12&mode=flank")
        self.assertTrue(x["ok"])
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.get("/api/route?from=50.45,30.52&to=44.95,34.10")
        self.assertEqual(cm.exception.code, 422)

    def test_observations(self):
        _, o = self.get_json("/api/obs")
        self.assertGreater(len(o["obs"]), 20)
        self.assertIn("raw", o["obs"][0])
        _, g = self.get_json("/api/grid?model=gfs_seamless&region=PL&hour=14")
        for k in ("conv10", "mfc", "ci", "wmaxshear"):
            self.assertIn(k, g["available"])

    def test_bad_requests(self):
        for path, code in [("/api/grid?model=nope", 400), ("/api/sounding?lat=x&lon=1", 400),
                           ("/api/radar/tile/5/1/1.png?path=/etc/passwd", 400), ("/api/unknown", 404),
                           ("/../../etc/passwd.txt", 404)]:
            with self.assertRaises(urllib.error.HTTPError) as cm:
                self.get(path)
            self.assertEqual(cm.exception.code, code, path)

    def test_static(self):
        status, ctype, body = self.get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"STORM", body)


class GeoTests(unittest.TestCase):
    def test_country_lookup(self):
        self.assertEqual(geo.country_at(50.45, 30.52), "UA")
        self.assertEqual(geo.country_at(44.95, 34.10), "UA")  # Crimea
        self.assertEqual(geo.country_at(55.75, 37.62), "RU")
        self.assertEqual(geo.country_at(39.93, 32.86), "TR")
        self.assertEqual(geo.country_at(60.17, 24.94), "FI")
        self.assertIsNone(geo.country_at(48.2, 16.37))  # Vienna, outside coverage

    def test_grid_budget(self):
        from stormmap import config
        for region in ["ALL", *config.COUNTRIES]:
            g = geo.build_grid(region, config.GRID_MAX_POINTS)
            self.assertLessEqual(len(g["points"]), config.GRID_MAX_POINTS)
            self.assertGreater(len(g["points"]), 50)

    def test_rate_weight(self):
        self.assertEqual(forecast.RateBudget.weight(10, 20), 20)
        self.assertEqual(forecast.RateBudget.weight(1, 5), 1)


if __name__ == "__main__":
    unittest.main()
