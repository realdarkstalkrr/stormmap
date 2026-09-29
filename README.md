# StormMap ⚡

StormMap is a black, map-first meteorology app for storm chasing and convective analysis. It covers **Ukraine, European Russia, Türkiye, Romania, Bulgaria, Slovakia, Poland, Finland, Germany and Belarus**.

It runs as a single Python server over plain HTTP on **port 8000**. You don't need to install any packages or run a build step.

```bash
python3 server.py            # → http://localhost:8000
python3 server.py --demo     # offline synthetic weather: no internet needed
python3 server.py --port 9000 --host 127.0.0.1
```

Requires Python ≥ 3.9. Leaflet and Chart.js are bundled in `static/vendor/`. The browser only needs internet access for base-map tiles and the live lightning feed.

## Features

| Area | What you get |
|---|---|
| **Weather maps (Ventusky-style)** | Temperature, precipitation over cloud cover, clouds, wind, gusts, sea-level pressure, humidity and dew point. There is a quick layer bar with altitude levels (surface / 850 / 500 / 250 hPa), and animated wind-flow particles that follow the selected level. Fields are shaded with smooth bicubic interpolation and cross-fade between hours. Values are printed at cities, and isobars are drawn with labelled **H/L pressure centres**. |
| **Point forecast** | Click anywhere for the current conditions (weather icon, feels-like, wind, gusts, humidity, pressure, dew point, CAPE, sunrise and sunset), a 7-day outlook with icons and storm flags, a 72-hour hourly strip with wind arrows and ⚡ convective hours, and a meteogram of temperature, dew point, gusts and precipitation. |
| **Units** | °C/°F; km/h, m/s, kt, mph or Beaufort; mm/in; hPa, inHg or mmHg; m/ft; and local or UTC time. Your choice is saved in the browser. |
| **Model maps** | Uses 15 NWP models through Open-Meteo: ECMWF IFS 0.25°, ECMWF AIFS (AI), GFS, ICON / ICON-EU / ICON-D2, ARPEGE Europe, GEM, UKMO 10 km, JMA, CMA GRAPES, DMI HARMONIE-AROME, MET Nordic, and best-match blending. Fields are shaded smoothly and clipped to the country borders. It also draws 500 hPa height contours and wind barbs (10 m / 850 / 500 hPa). |
| **Parameters** | Storm-threat category, STP, SCP, SHIP, EHI, CAPE, LI, CIN, mid-level lapse rate, LCL, total totals / K-index, deep-layer and low-level shear, 0–1 and 0–3 km SRH (Bunkers right mover), dew point, θe 850, 2 m temperature, precipitation, gusts, 850/250 hPa wind, Z500, T850 and more. |
| **Forecast timeline** | 72 h scrubber with a sparkline of the regional maximum threat and CAPE. Includes play/loop and keyboard control. |
| **Sounding analysis** | Click anywhere to open it. It includes a full Skew-T/log-P with SB/ML/MU parcel theory (virtual-temperature corrected), CAPE/CIN shading, LCL/LFC/EL markers and the effective inflow layer. There is also a hodograph with Bunkers RM/LM, mean wind and Corfidi vectors. Computed indices: SB/ML/MU CAPE, CIN, LCL, LFC, EL, LI, 0–3 km ML CAPE, DCAPE, SRH (0–0.5 / 1 / 3 km / effective), bulk shear (0–1 / 3 / 6 / 8 km / effective), lapse rates, PWAT, K, TT, Showalter, freezing level and wet-bulb zero, STP (effective and fixed), SCP, SHIP, DCP and EHI. It also gives a SHARPpy-style *possible hazard type* and a storm-mode hint. |
| **Parameter series** | Hour-by-hour charts of MLCAPE, MUCAPE, CIN, shear, STP, SCP, SHIP and SRH at a point. |
| **Model comparison** | Overlays up to 8 models for CAPE, precipitation, gusts, temperature, dew point, 500 hPa wind and LI over 7 days. |
| **Ensembles** | ICON-EPS, GEFS, ECMWF ENS and GEPS: P10–P90 plumes, median and max, plus exceedance probabilities such as P(CAPE ≥ 1000). |
| **Live radar** | RainViewer composite with a 2 h animated loop, served through the local proxy. |
| **Storm cell tracker** | Finds cells (≥ 35–50 dBZ) in the radar mosaic and links them across frames. Motion comes from a least-squares fit, and tracks are extrapolated to +15/30/45/60 min with an uncertainty cone. Each cell gets a max-dBZ trend, area, a lightning rate (with a *lightning jump* flag), the model environment (SCP/STP/SHIP), flags for hail, supercell, tornado environment and fast motion, and the nearest town. |
| **Lightning** | Live strikes from the Blitzortung.org community network, coloured by age. |
| **Convective outlook** | Automated Day 1–3 categories (TSTM → MDT+), per-country summaries and ranked **chase targets**. Clicking a target flies the map there and opens the sounding for its peak hour. |
| **Chase mode** | GPS tracking or a manually set position. For each tracked cell it shows distance and bearing, the closest point of approach, a *"cell hits you in N min"* alert, and an intercept solution (heading, distance and time at your road speed). |
| **Warnings** | MeteoAlarm feeds for DE, PL, SK, RO, BG, FI and UA, with a convective filter. |
| **Satellite** | EUMETSAT Meteosat IR 10.8, RGB Convection, RGB Airmass and WV 6.2 (WMS). |

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `STORMMAP_PORT` / `STORMMAP_HOST` | `8000` / `0.0.0.0` | Listen address |
| `OPEN_METEO_API_KEY` | – | Uses the commercial Open-Meteo API. This removes the pacing, turns on the extended grid variables and allows grids of up to 900 points. |
| `STORMMAP_GRID_MAX_POINTS` | `260` (`900` with a key) | Grid points per region |
| `STORMMAP_GRID_EXTENDED` | `0` (`1` with a key) | Adds 925/700/250 hPa, lightning potential, freezing level and cloud cover |
| `STORMMAP_GRID_TTL` | `10800` | Seconds a model grid is cached (in memory and in `.cache/`) |
| `STORMMAP_WARM` | `1` | Pre-fetches the default grid at startup |
| `STORMMAP_DEMO` | `0` | Same as `--demo` |

### Open-Meteo free-tier budget

Open-Meteo's free tier allows 600 calls/min, 5 000/h and 10 000/day. A request with more than 10 variables counts as several calls for each location.

- The model grid uses a 22-variable core set, so each point costs 2.2 calls. Each region is capped at about 260 points, which is roughly 480–580 calls and fits inside one minute. A built-in pacer keeps the server under the limits. The browser also caches hours it has already loaded and prefetches the next ones, so the timeline plays back smoothly.
- Grids are cached for 3 h on disk, so restarting the server doesn't spend the budget again.
- "All 10 countries" therefore uses a coarse grid of about 2.3°. Select a single country to get a fine grid (0.17–0.66°).

## Architecture

```
server.py              launcher (argparse, logging)
stormmap/app.py        stdlib ThreadingHTTPServer: JSON API + static SPA, gzip
stormmap/forecast.py   grid fetch/derive/cache, outlook & targets, sounding/meteogram/ensemble, rate pacer
stormmap/sounding.py   parcel theory & severe-weather indices on a 10 hPa column
stormmap/derived.py    fast grid-point parameters from limited pressure levels
stormmap/thermo.py     thermodynamic primitives (Bolton, RK4 pseudo-adiabats…)
stormmap/sources.py    RainViewer radar proxy, MeteoAlarm parser, geocoding
stormmap/geo.py        country polygons, grid masks, nearest town
stormmap/demo.py       synthetic trough/warm-sector weather, radar tiles, strikes
static/js/field.js     bicubic field rendering, isolines + H/L centres, city values, barbs
static/js/particles.js animated wind-flow particles
static/js/units.js     unit preferences and conversions
static/js/icons.js     SVG weather icons (WMO codes) and layer glyphs
static/                index.html, css, other js (radar, lightning, tracker, Skew-T, drawer…)
```

API endpoints: `/api/meta`, `/api/grid`, `/api/forecast`, `/api/timeline`, `/api/outlook`, `/api/sounding`, `/api/meteogram`, `/api/ensemble`, `/api/radar/frames`, `/api/radar/tile/{z}/{x}/{y}.png`, `/api/warnings`, `/api/geocode`.

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

## Notes and limitations

- **Grid parameters are approximations.** Grid shear and SRH use pressure-level layer proxies: 10 m→925/850 hPa for about 0–1 km, and 10 m→500 hPa for about 0–6 km. For the full effective-layer analysis, click a point to open its sounding.
- **Radar coverage is uneven.** Coverage over Russia, Belarus, Ukraine and Türkiye depends on what RainViewer receives. Where radar is missing, use the lightning layer and the model fields.
- **Tracker reflectivity is estimated.** The tracker reads reflectivity back from the colours of the radar tiles, so dBZ values are approximate (±3–5 dBZ).
- **Blitzortung.org data is for private, non-commercial use.** GPS in browsers requires HTTPS or `localhost`. On plain HTTP from another device, use *Set position on map*.
- **This is automated guidance.** Always check official forecasts and warnings, and chase responsibly.

Data: Open-Meteo (CC BY 4.0), RainViewer, Blitzortung.org, EUMETSAT, MeteoAlarm, © OpenStreetMap contributors, © CARTO, Esri. Borders: Natural Earth via world-atlas, with Crimea shown as part of Ukraine.
