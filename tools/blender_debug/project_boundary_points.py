import json
from pathlib import Path

import bpy
import bmesh
from bpy_extras.object_utils import world_to_camera_view


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.before_base_fix.glb"
OUT_PATH = Path("/Users/dog/Desktop/铭润/output/debug_v5/boundary_points_projected.json")


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def setup_camera():
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (-7.25, 0.9, 0.65)
    target = bpy.data.objects.new("Target", None)
    target.location = (-6.55, 3.28, 0.45)
    bpy.context.collection.objects.link(target)
    cam.rotation_euler = (target.location - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 52
    cam.data.clip_start = 0.001
    bpy.context.scene.camera = cam
    return cam


def get_boundary_points(obj):
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
    points = [obj.matrix_world @ v.co for v in verts]
    bm.free()
    return points


def main():
    reset_scene()
    import_glb(GLB_PATH)
    cam = setup_camera()
    shell = bpy.data.objects["Case_Base_Shell"]
    points = get_boundary_points(shell)
    projected = []
    for i, co in enumerate(points):
        uv = world_to_camera_view(bpy.context.scene, cam, co)
        projected.append(
            {
                "i": i,
                "x": float(co.x),
                "y": float(co.y),
                "z": float(co.z),
                "u": float(uv.x),
                "v": float(uv.y),
                "depth": float(uv.z),
            }
        )
    OUT_PATH.write_text(json.dumps(projected, indent=2))
    print(OUT_PATH)


if __name__ == "__main__":
    main()
