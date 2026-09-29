"""Offline demo data (STORMMAP_DEMO=1).

Synthesises an Open-Meteo-shaped forecast with a progressive trough and a warm, moist
sector over Ukraine/Poland/Romania, plus a radar mosaic and lightning with moving cells —
so the whole application (maps, soundings, tracking) can be exercised without internet.
"""

import math
import random
import struct
import time
import zlib

from .thermo import sat_vapor_pressure

HOUR = 3600


def _start():
    now = int(time.time())
    return now - now % 86400


def _field(lat, lon, t_unix):
    """Synthetic meteorology at a location/time. Returns a dict of surface + level values."""
    t_h = (t_unix - _start()) / HOUR
    utc = (t_unix % 86400) / HOUR
    # Front / trough axis progressing east ~0.3°/h, tilted SW-NE
    front = 20.0 + 0.3 * t_h + 0.5 * (lat - 50)
    dx = lon - front  # >0 = warm sector (east of front)
    warm = 1 / (1 + math.exp(-dx * 1.2)) * math.exp(-max(dx - 6, 0) / 6)
    south = max(0.0, min(1.0, (60 - lat) / 15))
    local_solar = (utc + lon / 15.0) % 24
    diurnal = max(0.0, math.sin(math.pi * (local_solar - 8) / 12)) if 8 <= local_solar <= 20 else 0.0
    ripple = 0.5 + 0.5 * math.sin(lat * 1.7 + lon * 0.9) * math.cos(lon * 0.6 - t_h * 0.05)

    t2 = 14 + 14 * south + 6 * diurnal - 6 * (1 - warm) - 3 * (1 - diurnal)
    td2 = min(t2 - 1, 6 + 13 * warm * south + 2 * ripple)
    cape = max(0.0, 4200 * warm * south ** 1.2 * (0.25 + 0.75 * diurnal) * (0.6 + 0.4 * ripple) - 150)
    cin = -(15 + 160 * (1 - diurnal)) * (0.3 + warm)
    jet = 0.6 + 0.4 * math.exp(-((dx - 1.5) ** 2) / 18)

    def wind(spd, d):
        return max(spd, 0.5), d % 360

    w10 = wind(4 + 3 * warm, 160 - 30 * (1 - warm))
    w925 = wind((8 + 8 * warm) * (1.2 - 0.4 * diurnal), 170 - 15 * (1 - warm))
    w850 = wind(10 + 10 * warm * jet, 190)
    w700 = wind(14 + 10 * jet, 210)
    w500 = wind(18 + 16 * jet, 225)
    w250 = wind(30 + 25 * jet, 235)

    low = 17 * math.exp(-(((lat - 57) / 6) ** 2 + ((lon - front + 1) / 9) ** 2))
    high = 11 * math.exp(-(((lat - 46) / 7) ** 2 + ((lon - front + 17) / 10) ** 2))
    mslp = 1013 - low + high - 3 * warm + 2 * math.sin(lon * 0.15 + lat * 0.1)

    t850 = t2 - 11 - 2 * diurnal
    t700 = t850 - 13
    t500 = -9 - 0.45 * (lat - 45) - 5 * (1 - warm) - 2 * jet
    z500 = 5780 - 11 * (lat - 45) - 90 * math.exp(-((dx + 2) ** 2) / 20)
    precip = 0.0
    if cape > 800 and diurnal > 0.4 and ripple > 0.55:
        precip = round((cape / 1000) * (ripple - 0.5) * 6, 1)
    precip += max(0.0, 2.5 * math.exp(-(dx ** 2) / 2) * (0.5 + 0.5 * ripple))

    return {
        "temperature_2m": round(t2, 1), "dew_point_2m": round(td2, 1),
        "surface_pressure": round(1008 - 6 * warm - (lat - 45) * 0.1, 1),
        "pressure_msl": round(mslp, 1),
        "precipitation": round(precip, 1), "rain": round(precip, 1), "showers": round(precip * 0.7, 1),
        "snowfall": 0.0, "precipitation_probability": min(100, round(precip * 25)),
        "wind_speed_10m": round(w10[0], 1), "wind_direction_10m": round(w10[1]),
        "wind_gusts_10m": round(w10[0] * 1.8 + (cape / 250 if precip > 1 else 0), 1),
        "cape": round(cape), "lifted_index": round(-cape / 420 + 1.5, 1), "convective_inhibition": round(-cin),
        "freezing_level_height": round(3900 - 70 * (lat - 45) + 300 * warm),
        "cloud_cover": round(min(100, 20 + 60 * (precip > 0.2) + 30 * (1 - warm))),
        "cloud_cover_low": 20, "cloud_cover_mid": 30, "cloud_cover_high": 40, "visibility": 24000,
        "lightning_potential": round(cape / 900 * diurnal, 1) if precip > 0.5 else 0.0,
        "boundary_layer_height": round(400 + 1600 * diurnal), "weather_code": 95 if precip > 3 else (61 if precip > 0.3 else 2),
        "total_column_integrated_water_vapour": round(15 + 25 * warm * south, 1),
        "temperature_850hPa": round(t850, 1), "temperature_700hPa": round(t700, 1), "temperature_500hPa": round(t500, 1),
        "dew_point_850hPa": round(t850 - 2 - 6 * (1 - warm), 1), "dew_point_700hPa": round(t700 - 7, 1),
        "wind_speed_925hPa": round(w925[0], 1), "wind_direction_925hPa": round(w925[1]),
        "wind_speed_850hPa": round(w850[0], 1), "wind_direction_850hPa": round(w850[1]),
        "wind_speed_700hPa": round(w700[0], 1), "wind_direction_700hPa": round(w700[1]),
        "wind_speed_500hPa": round(w500[0], 1), "wind_direction_500hPa": round(w500[1]),
        "wind_speed_250hPa": round(w250[0], 1), "wind_direction_250hPa": round(w250[1]),
        "geopotential_height_700hPa": round(z500 - 2700), "geopotential_height_500hPa": round(z500),
        "_warm": warm, "_diurnal": diurnal, "_t500": t500, "_t850": t850, "_t2": t2, "_td2": td2,
        "_w": {1000: w10, 925: w925, 850: w850, 700: w700, 500: w500, 250: w250},
    }


def _times(days=3):
    s = _start()
    return [s + i * HOUR for i in range(24 * days)]


def grid_response(coords, variables, model="best_match"):
    times = _times()
    out = []
    # each demo "model" is the same synthetic atmosphere, shifted slightly in space and time
    dlat, dlon, dt = _model_offset(model)
    for lat, lon in coords:
        hourly = {"time": times}
        rows = [_field(lat + dlat, lon + dlon, t + dt) for t in times]
        for k in variables:
            hourly[k] = [r.get(k) for r in rows]
        out.append({"latitude": lat, "longitude": lon, "elevation": 150.0, "hourly": hourly})
    return out


def _level_values(f, p):
    """Temperature / RH / wind / height at pressure level p from a synthetic field."""
    # height from hypsometric approximation
    z = 44330 * (1 - (p / 1013.25) ** 0.1903)
    zs = 150.0
    t2, t850, t500 = f["_t2"], f["_t850"], f["_t500"]
    if p >= 850:
        frac = (1013 - p) / (1013 - 850)
        t = t2 + (t850 - t2) * frac
    elif p >= 500:
        frac = (850 - p) / 350
        t = t850 + (t500 - t850) * frac
    else:
        z11 = 11000
        t = t500 - 6.8 * (min(z, z11) - 5600) / 1000
    if p >= 850:
        rh = 60 + 25 * f["_warm"]
    elif p >= 700:
        rh = 55
    else:
        rh = 35 + 20 * f["_warm"]
    levels = sorted(f["_w"])
    lo = max([lv for lv in levels if lv <= p] or [levels[0]])
    hi = min([lv for lv in levels if lv >= p] or [levels[-1]])
    if lo == hi:
        spd, d = f["_w"][lo]
    else:
        a = (p - lo) / (hi - lo)
        s0, d0 = f["_w"][lo]
        s1, d1 = f["_w"][hi]
        spd = s0 + (s1 - s0) * a
        d = d0 + (((d1 - d0 + 180) % 360) - 180) * a
    if p < 250:
        spd *= 0.8
    return {"t": round(t, 1), "rh": round(rh), "z": round(max(z, zs + 30)), "spd": round(spd, 1), "dir": round(d % 360)}


def _model_offset(model):
    k = sum(map(ord, model)) % 7 if model and model != "best_match" else 3
    return 0.25 * (k - 3) / 3, 0.4 * (k - 3) / 3, (k - 3) * 1200


def point_response(lat, lon, levels, model="best_match"):
    times = _times()
    hourly = {"time": times}
    dlat, dlon, dt = _model_offset(model)
    rows = [_field(lat + dlat, lon + dlon, t + dt) for t in times]
    for k in rows[0]:
        if not k.startswith("_"):
            hourly[k] = [r[k] for r in rows]
    for p in levels:
        vals = [_level_values(r, p) for r in rows]
        hourly[f"temperature_{p}hPa"] = [v["t"] for v in vals]
        hourly[f"relative_humidity_{p}hPa"] = [v["rh"] for v in vals]
        hourly[f"geopotential_height_{p}hPa"] = [v["z"] for v in vals]
        hourly[f"wind_speed_{p}hPa"] = [v["spd"] for v in vals]
        hourly[f"wind_direction_{p}hPa"] = [v["dir"] for v in vals]
    return {"latitude": lat, "longitude": lon, "elevation": 150.0, "hourly": hourly}


def meteogram_response(lat, lon, models, variables):
    times = [t for t in _times(7)]
    hourly = {"time": times}
    for mi, m in enumerate(models):
        rows = [_field(lat + 0.3 * mi, lon - 0.4 * mi, t + mi * 1800) for t in times]
        for v in variables:
            key = v if len(models) == 1 else f"{v}_{m}"
            hourly[key] = [r.get(v) for r in rows]
    return {"hourly": hourly}


def _weather_code(f):
    if f["precipitation"] >= 3 and f["cape"] > 500:
        return 95
    if f["precipitation"] >= 2:
        return 63
    if f["precipitation"] >= 0.3:
        return 61
    if f["cloud_cover"] >= 85:
        return 3
    if f["cloud_cover"] >= 50:
        return 2
    return 1 if f["cloud_cover"] >= 20 else 0


def forecast_response(lat, lon, hourly_vars, daily_vars):
    times = _times(7)
    rows = [_field(lat, lon, t) for t in times]
    hourly = {"time": times}
    for v in hourly_vars:
        if v == "weather_code":
            hourly[v] = [_weather_code(r) for r in rows]
        elif v == "apparent_temperature":
            hourly[v] = [round(r["temperature_2m"] - 0.4 * r["wind_speed_10m"] + 0.1 * (r["dew_point_2m"] - 10), 1) for r in rows]
        elif v == "relative_humidity_2m":
            hourly[v] = [round(min(100, 100 * sat_vapor_pressure(r["dew_point_2m"]) / sat_vapor_pressure(r["temperature_2m"]))) for r in rows]
        elif v == "is_day":
            hourly[v] = [1 if 5 <= ((t % 86400) / 3600 + lon / 15) % 24 < 19 else 0 for t in times]
        else:
            hourly[v] = [r.get(v) for r in rows]
    daily = {"time": [times[i] for i in range(0, len(times), 24)]}
    for d in range(7):
        sl = rows[d * 24:(d + 1) * 24]
        codes = [_weather_code(r) for r in sl]
        vals = {
            "weather_code": max(codes), "temperature_2m_max": max(r["temperature_2m"] for r in sl),
            "temperature_2m_min": min(r["temperature_2m"] for r in sl),
            "precipitation_sum": round(sum(r["precipitation"] for r in sl), 1),
            "precipitation_probability_max": max(r["precipitation_probability"] for r in sl),
            "wind_gusts_10m_max": max(r["wind_gusts_10m"] for r in sl), "wind_direction_10m_dominant": 200,
            "sunrise": daily["time"][d] + int((5.5 - lon / 15) * 3600), "sunset": daily["time"][d] + int((18.5 - lon / 15) * 3600),
            "uv_index_max": 6.5,
        }
        for v in daily_vars:
            daily.setdefault(v, []).append(vals.get(v))
    return {"latitude": lat, "longitude": lon, "elevation": 150.0, "timezone": "GMT", "utc_offset_seconds": 0,
            "hourly": hourly, "daily": daily}


def ensemble_response(lat, lon, variables):
    times = _times(7)
    hourly = {"time": times}
    for mem in range(0, 21):
        rows = [_field(lat + 0.15 * math.sin(mem), lon + 0.4 * math.cos(mem * 1.3), t + (mem - 10) * 900) for t in times]
        for v in variables:
            key = v if mem == 0 else f"{v}_member{mem:02d}"
            hourly[key] = [r.get(v) for r in rows]
    return {"hourly": hourly}


# ----------------------------------------------------------------------------------------
# Radar & lightning
# ----------------------------------------------------------------------------------------

# Approximation of RainViewer "Universal Blue" colours (dBZ lower bound, RGBA).
PALETTE = [
    (10, (136, 221, 238, 160)), (20, (0, 153, 204, 200)), (30, (0, 85, 170, 220)),
    (38, (255, 238, 0, 255)), (44, (255, 170, 0, 255)), (49, (255, 68, 0, 255)),
    (54, (200, 0, 0, 255)), (60, (255, 120, 255, 255)), (66, (255, 255, 255, 255)),
]

# Demo storm cells: (lat0, lon0, peak dBZ, radius km, u m/s, v m/s, birth offset min)
CELLS = [
    (49.2, 31.0, 62, 22, 13, 9, -200), (48.4, 33.2, 57, 18, 12, 8, -150), (50.6, 28.8, 52, 26, 11, 10, -240),
    (47.6, 29.7, 59, 16, 14, 7, -120), (51.8, 24.9, 48, 30, 10, 12, -300), (46.2, 26.4, 55, 20, 12, 10, -180),
    (52.7, 21.9, 50, 24, 9, 12, -260), (45.3, 24.7, 46, 28, 10, 9, -220), (49.9, 35.8, 64, 20, 15, 8, -90),
    (44.4, 27.5, 51, 22, 11, 8, -160),
]


def radar_times(n=13, step=600):
    now = int(time.time())
    last = now - now % step
    return [last - (n - 1 - i) * step for i in range(n)]


def _cells_at(t):
    out = []
    minutes = (t - _start()) / 60.0
    for lat0, lon0, peak, rad, u, v, birth in CELLS:
        # each cell lives through a repeating 6-hour cycle so the demo never runs dry
        age = (minutes % 360) - (180 + birth / 2)
        dt = age * 60
        lat = lat0 + v * dt / 111000.0
        lon = lon0 + u * dt / (111000.0 * math.cos(math.radians(lat0)))
        life = max(0.0, min(1.0, 1 - abs(age) / 260))
        out.append((lat, lon, peak * (0.75 + 0.25 * life), rad * (0.6 + 0.4 * life)))
    return out


def _dbz_color(dbz):
    col = None
    for lo, c in PALETTE:
        if dbz >= lo:
            col = c
    return col


def _png(width, height, rows):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + r for r in rows)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def _tile_lat(y, n):
    return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))


def radar_tile(t, z, x, y, size=256):
    n = 2 ** z
    lon_w, lon_e = x / n * 360 - 180, (x + 1) / n * 360 - 180
    lat_n, lat_s = _tile_lat(y, n), _tile_lat(y + 1, n)
    buf = bytearray(size * size * 4)
    for lat, lon, peak, rad in _cells_at(t):
        dlat = rad * 3 / 111.0
        dlon = dlat / math.cos(math.radians(lat))
        if lat + dlat < lat_s or lat - dlat > lat_n or lon + dlon < lon_w or lon - dlon > lon_e:
            continue
        # pixel window
        px0 = int(max(0, (lon - dlon - lon_w) / (lon_e - lon_w) * size))
        px1 = int(min(size - 1, (lon + dlon - lon_w) / (lon_e - lon_w) * size))
        for py in range(size):
            plat = _tile_lat(y + (py + 0.5) / size, n)
            if abs(plat - lat) > dlat:
                continue
            dy = (plat - lat) * 111.0
            for px in range(px0, px1 + 1):
                plon = lon_w + (px + 0.5) / size * (lon_e - lon_w)
                dxk = (plon - lon) * 111.0 * math.cos(math.radians(lat))
                # elongated along the SW-NE axis with a trailing stratiform shield
                a = (dxk * 0.8 + dy * 0.6)
                b = (-dxk * 0.6 + dy * 0.8)
                r2 = (a / (rad * 1.5)) ** 2 + (b / rad) ** 2
                dbz = peak * math.exp(-r2 * 1.2)
                if dbz < 10:
                    continue
                col = _dbz_color(dbz)
                o = (py * size + px) * 4
                if col and (buf[o + 3] == 0 or _dbz_rank(col) > _dbz_rank(tuple(buf[o:o + 4]))):
                    buf[o:o + 4] = bytes(col)
    rows = [bytes(buf[r * size * 4:(r + 1) * size * 4]) for r in range(size)]
    return _png(size, size, rows)


def _dbz_rank(col):
    for i, (_, c) in enumerate(PALETTE):
        if tuple(c) == tuple(col):
            return i
    return -1


def strikes(since_ms):
    """Synthetic lightning strikes near the strongest demo cells over the last few minutes."""
    now = time.time()
    out = []
    rnd = random.Random(int(now // 5))
    for lat, lon, peak, rad in _cells_at(int(now)):
        if peak < 45:
            continue
        rate = int((peak - 44) * 0.6)
        for _ in range(rate):
            r = rnd.gauss(0, rad / 111.0 * 0.4)
            a = rnd.random() * 2 * math.pi
            out.append({"lat": round(lat + r * math.sin(a), 4), "lon": round(lon + r * math.cos(a) / math.cos(math.radians(lat)), 4),
                        "time": int((now - rnd.random() * 5) * 1000)})
    return [s for s in out if s["time"] > since_ms]



def metars():
    """Synthetic METAR-like station reports at towns (demo mode)."""
    from .geo import cities
    now = int(time.time())
    out = []
    for k, (name, cc, lat, lon) in enumerate(cities()):
        if k % 2:
            continue
        f = _field(lat, lon, now)
        u_dir = f["wind_direction_10m"]
        wx = "TSRA" if f["precipitation"] > 3 and f["cape"] > 500 else ("RA" if f["precipitation"] > 0.3 else "")
        cover = 8 if f["cloud_cover"] > 85 else 6 if f["cloud_cover"] > 60 else 4 if f["cloud_cover"] > 30 else 2 if f["cloud_cover"] > 10 else 0
        out.append({"id": f"DM{k:02d}", "name": name, "lat": lat, "lon": lon, "time": now - now % 1800,
                    "t": round(f["temperature_2m"]), "td": round(f["dew_point_2m"]), "wdir": round(u_dir / 10) * 10, "vrb": False,
                    "wspd": round(f["wind_speed_10m"] * 1.944), "wgst": round(f["wind_gusts_10m"] * 1.944) if f["precipitation"] > 1 else None,
                    "p": f["pressure_msl"], "vis": "6+", "wx": wx, "cover": cover,
                    "raw": f"DEMO {name.upper()} {round(u_dir / 10) * 10:03d}{round(f['wind_speed_10m'] * 1.944):02d}KT {wx} {round(f['temperature_2m']):02d}/{round(f['dew_point_2m']):02d} Q{round(f['pressure_msl'])}"})
    return out
