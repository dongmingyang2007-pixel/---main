import bpy
from math import radians
from mathutils import Vector


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.glb"
OUT_DIR = "/Users/dog/Desktop/铭润/output/debug_v5/platform_debug"


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def make_debug_material():
    mat = bpy.data.materials.new(name="DebugFrontBack")
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)

    output = nt.nodes.new("ShaderNodeOutputMaterial")
    mix = nt.nodes.new("ShaderNodeMixShader")
    geom = nt.nodes.new("ShaderNodeNewGeometry")
    front = nt.nodes.new("ShaderNodeBsdfPrincipled")
    back = nt.nodes.new("ShaderNodeBsdfPrincipled")

    front.inputs["Base Color"].default_value = (0.78, 0.78, 0.8, 1.0)
    front.inputs["Roughness"].default_value = 0.75
    back.inputs["Base Color"].default_value = (1.0, 0.15, 0.45, 1.0)
    back.inputs["Roughness"].default_value = 0.5

    nt.links.new(geom.outputs["Backfacing"], mix.inputs["Fac"])
    nt.links.new(front.outputs["BSDF"], mix.inputs[1])
    nt.links.new(back.outputs["BSDF"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], output.inputs["Surface"])
    return mat


def apply_material(mat):
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(mat)


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 32
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("DebugWorld")
    scene.world.use_nodes = True
    nt = scene.world.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    output = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    nt.links.new(bg.outputs["Background"], output.inputs["Surface"])
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 1.0

    light_data = bpy.data.lights.new(name="Sun", type="SUN")
    light = bpy.data.objects.new(name="Sun", object_data=light_data)
    bpy.context.collection.objects.link(light)
    light.rotation_euler = (radians(40), radians(0), radians(25))
    light.data.energy = 2.5


def add_camera(name, location, target):
    cam_data = bpy.data.cameras.new(name=name)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector(location)
    direction = Vector(target) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 45
    cam.data.clip_start = 0.001
    cam.data.clip_end = 1000
    return cam


def render_camera(cam, filepath):
    bpy.context.scene.camera = cam
    bpy.context.scene.render.filepath = filepath
    bpy.ops.render.render(write_still=True)


def main():
    reset_scene()
    import_glb(GLB_PATH)
    mat = make_debug_material()
    apply_material(mat)
    setup_render()

    target = (-6.9, 1.2, 1.2)
    cams = [
        add_camera("cam_overview", (0.0, 28.0, 8.0), (0.0, 0.0, 0.5)),
        add_camera("cam_overview_left", (-18.0, 14.0, 6.0), (-6.5, 0.5, 1.2)),
        add_camera("cam_under_left", (-7.6, 6.8, 0.7), target),
        add_camera("cam_under_front", (-4.6, 2.8, 0.9), target),
        add_camera("cam_under_close", (-6.2, 2.6, 1.15), (-6.7, 1.3, 1.5)),
        add_camera("cam_back_low", (-8.6, 2.4, 1.0), (-6.8, 1.2, 1.4)),
    ]
    for cam in cams:
        render_camera(cam, f"{OUT_DIR}/{cam.name}.png")


if __name__ == "__main__":
    main()
