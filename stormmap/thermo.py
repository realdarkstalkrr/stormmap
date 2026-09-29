"""Thermodynamic helper functions (pure Python, SI units unless noted).

Temperatures are in °C at the public API boundaries unless the name ends in _k.
"""

import math

RD = 287.04        # J kg-1 K-1
RV = 461.5
CP = 1005.7
LV = 2.501e6
G = 9.80665
EPS = RD / RV      # 0.622
KAPPA = RD / CP    # 0.2857
ZERO_C = 273.15


def sat_vapor_pressure(t_c):
    """Saturation vapour pressure over water in hPa (Bolton 1980)."""
    return 6.112 * math.exp(17.67 * t_c / (t_c + 243.5))


def mixing_ratio(e_hpa, p_hpa):
    """Mixing ratio (kg/kg) from vapour pressure and pressure."""
    e = min(e_hpa, p_hpa * 0.5)
    return EPS * e / (p_hpa - e)


def sat_mixing_ratio(t_c, p_hpa):
    return mixing_ratio(sat_vapor_pressure(t_c), p_hpa)


def dewpoint_from_rh(t_c, rh):
    rh = max(min(rh, 100.0), 0.5)
    e = sat_vapor_pressure(t_c) * rh / 100.0
    ln = math.log(e / 6.112)
    return 243.5 * ln / (17.67 - ln)


def dewpoint_from_mixing_ratio(w, p_hpa):
    e = w * p_hpa / (EPS + w)
    e = max(e, 1e-6)
    ln = math.log(e / 6.112)
    return 243.5 * ln / (17.67 - ln)


def virtual_temp_k(t_c, w):
    return (t_c + ZERO_C) * (1.0 + 0.61 * w)


def potential_temp_k(t_c, p_hpa):
    return (t_c + ZERO_C) * (1000.0 / p_hpa) ** KAPPA


def temp_from_theta_c(theta_k, p_hpa):
    return theta_k * (p_hpa / 1000.0) ** KAPPA - ZERO_C


def lcl(t_c, td_c, p_hpa):
    """Lifting condensation level: returns (p_lcl hPa, t_lcl °C) using Bolton (1980)."""
    t_k = t_c + ZERO_C
    td_k = min(td_c, t_c) + ZERO_C
    t_lcl = 1.0 / (1.0 / (td_k - 56.0) + math.log(t_k / td_k) / 800.0) + 56.0
    p_lcl = p_hpa * (t_lcl / t_k) ** (1.0 / KAPPA)
    return p_lcl, t_lcl - ZERO_C


def equiv_potential_temp_k(t_c, td_c, p_hpa):
    """Equivalent potential temperature (Bolton 1980, eq. 43)."""
    w = sat_mixing_ratio(td_c, p_hpa)
    t_k = t_c + ZERO_C
    _, t_lcl = lcl(t_c, td_c, p_hpa)
    t_l = t_lcl + ZERO_C
    theta = t_k * (1000.0 / p_hpa) ** (0.2854 * (1 - 0.28 * w))
    return theta * math.exp((3.376 / t_l - 0.00254) * w * 1000.0 * (1 + 0.81 * w))


def wet_bulb_c(t_c, td_c, p_hpa):
    """Wet-bulb temperature via lifting to LCL and descending moist-adiabatically."""
    p_l, t_l = lcl(t_c, td_c, p_hpa)
    return moist_descend(t_l, p_l, p_hpa)


def _moist_lapse(t_k, p_hpa):
    """dT/dp (K/hPa) along a pseudo-adiabat."""
    t_c = t_k - ZERO_C
    rs = sat_mixing_ratio(t_c, p_hpa)
    num = (RD * t_k + LV * rs) / p_hpa
    den = CP + (LV * LV * rs * EPS) / (RD * t_k * t_k)
    return num / den


def moist_step(t_c, p0, p1, substeps=1):
    """Integrate the pseudo-adiabat from p0 to p1 (RK4). Returns T (°C) at p1."""
    t = t_c + ZERO_C
    h = (p1 - p0) / substeps
    p = p0
    for _ in range(substeps):
        k1 = _moist_lapse(t, p)
        k2 = _moist_lapse(t + 0.5 * h * k1, p + 0.5 * h)
        k3 = _moist_lapse(t + 0.5 * h * k2, p + 0.5 * h)
        k4 = _moist_lapse(t + h * k3, p + h)
        t += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6.0
        p += h
    return t - ZERO_C


def moist_descend(t_c, p_from, p_to, step=10.0):
    n = max(1, int(abs(p_to - p_from) / step))
    return moist_step(t_c, p_from, p_to, substeps=n)


def wind_components(speed, direction_deg):
    """Meteorological (speed, direction-from) -> (u, v)."""
    rad = math.radians(direction_deg)
    return -speed * math.sin(rad), -speed * math.cos(rad)


def wind_speed_dir(u, v):
    spd = math.hypot(u, v)
    if spd < 1e-9:
        return 0.0, 0.0
    return spd, (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0


def interp(x, xs, ys):
    """Linear interpolation of ys over monotonic (increasing or decreasing) xs; None if out of range."""
    n = len(xs)
    if n == 0:
        return None
    if n == 1:
        return ys[0] if x == xs[0] else None
    increasing = xs[-1] > xs[0]
    if increasing:
        if x < xs[0] or x > xs[-1]:
            return None
    else:
        if x > xs[0] or x < xs[-1]:
            return None
    lo, hi = 0, n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if (xs[mid] <= x) == increasing:
            lo = mid
        else:
            hi = mid
    x0, x1 = xs[lo], xs[hi]
    if x1 == x0:
        return ys[lo]
    f = (x - x0) / (x1 - x0)
    return ys[lo] + f * (ys[hi] - ys[lo])
