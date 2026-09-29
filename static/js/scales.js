/* StormMap — colour scales for model parameters */
'use strict';

(function () {
  const hex = h => {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  // stops: [value, '#rrggbb', alpha 0..1]
  const S = (stops, opts = {}) => ({ stops: stops.map(s => [s[0], hex(s[1]), s[2] == null ? 1 : s[2]]), ...opts });

  const THREAT = ['#000000', '#6fbf73', '#3e8e41', '#f2d15c', '#f08a3c', '#e0457b'];

  SM.scales = {
    threat: { categorical: true, cats: [
      [1, THREAT[1], 'TSTM'], [2, THREAT[2], 'MRGL'], [3, THREAT[3], 'SLGT'], [4, THREAT[4], 'ENH'], [5, THREAT[5], 'MDT+'],
    ] },
    cape: S([[50, '#0b2a3a', 0], [150, '#123f5a', .55], [300, '#16617a'], [500, '#1c8a8a'], [800, '#2fb38a'], [1200, '#b8d44a'], [1600, '#f2c14e'], [2000, '#f08a3c'], [2500, '#e5533d'], [3000, '#c21f4a'], [3500, '#9b1d8a'], [4500, '#e879f9'], [6000, '#ffffff']]),
    li: S([[4, '#1e3a8a', 0], [2, '#1e3a8a', .25], [0, '#0e7490', .45], [-1, '#2fb38a'], [-2, '#b8d44a'], [-3, '#f2c14e'], [-4, '#f08a3c'], [-6, '#e5533d'], [-8, '#c21f4a'], [-10, '#e879f9'], [-12, '#ffffff']], { reverse: true }),
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
    td2: S([[-10, '#3b2f2a', .5], [0, '#6b4f3a', .6], [5, '#8a7a4a'], [8, '#6b8e3a'], [11, '#2f9e44'], [14, '#1c8a6a'], [16, '#1c7a8a'], [18, '#2563eb'], [20, '#7c3aed'], [22, '#c026d3'], [25, '#f0abfc']]),
    t2: S([[-25, '#e0e7ff'], [-15, '#818cf8'], [-5, '#2563eb'], [0, '#0ea5e9'], [5, '#14b8a6'], [10, '#22c55e'], [15, '#a3e635'], [20, '#facc15'], [25, '#fb923c'], [30, '#ef4444'], [35, '#be123c'], [40, '#e879f9']]),
    theta_e: S([[290, '#1e3a8a'], [300, '#2563eb'], [310, '#0ea5e9'], [320, '#22c55e'], [330, '#facc15'], [340, '#fb923c'], [350, '#ef4444'], [360, '#e879f9']]),
    kindex: S([[15, '#10233a', 0], [20, '#1d4f73', .6], [25, '#1c8a8a'], [30, '#b8d44a'], [35, '#f08a3c'], [40, '#e5533d'], [45, '#e879f9']]),
    tt: S([[40, '#10233a', 0], [44, '#1d4f73', .6], [48, '#1c8a8a'], [52, '#b8d44a'], [55, '#f08a3c'], [58, '#e5533d'], [62, '#e879f9']]),
    precip: S([[0.1, '#88ddee', .0], [0.2, '#88ddee', .6], [1, '#0099cc'], [2, '#0055aa'], [4, '#ffee00'], [8, '#ffaa00'], [15, '#ff4400'], [25, '#c80000'], [40, '#ff78ff'], [70, '#ffffff']]),
    gust: S([[30, '#10233a', 0], [45, '#1d4f73', .6], [60, '#1c8a8a'], [75, '#b8d44a'], [90, '#f2c14e'], [105, '#f08a3c'], [120, '#e5533d'], [140, '#c21f4a'], [170, '#e879f9']]),
    lpi: S([[0.2, '#fef9c3', 0], [1, '#fde047', .6], [3, '#facc15'], [6, '#fb923c'], [10, '#ef4444'], [20, '#e879f9']]),
    wind850: S([[5, '#10233a', 0], [10, '#1d4f73', .6], [15, '#1c8a8a'], [20, '#2fb38a'], [25, '#b8d44a'], [30, '#f2c14e'], [40, '#f08a3c'], [50, '#e879f9']]),
    wind250: S([[20, '#10233a', 0], [30, '#1d4f73', .6], [40, '#1c8a8a'], [50, '#2fb38a'], [60, '#b8d44a'], [70, '#f2c14e'], [85, '#f08a3c'], [100, '#e5533d'], [120, '#e879f9']]),
    z500: S([[516, '#4c1d95'], [528, '#1e40af'], [540, '#0284c7'], [552, '#0d9488'], [564, '#65a30d'], [576, '#ca8a04'], [584, '#ea580c'], [592, '#dc2626'], [600, '#be185d']]),
    t850: S([[-25, '#e0e7ff'], [-15, '#818cf8'], [-8, '#2563eb'], [-2, '#0ea5e9'], [4, '#14b8a6'], [10, '#22c55e'], [14, '#a3e635'], [18, '#facc15'], [22, '#fb923c'], [26, '#ef4444'], [30, '#e879f9']]),
    fzl: S([[0, '#e0e7ff'], [1000, '#818cf8'], [2000, '#2563eb'], [3000, '#14b8a6'], [3800, '#a3e635'], [4500, '#facc15'], [5000, '#fb923c']]),
    cloud: S([[5, '#ffffff', 0], [30, '#9aa3b5', .25], [60, '#c7ccd6', .5], [90, '#eef1f6', .75], [100, '#ffffff', .85]]),
  };
  SM.THREAT_COLORS = THREAT;
  SM.THREAT_NAMES = ['None', 'TSTM', 'MRGL', 'SLGT', 'ENH', 'MDT+'];

  // Returns [r,g,b,a(0-255)] or null
  SM.colorFor = function (key, v) {
    if (v == null || Number.isNaN(v)) return null;
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
    if (asc ? v <= first[0] : v >= first[0]) return first[2] <= 0 ? null : [...first[1], first[2] * 255];
    if (asc ? v >= last[0] : v <= last[0]) return [...last[1], last[2] * 255];
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

  SM.legendHTML = function (key) {
    const sc = SM.scales[key];
    const p = SM.meta && SM.meta.params[key];
    if (!sc || !p) return '';
    const title = `<div class="lg-title"><b>${SM.esc(p.label)}</b><span>${SM.esc(p.unit)}</span></div>`;
    if (sc.categorical) {
      return title + '<div class="lg-cats">' + sc.cats.map(c => `<span style="background:${c[1]}">${c[2]}</span>`).join('') + '</div>';
    }
    const st = sc.stops;
    const lo = st[0][0], hi = st[st.length - 1][0];
    const grad = st.map(s => `rgba(${s[1][0]},${s[1][1]},${s[1][2]},${Math.max(s[2], .15)}) ${((s[0] - lo) / (hi - lo) * 100).toFixed(1)}%`).join(',');
    const ticks = [st[0], st[Math.floor(st.length / 3)], st[Math.floor(2 * st.length / 3)], st[st.length - 1]].map(s => `<span>${s[0]}</span>`).join('');
    return title + `<div class="lg-bar" style="background:linear-gradient(90deg,${grad})"></div><div class="lg-ticks">${ticks}</div>`;
  };

  SM.PARAM_GROUPS = [
    ['Composite', ['threat', 'stp', 'scp', 'ship', 'ehi']],
    ['Instability', ['cape', 'li', 'cin', 'lr75', 'lcl', 'kindex', 'tt']],
    ['Kinematics', ['shr6', 'shr1', 'srh3', 'srh1', 'wind850', 'wind250']],
    ['Moisture & surface', ['td2', 'theta_e', 't2', 'precip', 'gust', 'lpi', 'cloud']],
    ['Synoptic', ['z500', 't850', 'fzl']],
  ];
})();
