/* StormMap — surface observations (METAR) as station plots */
'use strict';

(function () {
  const O = SM.obs = { list: [], enabled: false, source: '' };
  const WX_COLORS = [[/TS/, '#fde047'], [/(GR|GS|PL)/, '#e879f9'], [/(\+RA|SH)/, '#60a5fa'], [/RA|DZ/, '#86efac'], [/SN|SG/, '#e2e8f0'], [/FG|BR|HZ/, '#94a3b8']];

  const StationLayer = L.Layer.extend({
    onAdd(map) {
      this._map = map;
      this._c = L.DomUtil.create('canvas', 'field-canvas leaflet-zoom-hide');
      this._c.style.position = 'absolute';
      map.getPane('valuesPane').appendChild(this._c);
      map.on('moveend zoomend resize', this.redraw, this);
      this.redraw();
    },
    onRemove(map) { map.off('moveend zoomend resize', this.redraw, this); this._c.remove(); },
    redraw() {
      const map = this._map;
      if (!map) return;
      const size = map.getSize(), dpr = window.devicePixelRatio || 1;
      L.DomUtil.setPosition(this._c, map.containerPointToLayerPoint([0, 0]));
      this._c.width = size.x * dpr; this._c.height = size.y * dpr;
      this._c.style.width = size.x + 'px'; this._c.style.height = size.y + 'px';
      const ctx = this._c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const placed = [];
      O.screen = [];
      const now = Date.now() / 1000;
      for (const o of O.list) {
        const p = map.latLngToContainerPoint([o.lat, o.lon]);
        if (p.x < 20 || p.y < 20 || p.x > size.x - 20 || p.y > size.y - 20) continue;
        if (placed.some(q => Math.abs(q.x - p.x) < 56 && Math.abs(q.y - p.y) < 40)) continue;
        placed.push(p);
        O.screen.push([p, o]);
        const old = now - o.time > 3 * 3600;
        ctx.globalAlpha = old ? 0.45 : 1;
        // wind barb (knots → m/s for the shared barb routine)
        ctx.strokeStyle = '#e7eaf0'; ctx.fillStyle = '#e7eaf0'; ctx.lineWidth = 1.2;
        if (o.wspd != null && o.wdir != null && o.wspd >= 2) {
          const ms = o.wspd / 1.943844, rad = o.wdir * Math.PI / 180;
          SM.drawBarb(ctx, p.x, p.y, -ms * Math.sin(rad), -ms * Math.cos(rad));
        }
        // cloud-cover circle
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#05070a'; ctx.fill(); ctx.stroke();
        if (o.cover) {
          ctx.beginPath(); ctx.moveTo(p.x, p.y);
          ctx.arc(p.x, p.y, 5, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * o.cover / 8);
          ctx.closePath(); ctx.fillStyle = '#e7eaf0'; ctx.fill();
        }
        ctx.font = '600 11px JetBrains Mono, monospace';
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(4,5,7,.85)';
        const text = (s, x, y, col, align = 'right') => { ctx.textAlign = align; ctx.strokeText(s, x, y); ctx.fillStyle = col; ctx.fillText(s, x, y); };
        if (o.t != null) text(SM.units.fmt('temp', o.t), p.x - 8, p.y - 5, '#fb7185');
        if (o.td != null) text(SM.units.fmt('temp', o.td), p.x - 8, p.y + 13, '#4ade80');
        if (o.p != null) text(String(Math.round(o.p * 10)).slice(-3), p.x + 8, p.y - 5, '#cbd5e1', 'left');
        if (o.wx) {
          const col = (WX_COLORS.find(w => w[0].test(o.wx)) || [0, '#cbd5e1'])[1];
          text(o.wx.split(' ')[0], p.x + 8, p.y + 13, col, 'left');
        }
        if (o.wgst) text('G' + Math.round(SM.units.conv('wind', o.wgst / 1.943844)), p.x + 8, p.y + 25, '#fbbf24', 'left');
        ctx.globalAlpha = 1;
      }
      ctx.textAlign = 'left';
    },
  });

  /** Nearest plotted station to a container point (for click popups). */
  O.hit = function (pt) {
    if (!O.enabled || !O.screen) return null;
    let best = null, bd = 14;
    for (const [p, o] of O.screen) { const d = Math.hypot(p.x - pt.x, p.y - pt.y); if (d < bd) { bd = d; best = o; } }
    return best;
  };

  O.popup = function (o) {
    const age = Math.round((Date.now() / 1000 - o.time) / 60);
    L.popup({ maxWidth: 360 }).setLatLng([o.lat, o.lon]).setContent(`
      <b>${SM.esc(o.id)}</b> ${SM.esc(o.name || '')}<br>
      <span style="color:var(--muted)">${age} min ago · ${SM.esc(O.source)}</span>
      <div style="font:11.5px var(--mono);margin-top:6px;white-space:pre-wrap">${SM.esc(o.raw)}</div>
      <div style="margin-top:6px">T ${SM.units.fmt('temp', o.t, true)} · Td ${SM.units.fmt('temp', o.td, true)} · Wind ${o.vrb ? 'VRB' : (o.wdir ?? '—') + '°'} ${SM.units.fmt('wind', o.wspd != null ? o.wspd / 1.943844 : null, true)}${o.wgst ? ' G' + SM.units.fmt('wind', o.wgst / 1.943844) : ''} · ${o.p ? Math.round(o.p) + ' hPa' : ''}</div>`).openOn(SM.map);
  };

  O.load = async function () {
    if (!O.enabled) return;
    try {
      const d = await SM.api('obs');
      O.list = d.obs; O.source = d.source;
      O.layer.redraw();
    } catch (e) { SM.toast('Observations unavailable: ' + e.message, true); }
  };

  O.setEnabled = function (on) {
    O.enabled = on;
    if (on) { O.layer.addTo(SM.map); O.load(); } else SM.map.removeLayer(O.layer);
  };

  O.init = function () {
    O.layer = new StationLayer();
    setInterval(O.load, 10 * 60000);
    SM.on('units', () => O.enabled && O.layer.redraw());
  };
})();
