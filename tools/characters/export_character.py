# blender -b build/<Name>.blend --python export_character.py -- <Name>
# Exports a web GLB: textures downscaled to 1024 px and written as WebP, all actions as clips.
import bpy, os, sys
name = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "Pathfinder"
BUILD = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)
# Images that can't be read or converted would export as textures with no source; drop them.
for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    for n in list(mat.node_tree.nodes):
        if n.type == 'TEX_IMAGE' and (n.image is None or not n.image.has_data and n.image.size[0] == 0):
            print("[EX] dropping unreadable image", mat.name, n.image.name if n.image else None)
            mat.node_tree.nodes.remove(n)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.location = (0, 0, 0)
for o in bpy.data.objects:
    o.select_set(o.type in ('ARMATURE', 'MESH') and not o.hide_render)
out = os.path.join(BUILD, f"{name}.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True,
                          export_animations=True, export_animation_mode='ACTIONS', export_skins=True,
                          export_def_bones=False, export_image_format='WEBP', export_image_quality=82,
                          export_extras=True, export_copyright=f"CURIOtrail {name} prototype. Base, outfit and animation from Quaternius packs (CC0 1.0).")
import json, struct
with open(out, "rb") as f:
    data = f.read()
doc = json.loads(data[20:20 + struct.unpack_from("<I", data, 12)[0]])
broken = [i for i, t in enumerate(doc.get("textures", []))
          if "source" not in t and not t.get("extensions", {}).get("EXT_texture_webp")]
if broken:
    raise SystemExit(f"[EX] FAILED: textures without an image source: {broken}")
print("[EX]", out, round(os.path.getsize(out) / 1e6, 2), "MB", "textures", len(doc["textures"]), "images", len(doc["images"]))
