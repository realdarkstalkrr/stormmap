"""Static configuration: coverage area, numerical weather models and variables."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = ROOT / "static"
CACHE_DIR = Path(os.environ.get("STORMMAP_CACHE_DIR", ROOT / ".cache"))

HOST = os.environ.get("STORMMAP_HOST", "0.0.0.0")
PORT = int(os.environ.get("STORMMAP_PORT", "8000"))
# Optional built-in TLS (GPS, offline mode and notifications need HTTPS outside localhost).
# A reverse proxy (Caddy / nginx) with Let's Encrypt is the recommended public setup.
TLS_CERT = os.environ.get("STORMMAP_TLS_CERT", "")
TLS_KEY = os.environ.get("STORMMAP_TLS_KEY", "")

# Open-Meteo endpoints. A commercial API key can be supplied to lift rate limits.
OPEN_METEO_KEY = os.environ.get("OPEN_METEO_API_KEY", "")
OPEN_METEO_FORECAST = os.environ.get(
    "OPEN_METEO_URL",
    "https://customer-api.open-meteo.com/v1/forecast" if OPEN_METEO_KEY else "https://api.open-meteo.com/v1/forecast",
)
OPEN_METEO_ENSEMBLE = os.environ.get(
    "OPEN_METEO_ENSEMBLE_URL",
    "https://customer-ensemble-api.open-meteo.com/v1/ensemble" if OPEN_METEO_KEY else "https://ensemble-api.open-meteo.com/v1/ensemble",
)
OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
RAINVIEWER_MAPS = "https://api.rainviewer.com/public/weather-maps.json"
METEOALARM_FEED = "https://feeds.meteoalarm.org/api/v1/warnings/feeds-{slug}"

# Offline demo mode: synthesise model data instead of calling Open-Meteo.
DEMO_MODE = os.environ.get("STORMMAP_DEMO", "0") == "1"

# Grid fetch settings. Open-Meteo counts a request with >10 variables as several calls
# (per location), and the free tier allows 600 calls/min, 5 000/h and 10 000/day.
# The core variable set (22 vars = 2.2 calls per point) with ~260 points fits in one minute;
# with an API key the extended variable set and denser grids are enabled.
GRID_EXTENDED = os.environ.get("STORMMAP_GRID_EXTENDED", "1" if OPEN_METEO_KEY else "0") == "1"
GRID_MAX_POINTS = int(os.environ.get("STORMMAP_GRID_MAX_POINTS", "900" if OPEN_METEO_KEY else "260"))
GRID_CHUNK = 40
GRID_TTL = int(os.environ.get("STORMMAP_GRID_TTL", str(3 * 3600)))
POINT_TTL = 30 * 60
FORECAST_DAYS = 3
# Free-tier budgets (calls) used by the request pacer; ignored when an API key is set.
RATE_PER_MIN = int(os.environ.get("STORMMAP_RATE_MIN", "590"))
RATE_PER_HOUR = int(os.environ.get("STORMMAP_RATE_HOUR", "4800"))
RATE_PER_DAY = int(os.environ.get("STORMMAP_RATE_DAY", "9500"))
WARM_CACHE = os.environ.get("STORMMAP_WARM", "1") == "1"

# Coverage: ISO code -> display name, grid bounds (lat_min, lat_max, lon_min, lon_max),
# minimum grid step and MeteoAlarm feed slug (None where the service has no feed).
COUNTRIES = {
    "UA": {"name": "Ukraine", "bounds": (44.3, 52.4, 22.1, 40.3), "step": 0.5, "meteoalarm": "ukraine"},
    "RU": {"name": "Russia (European)", "bounds": (41.1, 70.0, 19.6, 60.0), "step": 1.0, "meteoalarm": None},
    "TR": {"name": "Türkiye", "bounds": (35.8, 42.2, 25.6, 44.9), "step": 0.5, "meteoalarm": None},
    "RO": {"name": "Romania", "bounds": (43.6, 48.3, 20.2, 29.8), "step": 0.35, "meteoalarm": "romania"},
    "BG": {"name": "Bulgaria", "bounds": (41.2, 44.3, 22.3, 28.7), "step": 0.25, "meteoalarm": "bulgaria"},
    "SK": {"name": "Slovakia", "bounds": (47.7, 49.7, 16.8, 22.6), "step": 0.15, "meteoalarm": "slovakia"},
    "PL": {"name": "Poland", "bounds": (49.0, 54.9, 14.1, 24.2), "step": 0.35, "meteoalarm": "poland"},
    "FI": {"name": "Finland", "bounds": (59.7, 70.1, 20.5, 31.6), "step": 0.5, "meteoalarm": "finland"},
    "DE": {"name": "Germany", "bounds": (47.2, 55.1, 5.8, 15.1), "step": 0.35, "meteoalarm": "germany"},
    "BY": {"name": "Belarus", "bounds": (51.2, 56.2, 23.1, 32.8), "step": 0.35, "meteoalarm": None},
}

# Whole coverage area ("ALL" region) — longitude clipped at the Urals.
REGION_BOUNDS = (35.8, 70.1, 5.8, 60.0)
MAP_CENTER = (52.0, 30.0)

# Numerical weather prediction models served by Open-Meteo that cover the area.
# "coverage" lists the countries a limited-area model fully covers (None = global).
MODELS = {
    "best_match": {"name": "Best match (auto blend)", "res": "1–11 km", "coverage": None, "group": "Blend"},
    "ecmwf_ifs025": {"name": "ECMWF IFS 0.25°", "res": "25 km", "coverage": None, "group": "Global"},
    "ecmwf_aifs025_single": {"name": "ECMWF AIFS (AI)", "res": "25 km", "coverage": None, "group": "Global"},
    "gfs_seamless": {"name": "NOAA GFS", "res": "13–25 km", "coverage": None, "group": "Global"},
    "icon_seamless": {"name": "DWD ICON (seamless)", "res": "2–11 km", "coverage": None, "group": "Global"},
    "icon_global": {"name": "DWD ICON Global", "res": "11 km", "coverage": None, "group": "Global"},
    "gem_global": {"name": "CMC GEM Global", "res": "15 km", "coverage": None, "group": "Global"},
    "ukmo_global_deterministic_10km": {"name": "UK Met Office Global", "res": "10 km", "coverage": None, "group": "Global"},
    "jma_gsm": {"name": "JMA GSM", "res": "55 km", "coverage": None, "group": "Global"},
    "cma_grapes_global": {"name": "CMA GRAPES", "res": "15 km", "coverage": None, "group": "Global"},
    "icon_eu": {"name": "DWD ICON-EU", "res": "7 km", "coverage": ["DE", "PL", "SK", "RO", "BG", "BY", "FI", "UA", "TR"], "group": "Regional"},
    "icon_d2": {"name": "DWD ICON-D2", "res": "2 km", "coverage": ["DE"], "group": "Convection-allowing"},
    "meteofrance_arpege_europe": {"name": "Météo-France ARPEGE Europe", "res": "11 km", "coverage": ["DE", "PL", "SK", "RO", "BG", "BY", "FI"], "group": "Regional"},
    "dmi_harmonie_arome_europe": {"name": "DMI HARMONIE-AROME", "res": "2 km", "coverage": ["DE", "PL", "FI"], "group": "Convection-allowing"},
    "metno_nordic": {"name": "MET Nordic", "res": "1 km", "coverage": ["FI"], "group": "Convection-allowing"},
}

PRESSURE_LEVELS_SOUNDING = [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100]

GRID_CORE_VARS = [
    "temperature_2m", "dew_point_2m", "surface_pressure", "pressure_msl", "precipitation", "cloud_cover",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
    "cape", "lifted_index", "convective_inhibition",
    "temperature_850hPa", "temperature_500hPa", "dew_point_850hPa",
    "wind_speed_850hPa", "wind_direction_850hPa",
    "wind_speed_700hPa", "wind_direction_700hPa",
    "wind_speed_500hPa", "wind_direction_500hPa",
    "geopotential_height_500hPa",
]
GRID_EXTENDED_VARS = [
    "freezing_level_height", "lightning_potential",
    "temperature_700hPa", "dew_point_700hPa", "geopotential_height_700hPa",
    "wind_speed_925hPa", "wind_direction_925hPa",
    "wind_speed_250hPa", "wind_direction_250hPa",
]
GRID_VARS = GRID_CORE_VARS + (GRID_EXTENDED_VARS if GRID_EXTENDED else [])

POINT_SURFACE_VARS = [
    "temperature_2m", "dew_point_2m", "surface_pressure", "precipitation",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m",
    "cape", "lifted_index", "convective_inhibition", "freezing_level_height",
    "cloud_cover", "boundary_layer_height",
]

METEOGRAM_VARS = [
    "temperature_2m", "dew_point_2m", "precipitation", "wind_gusts_10m", "wind_speed_10m",
    "cape", "lifted_index", "cloud_cover", "pressure_msl",
    "wind_speed_500hPa", "wind_direction_500hPa", "wind_direction_10m",
]

FORECAST_HOURLY_VARS = [
    "temperature_2m", "apparent_temperature", "dew_point_2m", "relative_humidity_2m",
    "precipitation", "precipitation_probability", "weather_code", "cloud_cover",
    "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m", "pressure_msl", "cape", "is_day",
]
FORECAST_DAILY_VARS = [
    "weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum",
    "precipitation_probability_max", "wind_gusts_10m_max", "wind_direction_10m_dominant",
    "sunrise", "sunset", "uv_index_max",
]

ENSEMBLE_MODELS = {
    "icon_seamless": "DWD ICON-EPS",
    "gfs_seamless": "NOAA GEFS",
    "ecmwf_ifs025": "ECMWF ENS",
    "gem_global": "CMC GEPS",
}
ENSEMBLE_VARS = ["temperature_2m", "precipitation", "wind_gusts_10m", "cape"]
