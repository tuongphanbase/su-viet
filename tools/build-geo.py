"""Builds geo-data.js, the base map under the Sử Việt atlas, from Natural Earth (public domain).

    pip install shapely
    python tools/build-geo.py              # downloads the Natural Earth files it needs
    python tools/build-geo.py --data DIR   # or reads them from DIR

Two levels of detail: "wide" (1:50m, for zoom 3-5 and anywhere outside the core box) and "core"
(1:10m, for zoom 6+ around Vietnam). Lines are stored as encoded polylines (the Google polyline
algorithm) to keep the file small; basemap.js decodes them.
"""
import argparse
import json
import os
import urllib.request

from shapely.geometry import box, shape
from shapely.ops import unary_union

SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/{}.geojson'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'geo-data.js')

WIDE = dict(box=(30, -45, 180, 65), precision=100, land='ne_50m_land', lakes='ne_50m_lakes',
            rivers='ne_50m_rivers_lake_centerlines', tolerance=0.04, min_land=0.05, min_lake=0.2, max_river_zoom=4.0)
CORE = dict(box=(90, -4, 126, 34), precision=1000, land='ne_10m_land', lakes='ne_10m_lakes',
            rivers='ne_10m_rivers_lake_centerlines', tolerance=0.006, min_land=0.0004, min_lake=0.01, max_river_zoom=7.0)
BORDERS = 'ne_10m_admin_0_boundary_lines_land'


def load(name, data_dir):
    path = os.path.join(data_dir, name + '.geojson')
    if not os.path.exists(path):
        os.makedirs(data_dir, exist_ok=True)
        print('downloading', name)
        urllib.request.urlretrieve(SOURCE.format(name), path)
    with open(path, encoding='utf-8') as f:
        return json.load(f)['features']


def encode(coords, precision):
    """Google polyline encoding of (lon, lat) pairs, stored as lat, lon."""
    out, last_lat, last_lon = [], 0, 0
    for lon, lat in coords:
        lat_i, lon_i = round(lat * precision), round(lon * precision)
        for delta in (lat_i - last_lat, lon_i - last_lon):
            v = ~(delta << 1) if delta < 0 else delta << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63))
                v >>= 5
            out.append(chr(v + 63))
        last_lat, last_lon = lat_i, lon_i
    return ''.join(out)


def polygons(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'Polygon':
        return [geom]
    if geom.geom_type in ('MultiPolygon', 'GeometryCollection'):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def lines(geom):
    if geom.is_empty:
        return []
    if geom.geom_type == 'LineString':
        return [geom]
    if geom.geom_type in ('MultiLineString', 'GeometryCollection'):
        return [l for g in geom.geoms for l in lines(g)]
    return []


def area_rings(features, level, min_area):
    """Clipped, simplified rings (outer and holes) of every polygon big enough to see."""
    clip = box(*level['box'])
    merged = unary_union([shape(f['geometry']).intersection(clip) for f in features
                          if shape(f['geometry']).intersects(clip)])
    rings = []
    for poly in polygons(merged.simplify(level['tolerance'], preserve_topology=True)):
        if poly.area < min_area:
            continue
        rings.append(encode(poly.exterior.coords, level['precision']))
        rings += [encode(r.coords, level['precision']) for r in poly.interiors
                  if abs(shape({'type': 'Polygon', 'coordinates': [list(r.coords)]}).area) >= min_area]
    return rings


def river_lines(features, level):
    clip = box(*level['box'])
    out = []
    for f in features:
        p = f['properties']
        geom = shape(f['geometry'])
        if p.get('featurecla') not in ('River', 'Lake Centerline') or not geom.intersects(clip):
            continue
        if (p.get('min_zoom') or 99) > level['max_river_zoom']:
            continue
        for line in lines(geom.intersection(clip).simplify(level['tolerance'], preserve_topology=False)):
            if len(line.coords) > 1:
                out.append([p['min_zoom'], encode(line.coords, level['precision'])])
    return out


def build(data_dir):
    result = {}
    for name, level in (('wide', WIDE), ('core', CORE)):
        result[name] = {
            'box': level['box'],
            'precision': level['precision'],
            'land': area_rings(load(level['land'], data_dir), level, level['min_land']),
            'lakes': area_rings(load(level['lakes'], data_dir), level, level['min_lake']),
            'rivers': river_lines(load(level['rivers'], data_dir), level),
        }
    borders = []
    for f in load(BORDERS, data_dir):
        p = f['properties']
        if 'Vietnam' in (p.get('ADM0_LEFT'), p.get('ADM0_RIGHT')):
            for line in lines(shape(f['geometry']).simplify(0.004, preserve_topology=False)):
                borders.append(encode(line.coords, 1000))
    result['borders'] = {'precision': 1000, 'lines': borders}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--data', default=os.path.join(os.path.dirname(OUT), '.natural-earth'),
                        help='folder for the downloaded Natural Earth GeoJSON files')
    args = parser.parse_args()
    geo = build(args.data)
    body = json.dumps(geo, ensure_ascii=True, separators=(',', ':'))
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build-geo.py from Natural Earth (public domain, naturalearthdata.com).\n'
                '// Do not edit by hand: change the script and run it again.\n'
                'window.SUVIET_GEO=' + body + ';\n')
    for name in ('wide', 'core'):
        g = geo[name]
        print(f"{name}: {len(g['land'])} land rings, {len(g['lakes'])} lakes, {len(g['rivers'])} rivers")
    print(f"borders: {len(geo['borders']['lines'])} lines; {os.path.getsize(OUT) / 1024:.0f} KB written to geo-data.js")


if __name__ == '__main__':
    main()
