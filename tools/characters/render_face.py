import bpy, math, os
from mathutils import Vector
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "preview")
sc = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else engines[0]
sc.render.resolution_x, sc.render.resolution_y = 700, 700
w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.62, 0.64, 1)
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN')); sun.data.energy = 3
sun.rotation_euler = (math.radians(55), 0, math.radians(25)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); cam.data.lens = 85
sc.collection.objects.link(cam); sc.camera = cam
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
act = bpy.data.actions["Idle"]; arm.animation_data_create(); arm.animation_data.action = act
if act.slots: arm.animation_data.action_slot = act.slots[0]
sc.frame_set(1)
head = Vector((0, 0, 1.58))
for tag, pos in {"face_front": (0.25, -1.3, 1.62), "face_three_quarter": (0.9, -0.95, 1.62)}.items():
    cam.location = pos
    cam.rotation_euler = (head - Vector(pos)).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = os.path.join(OUT, f"Pathfinder_{tag}.png")
    bpy.ops.render.render(write_still=True)
