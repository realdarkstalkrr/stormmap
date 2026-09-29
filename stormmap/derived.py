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

# Parameters exposed on the map: key -> (label, unit, description, unit kind)
# Values are stored in base units (°C, m/s, mm, hPa); the browser converts for display.
PARAMS = {
    # --- weather ---
    "t2": ("Temperature", "°C", "Air temperature 2 m above ground", "temp"),
    "precip": ("Precipitation", "mm/h", "Hourly precipitation with cloud cover underlay", "precip"),
    "cloud": ("Clouds", "%", "Total cloud cover", "pct"),
    "wind10": ("Wind", "m/s", "Wind speed 10 m above ground", "wind"),
    "gust": ("Wind gusts", "m/s", "Maximum 10 m gusts in the preceding hour", "wind"),
    "mslp": ("Pressure", "hPa", "Mean sea-level pressure", "pressure"),
    "rh2": ("Humidity", "%", "Relative humidity 2 m above ground", "pct"),
    "td2": ("Dew point", "°C", "Dew point 2 m above ground — low-level moisture", "temp"),
    # --- upper air ---
    "t850": ("Temperature 850 hPa", "°C", "Temperature at ~1.5 km", "temp"),
    "t500": ("Temperature 500 hPa", "°C", "Temperature at ~5.5 km", "temp"),
    "wind850": ("Wind 850 hPa", "m/s", "Low-level jet (~1.5 km)", "wind"),
    "wind500": ("Wind 500 hPa", "m/s", "Mid-level steering flow (~5.5 km)", "wind"),
    "wind250": ("Jet stream 250 hPa", "m/s", "Upper-level jet (~10 km)", "wind"),
    "z500": ("Geopotential 500 hPa", "dam", "Synoptic pattern: troughs and ridges", "none"),
    "theta_e": ("θe 850 hPa", "K", "Equivalent potential temperature at 850 hPa", "none"),
    "fzl": ("Freezing level", "m", "Height of the 0 °C isotherm", "height"),
    # --- convective ---
    "threat": ("Storm threat", "0–5", "StormMap composite convective hazard category", "none"),
    "cape": ("CAPE", "J/kg", "Model convective available potential energy", "none"),
    "li": ("Lifted index", "°C", "Surface-parcel lifted index (negative = unstable)", "none"),
    "cin": ("CIN", "J/kg", "Convective inhibition (cap strength)", "none"),
    "shr6": ("Deep-layer shear", "m/s", "Bulk wind difference 10 m → 500 hPa (≈0–6 km)", "wind"),
    "shr1": ("Low-level shear", "m/s", "Bulk wind difference 10 m → 925 hPa (≈0–1 km; 850 hPa with the core variable set)", "wind"),
    "srh3": ("SRH 0–3 km", "m²/s²", "Storm-relative helicity, Bunkers right mover", "none"),
    "srh1": ("SRH 0–1 km", "m²/s²", "Storm-relative helicity, Bunkers right mover (layer proxy from pressure levels)", "none"),
    "stp": ("Sig. tornado param.", "", "Fixed-layer STP", "none"),
    "scp": ("Supercell composite", "", "Supercell composite parameter", "none"),
    "ship": ("Sig. hail param.", "", "SHIP (large hail ≥ 5 cm)", "none"),
    "ehi": ("Energy-helicity idx", "", "CAPE × SRH(0–1 km) / 160 000", "none"),
    "lr75": ("Mid-level lapse rate", "°C/km", "700–500 hPa lapse rate (850–500 hPa with the core variable set)", "none"),
    "lcl": ("LCL height", "m", "Surface-parcel lifting condensation level (AGL)", "height"),
    "kindex": ("K-index", "°C", "Air-mass thunderstorm potential", "none"),
    "tt": ("Total totals", "°C", "", "none"),
    "lpi": ("Lightning potential", "J/kg", "ICON lightning potential index", "none"),
    "wmaxshear": ("WMAXSHEAR", "m²/s²", "√(2·CAPE) × 0–6 km shear (ESSL/Taszarek severe discriminator; >500 severe, >1000 significant)", "none"),
    "conv10": ("Surface convergence", "10⁻⁵ s⁻¹", "10 m wind convergence — boundaries where storms initiate (grid-scale)", "none"),
    "mfc": ("Moisture-flux convergence", "g/kg/h", "Surface moisture-flux convergence — favoured initiation zones", "none"),
    "vort500": ("Vorticity 500 hPa", "10⁻⁵ s⁻¹", "Absolute vorticity at 500 hPa — shortwave troughs and PVA", "none"),
    "tadv850": ("Temp. advection 850 hPa", "K/3h", "Horizontal temperature advection at 850 hPa (warm > 0, cold < 0)", "none"),
    "fronto850": ("Frontogenesis 850 hPa", "K/100km/3h", "2-D kinematic (Petterssen) frontogenesis of θ at 850 hPa", "none"),
    "ci": ("Initiation potential", "%", "Chance-style index for storm initiation: CAPE, weak CIN and surface convergence", "pct"),
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

    rh2 = None
    if t2 is not None and td2 is not None:
        rh2 = min(100.0, 100.0 * sat_vapor_pressure(min(td2, t2)) / sat_vapor_pressure(t2))
    mslp = _g(h, "pressure_msl", i)
    out = {
        "t2": t2, "td2": td2, "rh2": rh2, "precip": precip, "cloud": _g(h, "cloud_cover", i),
        "wind10": math.hypot(*w10) if w10 else None, "gust": gust, "mslp": mslp,
        "t850": t850, "t500": t500, "z500": z500 / 10.0 if z500 is not None else None,
        "wind850": math.hypot(*w850) if w850 else None,
        "wind500": math.hypot(*w500) if w500 else None,
        "wind250": math.hypot(*w250) if w250 else None,
        "theta_e": _theta_e_850(t850, td850), "fzl": fzl,
        "cape": cape, "li": li, "cin": cin, "shr6": shr6, "shr1": shr1, "srh1": srh1, "srh3": srh3,
        "stp": stp, "scp": scp_v, "ship": ship_v, "ehi": ehi, "lr75": lr75, "lcl": lcl_h,
        "kindex": kindex, "tt": tt, "lpi": lpi,
        # wind vectors (m/s) for barbs and the particle animation
        "u10": w10[0] if w10 else None, "v10": w10[1] if w10 else None,
        "u850": w850[0] if w850 else None, "v850": w850[1] if w850 else None,
        "u500": w500[0] if w500 else None, "v500": w500[1] if w500 else None,
        "u250": w250[0] if w250 else None, "v250": w250[1] if w250 else None,
    }
    out["wmaxshear"] = math.sqrt(2 * cape) * shr6 if (cape is not None and cape > 0 and shr6 is not None) else (0.0 if shr6 is not None else None)
    out["q2"] = 622.0 * sat_vapor_pressure(min(td2, t2)) / 1000.0 if (td2 is not None and t2 is not None) else None
    out["threat"] = threat_level(cape, shr6, srh1, stp, scp_v, ship_v, li, lpi, precip)
    return out


def add_gradient_params(cols, grid, idx):
    """Grid-based kinematic fields for one hour (in place).

    Surface convergence, moisture-flux convergence, initiation potential, 500 hPa absolute
    vorticity, 850 hPa temperature advection and 850 hPa 2-D Petterssen frontogenesis.
    Centred differences on the model grid (one-sided at the edges of the data mask).

    cols: {param: [values per point]}; grid: dict(step, lat0, nlat, nlon); idx: flat grid index per point.
    """
    n, nlon, step = len(idx), grid["nlon"], grid["step"]
    pos = {k: p for p, k in enumerate(idx)}
    g = cols.get

    def prod(a, b):
        if a is None or b is None:
            return None
        return [None if (x is None or y is None) else x * y for x, y in zip(a, b)]

    u, v, q = g("u10"), g("v10"), g("q2")
    qu, qv = prod(q, u), prod(q, v)
    u8, v8, u5, v5, t8 = g("u850"), g("v850"), g("u500"), g("v500"), g("t850")
    th8 = None if t8 is None else [None if t is None else (t + 273.15) * (1000.0 / 850.0) ** 0.2857 for t in t8]
    out = {k: [None] * n for k in ("conv10", "mfc", "ci", "vort500", "tadv850", "fronto850")}
    r_earth, omega = 6371000.0, 7.2921e-5
    dy = math.radians(step) * r_earth

    for p, k in enumerate(idx):
        iy, ix = divmod(k, nlon)
        lat = grid["lat0"] + iy * step
        dx = math.radians(step) * r_earth * math.cos(math.radians(lat))

        def nb(di, dj):
            return pos.get((iy + dj) * nlon + ix + di) if 0 <= ix + di < nlon else None

        e, w, nn, s = nb(1, 0), nb(-1, 0), nb(0, 1), nb(0, -1)

        def deriv(arr, fwd, back, dist):
            if arr is None:
                return None
            a = arr[fwd] if fwd is not None else None
            b = arr[back] if back is not None else None
            c = arr[p]
            if a is not None and b is not None:
                return (a - b) / (2 * dist)
            if c is None:
                return None
            if a is not None:
                return (a - c) / dist
            if b is not None:
                return (c - b) / dist
            return None

        ddx = lambda arr: deriv(arr, e, w, dx)  # noqa: E731
        ddy = lambda arr: deriv(arr, nn, s, dy)  # noqa: E731

        # --- surface convergence, moisture-flux convergence, initiation potential
        dudx, dvdy = ddx(u), ddy(v)
        if dudx is not None and dvdy is not None:
            conv = -(dudx + dvdy) * 1e5
            out["conv10"][p] = round(conv, 2)
            dqu, dqv = ddx(qu), ddy(qv)
            if dqu is not None and dqv is not None:
                out["mfc"][p] = round(-(dqu + dqv) * 3600, 2)
            cape, cin = (g("cape") or [0] * n)[p] or 0, (g("cin") or [0] * n)[p] or 0
            f_cape = min(1.0, cape / 1000.0)
            f_cin = max(0.0, min(1.0, 1 + cin / 150.0))
            f_conv = max(0.0, min(1.0, 0.35 + conv / 2.0))
            out["ci"][p] = round(100 * f_cape * f_cin * f_conv)

        # --- 500 hPa absolute vorticity (1e-5 s-1)
        dv5dx, du5dy = ddx(v5), ddy(u5)
        if dv5dx is not None and du5dy is not None:
            f = 2 * omega * math.sin(math.radians(lat))
            out["vort500"][p] = round((dv5dx - du5dy + f) * 1e5, 1)

        # --- 850 hPa temperature advection (K / 3 h) and Petterssen frontogenesis
        if th8 is not None and u8 is not None and u8[p] is not None and v8[p] is not None:
            dtx, dty = ddx(t8), ddy(t8)
            if dtx is not None and dty is not None:
                out["tadv850"][p] = round(-(u8[p] * dtx + v8[p] * dty) * 10800, 2)
            ttx, tty = ddx(th8), ddy(th8)
            du8x, du8y, dv8x, dv8y = ddx(u8), ddy(u8), ddx(v8), ddy(v8)
            if None not in (ttx, tty, du8x, du8y, dv8x, dv8y):
                grad = math.hypot(ttx, tty)
                if grad > 1e-9:
                    fg = -(ttx * ttx * du8x + ttx * tty * (dv8x + du8y) + tty * tty * dv8y) / grad
                    out["fronto850"][p] = round(fg * 1e5 * 10800, 2)  # K / 100 km / 3 h
    cols.update(out)
