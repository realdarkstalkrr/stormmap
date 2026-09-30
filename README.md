# StormMap ⚡

[![CI](https://github.com/realdarkstalkrr/stormmap/actions/workflows/ci.yml/badge.svg)](https://github.com/realdarkstalkrr/stormmap/actions/workflows/ci.yml)
[![Container](https://github.com/realdarkstalkrr/stormmap/actions/workflows/docker.yml/badge.svg)](https://github.com/realdarkstalkrr/stormmap/pkgs/container/stormmap)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/realdarkstalkrr/stormmap)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/realdarkstalkrr/stormmap)

StormMap is a black, map-first meteorology app for storm chasing and convective analysis. It covers **Ukraine, Moldova, European Russia, Türkiye, Romania, Bulgaria, Slovakia, Poland, Finland, Germany and Belarus**.

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
| **Storm ranking** | Every tracked cell gets a 0–100 chase-potential score and a verdict: HIGH, GOOD, MARGINAL, NO POTENTIAL or DYING. The score has five parts shown as bars: intensity, trend, lightning, the model environment along the cell's forecast path (SCP/STP/SHIP/CAPE) and persistence. Each card lists the reasons in plain language and marks cells in, or heading into, no-go areas as *not chaseable*. |
| **Road routing & intercept** | Routes follow real roads via OSRM (OpenStreetMap), and every route is checked against the no-go raster every 0.5 km. If the fastest road route crosses a forbidden area, the planner automatically re-routes through safe towns. **Plan intercept** works out where the storm will be when you can get there, targeting either its safer south-east flank or its track, with a 10-minute lead. It shows drive time, ETA, the margin before the storm arrives, turn-by-turn directions, and a warning if the storm heads into a no-go area. There is also an optional road-network overlay. |
| **No-go zones (Ukraine)** | Occupied and contested territory comes from **[DeepStateMap](https://deepstatemap.live)**, a Ukrainian OSINT project with daily updates. It is rasterized at **0.01° (~1.1 × 0.7 km)**. On top of that come a configurable front-line safety buffer (default 30 km) and a UA–RU/BY border danger zone (default 20 km). Routes never cross the closed Ukraine–Russia/Belarus border. Routes also never cross from Ukraine into **Transnistria**: Ukraine closed those checkpoints in 2022. Ukraine–Moldova crossings elsewhere (for example Palanca or Mohyliv-Podilskyi–Otaci) and Moldova–Transnistria crossings stay allowed. |
| **Initiation & severe parameters** | Surface convergence and moisture-flux convergence (where storms fire), an initiation-potential index built from CAPE, weak CIN and convergence, and WMAXSHEAR (√(2·CAPE) × deep-layer shear, the European severe-storm discriminator used by ESSL). |
| **Surface observations** | METAR station plots from NOAA's Aviation Weather Center: temperature, dew point, wind barb, sea-level pressure, sky cover, present weather and gusts. Click a station for the raw report. |
| **Chase briefing** | A one-click text briefing covering risk by country, timing, the best target with its parameters, expected storm mode and hazards, sunset and civil dusk at the target, backup targets, the current top-ranked cells, warnings and no-go zone status. Copy it to share. |
| **Alerts** | Lightning within a set radius (with the 30/30 rule), a cell forecast to pass over you, a new high-potential chaseable storm, and orange/red warnings in your country. Alerts appear in the app feed, play a sound, and show as desktop notifications when the tab is hidden. |
| **Chase log** | Records your GPS track and one-tap field reports: wall cloud, funnel, tornado, hail size, wind damage, flooding, lightning damage and notes. Each report is tagged with the nearest tracked cell. Export as GPX, GeoJSON or an ESWD-style CSV. Everything is stored only in your browser. |
| **Daylight** | Sunrise, golden hour, sunset and civil dusk at your position, a daylight countdown, and a warning when a planned intercept happens after dark. |
| **Tools** | A distance and bearing ruler, and trend sparklines (max dBZ, area, lightning) for every ranked cell. |
| **Vertical cross-sections** | Use the section tool on the map and click point A, then point B. It samples 25 model columns along the great circle and draws them against pressure and distance. You can switch between four displays: θe contours over RH shading with the 0 °C isotherm, temperature with θ, isotachs with θ, and the wind component normal to the section. Wind barbs and terrain are included, and the section follows the timeline hour. |
| **Time–height sections** | A drawer tab showing 72 hours of the model column at a point. It has RH shading, isotherms (0 °C in bold), θe or isotachs with θ, and wind barbs. |
| **Advanced sounding diagnostics** | Storm-relative winds for 0–2, 4–6 and 9–11 km, with a Rasmussen–Straka supercell type (HP, classic or LP). Also the critical angle (Esterheld & Giuliano), BRN and BRN shear, the Craven–Brooks significant-severe parameter, WINDEX (McCann), MCS maintenance probability (Coniglio et al.), convective temperature, θe deficit, 3–6 and 3–8 km lapse rates, and the −10/−20/−30 °C heights with hail-growth-zone depth. The Skew-T adds wet-bulb and downdraft-parcel traces, and there is a storm-relative wind profile plot. |
| **Sounding tools** | *What-if* surface T/Td modification recomputes every parcel and index. You can overlay any other model's T/Td on the Skew-T, and export the sounding in SHARPpy/SPC `%RAW%` format or as CSV. |
| **Synoptic diagnostics** | 500 hPa absolute vorticity (drawn with 500 hPa height contours), 850 hPa temperature advection, and 850 hPa 2-D kinematic (Petterssen) frontogenesis, all computed from the model grid. |
| **Model difference maps** | Shows any field as model A − model B on a diverging colour scale, for comparing guidance and seeing forecast uncertainty. |
| **Chase mode** | GPS tracking or a manually set position. For each tracked cell it shows distance and bearing, the closest point of approach, a *"cell hits you in N min"* alert, and an intercept solution (heading, distance and time at your road speed). |
| **Warnings** | MeteoAlarm feeds for DE, PL, SK, RO, MD, BG, FI and UA, with a convective filter. |
| **Satellite** | EUMETSAT Meteosat IR 10.8, RGB Convection, RGB Airmass and WV 6.2 (WMS). |
| **Air-raid alerts (Ukraine)** | Live oblast and raion alerts from [alerts.in.ua](https://alerts.in.ua), refreshed every 30 s and drawn on oblast boundaries from geoBoundaries. A full alert turns red and a partial one orange. You get a big banner and a sound alert when your position is in an oblast under alert. Every road route and intercept lists the alerted oblasts it passes through. |
| **Mine-contamination areas** | Load an official GeoJSON of potentially contaminated territory (`STORMMAP_MINES_FILE`). The app then warns when you or a route are inside it: stay on the paved surface. It never pretends to be a clearance map. |
| **Storm-based warnings** | Click **Issue warning** on a ranked cell to draft a 45–120 min threat polygon along its forecast track. The draft lists the towns in its path with ETAs in Kyiv time, suggests hazards and severity, and pre-fills Ukrainian and English texts. A person reviews and edits the draft, then publishes it with the admin token. Published warnings show on everyone's map, are posted to a Telegram channel and are sent to bot subscribers inside or near the polygon. They can be cancelled. Without a bot token everything runs as a dry run. |
| **Telegram bot** | `/start`, then share your location or type `/town Краматорськ`. Other commands: `/radius 5–150`, `/lang uk\|en`, `/status`, `/warnings`, `/stop`. |
| **GPS integrity** | Protects against GNSS jamming and spoofing, which are common in eastern Ukraine. The app rejects fixes that imply more than 250 km/h, have more than 3 km of error, or sit at 0,0. A big jump needs your confirmation before it is accepted. A quality indicator shows accuracy, fix age and rejected fixes, and a lost fix is flagged instead of silently keeping a stale position. |
| **Offline / installable (PWA)** | A service worker caches the app shell, the last data you loaded (model grids, zones, alerts, warnings, radar) and map tiles. **Save this area offline** prefetches tiles for the current view. An *OFFLINE* badge shows when you are looking at cached data. This needs HTTPS (or `localhost`). |
| **Share-safe export** | Martial-law-aware reporting. *Share-safe text* keeps only the nearest settlement or a ~10 km grid and the hour, with no GPS track. The precise GPX/GeoJSON/CSV exports stay for ESWD and your own records. |
| **Ukrainian interface** | EN / УКР switch in ⚙ settings; the default follows the browser language. Warning texts, bot replies and town names are bilingual. |

## Deploying from GitHub

StormMap is a Python server, so it can't run on GitHub Pages, which only serves static files. Pick one of these instead:

| Option | How | Notes |
|---|---|---|
| **GitHub Codespaces** | Click *Open in GitHub Codespaces* above. The server starts by itself and port 8000 opens in your browser. | The quickest way to try it with **live data**. The forwarded URL is HTTPS, so GPS and offline mode work. It stops when the codespace sleeps. |
| **Docker image (GHCR)** | Every push to the default branch publishes `ghcr.io/realdarkstalkrr/stormmap:latest` (amd64 + arm64); `v*` tags publish versioned images. Run it with `docker run -d -p 8000:8000 -v stormmap:/data ghcr.io/realdarkstalkrr/stormmap:latest`, or with `docker compose up -d`. | Works on any VPS, a home server or a Raspberry Pi. The package starts out private: make it public under *Packages → stormmap → Package settings* if you want to pull it without logging in. |
| **Render** | Click *Deploy to Render* above, or use Dashboard → New → Blueprint → this repo. `render.yaml` builds the Dockerfile, generates an admin token and asks for the optional keys. | You get free HTTPS on `*.onrender.com`. The free plan sleeps when idle, and its cache and warnings are lost on restart. |
| **Railway / Fly.io / others** | Point them at the repository. The Dockerfile is detected automatically, and the server honours the `PORT` variable those platforms set. | Health check: `/api/health` |

**CI:** `.github/workflows/ci.yml` runs on every push and pull request:

- the test suite on Python 3.9–3.13, in demo mode with no network
- a JavaScript syntax check and JSON validation
- a Docker build with a smoke test against the running container

Secrets such as `ALERTS_IN_UA_TOKEN`, `STORMMAP_ADMIN_TOKEN` and `TELEGRAM_BOT_TOKEN` belong in the hosting platform's environment settings, or in a `.env` file next to `docker-compose.yml`. Never put them in the repository.

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
| `STORMMAP_OSRM_URL` | `https://router.project-osrm.org` | Road routing server. The public demo is for light personal use; run your own OSRM for heavy use. |
| `STORMMAP_ZONES_URL` | DeepStateMap API | Source of the occupied-territory GeoJSON |
| `STORMMAP_ZONES_FILE` | – | Local GeoJSON used instead of the live feed. Features are classified by name or fill colour. |
| `STORMMAP_FRONT_BUFFER_KM` / `STORMMAP_BORDER_BUFFER_KM` | `30` / `20` | Default buffers. You can also change them per browser in Chase → No-go zones. |
| `CARTO_API_KEY` | – | Optional. By default the base map uses Esri's public Dark Gray Canvas tiles, which need no key. CARTO's dark basemaps now require a key ([carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)); set one to use them instead. It is sent to browsers, so restrict it to your domain. |
| `ALERTS_IN_UA_TOKEN` | – | Free alerts.in.ua API token (request it at alerts.in.ua). Without it the air-raid layer is off. |
| `STORMMAP_OBLASTS_FILE` | – | Local oblast-boundary GeoJSON. Otherwise the app downloads geoBoundaries ADM1 once and caches it. |
| `STORMMAP_MINES_FILE` | – | GeoJSON of potentially mine-contaminated areas (or put it at `static/data/mines.geojson`) |
| `STORMMAP_ADMIN_TOKEN` | – | Required to publish or cancel storm warnings. Use a long random string. In `--demo`, `demo` is accepted. |
| `TELEGRAM_BOT_TOKEN` | – | Bot token from @BotFather. It enables the subscriber bot and sending. |
| `TELEGRAM_CHANNEL` | – | Channel to post warnings to, such as `@my_storm_warnings`. The bot must be an admin of the channel. |
| `STORMMAP_TLS_CERT` / `STORMMAP_TLS_KEY` | – | Serve HTTPS directly (PEM files). A reverse proxy is usually easier; see below. |

Keep tokens in environment variables or a service file. Never commit them.

### Public hosting with HTTPS

GPS, offline mode and notifications only work over HTTPS. The simplest setup is [Caddy](https://caddyserver.com), which gets Let's Encrypt certificates automatically:

```
# /etc/caddy/Caddyfile
storm.example.org {
    reverse_proxy 127.0.0.1:8000
}
```

Then run StormMap bound to localhost:

```bash
STORMMAP_HOST=127.0.0.1 STORMMAP_ADMIN_TOKEN=$(openssl rand -hex 24) python3 server.py
```

For a public instance, run your own OSRM server and consider an Open-Meteo API key: the free public services are meant for light use.

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
stormmap/zones.py      DeepStateMap no-go zones → 0.01° raster, buffers, closed-border rule
stormmap/routing.py    OSRM routing + zone validation/detours, offline network, storm intercept
stormmap/demo.py       synthetic trough/warm-sector weather, radar tiles, strikes
stormmap/airalerts.py  alerts.in.ua air-raid alerts + oblast boundaries
stormmap/hazards.py    mine-contamination GeoJSON loader
stormmap/publish.py    storm-warning store, admin check, Telegram channel + subscriber bot
static/sw.js           service worker (offline shell, data and tile cache)
static/js/safety.js    air-raid and mine layers, route/position safety banners
static/js/warn.js      storm-based warning composer and active-warnings layer
static/js/i18n.js      Ukrainian interface
static/js/field.js     bicubic field rendering, isolines + H/L centres, city values, barbs
static/js/particles.js animated wind-flow particles
static/js/sections.js  cross-section & time–height renderer (shading, contours, barbs, terrain)
static/js/units.js     unit preferences and conversions
static/js/icons.js     SVG weather icons (WMO codes) and layer glyphs
static/css/retro.css   2000s-style square, beveled black theme (loaded over app.css)
static/                index.html, css, other js (radar, lightning, tracker, Skew-T, drawer…)
```

API endpoints: `/api/meta`, `/api/grid`, `/api/forecast`, `/api/obs`, `/api/xsection`, `/api/timeheight`, `/api/sounding/export`, `/api/zones`, `/api/route`, `/api/intercept`, `/api/timeline`, `/api/outlook`, `/api/sounding`, `/api/meteogram`, `/api/ensemble`, `/api/radar/frames`, `/api/radar/tile/{z}/{x}/{y}.png`, `/api/warnings`, `/api/geocode`, `/api/airalerts`, `/api/oblasts`, `/api/hazards`, `/api/warn/active`, `/api/warn/status`, and the POST endpoints `/api/warn/publish` and `/api/warn/cancel` (both require the `X-Admin-Token` header).

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

## Notes and limitations

- **Grid parameters are approximations.** Grid shear and SRH use pressure-level layer proxies: 10 m→925/850 hPa for about 0–1 km, and 10 m→500 hPa for about 0–6 km. For the full effective-layer analysis, click a point to open its sounding.
- **Radar coverage is uneven.** Coverage over Russia, Belarus, Ukraine and Türkiye depends on what RainViewer receives. Where radar is missing, use the lightning layer and the model fields.
- **Tracker reflectivity is estimated.** The tracker reads reflectivity back from the colours of the radar tiles, so dBZ values are approximate (±3–5 dBZ).
- **No-go zones are safety aids, not official boundaries.** DeepStateMap is updated about once a day and the front moves, so keep the buffer generous and always follow official restrictions, curfews and checkpoints. The polygons are rasterized to about 1 km, but the source itself can lag reality by hours to days. If the feed is unreachable and nothing is cached, the app uses a deliberately over-blocking coarse fallback (±20 km) and flags it in red. The source name and map date are shown in Chase → No-go zones. Any polygon features that weren't classified are listed in `/api/zones` → `meta.ignored_polygon_names`, so a change in the source's naming scheme gets noticed.
- **METAR coverage is uneven.** Most Ukrainian airports have not reported since 2022, so expect few stations in Ukraine; coverage elsewhere in the region is good.
- **Cross-sections use the API budget.** Each new section costs about 8 Open-Meteo calls per sample column, roughly 200 for the default 25 columns. Sections are cached for 30 minutes, and moving along the timeline reuses the cache.
- **Grid-based diagnostics are only as fine as the grid.** Vorticity, advection and frontogenesis are smoothed on coarse grids. Use single-country regions for synoptic diagnosis.
- **Grid-scale convergence is weaker than reality.** Convergence and MFC are computed from the model grid, so on coarse grids they only show broad features. Pick a single country to get a finer grid.
- **Offline routing is approximate.** Without a reachable routing server (and in `--demo`), routes use straight links between towns and are labelled *Approximate — no road data*.
- **Blitzortung.org data is for private, non-commercial use.** GPS in browsers requires HTTPS or `localhost`. On plain HTTP from another device, use *Set position on map*.
- **StormMap warnings are unofficial.** They are issued by whoever holds the admin token and never replace Ukrhydrometcenter or State Emergency Service warnings. The texts say so. Review every draft: the polygon is a straight-line extrapolation of radar motion.
- **Air-raid alerts depend on alerts.in.ua.** If the feed fails, the status pill turns red. Always keep the official *Air Alert* (Повітряна тривога) app running as well.
- **The Ukrainian translation is a first pass.** Corrections from native-speaking forecasters are welcome (`static/js/i18n.js`).
- **This is automated guidance.** Always check official forecasts and warnings, and chase responsibly.

Data: Open-Meteo (CC BY 4.0), RainViewer, Blitzortung.org, EUMETSAT, MeteoAlarm, © OpenStreetMap contributors, Esri (and CARTO when a key is set). Borders: Natural Earth via world-atlas, with Crimea shown as part of Ukraine; the Transnistria outline is from Natural Earth 1:10m breakaway areas.
