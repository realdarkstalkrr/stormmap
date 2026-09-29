/* StormMap — display units (values are stored in °C, m/s, mm, hPa, m) */
'use strict';

(function () {
  const DEFAULTS = { temp: 'c', wind: 'kmh', precip: 'mm', pressure: 'hpa', height: 'm', time: 'local' };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('sm-units') || '{}'); } catch (e) { saved = {}; }

  const U = SM.units = { cfg: Object.assign({}, DEFAULTS, saved) };

  U.OPTIONS = {
    temp: [['c', '°C'], ['f', '°F']],
    wind: [['kmh', 'km/h'], ['ms', 'm/s'], ['kt', 'kt'], ['mph', 'mph'], ['bft', 'Bft']],
    precip: [['mm', 'mm'], ['in', 'in']],
    pressure: [['hpa', 'hPa'], ['inhg', 'inHg'], ['mmhg', 'mmHg']],
    height: [['m', 'm'], ['ft', 'ft']],
    time: [['local', 'Local'], ['utc', 'UTC']],
  };
  const LABELS = { temp: 'Temperature', wind: 'Wind speed', precip: 'Precipitation', pressure: 'Pressure', height: 'Height', time: 'Time' };

  const BFT = [0.5, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];

  /** Convert a base-unit value for a unit kind. */
  U.conv = function (kind, v) {
    if (v == null || Number.isNaN(v)) return v;
    const c = U.cfg;
    switch (kind) {
      case 'temp': return c.temp === 'f' ? v * 9 / 5 + 32 : v;
      case 'tempdiff': return c.temp === 'f' ? v * 9 / 5 : v;
      case 'wind':
        if (c.wind === 'kmh') return v * 3.6;
        if (c.wind === 'kt') return v * 1.943844;
        if (c.wind === 'mph') return v * 2.236936;
        if (c.wind === 'bft') { let b = 0; while (b < BFT.length && v >= BFT[b]) b++; return b; }
        return v;
      case 'precip': return c.precip === 'in' ? v / 25.4 : v;
      case 'pressure': return c.pressure === 'inhg' ? v * 0.02953 : c.pressure === 'mmhg' ? v * 0.750062 : v;
      case 'height': return c.height === 'ft' ? v * 3.28084 : v;
      default: return v;
    }
  };

  U.label = function (kind, fallback = '') {
    const c = U.cfg;
    switch (kind) {
      case 'temp': case 'tempdiff': return c.temp === 'f' ? '°F' : '°C';
      case 'wind': return { kmh: 'km/h', ms: 'm/s', kt: 'kt', mph: 'mph', bft: 'Bft' }[c.wind];
      case 'precip': return c.precip === 'in' ? 'in/h' : 'mm/h';
      case 'pressure': return { hpa: 'hPa', inhg: 'inHg', mmhg: 'mmHg' }[c.pressure];
      case 'height': return c.height === 'ft' ? 'ft' : 'm';
      default: return fallback;
    }
  };

  function digits(kind, v) {
    if (kind === 'precip') return U.cfg.precip === 'in' ? 2 : (Math.abs(v) < 10 ? 1 : 0);
    if (kind === 'pressure') return U.cfg.pressure === 'inhg' ? 2 : 0;
    if (kind === 'tempdiff') return 1;
    if (kind === 'temp' || kind === 'wind' || kind === 'height' || kind === 'pct') return 0;
    return Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  }

  /** Format a base-unit value; `withUnit` appends the unit label. */
  U.fmt = function (kind, v, withUnit = false, fallbackUnit = '') {
    if (v == null || Number.isNaN(v)) return '—';
    const x = U.conv(kind, v);
    const s = x.toFixed(digits(kind, x));
    if (!withUnit) return s;
    const lab = kind === 'pct' ? '%' : U.label(kind, fallbackUnit);
    return kind === 'temp' || kind === 'tempdiff' ? s + '°' : s + (lab ? ' ' + lab : '');
  };

  /** Param helpers — `p` is an entry of SM.meta.params. */
  U.paramKind = key => (SM.meta && SM.meta.params[key] && SM.meta.params[key].kind) || 'none';
  U.paramUnit = key => {
    const p = SM.meta && SM.meta.params[key];
    if (!p) return '';
    const k = p.kind;
    return k === 'none' || k === 'pct' ? p.unit : U.label(k, p.unit);
  };
  U.fmtParam = (key, v, withUnit = false) => U.fmt(U.paramKind(key), v, withUnit, SM.meta.params[key] && SM.meta.params[key].unit);

  /** Time helpers honouring the local/UTC preference. */
  U.hm = t => (U.cfg.time === 'utc' ? SM.utcHM(t) + 'Z' : SM.localHM(t));
  U.dayLabel = t => {
    const d = new Date(t * 1000);
    const utc = U.cfg.time === 'utc';
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][utc ? d.getUTCDay() : d.getDay()];
    return `${wd} ${utc ? d.getUTCDate() : d.getDate()}`;
  };
  U.stamp = t => `${U.dayLabel(t)} · ${U.hm(t)}`;

  U.set = function (kind, val) {
    U.cfg[kind] = val;
    try { localStorage.setItem('sm-units', JSON.stringify(U.cfg)); } catch (e) { /* private mode */ }
    SM.emit('units');
  };

  U.buildMenu = function (box) {
    box.innerHTML = '<h4>Units</h4>';
    for (const [kind, opts] of Object.entries(U.OPTIONS)) {
      const row = SM.el('div', { class: 'unit-row' }, `<span>${LABELS[kind]}</span>`);
      const seg = SM.el('div', { class: 'seg small' });
      for (const [val, lab] of opts) {
        const b = SM.el('button', { class: U.cfg[kind] === val ? 'active' : '' }, lab);
        b.addEventListener('click', e => { e.stopPropagation(); U.set(kind, val); U.buildMenu(box); });
        seg.appendChild(b);
      }
      row.appendChild(seg);
      box.appendChild(row);
    }
  };
})();
