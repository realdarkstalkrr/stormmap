/* StormMap — sun position & daylight (standard low-precision solar ephemeris, ~1 min accuracy) */
'use strict';

(function () {
  const rad = Math.PI / 180, DAY = 86400000, J1970 = 2440588, J2000 = 2451545, E = rad * 23.4397;
  const toJulian = d => d.valueOf() / DAY - 0.5 + J1970;
  const fromJulian = j => new Date((j + 0.5 - J1970) * DAY);
  const toDays = d => toJulian(d) - J2000;
  const meanAnomaly = d => rad * (357.5291 + 0.98560028 * d);
  const eclipticLon = M => M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + rad * 102.9372 + Math.PI;
  const declination = l => Math.asin(Math.sin(E) * Math.sin(l));
  const J0 = 0.0009;

  function times(date, lat, lng) {
    const lw = rad * -lng, phi = rad * lat, d = toDays(date);
    const n = Math.round(d - J0 - lw / (2 * Math.PI));
    const ds = J0 + lw / (2 * Math.PI) + n;
    const M = meanAnomaly(ds), L = eclipticLon(M), dec = declination(L);
    const Jnoon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const at = h => {
      const cosw = (Math.sin(h * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
      if (cosw < -1 || cosw > 1) return [null, null];
      const w = Math.acos(cosw);
      const Jset = J2000 + J0 + (w + lw) / (2 * Math.PI) + n + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
      return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)];
    };
    const [sunrise, sunset] = at(-0.833), [dawn, dusk] = at(-6), [, goldenStart] = at(6);
    return { sunrise, sunset, dawn, dusk, goldenStart, noon: fromJulian(Jnoon) };
  }

  SM.sun = { times };

  const hm = d => (d ? SM.pad(d.getHours()) + ':' + SM.pad(d.getMinutes()) : '—');

  /** Daylight summary for the chaser position (HTML). */
  SM.sun.summary = function (lat, lon) {
    const now = new Date();
    const t = times(now, lat, lon);
    if (!t.sunset) return '<div class="sun-box">Polar day/night — no sunset today.</div>';
    const left = (t.sunset - now) / 60000;
    const duskLeft = (t.dusk - now) / 60000;
    let state, cls = '';
    if (now < t.dawn) { state = `Night — civil dawn at ${hm(t.dawn)}`; cls = 'night'; }
    else if (now < t.sunrise) state = `Dawn twilight — sunrise ${hm(t.sunrise)}`;
    else if (left > 0) {
      const h = Math.floor(left / 60), m = Math.round(left % 60);
      state = `<b>${h}h ${m}m</b> of daylight left`;
      if (left < 90) cls = 'warn';
    } else if (duskLeft > 0) { state = `Civil twilight — dark in <b>${Math.round(duskLeft)} min</b>`; cls = 'warn'; }
    else { state = 'After dark — storms are much harder to see; chase with extreme care'; cls = 'night'; }
    return `<div class="sun-box ${cls}">
      <div class="sun-state">☀ ${state}</div>
      <div class="sun-times"><span>Sunrise <b>${hm(t.sunrise)}</b></span><span>Golden hour <b>${hm(t.goldenStart)}</b></span><span>Sunset <b>${hm(t.sunset)}</b></span><span>Civil dusk <b>${hm(t.dusk)}</b></span></div>
    </div>`;
  };

  /** True if a timestamp (s) falls after civil dusk / before civil dawn at a point. */
  SM.sun.isDark = function (ts, lat, lon) {
    const d = new Date(ts * 1000);
    const t = times(d, lat, lon);
    if (!t.dusk || !t.dawn) return false;
    return d > t.dusk || d < t.dawn;
  };
})();
