import bpy
from mathutils import Vector


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.glb"
TARGETS = ["Case_Base_Platform_V4", "Case_Base_Arc_Ramp_V4", "Case_Base_Shell"]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def bounds_world(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    xs = [v.x for v in corners]
    ys = [v.y for v in corners]
    zs = [v.z for v in corners]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def main():
    reset_scene()
    import_glb(GLB_PATH)
    for name in TARGETS:
        obj = bpy.data.objects.get(name)
        if not obj:
            print("MISSING", name)
            continue
        mn, mx = bounds_world(obj)
        print(name, "min", tuple(round(v, 4) for v in mn), "max", tuple(round(v, 4) for v in mx))


if __name__ == "__main__":
    main()
