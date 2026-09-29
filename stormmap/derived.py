"""Fast severe-weather parameters for model grid points (limited pressure levels).

The grid only carries a handful of levels, so kinematic parameters use layer proxies:
  0–1 km  ≈ 10 m → 925 hPa,   0–3 km ≈ 10 m → 700 hPa,   0–6 km ≈ 10 m → 500 hPa.
Thermodynamics use the model-diagnosed CAPE/CIN/LI where available and fall back to
our own surface-parcel lifted index otherwise.
"""

import math

from .sounding import scp as scp_fn, ship as ship_fn, stp_fixed
from .thermo import (
    G, RD, ZERO_C, lcl, mixing_ratio, moist_descend, potential_temp_k, sat_vapor_pressure,
    temp_from_theta_c, wind_components,
)

# Parameters exposed on the map: key -> (label, unit, description)
PARAMS = {
    "threat": ("Storm threat index", "0–5", "StormMap composite convective hazard category"),
    "cape": ("CAPE", "J/kg", "Model convective available potential energy"),
    "li": ("Lifted index", "°C", "Surface-parcel lifted index (negative = unstable)"),
    "cin": ("CIN", "J/kg", "Convective inhibition (cap strength)"),
    "shr6": ("Deep-layer shear", "m/s", "Bulk wind difference 10 m → 500 hPa (≈0–6 km)"),
    "shr1": ("Low-level shear", "m/s", "Bulk wind difference 10 m → 925 hPa (≈0–1 km; 850 hPa with the core variable set)"),
    "srh3": ("SRH 0–3 km", "m²/s²", "Storm-relative helicity, Bunkers right mover"),
    "srh1": ("SRH 0–1 km", "m²/s²", "Storm-relative helicity, Bunkers right mover (layer proxy from pressure levels)"),
    "stp": ("Sig. tornado param.", "", "Fixed-layer STP"),
    "scp": ("Supercell composite", "", "Supercell composite parameter"),
    "ship": ("Sig. hail param.", "", "SHIP (large hail ≥ 5 cm)"),
    "ehi": ("Energy-helicity idx", "", "CAPE × SRH(0–1 km) / 160 000"),
    "lr75": ("Mid-level lapse rate", "°C/km", "700–500 hPa lapse rate (850–500 hPa with the core variable set)"),
    "lcl": ("LCL height", "m", "Surface-parcel lifting condensation level (AGL)"),
    "td2": ("Dew point 2 m", "°C", "Low-level moisture"),
    "t2": ("Temperature 2 m", "°C", ""),
    "theta_e": ("θe 850 hPa", "K", "Equivalent potential temperature at 850 hPa"),
    "kindex": ("K-index", "°C", "Air-mass thunderstorm potential"),
    "tt": ("Total totals", "°C", ""),
    "precip": ("Precipitation", "mm/h", "Hourly total precipitation"),
    "gust": ("Wind gusts", "km/h", "10 m gusts"),
    "lpi": ("Lightning potential", "J/kg", "ICON lightning potential index"),
    "wind850": ("Wind 850 hPa", "m/s", "Low-level jet"),
    "wind250": ("Jet stream 250 hPa", "m/s", "Upper-level jet"),
    "z500": ("Geopotential 500 hPa", "dam", "Synoptic pattern"),
    "t850": ("Temperature 850 hPa", "°C", ""),
    "fzl": ("Freezing level", "m", ""),
    "cloud": ("Cloud cover", "%", ""),
}


def _g(h, name, i):
    arr = h.get(name)
    if not arr or i >= len(arr):
        return None
    return arr[i]


def _surface_li(t2, td2, ps, t500):
    if None in (t2, td2, ps, t500) or ps <= 520:
        return None
    p_l, t_l = lcl(t2, min(td2, t2), ps)
    if p_l <= 500:
        t_par = temp_from_theta_c(potential_temp_k(t2, ps), 500)
    else:
        t_par = moist_descend(t_l, p_l, 500, step=25.0)
    return t500 - t_par


def _theta_e_850(t, td):
    if t is None or td is None:
        return None
    from .thermo import equiv_potential_temp_k
    return equiv_potential_temp_k(t, min(td, t), 850)


def threat_level(cape, shr6, srh1, stp, scp, ship, li, lpi, precip):
    """0 none, 1 thunder, 2 marginal, 3 slight, 4 enhanced, 5 moderate/high."""
    cape = cape or 0
    shr6 = shr6 or 0
    if cape < 100 and (lpi or 0) < 1:
        return 0
    lvl = 1 if (cape >= 150 or (li is not None and li < 0) or (lpi or 0) >= 1) else 0
    if lvl == 0:
        return 0
    if cape >= 500 and shr6 >= 10:
        lvl = 2
    if (scp or 0) >= 1 or (ship or 0) >= 0.5 or (cape >= 1500 and shr6 >= 12.5):
        lvl = 3
    if (scp or 0) >= 4 or (stp or 0) >= 1 or (ship or 0) >= 1.5 or (cape >= 2500 and shr6 >= 18):
        lvl = 4
    if (stp or 0) >= 3 or ((scp or 0) >= 10 and shr6 >= 20):
        lvl = 5
    return lvl


def compute_point(h, i, elevation=0.0):
    """Return a dict of derived values for grid point hourly data h at index i."""
    t2 = _g(h, "temperature_2m", i)
    td2 = _g(h, "dew_point_2m", i)
    ps = _g(h, "surface_pressure", i)
    cape = _g(h, "cape", i)
    cin = _g(h, "convective_inhibition", i)
    li = _g(h, "lifted_index", i)
    t850 = _g(h, "temperature_850hPa", i)
    t700 = _g(h, "temperature_700hPa", i)
    t500 = _g(h, "temperature_500hPa", i)
    td850 = _g(h, "dew_point_850hPa", i)
    td700 = _g(h, "dew_point_700hPa", i)
    z700 = _g(h, "geopotential_height_700hPa", i)
    z500 = _g(h, "geopotential_height_500hPa", i)

    def wind(level):
        s = _g(h, f"wind_speed_{level}", i)
        d = _g(h, f"wind_direction_{level}", i)
        if s is None or d is None:
            return None
        return wind_components(s, d)

    w10 = wind("10m")
    w925 = wind("925hPa")
    w850 = wind("850hPa")
    w700 = wind("700hPa")
    w500 = wind("500hPa")
    w250 = wind("250hPa")

    def diff(a, b):
        if a is None or b is None:
            return None
        return math.hypot(b[0] - a[0], b[1] - a[1])

    shr6 = diff(w10, w500)
    shr1 = diff(w10, w925 if (ps is None or ps > 940) else w850)

    srh1 = srh3 = None
    if None not in (w10, w850, w700, w500):
        chain = [w10] + ([w925] if w925 and (ps is None or ps > 940) else []) + [w850, w700]
        layers_mean = [w10] + ([w925] if w925 else []) + [w850, w700, w500]
        mu = sum(x[0] for x in layers_mean) / len(layers_mean)
        mv = sum(x[1] for x in layers_mean) / len(layers_mean)
        su, sv = w500[0] - w10[0], w500[1] - w10[1]
        mag = math.hypot(su, sv) or 1e-6
        cu, cv = mu + 7.5 * sv / mag, mv - 7.5 * su / mag

        def srh(seq):
            tot = 0.0
            for a, b in zip(seq[:-1], seq[1:]):
                tot += (b[0] - cu) * (a[1] - cv) - (a[0] - cu) * (b[1] - cv)
            return tot

        srh3 = srh(chain)
        # 0–1 km: 10 m → 925 hPa when available, otherwise scale the 10 m → 850 hPa layer
        srh1 = srh(chain[:2]) if len(chain) > 3 else srh(chain[:2]) * 0.8

    if li is None or cape is None:
        # models without diagnosed LI/CAPE: lift our own surface parcel to 500 hPa
        own_li = _surface_li(t2, td2, ps, t500)
        if li is None:
            li = own_li
        if cape is None and own_li is not None:
            cape = max(0.0, -own_li * 250.0)  # crude CAPE proxy from LI

    lcl_h = None
    if t2 is not None and td2 is not None:
        lcl_h = max(0.0, 125.0 * (t2 - td2))

    lr75 = None
    if None not in (t700, t500, z700, z500) and z500 > z700:
        lr75 = (t700 - t500) / ((z500 - z700) / 1000.0)
    elif None not in (t850, t500):
        # hypsometric 850–500 hPa thickness from the layer-mean temperature
        dz = RD * ((t850 + t500) / 2 + ZERO_C) / G * math.log(850 / 500)
        lr75 = (t850 - t500) / (dz / 1000.0)

    kindex = tt = None
    if None not in (t850, t500, td850):
        tt = t850 + td850 - 2 * t500
        if None not in (t700, td700):
            kindex = (t850 - t500) + td850 - (t700 - td700)

    fzl = _g(h, "freezing_level_height", i)
    if cin is not None:
        cin = -abs(cin)  # sign convention differs between models
    stp = stp_fixed(cape or 0, lcl_h, srh1 or 0, shr6, cin or 0) if shr6 is not None else None
    scp_v = scp_fn(cape or 0, srh3 or 0, shr6, cin or 0) if shr6 is not None else None
    mu_w = mixing_ratio(sat_vapor_pressure(td2), ps) if (td2 is not None and ps) else 0.01
    ship_v = ship_fn(cape or 0, mu_w, lr75, t500, shr6, fzl - elevation if fzl is not None else None)
    ehi = (cape or 0) * (srh1 or 0) / 160000.0 if srh1 is not None else None
    lpi = _g(h, "lightning_potential", i)
    precip = _g(h, "precipitation", i)
    gust = _g(h, "wind_gusts_10m", i)

    out = {
        "cape": cape, "li": li, "cin": cin, "shr6": shr6, "shr1": shr1, "srh1": srh1, "srh3": srh3,
        "stp": stp, "scp": scp_v, "ship": ship_v, "ehi": ehi, "lr75": lr75, "lcl": lcl_h,
        "td2": td2, "t2": t2, "theta_e": _theta_e_850(t850, td850), "kindex": kindex, "tt": tt,
        "precip": precip, "gust": gust * 3.6 if gust is not None else None, "lpi": lpi,
        "wind850": math.hypot(*w850) if w850 else None,
        "wind250": math.hypot(*w250) if w250 else None,
        "z500": z500 / 10.0 if z500 is not None else None,
        "t850": t850, "fzl": fzl, "cloud": _g(h, "cloud_cover", i),
        # vectors for barbs/arrows
        "u850": w850[0] if w850 else None, "v850": w850[1] if w850 else None,
        "u500": w500[0] if w500 else None, "v500": w500[1] if w500 else None,
        "u10": w10[0] if w10 else None, "v10": w10[1] if w10 else None,
    }
    out["threat"] = threat_level(cape, shr6, srh1, stp, scp_v, ship_v, li, lpi, precip)
    return out
