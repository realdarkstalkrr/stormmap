import os
import tempfile
import unittest

os.environ["STORMMAP_DEMO"] = "1"
os.environ.setdefault("STORMMAP_CACHE_DIR", tempfile.mkdtemp())

from stormmap import routing, zones  # noqa: E402
from stormmap.net import FetchError  # noqa: E402


def square(lon0, lat0, size):
    return [[lon0, lat0, 0], [lon0 + size, lat0, 0], [lon0 + size, lat0 + size, 0], [lon0, lat0 + size, 0], [lon0, lat0, 0]]


DEEPSTATE_LIKE = {
    "id": 1, "datetime": "2026-09-29T06:00:00Z",
    "map": {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": "Окупована територія /// Occupied", "fill": "#a52714"},
         "geometry": {"type": "Polygon", "coordinates": [square(37.0, 47.5, 1.0)]}},
        {"type": "Feature", "properties": {"name": "Звільнено /// Liberated", "fill": "#0f9d58"},
         "geometry": {"type": "Polygon", "coordinates": [square(35.0, 49.0, 1.0)]}},
        {"type": "Feature", "properties": {"name": "Сіра зона", "fill": "#999999"},
         "geometry": {"type": "Polygon", "coordinates": [square(36.5, 47.5, 0.4)]}},
        {"type": "Feature", "properties": {"name": "", "fill": "#ff0000"},
         "geometry": {"type": "MultiPolygon", "coordinates": [[square(34.0, 45.0, 0.5)]]}},
        {"type": "Feature", "properties": {"name": "Unit marker"}, "geometry": {"type": "Point", "coordinates": [30, 50]}},
    ]},
}


class ParseTests(unittest.TestCase):
    def test_classification(self):
        polys = zones.parse_source(DEEPSTATE_LIKE)
        classes = sorted(c for c, _ in polys)
        self.assertEqual(classes, [zones.OCCUPIED, zones.OCCUPIED, zones.CONTESTED])  # liberated + point ignored

    def test_plain_geojson(self):
        self.assertEqual(len(zones.parse_source(DEEPSTATE_LIKE["map"])), 3)


class RasterTests(unittest.TestCase):
    def test_fill_precision_about_1km(self):
        # 1°×1° square rasterised at 0.01°: edges must be accurate to one cell (~1.1 km)
        grid = bytearray(zones.NLAT * zones.NLON)
        zones._fill_polygon(grid, zones.NLAT, zones.NLON, zones.LAT0, zones.LON0, zones.RES,
                            [[(p[0], p[1]) for p in square(37.0, 47.5, 1.0)]], 1)
        cell = lambda lat, lon: grid[int((lat - zones.LAT0) / zones.RES) * zones.NLON + int((lon - zones.LON0) / zones.RES)]
        self.assertEqual(cell(47.515, 37.015), 1)   # 1.5 km inside the corner
        self.assertEqual(cell(47.485, 37.5), 0)     # 1.5 km south of the edge
        self.assertEqual(cell(48.0, 36.985), 0)     # 1.1 km west of the edge
        self.assertEqual(cell(48.0, 37.985), 1)
        n = sum(grid)
        self.assertAlmostEqual(n, 100 * 100, delta=250)

    def test_mask_classes(self):
        m = zones.mask(30, 20)
        self.assertEqual(m.cls(44.95, 34.10), zones.OCCUPIED)       # Simferopol (fallback polygon)
        self.assertEqual(m.cls(50.45, 30.52), zones.FREE)           # Kyiv
        self.assertEqual(m.country(50.45, 30.52), zones.C_UA)
        self.assertEqual(m.country(55.0, 37.0), zones.C_OTHER)      # outside raster
        self.assertEqual(m.country(51.5, 38.0), zones.C_RUBY)       # Russia inside raster
        self.assertFalse(m.segment_ok((50.5, 35.5), (51.2, 37.2)))  # crosses closed UA–RU border

    def test_transnistria_border_closed(self):
        m = zones.mask(30, 20)
        self.assertEqual(m.country(46.84, 29.63), zones.C_TMR)       # Tiraspol
        self.assertEqual(m.country(47.02, 28.84), zones.C_MD)        # Chișinău
        # Kuchurhan (UA) → Tiraspol: the checkpoint has been closed by Ukraine since 2022
        r = m.check_path([(46.62, 29.95), (46.84, 29.63)])
        self.assertFalse(r["ok"])
        self.assertIn("Transnistria", r["reason"])
        # hopping through a sliver between the two outlines is caught too
        self.assertFalse(m.check_path([(47.97, 29.08), (47.97, 29.01), (47.90, 28.95)])["ok"])
        # open crossings: Palanca (UA→MD), Mohyliv-Podilskyi→Otaci, and Moldova ↔ Transnistria
        self.assertTrue(m.check_path([(46.48, 30.73), (46.42, 30.08), (46.55, 29.40), (47.02, 28.84)])["ok"])
        self.assertTrue(m.check_path([(48.45, 27.80), (48.43, 27.79)])["ok"])
        self.assertTrue(m.check_path([(47.02, 28.84), (46.84, 29.63)])["ok"])

    def test_turkiye_armenia_border_closed(self):
        m = zones.mask(30, 20)
        self.assertEqual(m.country(40.60, 43.09), zones.C_TR)   # Kars
        self.assertEqual(m.country(40.79, 43.85), zones.C_AM)   # Gyumri
        r = m.check_path([(40.60, 43.09), (40.79, 43.85)])
        self.assertFalse(r["ok"])
        self.assertIn("Armenia", r["reason"])
        # via Georgia is fine: a long stretch through a third country resets the border memory
        via_georgia = [(40.60, 43.09), (41.10, 42.85), (41.55, 42.85), (41.40, 43.49), (41.265, 43.59), (40.79, 43.85)]
        self.assertTrue(m.check_path(via_georgia)["ok"])

    def test_closed_border_pairs(self):
        self.assertTrue(zones.closed_border(zones.C_UA, zones.C_RUBY))
        self.assertTrue(zones.closed_border(zones.C_TMR, zones.C_UA))
        self.assertIsNone(zones.closed_border(zones.C_UA, zones.C_MD))
        self.assertIsNone(zones.closed_border(zones.C_MD, zones.C_TMR))
        self.assertIsNone(zones.closed_border(zones.C_UA, zones.C_UA))


class RoutingTests(unittest.TestCase):
    def test_safe_route_avoids_zones(self):
        r = routing.safe_route((50.45, 30.52), (48.46, 35.05), 30, 20)  # Kyiv → Dnipro
        self.assertTrue(r["safety"]["ok"])
        self.assertEqual(r["source"], "approx")
        m = zones.mask(30, 20)
        self.assertTrue(m.check_path([tuple(p) for p in r["geometry"]])["ok"])

    def test_route_into_transnistria_goes_via_moldova(self):
        r = routing.safe_route((46.48, 30.73), (46.84, 29.63), 30, 20)  # Odesa → Tiraspol
        self.assertTrue(r["safety"]["ok"])
        self.assertGreater(r["distance_km"], 120)  # not the ~80 km road over the closed Kuchurhan crossing
        m = zones.mask(30, 20)
        self.assertTrue(m.check_path([tuple(p) for p in r["geometry"]])["ok"])

    def test_destination_in_zone_rejected(self):
        with self.assertRaises(FetchError) as cm:
            routing.safe_route((50.45, 30.52), (44.95, 34.10), 30, 20)
        self.assertEqual(cm.exception.status, 422)

    def test_intercept(self):
        x = routing.intercept((49.44, 32.06), {"lat": 49.0, "lon": 30.6, "u": 12, "v": 8, "radius_km": 12}, 30, 20, 80)
        self.assertTrue(x["ok"])
        self.assertGreaterEqual(x["margin_min"], 10)
        self.assertTrue(x["route"]["safety"]["ok"])

    def test_intercept_reports_storm_entering_nogo(self):
        x = routing.intercept((49.0, 33.0), {"lat": 48.6, "lon": 35.8, "u": 14, "v": 3, "radius_km": 12}, 30, 20, 80)
        self.assertIsNotNone(x["enters_nogo_min"])


if __name__ == "__main__":
    unittest.main()
