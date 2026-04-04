import bpy
from math import radians
from mathutils import Vector


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.glb"
OUT_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/object_colors_closeup.png"

COLORS = {
    "Case_Base_Shell": (0.85, 0.25, 0.25, 1.0),
    "Case_Base_Platform_V4": (0.2, 0.6, 0.95, 1.0),
    "Case_Base_Arc_Ramp_V4": (0.25, 0.8, 0.45, 1.0),
}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def make_material(name: str, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    output = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def assign_materials():
    grey = make_material("NeutralGrey", (0.88, 0.88, 0.9, 1.0))
    mats = {name: make_material(name + "_mat", color) for name, color in COLORS.items()}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mats.get(obj.name, grey))


def setup_world_and_light():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1600
    scene.render.film_transparent = False

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    nt = world.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    output = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], output.inputs["Surface"])
    scene.world = world

    light_data = bpy.data.lights.new(name="Sun", type="SUN")
    light = bpy.data.objects.new("Sun", light_data)
    bpy.context.collection.objects.link(light)
    light.rotation_euler = (radians(52), radians(0), radians(16))
    light.data.energy = 2.5


def add_camera():
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector((-7.25, 0.9, 0.65))
    target = Vector((-6.55, 3.28, 0.45))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 52
    cam.data.clip_start = 0.001
    scene.camera = cam


def main():
    reset_scene()
    import_glb(GLB_PATH)
    assign_materials()
    setup_world_and_light()
    add_camera()
    bpy.context.scene.render.filepath = OUT_PATH
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
