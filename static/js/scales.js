/* StormMap — colour scales for model parameters (base units: °C, m/s, mm, hPa, m) */
'use strict';

(function () {
  const hex = h => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  // stops: [value, '#rrggbb', alpha 0..1]
  const S = (stops, opts = {}) => ({ stops: stops.map(s => [s[0], hex(s[1]), s[2] == null ? 1 : s[2]]), ...opts });

  const THREAT = ['#000000', '#6fbf73', '#3e8e41', '#f2d15c', '#f08a3c', '#e0457b'];
  const WIND = [[0, '#2a3a6e'], [2, '#2f5c96'], [4, '#2f86a8'], [6, '#34a39a'], [8, '#58b667'], [10, '#a3c945'], [12, '#e3d346'], [15, '#f0a431'], [18, '#e8663a'], [22, '#cf3552'], [27, '#a3307f'], [33, '#7a3aa8'], [42, '#c8a2ff'], [55, '#ffffff']];
  const TEMP = [[-40, '#f4e9ff'], [-30, '#c9a8f0'], [-22, '#8f6bd6'], [-15, '#5b5fd1'], [-8, '#3d7fd6'], [-3, '#3fa6d9'], [0, '#5cc2d0'], [4, '#5fc3a1'], [8, '#6cbf6a'], [12, '#9ac957'], [16, '#d4d24c'], [20, '#f2c243'], [24, '#f39a38'], [28, '#ec6a33'], [32, '#d93b35'], [36, '#b3244a'], [40, '#8a1d5e'], [46, '#e0a0ff']];

  SM.scales = {
    // ---------- weather ----------
    t2: S(TEMP), td2: S([[-20, '#6b4f3a'], [-5, '#8a7a4a'], [0, '#9a8f55'], [5, '#8fa24a'], [8, '#6b9e3a'], [11, '#2f9e44'], [14, '#1c8a6a'], [16, '#1c7a8a'], [18, '#2563eb'], [20, '#7c3aed'], [22, '#c026d3'], [25, '#f0abfc']]),
    t850: S(TEMP.map(([v, c]) => [v - 12, c])), t500: S(TEMP.map(([v, c]) => [v * 0.8 - 30, c])),
    precip: S([[0.05, '#9ec9ff', 0], [0.1, '#9ec9ff', .55], [0.5, '#5ea8ff', .8], [1, '#2f7ff0'], [2, '#1f5fd0'], [4, '#2cb34a'], [7, '#f2e03a'], [11, '#f3a02d'], [16, '#e8452e'], [25, '#c0184a'], [40, '#d24fe0'], [70, '#ffffff']]),
    cloud: S([[5, '#ffffff', 0], [20, '#8c95a8', .12], [50, '#b4bccb', .32], [80, '#d7dce6', .52], [100, '#f1f3f8', .68]]),
    wind10: S(WIND), gust: S(WIND.map(([v, c]) => [v * 1.35, c])),
    wind850: S(WIND.map(([v, c]) => [v * 1.3, c])), wind500: S(WIND.map(([v, c]) => [v * 1.8, c])), wind250: S(WIND.map(([v, c]) => [v * 2.4, c])),
    mslp: S([[960, '#6a1b9a'], [975, '#4a3fb8'], [990, '#3565c9'], [1000, '#2f8fbf'], [1008, '#35a88c'], [1014, '#6fbb5b'], [1020, '#bdc54a'], [1026, '#e9ad3c'], [1032, '#e8733a'], [1040, '#c9423f'], [1050, '#9c2750']]),
    rh2: S([[0, '#8a5a2b'], [20, '#b88346'], [35, '#d9b36a'], [50, '#b9c77a'], [65, '#6fb487'], [80, '#3b93b0'], [90, '#2e67c2'], [100, '#3044a6']]),
    z500: S([[516, '#4c1d95'], [528, '#1e40af'], [540, '#0284c7'], [552, '#0d9488'], [564, '#65a30d'], [576, '#ca8a04'], [584, '#ea580c'], [592, '#dc2626'], [600, '#be185d']]),
    theta_e: S([[290, '#1e3a8a'], [300, '#2563eb'], [310, '#0ea5e9'], [320, '#22c55e'], [330, '#facc15'], [340, '#fb923c'], [350, '#ef4444'], [360, '#e879f9']]),
    fzl: S([[0, '#e0e7ff'], [1000, '#818cf8'], [2000, '#2563eb'], [3000, '#14b8a6'], [3800, '#a3e635'], [4500, '#facc15'], [5000, '#fb923c']]),
    // ---------- convective ----------
    threat: { categorical: true, cats: [[1, THREAT[1], 'TSTM'], [2, THREAT[2], 'MRGL'], [3, THREAT[3], 'SLGT'], [4, THREAT[4], 'ENH'], [5, THREAT[5], 'MDT+']] },
    cape: S([[50, '#0b2a3a', 0], [150, '#123f5a', .55], [300, '#16617a'], [500, '#1c8a8a'], [800, '#2fb38a'], [1200, '#b8d44a'], [1600, '#f2c14e'], [2000, '#f08a3c'], [2500, '#e5533d'], [3000, '#c21f4a'], [3500, '#9b1d8a'], [4500, '#e879f9'], [6000, '#ffffff']]),
    li: S([[4, '#1e3a8a', 0], [2, '#1e3a8a', .25], [0, '#0e7490', .45], [-1, '#2fb38a'], [-2, '#b8d44a'], [-3, '#f2c14e'], [-4, '#f08a3c'], [-6, '#e5533d'], [-8, '#c21f4a'], [-10, '#e879f9'], [-12, '#ffffff']]),
    cin: S([[-500, '#0b1b3f'], [-300, '#1e3a8a'], [-200, '#2563eb'], [-100, '#60a5fa'], [-50, '#93c5fd', .75], [-25, '#bfdbfe', .45], [-5, '#e0f2fe', 0]]),
    shr6: S([[5, '#10233a', 0], [10, '#1d4f73', .7], [12.5, '#1c8a8a'], [15, '#2fb38a'], [20, '#b8d44a'], [25, '#f2c14e'], [30, '#f08a3c'], [35, '#e5533d'], [45, '#c21f4a'], [60, '#e879f9']]),
    shr1: S([[3, '#10233a', 0], [5, '#1d4f73', .7], [7.5, '#1c8a8a'], [10, '#2fb38a'], [12.5, '#b8d44a'], [15, '#f2c14e'], [20, '#f08a3c'], [25, '#e5533d'], [30, '#e879f9']]),
    srh3: S([[25, '#10233a', 0], [50, '#1d4f73', .7], [100, '#1c8a8a'], [150, '#2fb38a'], [200, '#b8d44a'], [250, '#f2c14e'], [300, '#f08a3c'], [400, '#e5533d'], [500, '#c21f4a'], [700, '#e879f9']]),
    srh1: S([[25, '#10233a', 0], [50, '#1d4f73', .7], [100, '#1c8a8a'], [150, '#b8d44a'], [200, '#f2c14e'], [250, '#f08a3c'], [300, '#e5533d'], [400, '#c21f4a'], [600, '#e879f9']]),
    stp: S([[0.1, '#10233a', 0], [0.3, '#1d4f73', .7], [0.5, '#1c8a8a'], [1, '#b8d44a'], [2, '#f2c14e'], [3, '#f08a3c'], [5, '#e5533d'], [8, '#c21f4a'], [12, '#e879f9']]),
    scp: S([[0.5, '#10233a', 0], [1, '#1d4f73', .7], [2, '#1c8a8a'], [4, '#b8d44a'], [6, '#f2c14e'], [8, '#f08a3c'], [12, '#e5533d'], [16, '#c21f4a'], [25, '#e879f9']]),
    ship: S([[0.1, '#10233a', 0], [0.3, '#1d4f73', .7], [0.5, '#1c8a8a'], [1, '#b8d44a'], [1.5, '#f2c14e'], [2, '#f08a3c'], [3, '#e5533d'], [4, '#c21f4a'], [6, '#e879f9']]),
    ehi: S([[0.2, '#10233a', 0], [0.5, '#1d4f73', .7], [1, '#1c8a8a'], [2, '#b8d44a'], [3, '#f2c14e'], [4, '#f08a3c'], [5, '#e5533d'], [8, '#e879f9']]),
    lr75: S([[5, '#1e3a8a', .2], [5.5, '#1d4f73', .5], [6, '#1c8a8a'], [6.5, '#2fb38a'], [7, '#b8d44a'], [7.5, '#f2c14e'], [8, '#f08a3c'], [8.5, '#e5533d'], [9.5, '#e879f9']]),
    lcl: S([[250, '#2fb38a'], [750, '#86c35a'], [1000, '#b8d44a'], [1250, '#f2c14e'], [1500, '#f08a3c'], [2000, '#9a4a3a', .7], [3000, '#3a2a2a', .3]]),
    kindex: S([[15, '#10233a', 0], [20, '#1d4f73', .6], [25, '#1c8a8a'], [30, '#b8d44a'], [35, '#f08a3c'], [40, '#e5533d'], [45, '#e879f9']]),
    tt: S([[40, '#10233a', 0], [44, '#1d4f73', .6], [48, '#1c8a8a'], [52, '#b8d44a'], [55, '#f08a3c'], [58, '#e5533d'], [62, '#e879f9']]),
    wmaxshear: S([[200, '#10233a', 0], [350, '#1d4f73', .6], [500, '#b8d44a'], [750, '#f2c14e'], [1000, '#f08a3c'], [1300, '#e5533d'], [1700, '#c21f4a'], [2200, '#e879f9'], [3000, '#ffffff']]),
    conv10: S([[0.03, '#10233a', 0], [0.08, '#1d4f73', .55], [0.15, '#1c8a8a'], [0.3, '#b8d44a'], [0.5, '#f2c14e'], [0.8, '#f08a3c'], [1.2, '#e5533d'], [2, '#e879f9']]),
    mfc: S([[0.03, '#10233a', 0], [0.08, '#1d4f73', .55], [0.15, '#1c8a8a'], [0.3, '#b8d44a'], [0.5, '#f2c14e'], [0.8, '#f08a3c'], [1.2, '#e5533d'], [2, '#e879f9']]),
    ci: S([[5, '#10233a', 0], [12, '#1d4f73', .6], [25, '#1c8a8a'], [40, '#b8d44a'], [55, '#f2c14e'], [70, '#f08a3c'], [85, '#e5533d'], [100, '#e879f9']]),
    vort500: S([[8, '#10233a', 0], [11, '#1d4f73', .45], [14, '#1c8a8a', .75], [17, '#b8d44a'], [20, '#f2c14e'], [24, '#f08a3c'], [28, '#e5533d'], [34, '#e879f9']]),
    tadv850: S([[-4, '#1e40af'], [-2, '#3b82f6'], [-0.8, '#93c5fd', .6], [-0.25, '#dbeafe', 0], [0.25, '#fee2e2', 0], [0.8, '#fca5a5', .6], [2, '#ef4444'], [4, '#991b1b']]),
    fronto850: S([[0.2, '#10233a', 0], [0.5, '#1d4f73', .6], [1, '#1c8a8a'], [2, '#b8d44a'], [3, '#f2c14e'], [5, '#f08a3c'], [8, '#e879f9']]),
    lpi: S([[0.2, '#fef9c3', 0], [1, '#fde047', .6], [3, '#facc15'], [6, '#fb923c'], [10, '#ef4444'], [20, '#e879f9']]),
  };
  SM.THREAT_COLORS = THREAT;
  SM.THREAT_NAMES = ['None', 'TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT+'];

  // Returns [r,g,b,a(0-255)] or null
  SM.colorFor = function (key, v) {
    if (v == null || v !== v) return null;
    const sc = SM.scales[key];
    if (!sc) return null;
    if (sc.categorical) {
      const lv = Math.round(v);
      if (lv < 1) return null;
      const c = hex(THREAT[Math.min(lv, 5)]);
      return [c[0], c[1], c[2], 190];
    }
    const st = sc.stops;
    const asc = st[st.length - 1][0] > st[0][0];
    const first = st[0], last = st[st.length - 1];
    if (asc ? v <= first[0] : v >= first[0]) return first[2] <= 0 ? null : [first[1][0], first[1][1], first[1][2], first[2] * 255];
    if (asc ? v >= last[0] : v <= last[0]) return [last[1][0], last[1][1], last[1][2], last[2] * 255];
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i];
      if (asc ? v <= b[0] : v >= b[0]) {
        const f = (v - a[0]) / (b[0] - a[0]);
        return [
          a[1][0] + (b[1][0] - a[1][0]) * f,
          a[1][1] + (b[1][1] - a[1][1]) * f,
          a[1][2] + (b[1][2] - a[1][2]) * f,
          (a[2] + (b[2] - a[2]) * f) * 255,
        ];
      }
    }
    return null;
  };

  /** Ventusky-style legend: continuous bar with unit-converted tick labels. */
  SM.legendHTML = function (key) {
    const sc = SM.scales[key];
    const p = SM.meta && SM.meta.params[key];
    if (!sc || !p) return '';
    const unit = SM.units.paramUnit(key);
    const title = `<div class="lg-title"><b>${SM.esc(p.label)}</b><span>${SM.esc(unit)}</span></div>`;
    if (sc.categorical) {
      return title + '<div class="lg-cats">' + sc.cats.map(c => `<span style="background:${c[1]}">${c[2]}</span>`).join('') + '</div>';
    }
    const st = sc.stops;
    const lo = st[0][0], hi = st[st.length - 1][0];
    const grad = st.map(s => `rgba(${s[1][0]},${s[1][1]},${s[1][2]},${Math.max(s[2], .2)}) ${((s[0] - lo) / (hi - lo) * 100).toFixed(1)}%`).join(',');
    const n = 6;
    const ticks = [];
    for (let i = 0; i < n; i++) {
      const v = lo + (hi - lo) * i / (n - 1);
      ticks.push(`<span>${SM.units.fmtParam(key, v)}</span>`);
    }
    return title + `<div class="lg-bar" style="background:linear-gradient(90deg,${grad})"></div><div class="lg-ticks">${ticks.join('')}</div>`;
  };

  SM.PARAM_GROUPS = [
    ['Weather', ['t2', 'precip', 'cloud', 'wind10', 'gust', 'mslp', 'rh2', 'td2']],
    ['Upper air', ['t850', 't500', 'wind850', 'wind500', 'wind250', 'z500', 'theta_e', 'fzl']],
    ['Storm composites', ['threat', 'stp', 'scp', 'ship', 'wmaxshear', 'ehi']],
    ['Initiation', ['ci', 'conv10', 'mfc']],
    ['Synoptic diagnostics', ['vort500', 'tadv850', 'fronto850']],
    ['Instability', ['cape', 'li', 'cin', 'lr75', 'lcl', 'kindex', 'tt', 'lpi']],
    ['Wind shear', ['shr6', 'shr1', 'srh3', 'srh1']],
  ];

  // Ventusky-style quick layer bar: [id, label, icon, levels: [[label, param]]]
  SM.QUICK_LAYERS = [
    ['temp', 'Temperature', 'temp', [['Surface', 't2'], ['850 hPa', 't850'], ['500 hPa', 't500']]],
    ['precip', 'Rain', 'rain', [['Surface', 'precip']]],
    ['cloud', 'Clouds', 'cloud', [['Total', 'cloud']]],
    ['wind', 'Wind', 'wind', [['10 m', 'wind10'], ['850 hPa', 'wind850'], ['500 hPa', 'wind500'], ['250 hPa', 'wind250']]],
    ['gust', 'Gusts', 'gust', [['10 m', 'gust']]],
    ['mslp', 'Pressure', 'pressure', [['Sea level', 'mslp'], ['500 hPa height', 'z500']]],
    ['rh', 'Humidity', 'drop', [['Relative', 'rh2'], ['Dew point', 'td2']]],
    ['cape', 'CAPE', 'bolt', [['CAPE', 'cape'], ['Lifted index', 'li'], ['CIN', 'cin']]],
    ['storm', 'Storms', 'storm', [['Threat', 'threat'], ['STP', 'stp'], ['SCP', 'scp'], ['SHIP', 'ship'], ['WMAXSHEAR', 'wmaxshear']]],
    ['init', 'Initiation', 'target', [['Potential', 'ci'], ['Convergence', 'conv10'], ['Moisture flux', 'mfc']]],
    ['synop', 'Synoptic', 'pressure', [['500 hPa vorticity', 'vort500'], ['850 T-advection', 'tadv850'], ['850 frontogenesis', 'fronto850'], ['500 hPa height', 'z500']]],
    ['shear', 'Shear', 'shear', [['0–6 km', 'shr6'], ['0–1 km', 'shr1'], ['SRH 0–1', 'srh1'], ['SRH 0–3', 'srh3']]],
  ];
  // Wind level shown by the particle animation for each parameter
  SM.PARTICLE_LEVEL = { wind850: '850', t850: '850', wind500: '500', t500: '500', z500: '500', wind250: '250' };
})();
