"""Build the Pathfinder prototype (Figma frame 25) from CC0 Quaternius parts.

blender -b --factory-startup --python build_pathfinder.py

Inputs (CC0, Quaternius): Universal Base Characters (Superhero_Female head and hands),
Modular Character Outfits - Fantasy (Female Peasant body/arms/legs/feet), Universal
Animation Library 1 (Idle, Walk, Jog, Talk, Interact, PickUp).
Outputs: build/Pathfinder.blend (editable source), build/Pathfinder.glb, build/textures/*.png
Everything is generated; the downloaded packs are never modified."""
import bpy, bmesh, math, os, random
import numpy as np
from mathutils import Vector

R = os.environ.get("CURIO_CC0_DIR", r"C:\Users\thaka\AppData\Local\Temp\cq")  # unzipped Quaternius packs: ubc/, ual/, mco/
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(os.path.dirname(HERE), "build")
TEX = os.path.join(BUILD, "textures")
os.makedirs(TEX, exist_ok=True)
BASE = R + r"\ubc\Base Characters\Godot - UE\Superhero_Female_FullBody.gltf"
PARTS = R + r"\mco\Exports\glTF (Godot-Unreal)\Modular Parts\\"
ANIMS = R + r"\ual\Unreal-Godot\UAL1_Standard.glb"
PEASANT_BASE = R + r"\mco\Textures\Peasant\T_Peasant_BaseColor.png"
TARGET_HEIGHT = 1.74            # Figma "Stage1 production rules": Pathfinder 1.74 m
CLIPS = {"Idle_Loop": "Idle", "Walk_Loop": "Walk", "Jog_Fwd_Loop": "Run",
         "Idle_Talking_Loop": "Talk", "Interact": "Interact", "PickUp_Table": "PickUp"}
# Figma frame 25 palette (sampled by eye from the reference, sRGB)
CHAMBRAY, CHARCOAL, LEATHER, BOOT = (0.36, 0.48, 0.64), (0.23, 0.24, 0.26), (0.42, 0.26, 0.15), (0.33, 0.21, 0.13)
HAIR = (0.10, 0.07, 0.05)
HAND_BONES = ("hand_", "thumb_", "index_", "middle_", "ring_", "pinky_")
random.seed(25)


def srgb_to_lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def weight_share(obj, v, prefixes=None, names=()):
    total = hit = 0.0
    for g in v.groups:
        name = obj.vertex_groups[g.group].name
        total += g.weight
        if name in names or (prefixes and name.startswith(prefixes)):
            hit += g.weight
    return hit / total if total else 0.0


def delete_verts(obj, predicate):
    me = obj.data
    drop = {v.index for v in me.vertices if predicate(v)}
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in drop], context='VERTS')
    bm.to_mesh(me); bm.free()


def add_part(arm, name):
    for o in imp(PARTS + name + ".gltf"):
        if o.type == 'MESH' and not o.name.startswith("Icosphere"):
            o.parent = arm
            for m in o.modifiers:
                if m.type == 'ARMATURE':
                    m.object = arm
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    return bpy.data.objects[name]


def rigid_mesh(name, bm, arm, bone, material):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = arm
    g = obj.vertex_groups.new(name=bone)
    g.add(range(len(me.vertices)), 1.0, 'REPLACE')
    obj.modifiers.new("Armature", 'ARMATURE').object = arm
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return obj


def pbr(name, color, rough, metal=0.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (*srgb_to_lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb_to_lin(emit), 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m


# ---------------------------------------------------------------- assemble
bpy.ops.wm.read_factory_settings(use_empty=True)
base = imp(BASE)
arm = next(o for o in base if o.type == 'ARMATURE')
arm.name = "Pathfinder_Rig"
for o in base:
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("Superhero"))
body.name = "Pathfinder_Skin"
# keep head, neck and hands of the base body; the outfit covers the rest
delete_verts(body, lambda v: weight_share(body, v, HAND_BONES, ("Head", "neck_01")) < 0.5)

shirt = add_part(arm, "Female_Peasant_Body")
sleeves = add_part(arm, "Female_Peasant_Arms")
trousers = add_part(arm, "Female_Peasant_Legs")
boots = add_part(arm, "Female_Peasant_Feet")
delete_verts(sleeves, lambda v: weight_share(sleeves, v, HAND_BONES) > 0.5)   # bare hands, not gloves

# The free tier's brow/lash texture is untinted grey (the paid tier tints it in a shader): use a solid dark brown.
brows = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("Eyebrows"))
brows.data.materials.clear()
brows.data.materials.append(pbr("MAT_Pathfinder_Brows", (0.12, 0.08, 0.06), 0.7))

# ---------------------------------------------------------------- recolour the outfit atlas per garment
SIZE = 2048
src_img = bpy.data.images.load(PEASANT_BASE)
src_img.scale(SIZE, SIZE)
px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
src_img.pixels.foreach_get(px)
px = px.reshape(SIZE, SIZE, 4)                    # rows run bottom-up, like UV v
lum = px[..., :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)   # linear-light luminance


def uv_mask(obj):
    """Rasterise the object's UV triangles (vectorised barycentric test per triangle bbox)."""
    mask = np.zeros((SIZE, SIZE), dtype=bool)
    uv = obj.data.uv_layers.active.data
    obj.data.calc_loop_triangles()
    for tri in obj.data.loop_triangles:
        a, b, c = (np.array(uv[i].uv) * SIZE for i in tri.loops)
        x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, SIZE - 1), min(y1, SIZE - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9:
            continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
        mask[y0:y1 + 1, x0:x1 + 1] |= inside
    for _ in range(3):                                # dilate to cover texture bleed at seams
        mask = mask | np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1)
    return mask


out = px.copy()
for obj, colour in ((shirt, CHAMBRAY), (sleeves, CHAMBRAY), (trousers, CHARCOAL), (boots, BOOT)):
    m = uv_mask(obj)
    region = lum[m]
    rel = np.clip(region / max(float(np.median(region)), 1e-4), 0.35, 1.6)   # keep folds, seams and stitching
    out[..., :3][m] = np.clip(np.outer(rel, np.array(srgb_to_lin(colour), dtype=np.float32)), 0, 1)
outfit_img = bpy.data.images.new("T_Pathfinder_Outfit_BaseColor", SIZE, SIZE)
outfit_img.pixels.foreach_set(out.ravel())
outfit_img.filepath_raw = os.path.join(TEX, "T_Pathfinder_Outfit_BaseColor.png")
outfit_img.file_format = 'PNG'
outfit_img.save()
for obj in (shirt, sleeves, trousers, boots):
    for mat in obj.data.materials:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and "BaseColor" in n.image.name:
                n.image = outfit_img

# ---------------------------------------------------------------- reference frame: where is the head, which way is front
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
head_pts = [body.matrix_world @ v.co for v in body.data.vertices if weight_share(body, v, None, ("Head",)) > 0.6]
hx = [p.x for p in head_pts]; hy = [p.y for p in head_pts]; hz = [p.z for p in head_pts]
centre = Vector(((min(hx) + max(hx)) / 2, (min(hy) + max(hy)) / 2, (min(hz) + max(hz)) / 2))
half = Vector(((max(hx) - min(hx)) / 2, (max(hy) - min(hy)) / 2, (max(hz) - min(hz)) / 2))
eyes = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("Eyes"))
eye_y = sum((eyes.matrix_world @ v.co).y for v in eyes.data.vertices) / len(eyes.data.vertices)
front = -1.0 if eye_y < centre.y else 1.0             # the eyes are on the face side

# ---------------------------------------------------------------- curly hair (Figma frame 25: short dark curls)
hair_mat = pbr("MAT_Pathfinder_Hair", HAIR, 0.55)
bm = bmesh.new()
skull = Vector((centre.x, centre.y - front * half.y * 0.08, centre.z + half.z * 0.10))
radii = Vector((half.x * 1.02, half.y * 1.04, half.z * 0.92))
placed = 0
while placed < 150:
    theta = math.acos(random.uniform(-0.25, 1.0))        # from the crown down past the ears
    phi = random.uniform(0, 2 * math.pi)
    d = Vector((math.sin(theta) * math.cos(phi), math.sin(theta) * math.sin(phi), math.cos(theta)))
    facing = d.y * front                                  # > 0 = towards the face
    if facing > 0.35 and d.z < 0.55:                      # leave the face and forehead clear
        continue
    if d.z < -0.05 and facing > -0.2:                     # nothing hanging over the cheeks
        continue
    p = skull + Vector((d.x * radii.x, d.y * radii.y, d.z * radii.z))
    r = random.uniform(0.020, 0.030)
    geom = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
    for v in geom["verts"]:
        v.co = v.co * Vector((1, 1, random.uniform(0.8, 1.05))) + p
    placed += 1
rigid_mesh("Pathfinder_Hair", bm, arm, "Head", hair_mat)

# ---------------------------------------------------------------- satchel and strap (worn left hip, strap over right shoulder)
leather = pbr("MAT_Pathfinder_Leather", LEATHER, 0.62)
pelvis = arm.data.bones["pelvis"].head_local
spine = arm.data.bones["spine_03"].head_local
side = 1.0 if arm.data.bones["thigh_l"].head_local.x > 0 else -1.0     # +X side is the left leg?
hip = Vector((side * 0.215, pelvis.y - front * 0.045, pelvis.z - 0.03))
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=1.0)
bmesh.ops.scale(bm, vec=(0.075, 0.22, 0.18), verts=bm.verts)
bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.015, segments=2, affect='EDGES')
bmesh.ops.translate(bm, vec=hip + Vector((side * 0.04, 0, 0)), verts=bm.verts)
rigid_mesh("Pathfinder_Satchel", bm, arm, "pelvis", leather)
# The strap is cut from the shirt's own surface (a diagonal band from the right shoulder to the
# left hip), so it keeps the shirt's skin weights and bends with the torso instead of floating.
shoulder = Vector((-side * 0.11, spine.y, spine.z + 0.16))
diag = (hip + Vector((0, 0, 0.10)) - shoulder).normalized()
normal = diag.cross(Vector((0, 1, 0))).normalized()
strap = shirt.copy(); strap.data = shirt.data.copy(); strap.name = "Pathfinder_Strap"
bpy.context.scene.collection.objects.link(strap)
bm = bmesh.new(); bm.from_mesh(strap.data)
lo_z, hi_z = hip.z + 0.075, shoulder.z + 0.06
drop = [f for f in bm.faces if abs((f.calc_center_median() - shoulder).dot(normal)) > 0.024
        or not (lo_z < f.calc_center_median().z < hi_z)]
bmesh.ops.delete(bm, geom=drop, context='FACES')
bm.normal_update()
for v in bm.verts:
    v.co += v.normal * 0.007
bm.to_mesh(strap.data); bm.free()
strap.data.materials.clear(); strap.data.materials.append(leather)
for poly in strap.data.polygons:
    poly.material_index = 0

# ---------------------------------------------------------------- the wrist band (Zeus Band) on the left forearm
band_mat = pbr("MAT_ZeusBand", (0.16, 0.18, 0.2), 0.35, 0.8)
glow = pbr("MAT_ZeusBand_Glow", (0.1, 0.5, 0.5), 0.3, 0.0, emit=(0.18, 0.85, 0.82))
fore = arm.data.bones["lowerarm_l"]
wrist = fore.head_local.lerp(fore.tail_local, 0.88)
axis = (fore.tail_local - fore.head_local).normalized()
for name, mat, minor, rad in (("Pathfinder_Band", band_mat, 0.012, 0.042), ("Pathfinder_Band_Glow", glow, 0.004, 0.051)):
    bm = bmesh.new()
    me_tmp = bpy.data.meshes.new("tmp")
    bpy.ops.mesh.primitive_torus_add(major_radius=rad, minor_radius=minor, major_segments=24, minor_segments=8)
    t = bpy.context.active_object
    bm.from_mesh(t.data)
    bpy.data.objects.remove(t, do_unlink=True)
    rot = Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=wrist, verts=bm.verts)
    rigid_mesh(name, bm, arm, "lowerarm_l", mat)

# ---------------------------------------------------------------- scale to 1.74 m
bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
top = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
bottom = min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
scale = TARGET_HEIGHT / (top - bottom)
arm.scale = (scale, scale, scale)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# ---------------------------------------------------------------- animations from the Universal Animation Library
for act in list(bpy.data.actions):                  # preview clips that came with the base/outfit files
    bpy.data.actions.remove(act)
lib = imp(ANIMS)
for o in lib:
    bpy.data.objects.remove(o, do_unlink=True)
for act in list(bpy.data.actions):
    key = act.name.split(".")[0]
    if key in CLIPS:
        act.name = CLIPS[key]
        act.use_fake_user = True
    else:
        bpy.data.actions.remove(act)
arm.animation_data_create()
for name in CLIPS.values():
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, bpy.data.actions[name])
    if hasattr(strip, "action_slot") and bpy.data.actions[name].slots:
        strip.action_slot = bpy.data.actions[name].slots[0]
    track.mute = True
arm.animation_data.action = None

# ---------------------------------------------------------------- report and save
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print(f"[PF] height={TARGET_HEIGHT} scale={scale:.4f} meshes={len(meshes)} tris={tris} actions={[a.name for a in bpy.data.actions]}")
print(f"[PF] front={front} side={side}")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, "Pathfinder.blend"))
