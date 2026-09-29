/* StormMap — radar mosaic (RainViewer via same-origin proxy) with loop animation */
'use strict';

(function () {
  const R = SM.radar = {
    frames: [],
    layers: {},
    index: 0,
    playing: false,
    opacity: 0.85,
    enabled: true,
    timer: null,
  };

  R.tileUrl = function (frame, size = 256) {
    return `/api/radar/tile/{z}/{x}/{y}.png?path=${encodeURIComponent(frame.path)}&size=${size}&color=2`;
  };

  function layerFor(frame) {
    if (!R.layers[frame.path]) {
      R.layers[frame.path] = L.tileLayer(R.tileUrl(frame), {
        pane: 'radarPane', opacity: 0, maxNativeZoom: 7, maxZoom: 14, tileSize: 256,
        attribution: 'Radar © <a href="https://www.rainviewer.com" target="_blank" rel="noopener">RainViewer</a>',
        keepBuffer: 1, updateWhenIdle: true,
      });
    }
    return R.layers[frame.path];
  }

  R.show = function (i) {
    if (!R.frames.length) return;
    R.index = Math.max(0, Math.min(i, R.frames.length - 1));
    const cur = R.frames[R.index];
    for (const f of R.frames) {
      const lyr = R.layers[f.path];
      if (!lyr) continue;
      if (f === cur) continue;
      if (R.playing) lyr.setOpacity(0); else if (SM.map.hasLayer(lyr)) SM.map.removeLayer(lyr);
    }
    if (R.enabled) {
      const lyr = layerFor(cur);
      if (!SM.map.hasLayer(lyr)) lyr.addTo(SM.map);
      lyr.setOpacity(R.opacity);
    }
    SM.$('#radarSlider').value = R.index;
    const age = Math.round((Date.now() / 1000 - cur.time) / 60);
    SM.$('#radarTime').textContent = `${SM.utcHM(cur.time)}Z · ${age} min ago`;
  };

  R.setEnabled = function (on) {
    R.enabled = on;
    if (!on) {
      R.stop();
      for (const l of Object.values(R.layers)) if (SM.map.hasLayer(l)) SM.map.removeLayer(l);
    } else R.show(R.index);
    SM.$('#radarBar').style.display = on ? '' : 'none';
  };

  R.setOpacity = function (o) { R.opacity = o; R.show(R.index); };

  R.play = function () {
    if (R.playing || !R.frames.length) return;
    R.playing = true;
    SM.$('#radarPlay').textContent = '❚❚';
    // preload every frame at zero opacity so the loop is smooth
    for (const f of R.frames) { const l = layerFor(f); if (!SM.map.hasLayer(l)) l.addTo(SM.map); l.setOpacity(0); }
    let hold = 0;
    R.timer = setInterval(() => {
      if (R.index === R.frames.length - 1 && hold++ < 2) return; // dwell on the latest frame
      hold = 0;
      R.show((R.index + 1) % R.frames.length);
    }, 550);
  };

  R.stop = function () {
    R.playing = false;
    clearInterval(R.timer);
    SM.$('#radarPlay').textContent = '▶';
    R.show(R.index);
  };

  R.toggle = () => (R.playing ? R.stop() : R.play());

  R.refresh = async function () {
    SM.status('stRadar', 'busy');
    try {
      const data = await SM.api('radar/frames');
      const frames = data.radar || [];
      if (!frames.length) throw new Error('no frames');
      const latestChanged = !R.frames.length || frames[frames.length - 1].path !== R.frames[R.frames.length - 1].path;
      // drop layers of frames that aged out
      const keep = new Set(frames.map(f => f.path));
      for (const [p, l] of Object.entries(R.layers)) if (!keep.has(p)) { if (SM.map.hasLayer(l)) SM.map.removeLayer(l); delete R.layers[p]; }
      R.frames = frames;
      R.demo = data.demo;
      const sl = SM.$('#radarSlider');
      sl.max = frames.length - 1;
      if (!R.playing) R.show(frames.length - 1);
      SM.status('stRadar', 'ok', `Radar: ${frames.length} frames, latest ${SM.utcHM(frames[frames.length - 1].time)}Z`);
      if (latestChanged) SM.emit('radar-frames', frames);
    } catch (e) {
      SM.status('stRadar', 'err', 'Radar unavailable: ' + e.message);
    }
  };

  R.init = function () {
    SM.$('#radarPlay').addEventListener('click', R.toggle);
    SM.$('#radarSlider').addEventListener('input', e => { if (R.playing) R.stop(); R.show(+e.target.value); });
    R.refresh();
    setInterval(R.refresh, 120000);
  };
})();
