import bpy
import bmesh
from mathutils import Vector


GLB_PATH = "/Users/dog/Desktop/铭润/output/debug_v5/qihang_product_pearl_phase2.glb"
TARGETS = ["Case_Base_Platform_V4", "Case_Base_Arc_Ramp_V4", "Case_Base_Shell"]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path: str):
    bpy.ops.import_scene.gltf(filepath=path)


def describe_object(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    boundary_edges = [e for e in bm.edges if e.is_boundary]
    non_manifold_edges = [e for e in bm.edges if not e.is_manifold]

    loops = []
    unvisited = set(boundary_edges)
    while unvisited:
        start = next(iter(unvisited))
        stack = [start]
        comp = []
        while stack:
            edge = stack.pop()
            if edge not in unvisited:
                continue
            unvisited.remove(edge)
            comp.append(edge)
            for vert in edge.verts:
                for linked in vert.link_edges:
                    if linked in unvisited:
                        stack.append(linked)
        loops.append(comp)

    print(f"OBJECT {obj.name}")
    print(f"  verts={len(bm.verts)} edges={len(bm.edges)} faces={len(bm.faces)}")
    print(f"  location={tuple(round(v, 4) for v in obj.location)}")
    print(f"  dimensions={tuple(round(v, 4) for v in obj.dimensions)}")
    print(f"  boundary_edges={len(boundary_edges)} boundary_loops={len(loops)} non_manifold_edges={len(non_manifold_edges)}")

    for idx, loop in enumerate(sorted(loops, key=len, reverse=True)[:20]):
        verts = []
        for edge in loop:
            verts.extend(edge.verts)
        unique = list({v for v in verts})
        center = sum((obj.matrix_world @ v.co for v in unique), Vector()) / max(len(unique), 1)
        min_v = Vector((min((obj.matrix_world @ v.co).x for v in unique),
                        min((obj.matrix_world @ v.co).y for v in unique),
                        min((obj.matrix_world @ v.co).z for v in unique)))
        max_v = Vector((max((obj.matrix_world @ v.co).x for v in unique),
                        max((obj.matrix_world @ v.co).y for v in unique),
                        max((obj.matrix_world @ v.co).z for v in unique)))
        print(
            "  loop",
            idx,
            f"edges={len(loop)} verts={len(unique)}",
            f"center=({center.x:.4f}, {center.y:.4f}, {center.z:.4f})",
            f"min=({min_v.x:.4f}, {min_v.y:.4f}, {min_v.z:.4f})",
            f"max=({max_v.x:.4f}, {max_v.y:.4f}, {max_v.z:.4f})",
        )

    bm.free()


def describe_object_welded(obj, merge_distance=1e-5):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_distance)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    boundary_edges = [e for e in bm.edges if e.is_boundary]
    non_manifold_edges = [e for e in bm.edges if not e.is_manifold]

    loops = []
    unvisited = set(boundary_edges)
    while unvisited:
        start = next(iter(unvisited))
        stack = [start]
        comp = []
        while stack:
            edge = stack.pop()
            if edge not in unvisited:
                continue
            unvisited.remove(edge)
            comp.append(edge)
            for vert in edge.verts:
                for linked in vert.link_edges:
                    if linked in unvisited:
                        stack.append(linked)
        loops.append(comp)

    print(f"WELDED {obj.name}")
    print(f"  verts={len(bm.verts)} edges={len(bm.edges)} faces={len(bm.faces)}")
    print(f"  boundary_edges={len(boundary_edges)} boundary_loops={len(loops)} non_manifold_edges={len(non_manifold_edges)}")

    for idx, loop in enumerate(sorted(loops, key=len, reverse=True)[:20]):
        verts = []
        for edge in loop:
            verts.extend(edge.verts)
        unique = list({v for v in verts})
        center = sum((obj.matrix_world @ v.co for v in unique), Vector()) / max(len(unique), 1)
        min_v = Vector((min((obj.matrix_world @ v.co).x for v in unique),
                        min((obj.matrix_world @ v.co).y for v in unique),
                        min((obj.matrix_world @ v.co).z for v in unique)))
        max_v = Vector((max((obj.matrix_world @ v.co).x for v in unique),
                        max((obj.matrix_world @ v.co).y for v in unique),
                        max((obj.matrix_world @ v.co).z for v in unique)))
        print(
            "  loop",
            idx,
            f"edges={len(loop)} verts={len(unique)}",
            f"center=({center.x:.4f}, {center.y:.4f}, {center.z:.4f})",
            f"min=({min_v.x:.4f}, {min_v.y:.4f}, {min_v.z:.4f})",
            f"max=({max_v.x:.4f}, {max_v.y:.4f}, {max_v.z:.4f})",
        )

    bm.free()


def main():
    reset_scene()
    import_glb(GLB_PATH)
    for name in TARGETS:
        obj = bpy.data.objects.get(name)
        if obj is None:
            print(f"OBJECT {name} missing")
            continue
        describe_object(obj)
        describe_object_welded(obj)


if __name__ == "__main__":
    main()
