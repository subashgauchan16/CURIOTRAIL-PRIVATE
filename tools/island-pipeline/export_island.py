# Realistic Viking island, streamed-tile export (Blender side of `npm run build-island-realistic`).
#   blender -b <source>/Viking_realistic_island.blend -P tools/island-pipeline/export_island.py \
#           -- --source <source> --out <build dir> [--chunk 96 --tex 1024 --only i,j]
# Normally run by tools/island-pipeline/build.mjs. Opens the master .blend READ-ONLY: this script never
# saves it, and build.mjs fails the build if the file's modification time changes.
#
# Output (<build dir>/):
#   chunk_<i>_<j>_raw.glb  terrain (3 LODs + skirts, chunk-baked splat texture) + merged buildings/boardwalks
#                          (LOD0 + 30 % LOD1) for one CHUNK x CHUNK m tile; materials are referenced by name only
#                          (their textures are stripped later and come from shared.glb)
#   shared_raw.glb         material library (thatch / light wood / dark wood / stone / ship wood / sail / bark /
#                          needles / rock) + instancing templates: 4 trees (sway weights in COLOR_0), 1 ship, 1 rock
#   chk_<i>_<j>_terrain.jpg, opt_*.jpg/png, opt_impostor_*.png   images for WebP conversion
#   chunks.json            per-chunk bounds (three.js coords), triangle counts, building/deck counts, timings
import bpy, bmesh, numpy as np, os, math, json, time, sys
from mathutils import Vector, Matrix

T0 = time.time()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return type(default)(argv[argv.index(name) + 1]) if name in argv else default
CHUNK = arg('--chunk', 96)          # metres (= grid cells) per tile side
TEX = arg('--tex', 1024)            # baked terrain texture per tile
ONLY = arg('--only', '')            # e.g. "2,1" to export a single tile (debugging)
ROOT = arg('--source', os.environ.get('VIKING_SOURCE', ''))   # folder holding Viking_realistic_island.blend, data/, polyhaven_dl/
OUT = arg('--out', os.path.join(ROOT, 'build_island_game')); os.makedirs(OUT, exist_ok=True)
if not os.path.isdir(os.path.join(ROOT, 'data')):
    raise SystemExit(f'--source must point at the Viking_realistic island folder (got {ROOT!r})')
PH = os.path.join(ROOT, 'polyhaven_dl')
G = np.load(os.path.join(ROOT, 'data', 'ground.npy')) - 36.0
DECK = np.load(os.path.join(ROOT, 'data', 'deck_h.npy'))
D, W = G.shape
sc = bpy.context.scene
TMP = bpy.data.collections.new('_EXPORT_TMP'); sc.collection.children.link(TMP)
LOG = {'chunk_m': CHUNK, 'tex': TEX, 'chunks': []}


# ---------------------------------------------------------------- helpers
def baked_copy(o, name=None, mat_world=True):
    bpy.context.view_layer.update()
    dgx = bpy.context.evaluated_depsgraph_get(); dgx.update()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dgx), preserve_all_data_layers=True, depsgraph=dgx)
    if mat_world:
        me.transform(o.matrix_world)
    ob = bpy.data.objects.new(name or (o.name + '_x'), me); TMP.objects.link(ob)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def single_uv(ob):
    """Keep exactly one UV layer called UVMap (joining meshes with differently named layers splits UVs)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap'); return
    keep = me.uv_layers.active or me.uv_layers[0]
    for l in [l for l in me.uv_layers if l != keep]:
        me.uv_layers.remove(l)
    me.uv_layers[0].name = 'UVMap'


def box_uv(ob, size, face_filter=None):
    me = ob.data
    if not me.uv_layers: me.uv_layers.new(name='UVMap')
    bm = bmesh.new(); bm.from_mesh(me); uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        if face_filter and not face_filter(f): continue
        n = f.normal; ax = max(range(3), key=lambda k: abs(n[k]))
        for lp in f.loops:
            co = lp.vert.co
            uv = (co.y, co.z) if ax == 0 else ((co.x, co.z) if ax == 1 else (co.x, co.y))
            lp[uvl].uv = (uv[0] / size, uv[1] / size)
    bm.to_mesh(me); bm.free()


def join(objs, name):
    objs = [o for o in objs if o and len(o.data.polygons)]
    if not objs: return None
    for o in objs: single_uv(o)
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
            bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def load_img(tex, m, size=1024, tint=None, name=None, noncolor=False):
    im = bpy.data.images.load(os.path.join(PH, tex, f'{tex}_{m}_2k.jpg'), check_existing=False)
    if noncolor: im.colorspace_settings.name = 'Non-Color'
    im.scale(size, size)
    if tint is not None:
        px = np.empty(size * size * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(-1, 4)
        px[:, :3] = np.clip(px[:, :3] * np.array(tint, np.float32), 0, 1); im.pixels.foreach_set(px.ravel())
    im.name = name
    im.filepath_raw = os.path.join(OUT, name + '.jpg'); im.file_format = 'JPEG'; im.save()
    return im


def gltf_mat(name, base_img=None, normal_img=None, rough=0.85, alpha_img=False, double=False, vcol=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links.new
    b = next(n for n in N if n.type == 'BSDF_PRINCIPLED'); b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = 0.5   # 0.5 = glTF default -> no KHR_materials_specular
    if base_img:
        t = N.new('ShaderNodeTexImage'); t.image = base_img
        if vcol:
            va = N.new('ShaderNodeVertexColor'); va.layer_name = 'Col'
            mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
            L(t.outputs['Color'], mx.inputs['A']); L(va.outputs['Color'], mx.inputs['B']); L(mx.outputs['Result'], b.inputs['Base Color'])
        else:
            L(t.outputs['Color'], b.inputs['Base Color'])
        if alpha_img:
            L(t.outputs['Alpha'], b.inputs['Alpha'])
            for attr, val in (('blend_method', 'CLIP'), ('surface_render_method', 'DITHERED')):
                try: setattr(m, attr, val)
                except Exception: pass
    if normal_img:
        tn = N.new('ShaderNodeTexImage'); tn.image = normal_img
        nm = N.new('ShaderNodeNormalMap'); L(tn.outputs['Color'], nm.inputs['Color']); L(nm.outputs['Normal'], b.inputs['Normal'])
    m.use_backface_culling = not double
    return m


def export(path, objs, vcol=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_materials='EXPORT',
              export_draco_mesh_compression_enable=False, export_animations=False, export_yup=True,
              export_texcoords=True, export_normals=True, export_image_format='AUTO')
    # export the 'Col' attribute by name; 'ACTIVE'/'all colours' write a fake white COLOR_0 when no material reads it
    if 'export_vertex_color' in props: kw['export_vertex_color'] = 'NAME' if vcol else 'NONE'
    if 'export_vertex_color_name' in props: kw['export_vertex_color_name'] = 'Col'
    if 'export_all_vertex_colors' in props: kw['export_all_vertex_colors'] = False
    kw = {k: v for k, v in kw.items() if k in props}
    bpy.ops.export_scene.gltf(**kw)
    return os.path.getsize(path)


# ---------------------------------------------------------------- shared material library
I = dict(
    thatch=load_img('thatch_roof_angled', 'diff', 1024, (1.0, 0.82, 0.55), 'opt_thatch_diff'),
    thatch_n=load_img('thatch_roof_angled', 'nor_gl', 1024, None, 'opt_thatch_nor', True),
    wood=load_img('medieval_wood', 'diff', 1024, None, 'opt_wood_diff'),
    wood_n=load_img('medieval_wood', 'nor_gl', 1024, None, 'opt_wood_nor', True),
    wood_light=load_img('medieval_wood', 'diff', 1024, (0.95, 0.80, 0.65), 'opt_woodlight_diff'),
    wood_dark=load_img('medieval_wood', 'diff', 1024, (0.42, 0.32, 0.24), 'opt_wooddark_diff'),
    stone=load_img('mossy_stone_wall', 'diff', 1024, None, 'opt_stone_diff'),
    stone_n=load_img('mossy_stone_wall', 'nor_gl', 1024, None, 'opt_stone_nor', True),
    bark=load_img('knotted_pine_bark', 'diff', 512, None, 'opt_bark_diff'),
    rock=load_img('aerial_rocks_02', 'diff', 1024, (0.95, 0.95, 0.95), 'opt_rock_diff'),
)
# frond (procedural needle shader baked to RGBA) and sail stripes
FW, FH = 1024, 256
UU, VV = np.meshgrid((np.arange(FW) + 0.5) / FW, (np.arange(FH) + 0.5) / FH)
c = np.abs(VV - 0.5) * 2
nz = 0.5 + 0.25 * np.sin(UU * 23.0 + 1.7) * np.sin(VV * 9.0)
alpha = (c < (1 - UU ** 1.6) * 0.92 + nz * 0.16) & ((np.mod(UU * 150 + c * 7, 1.0) < 0.5) | (c < 0.07))
col = np.array([0.04, 0.078, 0.028])[None, None] * (1 - UU[..., None] ** 3) + np.array([0.11, 0.16, 0.05])[None, None] * UU[..., None] ** 3
col = col * (0.85 + 0.3 * np.random.default_rng(1).random((FH, FW, 1)))
fimg = bpy.data.images.new('opt_frond', FW, FH, alpha=True)
fimg.pixels.foreach_set(np.flipud(np.concatenate([np.clip(col, 0, 1) ** (1 / 2.2), alpha[..., None]], -1)).astype(np.float32).ravel())
fimg.filepath_raw = os.path.join(OUT, 'opt_frond.png'); fimg.file_format = 'PNG'; fimg.save()
SW = 256
stripe = (np.mod((np.arange(SW) + 0.5) / SW * 7.0, 1.0) > 0.5)[None, :].repeat(SW, 0)
srgb = np.where(stripe[..., None], np.array([0.78, 0.72, 0.58]), np.array([0.55, 0.06, 0.04])) ** (1 / 2.2)
simg = bpy.data.images.new('opt_sail', SW, SW, alpha=True)
simg.pixels.foreach_set(np.concatenate([srgb, np.ones((SW, SW, 1))], -1).astype(np.float32).ravel())
simg.filepath_raw = os.path.join(OUT, 'opt_sail.png'); simg.file_format = 'PNG'; simg.save()

MAT = dict(thatch=gltf_mat('OPT_Thatch', I['thatch'], I['thatch_n'], 0.9, double=True),
           wood_light=gltf_mat('OPT_WoodLight', I['wood_light'], I['wood_n'], 0.8, double=True),
           wood_dark=gltf_mat('OPT_WoodDark', I['wood_dark'], I['wood_n'], 0.8, double=True),
           stone=gltf_mat('OPT_Stone', I['stone'], I['stone_n'], 0.9),
           ship=gltf_mat('OPT_ShipWood', I['wood'], I['wood_n'], 0.8, double=True, vcol=True),
           sail=gltf_mat('OPT_Sail', simg, None, 0.9, double=True),
           bark=gltf_mat('OPT_Bark', I['bark'], None, 0.9),
           needles=gltf_mat('OPT_Needles', fimg, None, 0.7, alpha_img=True, double=True),
           rock=gltf_mat('OPT_Rock', I['rock'], None, 0.9))
BUILD_MATS = (MAT['thatch'], MAT['wood_light'], MAT['stone'], MAT['wood_dark'])
MAPI = {'M_Thatch': 0, 'M_WoodWall': 1, 'M_Stone': 2, 'M_DarkWood': 3, 'M_Planks': 3}

# ---------------------------------------------------------------- source geometry (baked once)
houses = []
for o in bpy.data.collections['Houses'].objects:
    sm = o.modifiers.get('thatch_thickness')
    if sm: sm.show_viewport = False; sm.show_render = False  # single-sided roof + double-sided material
    b = baked_copy(o, 'h_' + o.name)
    if sm: sm.show_viewport = True; sm.show_render = True
    cen = sum((v.co for v in b.data.vertices), Vector()) / max(1, len(b.data.vertices))
    houses.append((b, cen))
walks = [baked_copy(o, 'w_' + o.name) for o in bpy.data.collections['Boardwalks'].objects]


def faces_in(ob, x0, x1, y0, y1, name):
    """Copy of ob keeping only faces whose centre lies in [x0,x1) x [y0,y1)."""
    me = ob.data.copy(); cp = bpy.data.objects.new(name, me); TMP.objects.link(cp)
    bm = bmesh.new(); bm.from_mesh(me)
    kill = [f for f in bm.faces if not (x0 <= f.calc_center_median().x < x1 and y0 <= f.calc_center_median().y < y1)]
    bmesh.ops.delete(bm, geom=kill, context='FACES'); bm.to_mesh(me); bm.free()
    return cp if len(me.polygons) else (bpy.data.objects.remove(cp) or None)


def consolidate(ob):
    me = ob.data
    names = [m.name if m else '' for m in me.materials]
    idx = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('material_index', idx)
    remap = np.array([MAPI.get(n, 3) for n in names] or [3], np.int32)
    newidx = remap[np.clip(idx, 0, len(remap) - 1)]
    me.materials.clear()
    for m in BUILD_MATS: me.materials.append(m)
    me.polygons.foreach_set('material_index', newidx)
    box_uv(ob, 2.0, face_filter=lambda f: f.material_index != 0)


def terrain_grid(name, ca, cb, ra, rb, step, skirt=2.0, inset=True):
    """Heightfield tile with UV 0..1 over the tile and a skirt hanging `skirt` m below the border (hides LOD cracks)."""
    cols = np.arange(ca, cb + 1, step); rows = np.arange(ra, rb + 1, step)
    X = cols + 0.5 - W / 2; Y = D / 2 - (rows + 0.5)
    XX, YY = np.meshgrid(X, Y); ZZ = G[np.ix_(np.clip(rows, 0, D - 1), np.clip(cols, 0, W - 1))]
    nr, nc = len(rows), len(cols)
    verts = [tuple(v) for v in np.stack([XX, YY, ZZ], -1).reshape(-1, 3)]
    faces = [(r * nc + q, (r + 1) * nc + q, (r + 1) * nc + q + 1, r * nc + q + 1) for r in range(nr - 1) for q in range(nc - 1)]
    ring = [(0, q) for q in range(nc)] + [(r, nc - 1) for r in range(1, nr)] + [(nr - 1, q) for q in range(nc - 2, -1, -1)] + [(r, 0) for r in range(nr - 2, 0, -1)]
    # normals from the GLOBAL heightfield (central differences across tile borders) -> no shading seams between tiles
    def gnorm(r_, q_):
        r_ = min(max(r_, 0), D - 1); q_ = min(max(q_, 0), W - 1)
        dx = (G[r_, min(q_ + step, W - 1)] - G[r_, max(q_ - step, 0)]) / (2 * step)
        dy = (G[max(r_ - step, 0), q_] - G[min(r_ + step, D - 1), q_]) / (2 * step)   # Blender +Y = up the rows
        n = Vector((-dx, -dy, 1.0)); n.normalize(); return n
    vnorm = [gnorm(rr, qq) for rr in rows for qq in cols]
    if skirt > 0:
        top0, bot0 = len(verts), len(verts) + len(ring)   # skirt uses its OWN border copies so it can't bend border normals
        for (r, q) in ring:
            verts.append(verts[r * nc + q]); vnorm.append(vnorm[r * nc + q])
        for (r, q) in ring:
            x, y, z = verts[r * nc + q]; verts.append((x, y, z - skirt)); vnorm.append(vnorm[r * nc + q])
        for k in range(len(ring)):
            k2 = (k + 1) % len(ring)
            faces.append((top0 + k, top0 + k2, bot0 + k2, bot0 + k))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    me.normals_split_custom_set_from_vertices(vnorm)
    uvl = me.uv_layers.new(name='UVMap')
    lv = np.array([l.vertex_index for l in me.loops]); vv = np.array(verts)[lv]
    x0 = ca + 0.5 - W / 2; x1 = cb + 0.5 - W / 2; y1 = D / 2 - (ra + 0.5); y0 = D / 2 - (rb + 0.5)
    u = (vv[:, 0] - x0) / (x1 - x0); v = (vv[:, 1] - y0) / (y1 - y0)
    if inset:   # sample texel centres at the tile border (avoids light seams from bake margins)
        u = (u * (TEX - 1) + 0.5) / TEX; v = (v * (TEX - 1) + 0.5) / TEX
    uvl.data.foreach_set('uv', np.stack([u, v], -1).ravel().astype(np.float32))
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me); TMP.objects.link(ob)
    return ob


def bake_tile(name, ca, cb, ra, rb):
    """Bake the Blender splat terrain material (base colour only) into a TEX x TEX image for one tile."""
    src = terrain_grid('bake_' + name, ca, cb, ra, rb, 1, skirt=0.0, inset=True)
    me = src.data
    tile_uv = me.uv_layers['UVMap']; tile_uv.name = 'BakeUV'
    isl = me.uv_layers.new(name='UVMap')   # island-wide UV used by the splat node
    lv = np.array([l.vertex_index for l in me.loops]); vv = np.array([me.vertices[i].co[:] for i in lv])
    isl.data.foreach_set('uv', np.stack([(vv[:, 0] + W / 2) / W, (vv[:, 1] + D / 2) / D], -1).ravel().astype(np.float32))
    me.uv_layers.active = me.uv_layers['BakeUV']
    mt = bpy.data.materials['M_Terrain']; me.materials.append(mt)
    img = bpy.data.images.new('chk_' + name + '_terrain', TEX, TEX)
    tn = mt.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = img; mt.node_tree.nodes.active = tn
    bpy.ops.object.select_all(action='DESELECT'); src.select_set(True); bpy.context.view_layer.objects.active = src
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=4)
    img.filepath_raw = os.path.join(OUT, img.name + '.jpg'); img.file_format = 'JPEG'; img.save()
    mt.node_tree.nodes.remove(tn); bpy.data.objects.remove(src)
    return img


try:
    sc.render.engine = 'CYCLES'
except TypeError as e:
    print(e)
sc.cycles.device = 'CPU'; sc.cycles.samples = 1

# ---------------------------------------------------------------- tiles
nx = math.ceil((W - 1) / CHUNK); ny = math.ceil((D - 1) / CHUNK)
for i in range(nx):
    for j in range(ny):
        if ONLY and ONLY != f'{i},{j}': continue
        ca, cb = i * CHUNK, min((i + 1) * CHUNK, W - 1); ra, rb = j * CHUNK, min((j + 1) * CHUNK, D - 1)
        bx0, bx1 = ca + 0.5 - W / 2, cb + 0.5 - W / 2        # Blender X range
        by1, by0 = D / 2 - (ra + 0.5), D / 2 - (rb + 0.5)    # Blender Y range
        tile = G[ra:rb + 1, ca:cb + 1]
        deck = ~np.isnan(DECK[ra:rb + 1, ca:cb + 1])
        hs = [h for h, cen in houses if bx0 <= cen.x < bx1 and by0 <= cen.y < by1]
        if tile.max() < -2.0 and not hs and not deck.any():
            continue                                           # open sea: nothing to stream
        t1 = time.time(); name = f'{i}_{j}'
        img = bake_tile(name, ca, cb, ra, rb)
        tmat = gltf_mat(f'CHK_Terrain_{name}', img, None, 0.95)
        objs = []
        for k, st in enumerate((1, 2, 4)):
            t = terrain_grid(f'Terrain_L{k}', ca, cb, ra, rb, st); t.data.materials.append(tmat); objs.append(t)
        parts = [faces_in(h, -1e9, 1e9, -1e9, 1e9, 'p_' + h.name) for h in hs]
        parts += [faces_in(wk, bx0, bx1, by0, by1, 'p_' + wk.name) for wk in walks]
        bld = join([p for p in parts if p], 'Buildings_L0')
        info = dict(i=i, j=j, name=name, houses=len(hs), deck_cells=int(deck.sum()),
                    three_bounds=[bx0, bx1, -by1, -by0], ground=[float(tile.min()), float(tile.max())],
                    tris_terrain=[tris(o) for o in objs])
        if bld:
            consolidate(bld)
            l1 = bpy.data.objects.new('Buildings_L1', bld.data.copy()); TMP.objects.link(l1)
            dm = l1.modifiers.new('dec', 'DECIMATE'); dm.ratio = 0.3
            l1b = baked_copy(l1, 'Buildings_L1', mat_world=False); bpy.data.objects.remove(l1); l1b.name = 'Buildings_L1'
            objs += [bld, l1b]
            info['tris_buildings'] = [tris(bld), tris(l1b)]
        info['raw_bytes'] = export(os.path.join(OUT, f'chunk_{name}_raw.glb'), objs)
        info['seconds'] = round(time.time() - t1, 1)
        LOG['chunks'].append(info); print('CHUNK', json.dumps(info), flush=True)
        for o in objs: bpy.data.objects.remove(o)

# ---------------------------------------------------------------- shared: material library + templates
shared = []
lib_me = bpy.data.meshes.new('MatLib')
lib_me.from_pydata([(k * 0.1, 0, 0) for k in range(3 * len(MAT))], [], [(3 * k, 3 * k + 1, 3 * k + 2) for k in range(len(MAT))])
for m in MAT.values(): lib_me.materials.append(m)
lib_me.polygons.foreach_set('material_index', list(range(len(MAT))))
lib = bpy.data.objects.new('MatLib', lib_me); TMP.objects.link(lib); box_uv(lib, 1.0); shared.append(lib)

for tn_ in ('Tpl_Spruce_A', 'Tpl_Spruce_B', 'Tpl_Spruce_C', 'Tpl_Pine_A'):
    src = bpy.data.objects[tn_]
    me = src.data.copy(); ob = bpy.data.objects.new('TreeTpl_' + tn_[4:], me); TMP.objects.link(ob)
    vg = src.vertex_groups['sway'].index
    w = np.zeros(len(me.vertices), np.float32)
    for vtx in me.vertices:
        for g_ in vtx.groups:
            if g_.group == vg: w[vtx.index] = g_.weight
    ca_ = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    lvx = np.array([l.vertex_index for l in me.loops])
    cc = np.ones((len(me.loops), 4), np.float32); cc[:, :3] = w[lvx][:, None]
    ca_.data.foreach_set('color', cc.ravel())
    keep_idx = [pp.material_index for pp in me.polygons]
    me.materials.clear(); me.materials.append(MAT['bark']); me.materials.append(MAT['needles'])
    me.polygons.foreach_set('material_index', keep_idx)
    single_uv(ob); box_uv(ob, 1.5, face_filter=lambda f: f.material_index == 0)
    me.color_attributes.active_color = me.color_attributes['Col']
    shared.append(ob)

ship = bpy.data.objects['Longship_0']
inv = ship.matrix_world.inverted()
sobjs = []
for o in [ship] + list(ship.children):
    bpy.context.view_layer.update(); dgx = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dgx), depsgraph=dgx)
    me.transform(inv @ o.matrix_world)
    so = bpy.data.objects.new('s_' + o.name, me); TMP.objects.link(so)
    names = [m.name if m else '' for m in me.materials]
    ca_ = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER'); cols = np.ones((len(me.loops), 4), np.float32)
    newidx = []
    for poly in me.polygons:
        nm = names[poly.material_index] if poly.material_index < len(names) else ''
        t = {'M_ShieldRed': (0.6, 0.08, 0.05), 'M_ShieldOchre': (0.85, 0.6, 0.18), 'M_Planks': (0.62, 0.5, 0.38), 'M_Sail': (1, 1, 1)}.get(nm, (0.38, 0.29, 0.22))
        cols[poly.loop_start:poly.loop_start + poly.loop_total, :3] = t
        newidx.append(1 if nm == 'M_Sail' else 0)
    ca_.data.foreach_set('color', cols.ravel())
    single_uv(so)                                   # sail keeps its own UVs; everything else gets box UVs
    me.materials.clear(); me.materials.append(MAT['ship']); me.materials.append(MAT['sail'])
    me.polygons.foreach_set('material_index', newidx)
    if 'Sail' not in o.name: box_uv(so, 2.0)
    sobjs.append(so)
shp = join(sobjs, 'ShipTpl')
shp.data.color_attributes.active_color = shp.data.color_attributes['Col']
shared.append(shp)

rk = bpy.data.objects.new('RockTpl', bpy.data.objects['Tpl_Rock_0'].data.copy()); TMP.objects.link(rk)
rk.modifiers.new('dec', 'DECIMATE').ratio = 0.25
rk2 = baked_copy(rk, 'RockTpl', mat_world=False); bpy.data.objects.remove(rk); rk2.name = 'RockTpl'
rk2.data.materials.clear(); rk2.data.materials.append(MAT['rock']); single_uv(rk2); box_uv(rk2, 1.2)
shared.append(rk2)
LOG['shared_raw_bytes'] = export(os.path.join(OUT, 'shared_raw.glb'), shared, vcol=True)
LOG['shared_tris'] = {o.name: tris(o) for o in shared}

# ---------------------------------------------------------------- impostors
try:
    sc.render.engine = 'BLENDER_EEVEE'
except TypeError as e:
    print(e)
for c_ in sc.collection.children:
    if c_ is not TMP:
        lc = bpy.context.view_layer.layer_collection.children.get(c_.name)
        if lc: lc.exclude = True
cam = bpy.data.objects.new('ImpCam', bpy.data.cameras.new('ImpCam')); TMP.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 22; cam.location = (0, -60, 10); cam.rotation_euler = (math.pi / 2, 0, 0)
sun = bpy.data.objects.new('ImpSun', bpy.data.lights.new('ImpSun', 'SUN')); TMP.objects.link(sun); sun.data.energy = 4
sun.rotation_euler = (0.9, 0.2, 0.6)
sc.camera = cam; sc.render.film_transparent = True; sc.render.resolution_x = 256; sc.render.resolution_y = 512
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
for o in TMP.objects: o.hide_render = o.type == 'MESH'
for tn_ in ('Tpl_Spruce_A', 'Tpl_Pine_A'):
    tmp = bpy.data.objects.new('imp_' + tn_, bpy.data.objects[tn_].data); TMP.objects.link(tmp); tmp.location = (0, 0, -1)
    sc.render.filepath = os.path.join(OUT, f'opt_impostor_{tn_[4:]}.png'); bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(tmp)

LOG['seconds'] = round(time.time() - T0, 1)
json.dump(LOG, open(os.path.join(OUT, 'chunks.json'), 'w'), indent=1)
print('DONE', json.dumps({k: v for k, v in LOG.items() if k != 'chunks'}), 'chunks', len(LOG['chunks']), flush=True)
# intentionally no bpy.ops.wm.save_mainfile(): the master .blend is not modified
