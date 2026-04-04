import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.glb"
PLATFORM = "Case_Base_Platform_V4"
OTHERS = ["Case_Base_Arc_Ramp_V4", "Case_Base_Shell"]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def bvh_for_object(obj, merge_distance=1e-5):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_distance)
    bm.transform(obj.matrix_world)
    bm.normal_update()
    bvh = BVHTree.FromBMesh(bm)
    return bm, bvh


def main():
    reset_scene()
    import_glb(GLB_PATH)

    platform_obj = bpy.data.objects[PLATFORM]
    platform_bm, _ = bvh_for_object(platform_obj)
    other_bvhs = []
    for name in OTHERS:
        obj = bpy.data.objects[name]
        bm, bvh = bvh_for_object(obj)
        other_bvhs.append((name, bm, bvh))

    samples = []
    for face in platform_bm.faces:
        center = face.calc_center_median()
        normal = face.normal.normalized()
        if normal.z < -0.6:
            best = None
            best_name = None
            for name, _, bvh in other_bvhs:
                hit = bvh.find_nearest(center)
                if hit[0] is None:
                    continue
                dist = (hit[0] - center).length
                if best is None or dist < best:
                    best = dist
                    best_name = name
            samples.append((best, best_name, center, normal))

    samples.sort(key=lambda x: x[0] if x[0] is not None else 1e9, reverse=True)
    print("bottom_face_count", len(samples))
    for idx, (dist, name, center, normal) in enumerate(samples[:50]):
        print(
            idx,
            "dist", round(dist, 4) if dist is not None else None,
            "to", name,
            "center", tuple(round(v, 4) for v in center),
            "normal", tuple(round(v, 4) for v in normal),
        )

    platform_bm.free()
    for _, bm, _ in other_bvhs:
        bm.free()


if __name__ == "__main__":
    main()
