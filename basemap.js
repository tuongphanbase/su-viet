// Base map under the atlas: sea, land, lakes, rivers, a 5° grid and Vietnam's modern land borders (dashed),
// from geo-data.js (Natural Earth, public domain). The paths are built once in "world" units
// (Web Mercator at zoom 0, 256 px wide, the same projection as project() in app.js), so a pan or
// zoom only moves one transform instead of rebuilding thousands of points.
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
    return { svg, levels, clipUse, world, land, labels, data };
  }

  // The 1:10m "core" data is used when zoomed in and the whole view lies inside its box.
  function levelFor(levels, view) {
    const [west, south, east, north] = levels.core.box;
    const inside = view.west >= west && view.east <= east && view.south >= south && view.north <= north;
    return view.zoom >= 6 && inside ? 'core' : 'wide';
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
