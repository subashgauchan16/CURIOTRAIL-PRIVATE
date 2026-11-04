# Read-only inspection of the CC0 packs (imports into an empty scene, never saves).
import bpy, os
R = os.environ.get("CURIO_CC0_DIR", r"C:\Users\thaka\AppData\Local\Temp\cq")  # unzipped Quaternius packs: ubc/, ual/, mco/
files = {
 "body_f": R + r"\ubc\Base Characters\Godot - UE\Superhero_Female_FullBody.gltf",
 "outfit_fp": R + r"\mco\Exports\glTF (Godot-Unreal)\Outfits\Female_Peasant.gltf",
 "outfit_fr": R + r"\mco\Exports\glTF (Godot-Unreal)\Outfits\Female_Ranger.gltf",
 "anim": R + r"\ual\Unreal-Godot\UAL1_Standard.glb",
}
for key, path in files.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    print(f"=== {key}: meshes={[(o.name, len(o.data.polygons)) for o in meshes][:12]} tris={tris}")
    for a in arms:
        names = [b.name for b in a.data.bones]
        print("   armature", a.name, len(names), names[:25])
        print("   dims", [round(v, 3) for v in a.dimensions], "mesh dims", [[round(v, 2) for v in o.dimensions] for o in meshes][:4])
    print("   materials", [(m.name, [n.image.name for n in m.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image]) for m in bpy.data.materials][:10])
    if key == "anim":
        print("   actions", len(bpy.data.actions), [a.name for a in bpy.data.actions])
