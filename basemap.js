// Base map under the atlas. By default it is satellite imagery (keyless tile services, tried in
// order); the "Vệ tinh" button, or imagery that will not load, switches to a drawn map: sea, land,
// lakes, rivers and a 5° grid from geo-data.js (Natural Earth, public domain). Vietnam's modern land
// borders (dashed) and the land outline used to clip territories come from geo-data.js in both modes.
// The paths are built once in "world" units (Web Mercator at zoom 0, 256 px wide, the same projection
// as project() in app.js), so a pan or zoom only moves one transform instead of rebuilding them.
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SEA_LABELS = [
    { name: 'Biển Đông', lat: 12.6, lon: 111.4, min: 3, max: 7 },
    { name: 'Vịnh Bắc Bộ', lat: 19.3, lon: 107.3, min: 5, max: 9 },
    { name: 'Vịnh Thái Lan', lat: 10.4, lon: 101.7, min: 5, max: 9 },
  ];

  // Google polyline encoding: lat, lon pairs as zig-zag varints of the change from the last point.
  function decode(str, precision) {
    const points = [];
    let i = 0, lat = 0, lon = 0;
    const next = () => {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    while (i < str.length) {
      lat += next();
      lon += next();
      points.push([lat / precision, lon / precision]);
    }
    return points;
  }

  const worldX = lon => (lon + 180) / 360 * 256;
  const worldY = lat => (1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 256;
  const lonAt = x => x / 256 * 360 - 180;
  const latAt = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 256))) * 180 / Math.PI;

  function pathData(list, precision, close) {
    return list.map(enc => 'M' + decode(enc, precision)
      .map(([lat, lon]) => worldX(lon).toFixed(4) + ' ' + worldY(lat).toFixed(4))
      .join('L') + (close ? 'Z' : '')).join('');
  }

  function grid([west, south, east, north]) {
    let d = '';
    for (let lon = Math.ceil(west / 5) * 5; lon <= east; lon += 5) {
      d += `M${worldX(lon).toFixed(4)} ${worldY(north).toFixed(4)}V${worldY(south).toFixed(4)}`;
    }
    for (let lat = Math.ceil(south / 5) * 5; lat <= north; lat += 5) {
      d += `M${worldX(west).toFixed(4)} ${worldY(lat).toFixed(4)}H${worldX(east).toFixed(4)}`;
    }
    return d;
  }

  function el(parent, tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  // Creates the layers once per <svg>; app.js redraws only the data layer.
  function build(svg, geo) {
    svg.textContent = '';
    const defs = el(svg, 'defs');
    const levels = {};
    for (const name of ['wide', 'core']) {
      const g = geo[name];
      el(defs, 'path', { id: `bm-land-${name}`, d: pathData(g.land, g.precision, true), 'fill-rule': 'evenodd',
        'vector-effect': 'non-scaling-stroke' });
      levels[name] = { box: g.box, rivers: [] };
    }
    const clip = el(defs, 'clipPath', { id: 'bm-land-clip', clipPathUnits: 'userSpaceOnUse' });
    const clipUse = el(clip, 'use', { href: '#bm-land-wide', 'clip-rule': 'evenodd' });

    const world = el(svg, 'g', { class: 'bm-world' });
    el(world, 'path', { class: 'bm-grid', d: grid(geo.wide.box) });
    const land = el(world, 'use', { class: 'bm-land', href: '#bm-land-wide' });
    for (const name of ['wide', 'core']) {
      const g = geo[name];
      levels[name].lakes = el(world, 'path', { class: 'bm-lake', d: pathData(g.lakes, g.precision, true),
        'fill-rule': 'evenodd' });
      const byZoom = {};
      for (const [minZoom, enc] of g.rivers) (byZoom[minZoom] = byZoom[minZoom] || []).push(enc);
      for (const [minZoom, list] of Object.entries(byZoom)) {
        levels[name].rivers.push({ minZoom: +minZoom, node: el(world, 'path', { class: 'bm-river', d: pathData(list, g.precision, false) }) });
      }
    }
    el(world, 'path', { class: 'bm-border', d: pathData(geo.borders.lines, geo.borders.precision, false) });

    const labels = el(svg, 'g', { class: 'bm-labels' });
    const data = el(svg, 'g', { class: 'bm-data' });
    const button = svg.closest('.map') && svg.closest('.map').querySelector('.map-mode');
    if (button) button.addEventListener('click', toggleMode);
    return { svg, levels, clipUse, world, land, labels, data };
  }

  // The 1:10m "core" data is used when zoomed in and the whole view lies inside its box.
  function levelFor(levels, view) {
    const [west, south, east, north] = levels.core.box;
    const inside = view.west >= west && view.east <= east && view.south >= south && view.north <= north;
    return view.zoom >= 6 && inside ? 'core' : 'wide';
  }

  // Satellite imagery. The first source that loads is remembered for the next visit.
  const IMAGERY = [
    {
      id: 's2cloudless-2020',
      url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`,
      maxZoom: 13,
      credit: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by EOX (Copernicus Sentinel data 2020)',
      short: '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> © EOX',
    },
    {
      id: 'blue-marble',
      url: (z, x, y) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/${z}/${y}/${x}.jpeg`,
      maxZoom: 8,
      credit: '<a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener">NASA Blue Marble</a> (GIBS)',
      short: '<a href="https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api" target="_blank" rel="noopener">NASA Blue Marble</a>',
    },
  ];
  const MODE_KEY = 'suviet_map_mode', SOURCE_KEY = 'suviet_imagery';
  const stored = key => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const store = (key, value) => { try { localStorage.setItem(key, value); } catch (e) { /* storage off: just not remembered */ } };
  const imagery = {
    mode: stored(MODE_KEY) === 'map' ? 'map' : 'sat',
    index: Math.max(0, IMAGERY.findIndex(s => s.id === stored(SOURCE_KEY))),
    loaded: 0, failed: 0, tiles: new Map(), bad: new Set(), view: null, credit: null,
  };
  const satelliteOn = () => imagery.mode === 'sat' && imagery.index < IMAGERY.length;

  function clearTiles() {
    for (const img of imagery.tiles.values()) img.remove();
    imagery.tiles.clear();
  }

  // Three failed tiles and none loaded: try the next source, or fall back to the drawn map.
  function nextSource() {
    imagery.index++;
    imagery.loaded = imagery.failed = 0;
    clearTiles();
    showImagery();
  }

  function placeTiles(box, v) {
    const src = IMAGERY[imagery.index];
    const z = Math.min(v.zoom, src.maxZoom), size = 256 * 2 ** (v.zoom - z), count = 2 ** z, n = 2 ** v.zoom;
    const left = Math.round(worldX(v.center.lon) * n - v.w / 2), top = Math.round(worldY(v.center.lat) * n - v.h / 2);
    const wanted = new Set();
    for (let ty = Math.max(0, Math.floor(top / size)); ty <= Math.min(count - 1, Math.floor((top + v.h) / size)); ty++) {
      for (let tx = Math.floor(left / size); tx <= Math.floor((left + v.w) / size); tx++) {
        const key = `${src.id}/${z}/${tx}/${ty}`;
        if (imagery.bad.has(key)) continue;
        wanted.add(key);
        let img = imagery.tiles.get(key);
        if (!img) {
          img = new Image();
          img.className = 'tile';
          img.alt = '';
          img.draggable = false;
          img.onload = () => {
            if (IMAGERY[imagery.index] !== src) return;
            img.classList.add('in');
            if (++imagery.loaded === 1) store(SOURCE_KEY, src.id);
          };
          img.onerror = () => {
            imagery.bad.add(key);
            img.remove();
            imagery.tiles.delete(key);
            if (IMAGERY[imagery.index] === src && ++imagery.failed >= 3 && !imagery.loaded) nextSource();
          };
          img.src = src.url(z, ((tx % count) + count) % count, ty);
          imagery.tiles.set(key, img);
          box.appendChild(img);
        }
        img.style.cssText = `left:${tx * size - left}px;top:${ty * size - top}px;width:${size}px;height:${size}px`;
      }
    }
    for (const [key, img] of imagery.tiles) if (!wanted.has(key)) { img.remove(); imagery.tiles.delete(key); }
  }

  function showImagery() {
    const v = imagery.view, map = v && v.svg.closest('.map');
    if (!map) return;
    const on = satelliteOn(), box = map.querySelector('.tiles'), attrib = map.querySelector('.attrib');
    map.classList.toggle('sat', on);
    const button = map.querySelector('.map-mode');
    if (button) button.setAttribute('aria-pressed', String(on));
    const src = IMAGERY[imagery.index], narrow = v.w < 480;
    const credit = on ? `${narrow ? src.short : src.credit} · Natural Earth` : 'Natural Earth · nét đứt: biên giới hiện nay';
    if (attrib && credit !== imagery.credit) attrib.innerHTML = imagery.credit = credit;
    if (box && on) placeTiles(box, v);
    else clearTiles();
  }

  // The button shows whether imagery is on screen; pressing it while imagery failed tries again.
  function toggleMode() {
    if (satelliteOn()) {
      imagery.mode = 'map';
    } else {
      imagery.mode = 'sat';
      if (imagery.index >= IMAGERY.length) {
        imagery.index = 0;
        imagery.loaded = imagery.failed = 0;
        imagery.bad.clear();
      }
    }
    store(MODE_KEY, imagery.mode);
    showImagery();
  }

  let state = null;

  function draw(svg, w, h, center, zoom) {
    const geo = window.SUVIET_GEO;
    if (!state || state.svg !== svg) state = build(svg, geo);
    const n = 2 ** zoom;
    const cx = worldX(center.lon) * n, cy = worldY(center.lat) * n;
    const transform = `translate(${(w / 2 - cx).toFixed(3)} ${(h / 2 - cy).toFixed(3)}) scale(${n})`;
    const view = {
      zoom,
      west: lonAt((cx - w / 2) / n), east: lonAt((cx + w / 2) / n),
      north: latAt((cy - h / 2) / n), south: latAt((cy + h / 2) / n),
    };
    const level = levelFor(state.levels, view);
    imagery.view = { svg, w, h, zoom, center: { lat: center.lat, lon: center.lon } };
    showImagery();

    state.world.setAttribute('transform', transform);
    state.clipUse.setAttribute('transform', transform);
    state.clipUse.setAttribute('href', `#bm-land-${level}`);
    state.land.setAttribute('href', `#bm-land-${level}`);
    for (const [name, l] of Object.entries(state.levels)) {
      l.lakes.style.display = name === level ? '' : 'none';
      for (const r of l.rivers) r.node.style.display = name === level && r.minZoom <= zoom + 0.5 ? '' : 'none';
    }

    state.labels.innerHTML = SEA_LABELS.filter(l => zoom >= l.min && zoom <= l.max).map(l => {
      const x = worldX(l.lon) * n - cx + w / 2, y = worldY(l.lat) * n - cy + h / 2;
      return `<text class="bm-sea" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${l.name}</text>`;
    }).join('');

    // Fresh layers for app.js: territories are clipped to land, everything else sits on top.
    state.data.textContent = '';
    const territories = el(state.data, 'g', { class: 'bm-territories', 'clip-path': 'url(#bm-land-clip)' });
    const top = el(state.data, 'g', { class: 'bm-top' });
    return { territories, top };
  }

  window.SuVietBasemap = { draw, decode };
})();
