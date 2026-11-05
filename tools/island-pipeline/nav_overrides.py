# Hand-authored corrections for the walk grid and the vegetation list (route-overrides.json), applied by
# make_nav.py after the Blender data is read. Pure functions, no numpy, so they can be self-tested anywhere:
#   python tools/island-pipeline/nav_overrides.py --self-test
import json, math, os, sys

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'route-overrides.json')


def load(path=DEFAULT_PATH):
    with open(path, encoding='utf-8') as f:
        ov = json.load(f)
    if ov.get('version') != 1:
        raise ValueError(f'{path}: unsupported overrides version {ov.get("version")!r}')
    return ov


def filter_trees(trees, ov):
    """Drop every tree within `tree_match_radius_m` of a removed_trees entry (Blender x, y). Each entry must match
    exactly one tree, so a drifted source list is noticed instead of silently thinning the wrong tree."""
    r = float(ov.get('tree_match_radius_m', 1.0))
    keep = list(trees)
    for e in ov.get('removed_trees', []):
        hits = [t for t in keep if math.hypot(t['x'] - e['x'], t['y'] - e['y']) <= r]
        if len(hits) != 1:
            raise ValueError(f'removed tree at ({e["x"]}, {e["y"]}) matched {len(hits)} trees within {r} m; expected exactly 1')
        keep.remove(hits[0])
    return keep


def blocked_cells(ov):
    """All (bx, by) Blender cells the overrides force to blocked."""
    out = []
    for group in ov.get('blocked_cells', []):
        for bx, by in group['cells']:
            out.append((int(bx), int(by)))
    return out


def apply_blocked(blocked, ov, half):
    """Set blocked[i][j] = True for every override cell; `blocked` is indexable as blocked[i][j] (numpy or lists).
    Returns the number of cells changed."""
    n = 0
    for bx, by in blocked_cells(ov):
        i, j = bx + half, by + half
        if not blocked[i][j]:
            blocked[i][j] = True
            n += 1
    return n


def _self_test():
    ov = load()
    trees = [{'x': -32.89, 'y': 58.64, 'height': 18.56}, {'x': -6.0, 'y': -161.0, 'height': 29.28}, {'x': 10.0, 'y': 10.0, 'height': 12.0}]
    kept = filter_trees(trees, ov)
    assert [t['x'] for t in kept] == [10.0], kept
    try:
        filter_trees([{'x': 10.0, 'y': 10.0, 'height': 12.0}], ov)
        raise AssertionError('a missing tree must raise')
    except ValueError:
        pass
    half, n = 290, 580
    grid = [[False] * n for _ in range(n)]
    changed = apply_blocked(grid, ov, half)
    assert changed == len(blocked_cells(ov)) == 14, changed
    assert grid[-22 + half][62 + half] is True
    assert apply_blocked(grid, ov, half) == 0
    print(json.dumps({'ok': True, 'removed_trees': len(ov['removed_trees']), 'blocked_cells': changed}))


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        _self_test()
    else:
        print(json.dumps(load(), indent=1))
