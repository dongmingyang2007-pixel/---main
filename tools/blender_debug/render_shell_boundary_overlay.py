import bpy
import bmesh
from math import radians
from mathutils import Vector


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.before_base_fix.glb"
OUT_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/shell_boundary_overlay.png"


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


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

    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = Vector((-7.25, 0.9, 0.65))
    target = Vector((-6.55, 3.28, 0.45))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 52
    cam.data.clip_start = 0.001
    scene.camera = cam


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
    bsdf.inputs["Roughness"].default_value = 0.65
    return mat


def assign_base_materials():
    neutral = make_material("Neutral", (0.9, 0.9, 0.92, 1.0))
    shell_mat = make_material("Shell", (0.75, 0.75, 0.78, 1.0))
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        obj.data.materials.clear()
        obj.data.materials.append(shell_mat if obj.name == "Case_Base_Shell" else neutral)


def get_largest_boundary_loop(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    boundary_edges = [e for e in bm.edges if e.is_boundary]
    unvisited = set(boundary_edges)
    loops = []
    while unvisited:
        start = next(iter(unvisited))
        stack = [start]
        loop = []
        while stack:
            edge = stack.pop()
            if edge not in unvisited:
                continue
            unvisited.remove(edge)
            loop.append(edge)
            for vert in edge.verts:
                for linked in vert.link_edges:
                    if linked in unvisited:
                        stack.append(linked)
        loops.append(loop)
    loop = max(loops, key=len)
    verts = list({v for e in loop for v in e.verts})
    coords = [obj.matrix_world @ v.co for v in verts]
    bm.free()
    return coords


def add_markers(coords):
    marker_mat = make_material("Marker", (1.0, 0.1, 0.1, 1.0))
    for i, co in enumerate(coords):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.05, location=co)
        sphere = bpy.context.active_object
        sphere.name = f"GapMarker_{i}"
        sphere.data.materials.clear()
        sphere.data.materials.append(marker_mat)


def main():
    reset_scene()
    import_glb(GLB_PATH)
    setup_scene()
    assign_base_materials()
    shell = bpy.data.objects["Case_Base_Shell"]
    coords = get_largest_boundary_loop(shell)
    add_markers(coords)
    bpy.context.scene.render.filepath = OUT_PATH
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
