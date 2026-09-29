"""War-zone safety features: air-raid alerts, mine map, storm-warning publishing and the Telegram bot logic."""

import json
import os
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

os.environ["STORMMAP_DEMO"] = "1"
os.environ.setdefault("STORMMAP_CACHE_DIR", tempfile.mkdtemp())

from http.server import ThreadingHTTPServer  # noqa: E402

from stormmap import airalerts, app, hazards, publish  # noqa: E402


def square(lat, lon, d=0.2):
    return [[lat - d, lon - d], [lat - d, lon + d], [lat + d, lon + d], [lat + d, lon - d]]


def warning(**kw):
    w = {"polygon": square(48.7, 37.5), "severity": "severe", "expires": time.time() + 3600,
         "text_uk": "Гроза", "text_en": "Storm", "title_en": "SEVERE THUNDERSTORM: Kramatorsk", "towns": ["Краматорськ"]}
    w.update(kw)
    return w


class AirAlertTests(unittest.TestCase):
    def test_oblast_keys_from_ukrainian_titles(self):
        self.assertEqual(airalerts.oblast_key_from_uk("Харківська область"), "kharkiv")
        self.assertEqual(airalerts.oblast_key_from_uk("м. Київ"), "kyiv-city")
        self.assertEqual(airalerts.oblast_key_from_uk("Київська область"), "kyiv")
        self.assertEqual(airalerts.oblast_key_from_uk("Дніпропетровська область"), "dnipro")
        self.assertIsNone(airalerts.oblast_key_from_uk("Nowhere"))

    def test_oblast_keys_from_boundary_names(self):
        self.assertEqual(airalerts.oblast_key_from_en("Kyiv"), "kyiv-city")
        self.assertEqual(airalerts.oblast_key_from_en("Kyiv Oblast"), "kyiv")
        self.assertEqual(airalerts.oblast_key_from_en("Kharkiv Oblast"), "kharkiv")
        self.assertEqual(airalerts.oblast_key_from_en("Autonomous Republic of Crimea"), "crimea")
        self.assertEqual(airalerts.oblast_key_from_en("Sevastopol"), "sevastopol")
        self.assertEqual(airalerts.oblast_key_from_en("Ivano-Frankivsk Oblast"), "ivano-frankivsk")

    def test_parse_skips_finished_and_maps_raions(self):
        data = {"alerts": [
            {"location_title": "Харківська область", "location_type": "oblast", "location_oblast": "Харківська область",
             "alert_type": "air_raid", "started_at": "2026-09-29T10:00:00.000Z", "finished_at": None},
            {"location_title": "Шосткинський район", "location_type": "raion", "location_oblast": "Сумська область",
             "alert_type": "artillery_shelling", "started_at": "2026-09-29T10:00:00.000Z", "finished_at": None},
            {"location_title": "Львівська область", "location_type": "oblast", "location_oblast": "Львівська область",
             "alert_type": "air_raid", "finished_at": "2026-09-29T11:00:00.000Z"},
        ]}
        out = airalerts._parse(data)
        self.assertEqual([a["oblast"] for a in out], ["kharkiv", "sumy"])
        self.assertEqual(out[1]["level"], "raion")
        self.assertEqual(out[1]["type_en"], "Artillery shelling")

    def test_active_summary_in_demo(self):
        d = airalerts.active()
        self.assertEqual(d["status"], "demo")
        self.assertTrue(d["oblasts"]["kharkiv"]["full"])
        self.assertFalse(d["oblasts"]["sumy"]["full"])
        self.assertIn("Шосткинський район", d["oblasts"]["sumy"]["partial"])


class PublishTests(unittest.TestCase):
    def test_admin_token(self):
        self.assertTrue(publish.admin_ok("demo"))  # demo mode only
        self.assertFalse(publish.admin_ok(""))
        self.assertFalse(publish.admin_ok("wrong"))

    def test_validation(self):
        from stormmap.net import FetchError
        with self.assertRaises(FetchError):
            publish._clean_warning(warning(polygon=[[1, 2], [3, 4]]))
        with self.assertRaises(FetchError):
            publish._clean_warning(warning(severity="apocalyptic"))
        with self.assertRaises(FetchError):
            publish._clean_warning(warning(expires=time.time() + 7 * 3600))
        with self.assertRaises(FetchError):
            publish._clean_warning(warning(text_uk="", text_en=""))
        w = publish._clean_warning(warning(text_en="x" * 5000))
        self.assertEqual(len(w["text_en"]), 2000)

    def test_distance_to_polygon(self):
        poly = square(48.7, 37.5)
        self.assertEqual(publish.distance_to_polygon_km(48.7, 37.5, poly), 0.0)
        d = publish.distance_to_polygon_km(48.7, 38.0, poly)  # 0.3° lon east of the edge ≈ 22 km
        self.assertAlmostEqual(d, 0.3 * 111.32 * 0.6593, delta=1.0)

    def test_bot_subscribe_match_publish_cancel(self):
        chat = {"id": 4242}
        r = publish.handle_update({"message": {"chat": chat, "text": "/start", "from": {"language_code": "uk"}}})
        self.assertIn("StormMap", r[0][1])
        r = publish.handle_update({"message": {"chat": chat, "text": "/town Краматорськ"}})
        self.assertIn("Краматорськ", r[0][1])
        publish.handle_update({"message": {"chat": chat, "text": "/radius 10"}})
        r = publish.handle_update({"message": {"chat": chat, "text": "/radius 999"}})
        self.assertIn("5", r[0][1])
        far = {"id": 777}
        publish.handle_update({"message": {"chat": far, "location": {"latitude": 50.45, "longitude": 30.52}}})
        res = publish.publish(warning())
        self.assertTrue(res["dry_run"])
        self.assertEqual(res["subscribers"], 1)  # Kramatorsk subscriber, not Kyiv
        self.assertIn(res["id"], [w["id"] for w in publish.active_warnings()])
        publish.cancel(res["id"])
        self.assertNotIn(res["id"], [w["id"] for w in publish.active_warnings()])
        r = publish.handle_update({"message": {"chat": chat, "text": "/stop"}})
        self.assertNotIn("4242", publish._subs())

    def test_find_town_english_and_ukrainian(self):
        self.assertEqual(publish.find_town("kramatorsk")[0], "Kramatorsk")
        self.assertEqual(publish.find_town("Слов'янськ")[0], "Sloviansk")
        self.assertIsNone(publish.find_town("Atlantis"))


class HazardTests(unittest.TestCase):
    def test_mines_file(self):
        if not os.path.exists(hazards.config.STATIC_DIR / "data" / "mines.geojson"):
            self.assertFalse(hazards.load()["loaded"])
        with tempfile.NamedTemporaryFile("w", suffix=".geojson", delete=False) as f:
            json.dump({"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[[37, 48], [38, 48], [38, 49], [37, 48]]]}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [37, 48]}}]}, f)
        old = hazards.MINES_FILE
        hazards.MINES_FILE = f.name
        try:
            d = hazards.load()
            self.assertTrue(d["loaded"])
            self.assertEqual(d["count"], 1)
        finally:
            hazards.MINES_FILE = old
            os.unlink(f.name)


class EndpointTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def call(self, path, body=None, token=None, raw=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method="POST" if data is not None else "GET")
        req.add_header("Content-Type", "application/json")
        if token:
            req.add_header("X-Admin-Token", token)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_get_endpoints(self):
        s, d = self.call("/api/airalerts")
        self.assertEqual(s, 200)
        self.assertIn("kharkiv", d["oblasts"])
        s, d = self.call("/api/oblasts")
        self.assertEqual(len(d["centres"]), 27)
        s, d = self.call("/api/hazards")
        self.assertEqual(s, 200)
        s, d = self.call("/api/warn/status")
        self.assertFalse(d["telegram"])

    def test_publish_requires_token(self):
        s, d = self.call("/api/warn/publish", warning())
        self.assertEqual(s, 403)
        s, d = self.call("/api/warn/publish", warning(), token="bad")
        self.assertEqual(s, 403)
        s, d = self.call("/api/warn/publish", {"polygon": []}, token="demo")
        self.assertEqual(s, 400)
        s, d = self.call("/api/warn/publish", raw=b"not json", token="demo")
        self.assertEqual(s, 400)
        s, d = self.call("/api/warn/publish", warning(), token="demo")
        self.assertEqual(s, 200)
        wid = d["id"]
        s, a = self.call("/api/warn/active")
        self.assertIn(wid, [w["id"] for w in a["warnings"]])
        s, d = self.call("/api/warn/cancel", {"id": wid})
        self.assertEqual(s, 403)
        s, d = self.call("/api/warn/cancel", {"id": wid}, token="demo")
        self.assertEqual(s, 200)
        s, d = self.call("/api/warn/cancel", {"id": "nope"}, token="demo")
        self.assertEqual(s, 404)


if __name__ == "__main__":
    unittest.main()
