import bpy
import bmesh
from pathlib import Path


SRC = Path("/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.glb")
BACKUP = Path("/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.before_base_fix.glb")
OUT = SRC

TARGETS = ["Case_Base_Platform_V4", "Case_Base_Arc_Ramp_V4", "Case_Base_Shell"]


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

    if obj.name == "Case_Base_Shell":
        for _ in range(8):
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

            filled = False
            for loop in loops:
                verts = list({v for e in loop for v in e.verts})
                xs = [v.co.x for v in verts]
                ys = [v.co.y for v in verts]
                zs = [v.co.z for v in verts]
                span_x = max(xs) - min(xs)
                span_y = max(ys) - min(ys)
                span_z = max(zs) - min(zs)
                if span_x < 4.0 and span_y < 1.0 and span_z < 4.0:
                    print("filling shell hole", len(loop), "edges", "spans", round(span_x, 4), round(span_y, 4), round(span_z, 4))
                    bmesh.ops.contextual_create(bm, geom=list(loop) + verts)
                    filled = True
            if not filled:
                break

    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.validate(clean_customdata=True)
    mesh.update()


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
    import_glb(SRC)

    if not BACKUP.exists():
        BACKUP.write_bytes(SRC.read_bytes())

    for name in TARGETS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            print("missing", name)
            continue
        print("repairing", name)
        repair_object(obj)

    export_glb(OUT)
    print("exported", OUT)


if __name__ == "__main__":
    main()
