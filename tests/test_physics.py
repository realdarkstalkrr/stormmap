import math
import unittest

from stormmap import thermo
from stormmap.derived import compute_point, threat_level
from stormmap.sounding import analyze, build_profile, scp, ship, stp_fixed


def _z(p):
    return 44330 * (1 - (p / 1013.25) ** 0.1903)


def synthetic_profile(t_sfc=30.0, td_sfc=20.0, veer=120.0, top_speed=30.0):
    levels = []
    for p in [975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100]:
        z = _z(p)
        t = t_sfc - 9.0 * min(z, 1200) / 1000 - 7.0 * max(0, min(z, 11000) - 1200) / 1000
        td = min(t - 1, td_sfc - 2 * z / 1000) if z < 1500 else t - 15
        u, v = thermo.wind_components(5 + (top_speed - 5) * min(z, 8000) / 8000, 150 + veer * min(z, 6000) / 6000)
        levels.append(dict(p=p, z=z, t=t, td=td, u=u, v=v))
    u, v = thermo.wind_components(4, 140)
    return build_profile(dict(p=1005, t=t_sfc, td=td_sfc, u=u, v=v, elev=60), levels)


class ThermoTests(unittest.TestCase):
    def test_saturation_vapour_pressure(self):
        self.assertAlmostEqual(thermo.sat_vapor_pressure(0), 6.112, places=3)
        self.assertAlmostEqual(thermo.sat_vapor_pressure(20), 23.37, delta=0.1)

    def test_lcl_bolton(self):
        p, t = thermo.lcl(30, 20, 1000)
        # ~125 m per °C of dew-point depression -> ~1250 m AGL, ~865 hPa
        self.assertAlmostEqual(p, 865, delta=10)
        self.assertLess(t, 20)

    def test_dewpoint_roundtrip(self):
        td = thermo.dewpoint_from_rh(25, 60)
        self.assertAlmostEqual(td, 16.7, delta=0.3)
        w = thermo.mixing_ratio(thermo.sat_vapor_pressure(td), 1000)
        self.assertAlmostEqual(thermo.dewpoint_from_mixing_ratio(w, 1000), td, places=2)

    def test_moist_adiabat_cools_less_than_dry(self):
        t_moist = thermo.moist_descend(20, 1000, 500)
        t_dry = thermo.temp_from_theta_c(thermo.potential_temp_k(20, 1000), 500)
        self.assertGreater(t_moist, t_dry)
        self.assertAlmostEqual(t_moist, -8.0, delta=1.5)  # 20 °C pseudo-adiabat at 500 hPa

    def test_wind_components(self):
        u, v = thermo.wind_components(10, 270)  # westerly
        self.assertAlmostEqual(u, 10, places=6)
        self.assertAlmostEqual(v, 0, places=6)
        s, d = thermo.wind_speed_dir(u, v)
        self.assertAlmostEqual(d, 270, places=6)

    def test_interp_both_directions(self):
        self.assertEqual(thermo.interp(1.5, [1, 2], [10, 20]), 15)
        self.assertEqual(thermo.interp(1.5, [2, 1], [20, 10]), 15)
        self.assertIsNone(thermo.interp(3, [1, 2], [10, 20]))


class SoundingTests(unittest.TestCase):
    def test_unstable_sheared_profile(self):
        ix, plot = analyze(synthetic_profile())
        self.assertGreater(ix["sbcape"], 1500)
        self.assertLess(ix["sbcape"], 4000)
        self.assertLessEqual(ix["sbcin"], 0)
        self.assertLess(ix["sbli"], -4)
        self.assertGreater(ix["shr6"], 20)
        self.assertGreater(ix["srh3"], 100)  # veering hodograph -> positive SRH
        self.assertGreater(ix["scp"], 1)
        self.assertLess(ix["mllcl"], ix["mlel"])
        self.assertIn(ix["hazard"], ("SVR", "MRGL SVR", "TOR", "MRGL TOR"))
        self.assertEqual(len(plot["p"]), len(plot["t"]))
        self.assertTrue(plot["hodograph"])

    def test_stable_profile_has_no_cape(self):
        ix, _ = analyze(synthetic_profile(t_sfc=10, td_sfc=-5, veer=0, top_speed=8))
        self.assertLess(ix["mucape"], 50)
        self.assertEqual(ix["hazard"], "NONE")

    def test_backing_hodograph_negative_srh(self):
        ix, _ = analyze(synthetic_profile(veer=-120))
        self.assertLess(ix["srh3"], 0)

    def test_composites(self):
        self.assertEqual(stp_fixed(0, 500, 300, 25, 0), 0)
        self.assertAlmostEqual(stp_fixed(1500, 1000, 150, 20, 0), 1.0)
        self.assertAlmostEqual(scp(1000, 50, 20, 0), 1.0)
        self.assertEqual(scp(3000, 300, 5, 0), 0)
        self.assertGreater(ship(3000, 0.014, 8, -15, 25, 3500), 1)


class DerivedTests(unittest.TestCase):
    def _hourly(self, **over):
        h = {
            "temperature_2m": [28], "dew_point_2m": [18], "surface_pressure": [1000], "precipitation": [0],
            "wind_speed_10m": [5], "wind_direction_10m": [150], "wind_gusts_10m": [10],
            "cape": [2500], "lifted_index": [-6], "convective_inhibition": [20],
            "temperature_850hPa": [18], "temperature_500hPa": [-14], "dew_point_850hPa": [14],
            "wind_speed_850hPa": [15], "wind_direction_850hPa": [200],
            "wind_speed_700hPa": [18], "wind_direction_700hPa": [225],
            "wind_speed_500hPa": [25], "wind_direction_500hPa": [240],
            "geopotential_height_500hPa": [5800],
        }
        h.update({k: [v] for k, v in over.items()})
        return h

    def test_core_variable_set(self):
        d = compute_point(self._hourly(), 0)
        self.assertEqual(d["cin"], -20)  # sign normalised
        self.assertGreater(d["shr6"], 15)
        self.assertGreater(d["srh3"], 50)
        self.assertGreater(d["lr75"], 6)  # 850-500 hypsometric fallback
        self.assertIsNone(d["kindex"])    # needs 700 hPa dewpoint
        self.assertIsNotNone(d["tt"])
        self.assertGreaterEqual(d["threat"], 3)
        self.assertAlmostEqual(d["gust"], 36.0)

    def test_missing_cape_uses_own_parcel(self):
        h = self._hourly()
        h["cape"] = [None]
        h["lifted_index"] = [None]
        d = compute_point(h, 0)
        self.assertIsNotNone(d["li"])
        self.assertLess(d["li"], 0)
        self.assertGreater(d["cape"], 0)

    def test_threat_levels(self):
        self.assertEqual(threat_level(0, 30, 300, 0, 0, 0, 5, 0, 0), 0)
        self.assertEqual(threat_level(300, 5, 0, 0, 0, 0, -1, 0, 0), 1)
        self.assertEqual(threat_level(3000, 25, 300, 4, 12, 2, -8, 0, 0), 5)


if __name__ == "__main__":
    unittest.main()
