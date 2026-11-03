# blender -b build/<Name>.blend --python render_character.py -- <Name>
# Renders a contact sheet: 4 rest views + 4 walk frames + idle, in neutral light. Never saves the .blend.
import bpy, math, os, sys
from mathutils import Vector

name = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "Pathfinder"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "preview")
sc = bpy.context.scene
engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
sc.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in engines else engines[0]
sc.render.resolution_x, sc.render.resolution_y = 600, 800
sc.render.film_transparent = False
world = bpy.data.worlds.new("W"); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (0.62, 0.64, 0.66, 1); bg.inputs[1].default_value = 1.1
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", 'SUN')); sun.data.energy = 3.2
sun.rotation_euler = (math.radians(48), 0, math.radians(35)); sc.collection.objects.link(sun)
cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); cam.data.lens = 60
sc.collection.objects.link(cam); sc.camera = cam
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')


def look(pos, target=Vector((0, 0, 0.92))):
    cam.location = pos
    cam.rotation_euler = (target - pos).to_track_quat('-Z', 'Y').to_euler()


def shot(tag):
    sc.render.filepath = os.path.join(OUT, f"{name}_{tag}.png")
    bpy.ops.render.render(write_still=True)


arm.animation_data_create()
for t in arm.animation_data.nla_tracks:
    t.mute = True
views = {"front": (0, -4.4), "three_quarter": (3.1, -3.1), "side": (4.4, 0), "rear": (0, 4.4)}
def use(action):
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]


use(bpy.data.actions["Idle"])
sc.frame_set(1)
for tag, (x, y) in views.items():
    look(Vector((x, y, 1.15)))
    shot("rest_" + tag)
walk = bpy.data.actions["Walk"]
use(walk)
start, end = (int(v) for v in walk.frame_range)
look(Vector((3.6, -1.6, 1.1)))
for i, f in enumerate((start, start + (end - start) // 4, start + (end - start) // 2, start + 3 * (end - start) // 4)):
    sc.frame_set(f)
    shot(f"walk_{i}")
print("[RC] walk frames", start, end)
