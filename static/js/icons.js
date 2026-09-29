/* StormMap — weather icons (inline SVG) for WMO weather codes, plus layer-bar glyphs */
'use strict';

(function () {
  const SUN = '<circle cx="24" cy="24" r="8" fill="#fbbf24"/><g stroke="#fbbf24" stroke-width="2.4" stroke-linecap="round"><path d="M24 6v4M24 38v4M6 24h4M38 24h4M11.3 11.3l2.8 2.8M33.9 33.9l2.8 2.8M11.3 36.7l2.8-2.8M33.9 14.1l2.8-2.8"/></g>';
  const MOON = '<path d="M30 8a15 15 0 1 0 10 26A13 13 0 0 1 30 8z" fill="#cbd5e1"/>';
  const CLOUD = (y = 0, c = '#dbe2ee') => `<path transform="translate(0 ${y})" d="M14 36h21a8 8 0 0 0 1-15.9A11 11 0 0 0 15.3 18 9 9 0 0 0 14 36z" fill="${c}"/>`;
  const SMALL_SUN = '<g transform="translate(-6 -6) scale(.8)">' + SUN + '</g>';
  const SMALL_MOON = '<g transform="translate(-4 -4) scale(.75)">' + MOON + '</g>';
  const DROPS = (n, c = '#5ea8ff') => Array.from({ length: n }, (_, i) => `<path d="M${16 + i * 7} 40l-2 5" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`).join('');
  const FLAKES = n => Array.from({ length: n }, (_, i) => `<circle cx="${17 + i * 7}" cy="43" r="1.8" fill="#e2e8f0"/>`).join('');
  const BOLT = '<path d="M25 30l-5 9h5l-3 8 9-11h-5l3-6z" fill="#fde047" stroke="#0b0e14" stroke-width=".8"/>';
  const FOG = '<g stroke="#94a3b8" stroke-width="2.4" stroke-linecap="round"><path d="M10 38h26M14 43h24"/></g>';

  function svg(inner) { return `<svg viewBox="0 0 48 48" class="wx-icon" aria-hidden="true">${inner}</svg>`; }

  /** Icon for a WMO weather code (Open-Meteo `weather_code`). */
  SM.weatherIcon = function (code, isDay = true) {
    const orb = isDay ? SMALL_SUN : SMALL_MOON;
    if (code == null) return svg('');
    if (code === 0) return svg(isDay ? SUN : MOON);
    if (code === 1) return svg(orb + CLOUD(6, '#c7cfdc'));
    if (code === 2) return svg(orb + CLOUD(2));
    if (code === 3) return svg(CLOUD(0, '#aeb8c8'));
    if (code === 45 || code === 48) return svg(CLOUD(-4, '#9aa5b6') + FOG);
    if (code >= 51 && code <= 57) return svg(CLOUD(-4) + DROPS(2, '#8ec5ff'));
    if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
      const heavy = code === 65 || code === 82 || code === 67;
      return svg((code >= 80 ? orb : '') + CLOUD(-4, heavy ? '#94a3b8' : '#dbe2ee') + DROPS(heavy ? 3 : 2));
    }
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return svg(CLOUD(-4) + FLAKES(3));
    if (code >= 95) return svg(CLOUD(-6, '#8b95a7') + BOLT + (code >= 96 ? '<circle cx="36" cy="42" r="2.2" fill="#e2e8f0"/><circle cx="14" cy="42" r="2.2" fill="#e2e8f0"/>' : ''));
    return svg(CLOUD(0));
  };

  SM.weatherText = function (code) {
    const T = {
      0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
      51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
      61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
      71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
      82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Severe thunderstorm with hail',
    };
    return T[code] || '—';
  };

  const G = {
    temp: '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
    rain: '<path d="M7 15a4 4 0 0 1 .5-8A5 5 0 0 1 17 8a3.5 3.5 0 0 1 0 7z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>',
    cloud: '<path d="M7 18a4.5 4.5 0 0 1 .6-9A6 6 0 0 1 19 10a4 4 0 0 1-1 8z"/>',
    wind: '<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8"/>',
    gust: '<path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5M3 12h14a3 3 0 1 1-3 3M3 16h6"/><path d="M19 5l-2 4h3l-2 4"/>',
    pressure: '<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M12 5v1.5M5 13h1.5M17.5 13H19"/>',
    drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    storm: '<path d="M6 13a4 4 0 0 1 .6-8A5.5 5.5 0 0 1 17 6a3.5 3.5 0 0 1 0 7"/><path d="M12 11l-3 5h4l-2 5"/>',
    shear: '<path d="M4 20l4-6 4-3 8-5"/><path d="M4 20h4M4 16h6M4 12h9M4 8h12"/>',
  };
  SM.glyph = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${G[name] || ''}</svg>`;
})();
