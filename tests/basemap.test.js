// Run: node tests/basemap.test.js
// Decodes geo-data.js the way basemap.js does and checks the shapes are where they should be.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const f of ['geo-data.js', 'basemap.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
const geo = sandbox.window.SUVIET_GEO, { decode } = sandbox.window.SuVietBasemap;
assert.ok(geo && typeof decode === 'function', 'geo-data.js and basemap.js load');

// Known example from the Google polyline documentation (arrays come from the VM, so compare as JSON).
assert.deepStrictEqual(JSON.parse(JSON.stringify(decode('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 1e5).map(p => p.map(v => +v.toFixed(3))))),
  [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]);

const inside = ([lat, lon], [west, south, east, north]) => lon >= west - 1e-9 && lon <= east + 1e-9 && lat >= south - 1e-9 && lat <= north + 1e-9;
for (const name of ['wide', 'core']) {
  const g = geo[name];
  assert.ok(g.land.length > 10, `${name}: has land`);
  for (const enc of [...g.land, ...g.lakes, ...g.rivers.map(r => r[1])]) {
    const pts = decode(enc, g.precision);
    assert.ok(pts.length >= 2, `${name}: every shape has points`);
    for (const p of pts) assert.ok(inside(p, g.box), `${name}: ${p} lies inside ${g.box}`);
  }
  for (const [minZoom] of g.rivers) assert.ok(minZoom >= 0 && minZoom <= 10, `${name}: river min zoom ${minZoom}`);
}

// Hà Nội is on land in the detailed data: some land ring's bounding box holds it.
const hanoi = [21.03, 105.85];
assert.ok(geo.core.land.some(enc => {
  const pts = decode(enc, geo.core.precision);
  const lats = pts.map(p => p[0]), lons = pts.map(p => p[1]);
  return Math.min(...lats) < hanoi[0] && Math.max(...lats) > hanoi[0] && Math.min(...lons) < hanoi[1] && Math.max(...lons) > hanoi[1];
}), 'Hà Nội falls inside the mainland');

// Vietnam's land borders run from the Gulf of Tonkin (about 21.5°N) to the Gulf of Thailand (about 10.4°N).
const borderLats = geo.borders.lines.flatMap(enc => decode(enc, geo.borders.precision).map(p => p[0]));
assert.ok(Math.max(...borderLats) > 23 && Math.min(...borderLats) < 11, 'border lines cover north to south');

console.log('basemap validation passed:', ['wide', 'core'].map(n => `${n} ${geo[n].land.length} land rings, ${geo[n].rivers.length} rivers`).join(' · '));
