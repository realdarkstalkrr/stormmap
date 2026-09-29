"""Full-column convective analysis of a model forecast sounding.

Implements parcel theory (SB / ML / MU parcels with virtual-temperature correction),
effective inflow layer, Bunkers storm motion, storm-relative helicity, bulk shear,
DCAPE and the composite indices storm chasers use (STP, SCP, SHIP, DCP, EHI...).
"""

import math

from .thermo import (
    G, RD, ZERO_C, dewpoint_from_mixing_ratio, dewpoint_from_rh, equiv_potential_temp_k,
    interp, lcl, mixing_ratio, moist_descend, moist_step, potential_temp_k,
    sat_mixing_ratio, sat_vapor_pressure, temp_from_theta_c, virtual_temp_k, wet_bulb_c,
    wind_components, wind_speed_dir,
)

MS_TO_KT = 1.943844
FINE_DP = 10.0  # hPa resolution of the analysis column


class Profile:
    """An observed/forecast column on a fine pressure grid (surface first)."""

    def __init__(self, p, z, t, td, u, v, elev):
        self.p = p
        self.z = z
        self.t = t
        self.td = td
        self.u = u
        self.v = v
        self.elev = elev
        self.lnp = [math.log(x) for x in p]
        self.w = [mixing_ratio(sat_vapor_pressure(d), pp) for d, pp in zip(td, p)]
        self.tv = [virtual_temp_k(tt, ww) for tt, ww in zip(t, self.w)]
        self.agl = [zz - elev for zz in z]

    def at_p(self, arr, p):
        return interp(-math.log(p), [-x for x in self.lnp], arr)

    def height_agl_at_p(self, p):
        v = self.at_p(self.agl, p)
        return v

    def p_at_height(self, h_agl):
        lnp = interp(h_agl, self.agl, self.lnp)
        return math.exp(lnp) if lnp is not None else None

    def at_height(self, arr, h_agl):
        return interp(h_agl, self.agl, arr)


def build_profile(sfc, levels):
    """sfc: dict(p, t, td, u, v, elev); levels: list of dict(p, z, t, td, u, v).

    Returns a Profile interpolated to FINE_DP steps, or None if data are insufficient.
    """
    psfc = sfc["p"]
    elev = sfc["elev"]
    pts = [(psfc, elev, sfc["t"], min(sfc["td"], sfc["t"]), sfc["u"], sfc["v"])]
    for lv in sorted(levels, key=lambda x: -x["p"]):
        if lv["p"] >= psfc - 2 or lv["z"] is None or lv["z"] <= elev + 10:
            continue
        if any(lv[k] is None for k in ("t", "td", "u", "v")):
            continue
        pts.append((lv["p"], lv["z"], lv["t"], min(lv["td"], lv["t"]), lv["u"], lv["v"]))
    if len(pts) < 5 or pts[-1][0] > 300:
        return None

    src_lnp = [-math.log(x[0]) for x in pts]  # increasing
    cols = list(zip(*pts))
    p_top = pts[-1][0]
    fine_p = [psfc]
    p = math.floor(psfc / FINE_DP) * FINE_DP
    if psfc - p < 1.0:
        p -= FINE_DP
    while p >= p_top - 1e-6:
        fine_p.append(p)
        p -= FINE_DP
    fine = {k: [] for k in ("z", "t", "td", "u", "v")}
    for fp in fine_p:
        x = -math.log(fp)
        for idx, key in ((1, "z"), (2, "t"), (3, "td"), (4, "u"), (5, "v")):
            fine[key].append(interp(x, src_lnp, cols[idx]))
    return Profile(fine_p, fine["z"], fine["t"], fine["td"], fine["u"], fine["v"], elev)


# ----------------------------------------------------------------------------------------
# Parcel theory
# ----------------------------------------------------------------------------------------

def lift_parcel(prof, i0, t0, td0):
    """Lift a parcel starting at fine level i0. Returns dict with parcel temperatures & energetics."""
    p0 = prof.p[i0]
    p_lcl, t_lcl = lcl(t0, td0, p0)
    theta = potential_temp_k(t0, p0)
    w0 = mixing_ratio(sat_vapor_pressure(td0), p0)
    tp = []
    tvp = []
    t_moist = None
    p_prev = None
    for i in range(i0, len(prof.p)):
        p = prof.p[i]
        if p >= p_lcl:
            t = temp_from_theta_c(theta, p)
            tv = virtual_temp_k(t, w0)
        else:
            if t_moist is None:
                t_moist = moist_step(t_lcl, p_lcl, p, substeps=max(1, int((p_lcl - p) / FINE_DP) + 1))
            else:
                t_moist = moist_step(t_moist, p_prev, p)
            t = t_moist
            tv = virtual_temp_k(t, sat_mixing_ratio(t, p))
            p_prev = p
        tp.append(t)
        tvp.append(tv)
    return _energetics(prof, i0, tp, tvp, p_lcl, t_lcl)


def _energetics(prof, i0, tp, tvp, p_lcl, t_lcl):
    n = len(tvp)
    buoy = [tvp[k] - prof.tv[i0 + k] for k in range(n)]
    lnp = prof.lnp[i0:]

    # Integrate positive/negative area layer by layer, splitting at zero crossings.
    layers = []  # (p_bot, p_top, area)
    for k in range(n - 1):
        b0, b1 = buoy[k], buoy[k + 1]
        l0, l1 = lnp[k], lnp[k + 1]
        if (b0 >= 0) == (b1 >= 0) or b0 == b1:
            layers.append((k, l0, l1, RD * 0.5 * (b0 + b1) * (l0 - l1)))
        else:
            f = b0 / (b0 - b1)
            lc = l0 + f * (l1 - l0)
            layers.append((k, l0, lc, RD * 0.5 * b0 * (l0 - lc)))
            layers.append((k, lc, l1, RD * 0.5 * b1 * (lc - l1)))

    ln_lcl = math.log(p_lcl)
    # Positive segments (contiguous positive-area layers) above the LCL.
    segs = []
    cur = None
    for (_, lb, lt, a) in layers:
        if a > 0:
            if cur is None:
                cur = [lb, lt, a]
            else:
                cur[1] = lt
                cur[2] += a
        else:
            if cur is not None:
                segs.append(cur)
                cur = None
    if cur is not None:
        segs.append(cur)
    segs = [s for s in segs if s[1] < ln_lcl]  # segment top above LCL

    res = {
        "p_lcl": p_lcl, "t_lcl": t_lcl, "tp": tp, "i0": i0,
        "cape": 0.0, "cin": 0.0, "p_lfc": None, "p_el": None, "cape3": 0.0,
        "lcl_hgt": prof.height_agl_at_p(p_lcl),
        "lfc_hgt": None, "el_hgt": None, "li": None, "max_buoy": max(buoy) if buoy else 0,
    }
    # Lifted index at 500 hPa
    if prof.p[-1] <= 500 <= prof.p[i0]:
        tvp500 = interp(-math.log(500), [-x for x in lnp], tvp)
        tve500 = prof.at_p(prof.tv, 500)
        if tvp500 is not None and tve500 is not None:
            res["li"] = tve500 - tvp500

    if not segs:
        return res
    ln_lfc = min(segs[0][0], ln_lcl)
    ln_el = segs[-1][1]
    cape = 0.0
    cin = 0.0
    cape3 = 0.0
    z3_ln = None
    p3 = prof.p_at_height(3000)
    if p3:
        z3_ln = math.log(p3)
    for (_, lb, lt, a) in layers:
        if lt >= ln_lfc - 1e-9 and lb > ln_lfc:  # below LFC
            if a < 0:
                cin += a
        elif lb <= ln_lfc + 1e-9 and lt >= ln_el - 1e-9:
            if a > 0:
                cape += a
                if z3_ln is not None and lb > z3_ln:
                    frac = 1.0 if lt >= z3_ln else (lb - z3_ln) / (lb - lt)
                    cape3 += a * frac
    res.update({
        "cape": cape, "cin": cin, "cape3": cape3,
        "p_lfc": math.exp(ln_lfc), "p_el": math.exp(ln_el),
    })
    res["lfc_hgt"] = prof.height_agl_at_p(res["p_lfc"])
    res["el_hgt"] = prof.height_agl_at_p(res["p_el"])
    return res


def surface_parcel(prof):
    return lift_parcel(prof, 0, prof.t[0], prof.td[0])


def mixed_layer_parcel(prof, depth=100.0):
    psfc = prof.p[0]
    thetas, ws = [], []
    for i, p in enumerate(prof.p):
        if p < psfc - depth:
            break
        thetas.append(potential_temp_k(prof.t[i], p))
        ws.append(prof.w[i])
    theta = sum(thetas) / len(thetas)
    w = sum(ws) / len(ws)
    t0 = temp_from_theta_c(theta, psfc)
    td0 = min(dewpoint_from_mixing_ratio(w, psfc), t0)
    return lift_parcel(prof, 0, t0, td0)


def most_unstable_parcel(prof, depth=300.0):
    psfc = prof.p[0]
    best, best_i = -1e9, 0
    for i, p in enumerate(prof.p):
        if p < psfc - depth:
            break
        te = equiv_potential_temp_k(prof.t[i], prof.td[i], p)
        if te > best:
            best, best_i = te, i
    parcel = lift_parcel(prof, best_i, prof.t[best_i], prof.td[best_i])
    parcel["p_start"] = prof.p[best_i]
    return parcel


def effective_inflow_layer(prof, mu_cape):
    if mu_cape < 100:
        return None
    psfc = prof.p[0]
    bot = top = None
    for i, p in enumerate(prof.p):
        if p < psfc - 300:
            break
        pc = lift_parcel(prof, i, prof.t[i], prof.td[i])
        ok = pc["cape"] >= 100 and pc["cin"] >= -250
        if bot is None:
            if ok:
                bot = i
                top = i
        else:
            if ok:
                top = i
            else:
                break
    if bot is None:
        return None
    return prof.p[bot], prof.p[top]


def dcape(prof):
    """Downdraft CAPE from the minimum theta-e level in the lowest 400 hPa."""
    psfc = prof.p[0]
    best, best_i = 1e9, None
    for i, p in enumerate(prof.p):
        if p < psfc - 400:
            break
        if i == 0:
            continue
        te = equiv_potential_temp_k(prof.t[i], prof.td[i], p)
        if te < best:
            best, best_i = te, i
    if best_i is None:
        return 0.0, None
    t_start = wet_bulb_c(prof.t[best_i], prof.td[best_i], prof.p[best_i])
    total = 0.0
    t_par = t_start
    for i in range(best_i, 0, -1):
        p_hi, p_lo = prof.p[i], prof.p[i - 1]
        t_next = moist_step(t_par, p_hi, p_lo)
        e0 = prof.t[i] + ZERO_C - (t_par + ZERO_C)
        e1 = prof.t[i - 1] + ZERO_C - (t_next + ZERO_C)
        total += RD * 0.5 * (e0 + e1) * math.log(p_lo / p_hi)
        t_par = t_next
    return max(total, 0.0), prof.p[best_i]


# ----------------------------------------------------------------------------------------
# Kinematics
# ----------------------------------------------------------------------------------------

def wind_at(prof, h):
    u = prof.at_height(prof.u, h)
    v = prof.at_height(prof.v, h)
    if u is None or v is None:
        return None
    return u, v


def bulk_shear(prof, h_bot, h_top):
    a = wind_at(prof, h_bot)
    b = wind_at(prof, h_top)
    if a is None or b is None:
        return None
    return b[0] - a[0], b[1] - a[1]


def mean_wind(prof, h_bot, h_top, step=250.0):
    us, vs = [], []
    h = h_bot
    while h <= h_top + 1e-6:
        w = wind_at(prof, h)
        if w:
            us.append(w[0])
            vs.append(w[1])
        h += step
    if not us:
        return None
    return sum(us) / len(us), sum(vs) / len(vs)


def mean_wind_p(prof, p_bot, p_top):
    us, vs = [], []
    for i, p in enumerate(prof.p):
        if p_top <= p <= p_bot:
            us.append(prof.u[i])
            vs.append(prof.v[i])
    if not us:
        return None
    return sum(us) / len(us), sum(vs) / len(vs)


def bunkers(prof):
    """Bunkers (2000) right- and left-moving supercell motion."""
    mw = mean_wind(prof, 0, 6000)
    lo = mean_wind(prof, 0, 500)
    hi = mean_wind(prof, 5500, 6000)
    if not (mw and lo and hi):
        return None
    su, sv = hi[0] - lo[0], hi[1] - lo[1]
    mag = math.hypot(su, sv)
    if mag < 1e-6:
        return {"rm": mw, "lm": mw, "mean": mw}
    d = 7.5
    rm = (mw[0] + d * sv / mag, mw[1] - d * su / mag)
    lm = (mw[0] - d * sv / mag, mw[1] + d * su / mag)
    return {"rm": rm, "lm": lm, "mean": mw}


def helicity(prof, h_bot, h_top, storm, step=100.0):
    cu, cv = storm
    total = 0.0
    prev = wind_at(prof, h_bot)
    h = h_bot + step
    while h <= h_top + 1e-6 and prev:
        cur = wind_at(prof, h)
        if cur is None:
            break
        total += (cur[0] - cu) * (prev[1] - cv) - (prev[0] - cu) * (cur[1] - cv)
        prev = cur
        h += step
    return total


def corfidi(prof):
    """Corfidi upwind/downwind MCS propagation vectors."""
    cloud = mean_wind_p(prof, 850, 300)
    llj = mean_wind(prof, 0, 1500)
    if not (cloud and llj):
        return None
    up = (cloud[0] - llj[0], cloud[1] - llj[1])
    down = (cloud[0] + up[0], cloud[1] + up[1])
    return {"upshear": up, "downshear": down}


# ----------------------------------------------------------------------------------------
# Composite indices
# ----------------------------------------------------------------------------------------

def stp_fixed(sbcape, sblcl, srh1, shr6, sbcin):
    if sblcl is None or shr6 is None:
        return 0.0
    lcl_t = 1.0 if sblcl < 1000 else (0.0 if sblcl > 2000 else (2000 - sblcl) / 1000)
    shr_t = 0.0 if shr6 < 12.5 else min(shr6, 30.0) / 20.0
    cin_t = 1.0 if sbcin > -50 else (0.0 if sbcin < -200 else (200 + sbcin) / 150)
    return max(0.0, (sbcape / 1500.0) * lcl_t * (srh1 / 150.0) * shr_t * cin_t)


def stp_effective(mlcape, mllcl, esrh, ebwd, mlcin):
    if mllcl is None or ebwd is None:
        return 0.0
    lcl_t = 1.0 if mllcl < 1000 else (0.0 if mllcl > 2000 else (2000 - mllcl) / 1000)
    shr_t = 0.0 if ebwd < 12.5 else min(ebwd, 30.0) / 20.0
    cin_t = 1.0 if mlcin > -50 else (0.0 if mlcin < -200 else (200 + mlcin) / 150)
    return max(0.0, (mlcape / 1500.0) * lcl_t * (esrh / 150.0) * shr_t * cin_t)


def scp(mucape, esrh, ebwd, mucin):
    if ebwd is None:
        return 0.0
    shr_t = 0.0 if ebwd < 10 else (1.0 if ebwd > 20 else ebwd / 20.0)
    cin_t = 1.0 if mucin > -40 else -40.0 / mucin
    return max(0.0, (mucape / 1000.0) * (esrh / 50.0) * shr_t * cin_t)


def ship(mucape, mu_w, lr75, t500, shr6, fzl):
    if None in (lr75, t500, shr6) or mucape <= 0:
        return 0.0
    mr = min(max(mu_w * 1000.0, 11.0), 13.6)
    t500 = min(t500, -5.5)
    shr = min(max(shr6, 7.0), 27.0)
    val = mucape * mr * lr75 * (-t500) * shr / 42_000_000.0
    if mucape < 1300:
        val *= mucape / 1300.0
    if lr75 < 5.8:
        val *= lr75 / 5.8
    if fzl is not None and fzl < 2400:
        val *= fzl / 2400.0
    return max(val, 0.0)


def dcp(dcape_v, mucape, shr6, mw6):
    if None in (shr6, mw6):
        return 0.0
    return (dcape_v / 980.0) * (mucape / 2000.0) * (shr6 * MS_TO_KT / 20.0) * (mw6 * MS_TO_KT / 16.0)


def hazard_type(ix):
    """Condensed SHARPpy-style 'possible hazard type' classification."""
    stp = ix.get("stp_eff") or 0
    stpf = ix.get("stp_fixed") or 0
    mlcin = ix.get("mlcin") or 0
    srh1 = ix.get("srh1") or 0
    esrh = ix.get("esrh") or 0
    lcl_ = ix.get("sblcl") or 9999
    ebot = ix.get("eff_base_agl")
    scp_ = ix.get("scp") or 0
    ship_ = ix.get("ship") or 0
    dcape_ = ix.get("dcape") or 0
    shr8 = ix.get("shr8") or 0
    pwat = ix.get("pwat") or 0
    mw6 = ix.get("mean_wind6") or 99
    mucape = ix.get("mucape") or 0
    sfc_based = ebot is not None and ebot < 50
    if stp >= 3 and srh1 >= 200 and esrh >= 200 and shr8 >= 23 and lcl_ < 1000 and mlcin > -50 and sfc_based:
        return "PDS TOR"
    if (stp >= 3 or stpf >= 4) and mlcin > -125 and sfc_based:
        return "TOR"
    if (stp >= 1 or stpf >= 1) and shr8 >= 20 and mlcin > -50 and sfc_based:
        return "TOR"
    if (stp >= 0.5 or stpf >= 0.5) and esrh >= 100 and mlcin > -50 and sfc_based:
        return "MRGL TOR"
    if scp_ >= 4 or ship_ >= 1 or (scp_ >= 2 and dcape_ >= 750):
        return "SVR"
    if scp_ >= 1 or ship_ >= 0.5 or (mucape >= 1000 and dcape_ >= 1000):
        return "MRGL SVR"
    if pwat >= 38 and mw6 < 6 and mucape >= 300:
        return "FLASH FLOOD"
    if mucape >= 100:
        return "TSTM"
    return "NONE"


def storm_mode(ix):
    mucape = ix.get("mucape") or 0
    ebwd = ix.get("ebwd")
    shr6 = ix.get("shr6") or 0
    shear = ebwd if ebwd is not None else shr6
    if mucape < 100:
        return "No deep convection"
    if shear >= 20:
        return "Discrete supercells favoured" if (ix.get("scp") or 0) >= 1 else "Supercells / organised multicells"
    if shear >= 12.5:
        return "Organised multicells / bowing segments / QLCS"
    return "Pulse / disorganised multicells"


# ----------------------------------------------------------------------------------------
# Main entry
# ----------------------------------------------------------------------------------------

def _r(x, nd=1):
    return None if x is None else round(x, nd)


def analyze(prof):
    """Compute every index for a Profile. Returns (indices dict, plot dict)."""
    sb = surface_parcel(prof)
    ml = mixed_layer_parcel(prof)
    mu = most_unstable_parcel(prof)
    eff = effective_inflow_layer(prof, mu["cape"])
    dc, _ = dcape(prof)

    storm = bunkers(prof)
    rm = storm["rm"] if storm else (0.0, 0.0)
    srh1 = helicity(prof, 0, 1000, rm)
    srh3 = helicity(prof, 0, 3000, rm)
    srh500 = helicity(prof, 0, 500, rm)

    def shear_mag(a, b):
        s = bulk_shear(prof, a, b)
        return math.hypot(*s) if s else None

    shr1 = shear_mag(0, 1000)
    shr3 = shear_mag(0, 3000)
    shr6 = shear_mag(0, 6000)
    shr8 = shear_mag(0, 8000)

    esrh, ebwd, eff_base, eff_top = 0.0, None, None, None
    if eff:
        eff_base = prof.height_agl_at_p(eff[0])
        eff_top = prof.height_agl_at_p(eff[1])
        if eff_base is not None and eff_top is not None:
            esrh = helicity(prof, eff_base, max(eff_top, eff_base + 100), rm)
            if mu["el_hgt"]:
                top = eff_base + 0.5 * (mu["el_hgt"] - eff_base)
                s = bulk_shear(prof, eff_base, top)
                ebwd = math.hypot(*s) if s else None

    def lapse(h0, h1):
        t0 = prof.at_height(prof.t, h0)
        t1 = prof.at_height(prof.t, h1)
        if t0 is None or t1 is None:
            return None
        return (t0 - t1) / ((h1 - h0) / 1000.0)

    lr03 = lapse(0, 3000)
    lr700_500 = None
    t700, t500, t850 = prof.at_p(prof.t, 700), prof.at_p(prof.t, 500), prof.at_p(prof.t, 850)
    td850, td700 = prof.at_p(prof.td, 850), prof.at_p(prof.td, 700)
    z700, z500 = prof.at_p(prof.z, 700), prof.at_p(prof.z, 500)
    if None not in (t700, t500, z700, z500):
        lr700_500 = (t700 - t500) / ((z500 - z700) / 1000.0)
    k_index = tt = None
    if None not in (t850, t700, t500, td850, td700):
        k_index = (t850 - t500) + td850 - (t700 - td700)
        tt = t850 + td850 - 2 * t500

    # Freezing level / wet-bulb zero
    fzl = wbz = None
    for i in range(1, len(prof.p)):
        if fzl is None and prof.t[i - 1] >= 0 > prof.t[i]:
            f = prof.t[i - 1] / (prof.t[i - 1] - prof.t[i])
            fzl = prof.agl[i - 1] + f * (prof.agl[i] - prof.agl[i - 1])
    if prof.t[0] < 0:
        fzl = 0.0
    prev_wb = wet_bulb_c(prof.t[0], prof.td[0], prof.p[0])
    if prev_wb < 0:
        wbz = 0.0
    for i in range(1, len(prof.p)):
        if wbz is not None or prof.p[i] < 400:
            break
        wb = wet_bulb_c(prof.t[i], prof.td[i], prof.p[i])
        if prev_wb >= 0 > wb:
            f = prev_wb / (prev_wb - wb)
            wbz = prof.agl[i - 1] + f * (prof.agl[i] - prof.agl[i - 1])
        prev_wb = wb

    # Precipitable water (mm)
    pwat = 0.0
    for i in range(1, len(prof.p)):
        if prof.p[i] < 300:
            break
        pwat += 0.5 * (prof.w[i - 1] + prof.w[i]) * (prof.p[i - 1] - prof.p[i]) * 100.0 / G
    # Showalter index (850 hPa parcel)
    showalter = None
    if t850 is not None and td850 is not None and t500 is not None and prof.p[0] > 850:
        p_l, t_l = lcl(t850, td850, 850)
        t_par = moist_descend(t_l, p_l, 500) if p_l > 500 else temp_from_theta_c(potential_temp_k(t850, 850), 500)
        showalter = t500 - t_par

    mw6 = mean_wind(prof, 0, 6000)
    mw6_mag = math.hypot(*mw6) if mw6 else None
    cf = corfidi(prof)

    ix = {
        "sbcape": sb["cape"], "sbcin": sb["cin"], "sblcl": sb["lcl_hgt"], "sblfc": sb["lfc_hgt"], "sbel": sb["el_hgt"], "sbli": sb["li"],
        "mlcape": ml["cape"], "mlcin": ml["cin"], "mllcl": ml["lcl_hgt"], "mllfc": ml["lfc_hgt"], "mlel": ml["el_hgt"], "mlli": ml["li"],
        "mucape": mu["cape"], "mucin": mu["cin"], "mulcl": mu["lcl_hgt"], "mulfc": mu["lfc_hgt"], "muel": mu["el_hgt"], "muli": mu["li"],
        "mu_p": mu.get("p_start"), "ml3cape": ml["cape3"], "dcape": dc,
        "shr1": shr1, "shr3": shr3, "shr6": shr6, "shr8": shr8, "ebwd": ebwd,
        "srh500": srh500, "srh1": srh1, "srh3": srh3, "esrh": esrh,
        "eff_base_agl": eff_base, "eff_top_agl": eff_top,
        "lr03": lr03, "lr75": lr700_500, "k_index": k_index, "total_totals": tt, "showalter": showalter,
        "fzl": fzl, "wbz": wbz, "pwat": pwat, "mean_wind6": mw6_mag,
        "t500": t500, "t850": t850,
    }
    mu_w = prof.w[mu["i0"]]
    ix["stp_fixed"] = stp_fixed(sb["cape"], sb["lcl_hgt"], srh1, shr6, sb["cin"])
    ix["stp_eff"] = stp_effective(ml["cape"], ml["lcl_hgt"], esrh, ebwd, ml["cin"])
    ix["scp"] = scp(mu["cape"], esrh, ebwd, mu["cin"])
    ix["ship"] = ship(mu["cape"], mu_w, lr700_500, t500, shr6, fzl)
    ix["dcp"] = dcp(dc, mu["cape"], shr6, mw6_mag)
    ix["ehi1"] = sb["cape"] * srh1 / 160000.0
    ix["ehi3"] = sb["cape"] * srh3 / 160000.0
    ix["hazard"] = hazard_type(ix)
    ix["storm_mode"] = storm_mode(ix)

    def vec(t):
        if not t:
            return None
        s, d = wind_speed_dir(*t)
        return {"u": round(t[0], 2), "v": round(t[1], 2), "spd": round(s, 1), "dir": round(d)}

    motions = {
        "bunkers_rm": vec(storm["rm"]) if storm else None,
        "bunkers_lm": vec(storm["lm"]) if storm else None,
        "mean_0_6": vec(storm["mean"]) if storm else None,
        "corfidi_up": vec(cf["upshear"]) if cf else None,
        "corfidi_down": vec(cf["downshear"]) if cf else None,
    }

    out = {}
    for k, v in ix.items():
        if isinstance(v, float):
            nd = 2 if k in ("stp_fixed", "stp_eff", "scp", "ship", "dcp", "ehi1", "ehi3") else 1
            out[k] = round(v, nd)
        else:
            out[k] = v
    out["motions"] = motions

    # Hodograph up to 10 km AGL every 250 m (+ key marker heights)
    hodo = []
    h = 0.0
    while h <= 10000:
        w = wind_at(prof, h)
        if w:
            hodo.append([round(h), round(w[0], 2), round(w[1], 2)])
        h += 250.0

    plot = {
        "p": [_r(x) for x in prof.p],
        "z": [_r(x, 0) for x in prof.agl],
        "t": [_r(x) for x in prof.t],
        "td": [_r(x) for x in prof.td],
        "u": [_r(x, 1) for x in prof.u],
        "v": [_r(x, 1) for x in prof.v],
        "parcels": {
            "sb": {"t": [_r(x) for x in sb["tp"]], "i0": sb["i0"], "lcl": _r(sb["p_lcl"]), "lfc": _r(sb["p_lfc"]), "el": _r(sb["p_el"])},
            "ml": {"t": [_r(x) for x in ml["tp"]], "i0": ml["i0"], "lcl": _r(ml["p_lcl"]), "lfc": _r(ml["p_lfc"]), "el": _r(ml["p_el"])},
            "mu": {"t": [_r(x) for x in mu["tp"]], "i0": mu["i0"], "lcl": _r(mu["p_lcl"]), "lfc": _r(mu["p_lfc"]), "el": _r(mu["p_el"])},
        },
        "eff_layer": [_r(eff[0]), _r(eff[1])] if eff else None,
        "hodograph": hodo,
    }
    return out, plot


def profile_from_openmeteo(data, hour_index, levels):
    """Build a Profile for one hour from an Open-Meteo single-location response."""
    h = data.get("hourly", {})

    def get(name):
        arr = h.get(name)
        if not arr or hour_index >= len(arr):
            return None
        return arr[hour_index]

    t2, td2, ps = get("temperature_2m"), get("dew_point_2m"), get("surface_pressure")
    ws, wd = get("wind_speed_10m"), get("wind_direction_10m")
    if None in (t2, td2, ps, ws, wd):
        return None
    u10, v10 = wind_components(ws, wd)
    sfc = {"p": ps, "t": t2, "td": td2, "u": u10, "v": v10, "elev": data.get("elevation") or 0.0}
    lv = []
    for p in levels:
        t = get(f"temperature_{p}hPa")
        rh = get(f"relative_humidity_{p}hPa")
        z = get(f"geopotential_height_{p}hPa")
        s = get(f"wind_speed_{p}hPa")
        d = get(f"wind_direction_{p}hPa")
        if None in (t, rh, z, s, d):
            continue
        u, v = wind_components(s, d)
        lv.append({"p": p, "z": z, "t": t, "td": dewpoint_from_rh(t, rh), "u": u, "v": v})
    return build_profile(sfc, lv)
