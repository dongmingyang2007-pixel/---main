import bpy
from mathutils import Vector
from math import radians


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.before_base_fix.glb"
OUT_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/two_layer_trial.png"


UPPER = [
    (-7.8530, 3.3653, -0.0927),
    (-7.7706, 3.2050, -0.0928),
    (-6.6795, 3.2863, 2.0939),
    (-7.5459, 3.1700, 2.1196),
    (-6.0763, 3.2863, 0.5136),
    (-6.0443, 3.2863, 0.4200),
    (-6.7691, 3.3066, -0.2040),
    (-7.0667, 3.2437, -0.2040),
]

LOWER = [
    (-7.0667, 3.2437, -0.2040),
    (-6.7691, 3.3066, -0.2040),
    (-6.4968, 3.2762, -0.2036),
    (-6.1372, 3.2934, -0.2027),
    (-5.7630, 3.2934, -0.2021),
    (-5.5326, 3.4304, -0.9662),
    (-5.8919, 3.4146, -0.9662),
    (-6.2371, 3.3902, -0.9662),
    (-6.5673, 3.3364, -0.9662),
    (-6.8816, 3.2540, -0.9662),
    (-7.1683, 3.4658, -0.0928),
    (-7.4785, 3.3476, -0.0928),
    (-7.8530, 3.3653, -0.0927),
]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def make_patch(name: str, verts, color):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.from_pydata([Vector(v) for v in verts], [], [list(range(len(verts)))])
    mesh.update()

    mat = bpy.data.materials.new(name + "_mat")
    mat.use_nodes = True
    nt = mat.node_tree
    for node in list(nt.nodes):
        nt.nodes.remove(node)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = 0.75
    obj.data.materials.append(mat)
    return obj


def setup_scene():
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
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (1, 1, 1, 1)
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    scene.world = world

    light_data = bpy.data.lights.new(name="Sun", type="SUN")
    light = bpy.data.objects.new(name="Sun", object_data=light_data)
    bpy.context.collection.objects.link(light)
    light.rotation_euler = (radians(50), radians(0), radians(18))
    light.data.energy = 2.3

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector((-7.2, 0.75, 0.7))
    target = Vector((-6.6, 3.25, 0.5))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 52
    cam.data.clip_start = 0.001
    scene.camera = cam


def main():
    reset_scene()
    import_glb(GLB_PATH)
    setup_scene()
    make_patch("PatchUpper", UPPER, (0.95, 0.55, 0.2, 1.0))
    make_patch("PatchLower", LOWER, (0.2, 0.65, 0.95, 1.0))
    bpy.context.scene.render.filepath = OUT_PATH
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
