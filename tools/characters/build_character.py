"""Build a CURIOtrail character from CC0 Quaternius parts.

blender -b --factory-startup --python build_character.py -- <Pathfinder|Mira|Tove>

Inputs (CC0 1.0, Quaternius; unzipped into CURIO_CC0_DIR as ubc/, ual/, mco/):
Universal Base Characters (Superhero_Female head, eyes, brows, hands; hair caps),
Modular Character Outfits - Fantasy (Peasant / Ranger parts), Universal Animation Library 1.
Outputs in build/: <Name>.blend (editable) and textures/T_<Name>_Outfit_BaseColor.png.
Export with export_character.py. The downloaded packs are never modified."""
import bpy, bmesh, math, os, random, sys
import numpy as np
from mathutils import Vector

R = os.environ.get("CURIO_CC0_DIR", r"C:\Users\thaka\AppData\Local\Temp\cq")  # unzipped Quaternius packs: ubc/, ual/, mco/
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.environ.get("CURIO_CHAR_BUILD", os.path.join(os.path.dirname(HERE), "build"))
TEX = os.path.join(BUILD, "textures")
os.makedirs(TEX, exist_ok=True)
BASE = R + r"\ubc\Base Characters\Godot - UE\Superhero_Female_FullBody.gltf"
SKIN_LIGHT = R + r"\ubc\Base Characters\Textures\T_Superhero_Female_Light_BaseColor.png"
HAIR_CAPS = R + r"\ubc\Hairstyles\Rigged to Head Bone\glTF (Godot -Unreal)\\"
PARTS = R + r"\mco\Exports\glTF (Godot-Unreal)\Modular Parts\\"
ATLAS = {"Peasant": R + r"\mco\Textures\Peasant\T_Peasant_BaseColor.png",
         "Ranger": R + r"\mco\Textures\Ranger\T_Ranger_BaseColor.png"}
ANIMS = R + r"\ual\Unreal-Godot\UAL1_Standard.glb"
CLIPS = {"Idle_Loop": "Idle", "Walk_Loop": "Walk", "Jog_Fwd_Loop": "Run",
         "Idle_Talking_Loop": "Talk", "Interact": "Interact", "PickUp_Table": "PickUp"}
HAND_BONES = ("hand_", "thumb_", "index_", "middle_", "ring_", "pinky_")

# Designs: Figma frame 25 (Pathfinder), frames 07/09/22 (Mira), "Tove prepares the voyage" (Tove).
# Heights: Pathfinder 1.74 m is the Figma S1 scale contract; Mira and Tove are planning assumptions.
# Garment modes: all = tint everything; green = tint only green cloth (keeps leather and metal);
# light = tint only lighter cloth (keeps dark leather).
CHARACTERS = {
    "Pathfinder": dict(
        height=1.74, outfit="Peasant", skin="dark",
        garments={"Female_Peasant_Body": ((0.36, 0.48, 0.64), "all"), "Female_Peasant_Arms": ((0.36, 0.48, 0.64), "all"),
                  "Female_Peasant_Legs": ((0.23, 0.24, 0.26), "all"), "Female_Peasant_Feet": ((0.33, 0.21, 0.13), "all")},
        hair=dict(style="curls", colour=(0.10, 0.07, 0.05)), brows=(0.12, 0.08, 0.06),
        satchel=True, strap=True, band=True),
    "Mira": dict(
        height=1.66, outfit="Ranger", skin="light",
        # every green pixel in the Ranger atlas is cloth, so recolour green atlas-wide (leather and metal stay)
        atlas_green=(0.47, 0.54, 0.40),
        garments={"Female_Ranger_Body": None, "Female_Ranger_Arms": None,
                  "Female_Ranger_Legs": ((0.24, 0.26, 0.23), "all"), "Female_Ranger_Feet": None},
        hair=dict(style="braid", cap="Hair_BuzzedFemale", colour=(0.50, 0.21, 0.10)), brows=(0.30, 0.13, 0.07),
        satchel=False, strap=False, band=False),
    "Tove": dict(
        height=1.70, outfit="Peasant", skin="light",
        garments={"Female_Peasant_Body": ((0.42, 0.45, 0.22), "light"), "Female_Peasant_Arms": ((0.42, 0.45, 0.22), "light"),
                  "Female_Peasant_Legs": ((0.27, 0.19, 0.12), "all"), "Female_Peasant_Feet": ((0.40, 0.26, 0.15), "all")},
        hair=dict(style="braid", cap="Hair_BuzzedFemale", colour=(0.86, 0.68, 0.36)), brows=(0.55, 0.40, 0.22),
        satchel="pouch", strap=False, band=False),
}
name = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "Pathfinder"
cfg = CHARACTERS[name]
random.seed(sum(map(ord, name)))


def srgb_to_lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def imp(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def weight_share(obj, v, prefixes=None, names=()):
    total = hit = 0.0
    for g in v.groups:
        gname = obj.vertex_groups[g.group].name
        total += g.weight
        if gname in names or (prefixes and gname.startswith(prefixes)):
            hit += g.weight
    return hit / total if total else 0.0


def delete_verts(obj, predicate):
    me = obj.data
    drop = {v.index for v in me.vertices if predicate(v)}
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index in drop], context='VERTS')
    bm.to_mesh(me); bm.free()


def attach(arm, path):
    """Import a rigged part that shares the universal skeleton and bind it to our armature."""
    meshes = []
    for o in imp(path):
        if o.type == 'MESH' and not o.name.startswith("Icosphere"):
            o.parent = arm
            for m in o.modifiers:
                if m.type == 'ARMATURE':
                    m.object = arm
            meshes.append(o)
        else:
            bpy.data.objects.remove(o, do_unlink=True)
    return meshes


def rigid_mesh(oname, bm, arm, bone, material):
    me = bpy.data.meshes.new(oname)
    bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(oname, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.parent = arm
    obj.vertex_groups.new(name=bone).add(range(len(me.vertices)), 1.0, 'REPLACE')
    obj.modifiers.new("Armature", 'ARMATURE').object = arm
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = True
    return obj


def pbr(mname, color, rough, metal=0.0, emit=None):
    m = bpy.data.materials.new(mname)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs["Base Color"].default_value = (*srgb_to_lin(color), 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*srgb_to_lin(emit), 1)
        b.inputs["Emission Strength"].default_value = 2.0
    return m


def solid(objs, material):
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(material)
        for p in o.data.polygons:
            p.material_index = 0


# ---------------------------------------------------------------- assemble
bpy.ops.wm.read_factory_settings(use_empty=True)
base = imp(BASE)
arm = next(o for o in base if o.type == 'ARMATURE')
arm.name = f"{name}_Rig"
for o in base:
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o, do_unlink=True)
body = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("Superhero"))
body.name = f"{name}_Skin"
delete_verts(body, lambda v: weight_share(body, v, HAND_BONES, ("Head", "neck_01")) < 0.5)   # outfit covers the rest
if cfg["skin"] == "light":
    light = bpy.data.images.load(SKIN_LIGHT)
    for mat in body.data.materials:
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and "BaseColor" in n.image.name:
                n.image = light

garments = {}
for part in cfg["garments"]:
    for o in attach(arm, PARTS + part + ".gltf"):
        garments[o.name] = o
for part, o in garments.items():
    if part.endswith("_Arms"):
        delete_verts(o, lambda v, o=o: weight_share(o, v, HAND_BONES) > 0.5)   # bare hands from the base body
        # forearm skin that some sleeves carry would not match the head's skin texture
        skin_slots = {i for i, m in enumerate(o.data.materials) if m and "Regular_" in m.name}
        if skin_slots:
            bm = bmesh.new(); bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in skin_slots], context='FACES')
            bm.to_mesh(o.data); bm.free()

brows = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("Eyebrows"))
solid([brows], pbr(f"MAT_{name}_Brows", cfg["brows"], 0.7))   # free tier ships brows untinted grey

# ---------------------------------------------------------------- recolour the outfit atlas per garment
SIZE = 2048
src_img = bpy.data.images.load(ATLAS[cfg["outfit"]])
src_img.scale(SIZE, SIZE)
px = np.empty(SIZE * SIZE * 4, dtype=np.float32)
src_img.pixels.foreach_get(px)
px = px.reshape(SIZE, SIZE, 4)                    # rows run bottom-up, like UV v
rgb = px[..., :3]
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)   # linear-light luminance


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
        mask[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
    for _ in range(3):                                # dilate to cover texture bleed at seams
        mask = mask | np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1)
    return mask


out = px.copy()
if cfg.get("atlas_green"):
    g = (rgb[..., 1] > rgb[..., 0] * 1.08) & (rgb[..., 1] > rgb[..., 2] * 1.08)
    rel = np.clip(lum[g] / max(float(np.median(lum[g])), 1e-4), 0.35, 1.6)
    out[..., :3][g] = np.clip(np.outer(rel, np.array(srgb_to_lin(cfg["atlas_green"]), dtype=np.float32)), 0, 1)
for part, spec in cfg["garments"].items():
    if spec is None or part not in garments:
        continue
    colour, mode = spec
    m = uv_mask(garments[part])
    if mode == "green":
        m &= (rgb[..., 1] > rgb[..., 0] * 1.08) & (rgb[..., 1] > rgb[..., 2] * 1.08)
    elif mode == "light":
        m &= lum > np.percentile(lum[m], 35)
    if not m.any():
        continue
    region = lum[m]
    rel = np.clip(region / max(float(np.median(region)), 1e-4), 0.35, 1.6)   # keep folds, seams and stitching
    out[..., :3][m] = np.clip(np.outer(rel, np.array(srgb_to_lin(colour), dtype=np.float32)), 0, 1)
outfit_img = bpy.data.images.new(f"T_{name}_Outfit_BaseColor", SIZE, SIZE)
outfit_img.pixels.foreach_set(out.ravel())
outfit_img.filepath_raw = os.path.join(TEX, f"T_{name}_Outfit_BaseColor.png")
outfit_img.file_format = 'PNG'
outfit_img.save()
for o in garments.values():
    for mat in o.data.materials:
        if not mat or not mat.node_tree:
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and "BaseColor" in n.image.name and cfg["outfit"] in n.image.name:
                n.image = outfit_img

# ---------------------------------------------------------------- reference frame
bpy.context.view_layer.update()
head_pts = [body.matrix_world @ v.co for v in body.data.vertices if weight_share(body, v, None, ("Head",)) > 0.6]
lo = Vector((min(p.x for p in head_pts), min(p.y for p in head_pts), min(p.z for p in head_pts)))
hi = Vector((max(p.x for p in head_pts), max(p.y for p in head_pts), max(p.z for p in head_pts)))
centre, half = (lo + hi) / 2, (hi - lo) / 2
eyes = next(o for o in bpy.data.objects if o.type == 'MESH' and o.name.startswith("Eyes"))
eye_y = sum((eyes.matrix_world @ v.co).y for v in eyes.data.vertices) / len(eyes.data.vertices)
front = -1.0 if eye_y < centre.y else 1.0             # the eyes are on the face side
side = 1.0 if arm.data.bones["thigh_l"].head_local.x > 0 else -1.0   # +X is the character's left
pelvis = arm.data.bones["pelvis"].head_local
spine = arm.data.bones["spine_03"].head_local
neck = arm.data.bones["neck_01"].head_local

# ---------------------------------------------------------------- hair
hair_mat = pbr(f"MAT_{name}_Hair", cfg["hair"]["colour"], 0.5)
if cfg["hair"]["style"] == "curls":                   # Pathfinder: short dark curls
    bm = bmesh.new()
    skull = Vector((centre.x, centre.y - front * half.y * 0.08, centre.z + half.z * 0.10))
    radii = Vector((half.x * 1.02, half.y * 1.04, half.z * 0.92))
    placed = 0
    while placed < 150:
        theta = math.acos(random.uniform(-0.25, 1.0))
        phi = random.uniform(0, 2 * math.pi)
        d = Vector((math.sin(theta) * math.cos(phi), math.sin(theta) * math.sin(phi), math.cos(theta)))
        facing = d.y * front
        if facing > 0.35 and d.z < 0.55:
            continue
        if d.z < -0.05 and facing > -0.2:
            continue
        p = skull + Vector((d.x * radii.x, d.y * radii.y, d.z * radii.z))
        geom = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=random.uniform(0.020, 0.030))
        for v in geom["verts"]:
            v.co = v.co * Vector((1, 1, random.uniform(0.8, 1.05))) + p
        placed += 1
    rigid_mesh(f"{name}_Hair", bm, arm, "Head", hair_mat)
else:                                                 # Mira, Tove: parted cap plus a side braid over the right shoulder
    solid(attach(arm, HAIR_CAPS + cfg["hair"]["cap"] + ".gltf"), hair_mat)
    start = Vector((-side * half.x * 0.62, centre.y - front * half.y * 0.55, centre.z - half.z * 0.25))
    ctrl = Vector((-side * 0.17, neck.y - front * 0.02, neck.z - 0.02))
    end = Vector((-side * 0.13, spine.y + front * 0.13, spine.z - 0.06))
    segments = 13
    for i in range(segments):
        t = i / (segments - 1)
        p = (1 - t) ** 2 * start + 2 * (1 - t) * t * ctrl + t ** 2 * end
        r = 0.036 - 0.014 * t
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        wobble = Vector((0.009 if i % 2 else -0.009, 0, 0))
        bmesh.ops.scale(bm, vec=(1.0, 0.85, 1.35), verts=bm.verts)
        bmesh.ops.translate(bm, vec=p + wobble, verts=bm.verts)
        if i == segments - 1:                         # a tie and a short tail
            tie = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.016, radius2=0.004, depth=0.07)
            bmesh.ops.translate(bm, vec=p + Vector((0, 0, -0.05)), verts=tie["verts"])
        rigid_mesh(f"{name}_Braid_{i:02d}", bm, arm, "Head" if p.z > neck.z + 0.03 else "spine_03", hair_mat)

# ---------------------------------------------------------------- accessories
leather = pbr(f"MAT_{name}_Leather", (0.42, 0.26, 0.15), 0.62)
if cfg["satchel"]:
    pouch = cfg["satchel"] == "pouch"
    hip = (Vector((side * 0.16, pelvis.y + front * 0.10, pelvis.z + 0.02)) if pouch
           else Vector((side * 0.215, pelvis.y - front * 0.045, pelvis.z - 0.03)))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.06, 0.11, 0.12) if pouch else (0.075, 0.22, 0.18), verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.012, segments=2, affect='EDGES')
    bmesh.ops.translate(bm, vec=hip + (Vector((0, 0, 0)) if pouch else Vector((side * 0.04, 0, 0))), verts=bm.verts)
    rigid_mesh(f"{name}_Satchel", bm, arm, "pelvis", leather)
if cfg["strap"]:
    # cut from the shirt's own surface (a diagonal band), so it keeps the shirt's skin weights
    shirt = next(o for k, o in garments.items() if k.endswith("_Body"))
    shoulder = Vector((-side * 0.11, spine.y, spine.z + 0.16))
    diag = (hip + Vector((0, 0, 0.10)) - shoulder).normalized()
    normal = diag.cross(Vector((0, 1, 0))).normalized()
    strap = shirt.copy(); strap.data = shirt.data.copy(); strap.name = f"{name}_Strap"
    bpy.context.scene.collection.objects.link(strap)
    bm = bmesh.new(); bm.from_mesh(strap.data)
    lo_z, hi_z = hip.z + 0.075, shoulder.z + 0.06
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs((f.calc_center_median() - shoulder).dot(normal)) > 0.024
                               or not (lo_z < f.calc_center_median().z < hi_z)], context='FACES')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * 0.007
    bm.to_mesh(strap.data); bm.free()
    solid([strap], leather)
if cfg["band"]:                                       # the Zeus Band on the left forearm
    band_mat = pbr("MAT_ZeusBand", (0.16, 0.18, 0.2), 0.35, 0.8)
    glow = pbr("MAT_ZeusBand_Glow", (0.1, 0.5, 0.5), 0.3, 0.0, emit=(0.18, 0.85, 0.82))
    fore = arm.data.bones["lowerarm_l"]
    wrist = fore.head_local.lerp(fore.tail_local, 0.88)
    axis = (fore.tail_local - fore.head_local).normalized()
    for oname, mat, minor, rad in ((f"{name}_Band", band_mat, 0.012, 0.042), (f"{name}_Band_Glow", glow, 0.004, 0.051)):
        bpy.ops.mesh.primitive_torus_add(major_radius=rad, minor_radius=minor, major_segments=24, minor_segments=8)
        t = bpy.context.active_object
        bm = bmesh.new(); bm.from_mesh(t.data)
        bpy.data.objects.remove(t, do_unlink=True)
        bmesh.ops.transform(bm, matrix=Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4(), verts=bm.verts)
        bmesh.ops.translate(bm, vec=wrist, verts=bm.verts)
        rigid_mesh(oname, bm, arm, "lowerarm_l", mat)

# ---------------------------------------------------------------- scale to the target height
bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
top = max((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
bottom = min((o.matrix_world @ v.co).z for o in meshes for v in o.data.vertices)
scale = cfg["height"] / (top - bottom)
arm.scale = (scale, scale, scale)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True)
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

# ---------------------------------------------------------------- animations from the Universal Animation Library
for act in list(bpy.data.actions):                    # preview clips that came with the base/outfit files
    bpy.data.actions.remove(act)
for o in imp(ANIMS):
    bpy.data.objects.remove(o, do_unlink=True)
for act in list(bpy.data.actions):
    key = act.name.split(".")[0]
    if key in CLIPS:
        act.name = CLIPS[key]
        act.use_fake_user = True
    else:
        bpy.data.actions.remove(act)
arm.animation_data_create()
for clip in CLIPS.values():
    track = arm.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, 1, bpy.data.actions[clip])
    if hasattr(strip, "action_slot") and bpy.data.actions[clip].slots:
        strip.action_slot = bpy.data.actions[clip].slots[0]
    track.mute = True

tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
print(f"[PF] {name} height={cfg['height']} scale={scale:.4f} meshes={len(meshes)} tris={tris} actions={sorted(a.name for a in bpy.data.actions)}")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(BUILD, f"{name}.blend"))
