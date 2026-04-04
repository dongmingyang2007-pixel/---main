import bpy
import bmesh
from pathlib import Path
from mathutils import Vector


ORIGINAL = Path("/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.before_base_fix.glb")
OUT = Path("/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.small_patch_test.glb")

TARGETS = ["Case_Base_Platform_V4", "Case_Base_Arc_Ramp_V4", "Case_Base_Shell"]

UPPER = [
    (-7.4785, 3.3476, -0.0928),
    (-7.1683, 3.4658, -0.0928),
    (-6.0763, 3.2863, 0.5136),
    (-6.0443, 3.2863, 0.4200),
]

LOWER = [
    (-7.0667, 3.2437, -0.2040),
    (-6.7691, 3.3066, -0.2040),
    (-6.5673, 3.3364, -0.9662),
    (-6.8816, 3.2540, -0.9662),
]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: Path):
    bpy.ops.import_scene.gltf(filepath=str(path))


def repair_object(obj, merge_distance=1e-5):
    if obj.type != "MESH":
        return

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    try:
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.remove_doubles(threshold=merge_distance)
        bpy.ops.mesh.normals_make_consistent(inside=False)
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.mode_set(mode="OBJECT")
    finally:
        if obj.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        obj.select_set(False)

    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_distance)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(clean_customdata=True)
    mesh.update()


def make_patch(name: str, verts, material):
    mesh = bpy.data.meshes.new(name)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    local = [Vector(v) for v in verts]
    mesh.from_pydata(local, [], [[0, 1, 2], [0, 2, 3]])
    mesh.update()
    mesh.materials.append(material)
    return obj


def export_glb(path: Path):
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=False,
        export_apply=False,
        export_yup=True,
        export_normals=True,
        export_tangents=False,
        export_texcoords=True,
        export_materials="EXPORT",
    )


def main():
    reset_scene()
    import_glb(ORIGINAL)

    for name in TARGETS:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            repair_object(obj)

    shell = bpy.data.objects["Case_Base_Shell"]
    material = shell.data.materials[0]
    make_patch("Case_Base_Shell_Patch_Upper", UPPER, material)
    make_patch("Case_Base_Shell_Patch_Lower", LOWER, material)
    export_glb(OUT)
    print("exported", OUT)


if __name__ == "__main__":
    main()
