# Builds the realistic island's walk grid in the game's own NavData format (src/world/explore.ts):
#   python tools/island-pipeline/make_nav.py --source "<Viking_realistic island>" --overlay public/data/islands/realistic.json \
#          --world public/data/world.json --out public/data/nav-island-realistic.json
# Same inputs as the streamed tiles (ground + boardwalk heightfields and the building/ship/tree/rock list from the
# Blender pipeline), so collision matches what is drawn. Needs numpy.
#   h[i][j]     surface height (boardwalk deck where there is one, else ground) for Blender cell
#               x in [i-half, i-half+1), y in [j-half, j-half+1); null = sea / deep water
#   blocked[i]  '1' where a building, ship, tree trunk or rock stands (rasterised from the collider list)
import argparse, json, math, os, sys
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--source', required=True)
ap.add_argument('--overlay', required=True)
ap.add_argument('--world', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--step-max', type=float, default=1.05)   # boardwalk stairs in the source are 1 m blocks
ap.add_argument('--instances', help='also write the tree/ship/rock placements (three.js coords) for the streamed island')
ap.add_argument('--overrides', default=None, help='route-overrides.json (default: the one beside this script); "none" disables')
a = ap.parse_args()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nav_overrides

SEA = 36.0
G = np.load(os.path.join(a.source, 'data', 'ground.npy')).astype(np.float64) - SEA
DK = np.load(os.path.join(a.source, 'data', 'deck_h.npy')).astype(np.float64) - SEA
F = json.load(open(os.path.join(a.source, 'data', 'features.json')))
T = json.load(open(os.path.join(a.source, 'data', 'trees.json')))
# Hand-authored corrections (removed route trees, extra blocked cells) live in the repo and are applied here,
# before the colliders are rasterised, so every pipeline run reproduces them.
OV = None if a.overrides == 'none' else nav_overrides.load(a.overrides or nav_overrides.DEFAULT_PATH)
if OV:
    T = nav_overrides.filter_trees(T, OV)
D, W = G.shape
HALF = int(math.ceil(max(W, D) / 2)) + 1
N = 2 * HALF


def ground(bx, by):
    """Bilinear ground height at Blender (x, y); data cell c has its centre at x = c + 0.5 - W/2."""
    gx = min(max(bx + W / 2 - 0.5, 0), W - 1.001); gz = min(max(D / 2 - by - 0.5, 0), D - 1.001)
    x0, z0 = int(gx), int(gz); fx, fz = gx - x0, gz - z0
    return (G[z0, x0] * (1 - fx) * (1 - fz) + G[z0, x0 + 1] * fx * (1 - fz) + G[z0 + 1, x0] * (1 - fx) * fz + G[z0 + 1, x0 + 1] * fx * fz)


def deck(bx, by):
    c = int(math.floor(bx + W / 2)); r = int(math.floor(D / 2 - by))
    if 0 <= c < W and 0 <= r < D and not np.isnan(DK[r, c]):
        return float(DK[r, c])
    return None


# ---- colliders (same shapes as the validation viewer's world.js) ----
cols = []
for h in F['houses']:
    L = max(h['length'], h['length'] if h['round'] else h['width'] * 1.35); Wd = max(h['width'], 3.0)
    if h['round']:
        cols.append(('c', h['x'], h['y'], L / 2 + 0.3))
    else:
        cols.append(('o', h['x'], h['y'], L / 2 + 0.3, Wd / 2 + 0.3, h['angle']))
for s in F['ships']:
    cols.append(('o', s['x'], s['y'], s['length'] / 2, s['width'] / 2, s['angle']))
for t in T:
    cols.append(('c', t['x'], t['y'], 0.45 * max(0.7, t['height'] / 20) + 0.1))
for r in F['rocks']:
    cols.append(('c', r['x'], r['y'], r['size'] * 0.45))

blocked = np.zeros((N, N), bool)
for c in cols:
    ext = c[3] if c[0] == 'c' else math.hypot(c[3], c[4])
    i0, i1 = int(math.floor(c[1] - ext)) + HALF, int(math.ceil(c[1] + ext)) + HALF
    j0, j1 = int(math.floor(c[2] - ext)) + HALF, int(math.ceil(c[2] + ext)) + HALF
    for i in range(max(i0, 0), min(i1 + 1, N)):
        for j in range(max(j0, 0), min(j1 + 1, N)):
            px, py = i - HALF + 0.5, j - HALF + 0.5        # cell centre (Blender)
            dx, dy = px - c[1], py - c[2]
            if c[0] == 'c':
                inside = math.hypot(dx, dy) <= c[3]
            else:
                ca, sa = math.cos(c[5]), math.sin(c[5])
                u, v = dx * ca + dy * sa, -dx * sa + dy * ca   # into the collider's local frame (Blender rotZ)
                inside = abs(u) <= c[3] and abs(v) <= c[4]
            if inside:
                blocked[i, j] = True

forced = nav_overrides.apply_blocked(blocked, OV, HALF) if OV else 0

h = []
walk = 0
for i in range(N):
    col = []
    for j in range(N):
        bx, by = i - HALF + 0.5, j - HALF + 0.5
        d = deck(bx, by)
        if d is not None:
            v = d
        else:
            g = ground(bx, by)
            v = None if g < -0.35 or abs(bx) > W / 2 or abs(by) > D / 2 else g
        col.append(None if v is None else round(float(v), 2))
        if v is not None and not blocked[i, j]: walk += 1
    h.append(col)

world = json.load(open(a.world, encoding='utf-8')); ov = json.load(open(a.overlay, encoding='utf-8'))
pos = ov.get('positions', {})
zones = {}
for d_ in world['destinations']:
    p = pos.get(d_['id'], d_['position'])           # three.js [x, z] -> Blender (x, -z)
    zones[d_['id']] = {'name': d_['name'], 'x': p[0], 'y': -p[1]}
sp = ov['spawn']
nav = dict(n=N, half=HALF, cell=1.0, step_max=a.step_max, h=h,
           blocked=[''.join('1' if b else '0' for b in blocked[i]) for i in range(N)],
           spawn={'x': sp[0], 'y': sp[1], 'z': round(float(deck(sp[0], sp[1]) or ground(sp[0], sp[1])), 2)},
           zones=zones,
           source='tools/island-pipeline/make_nav.py from the realistic island data (ground, boardwalks, colliders)' + (f' + route-overrides.json v{OV["version"]}' if OV else ''))
with open(a.out, 'w') as f:
    json.dump(nav, f, separators=(',', ':'))
if a.instances:   # Blender (x, y) -> three.js (x, -y); base heights from the same ground the walk grid uses
    inst = dict(
        trees=[[round(t['x'], 2), round(float(ground(t['x'], t['y'])), 2), round(-t['y'], 2), round(t['height'], 2), t['kind']] for t in T],
        ships=[[round(s['x'], 2), round(-s['y'], 2), round(s['angle'], 4)] for s in F['ships']],
        rocks=[[round(r['x'], 2), round(float(ground(r['x'], r['y'])), 2), round(-r['y'], 2), round(r['size'], 2)] for r in F['rocks']],
    )
    with open(a.instances, 'w') as f:
        json.dump(inst, f, separators=(',', ':'))
print(json.dumps({'n': N, 'half': HALF, 'walkable_cells': walk, 'blocked_cells': int(blocked.sum()), 'forced_blocked': forced, 'removed_trees': len(OV['removed_trees']) if OV else 0, 'colliders': len(cols), 'bytes': os.path.getsize(a.out)}))
