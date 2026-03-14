from __future__ import annotations

import argparse
import json
import math
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


GLB_HEADER_STRUCT = struct.Struct("<4sII")
GLB_CHUNK_HEADER_STRUCT = struct.Struct("<I4s")
COMPONENT_COUNTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
COMPONENT_BYTE_SIZES = {
    5120: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5125: 4,
    5126: 4,
}
COMPONENT_STRUCT_FORMATS = {
    5120: "b",
    5121: "B",
    5122: "h",
    5123: "H",
    5125: "I",
    5126: "f",
}


@dataclass(frozen=True)
class AccessorInfo:
    accessor: dict
    view: dict
    component_count: int
    component_size: int
    stride: int
    offset: int
    count: int


@dataclass(frozen=True)
class ProtectedSphere:
    center: tuple[float, float, float]
    inner_radius: float
    outer_radius: float


def pad_to_4(data: bytes, fill: bytes) -> bytes:
    padding = (-len(data)) % 4
    return data + (fill * padding)


def parse_glb(path: Path) -> tuple[dict, bytearray]:
    raw = path.read_bytes()
    magic, version, total_length = GLB_HEADER_STRUCT.unpack_from(raw, 0)
    if magic != b"glTF":
        raise ValueError(f"{path} is not a GLB file")
    if version != 2:
        raise ValueError(f"Unsupported GLB version: {version}")
    if total_length != len(raw):
        raise ValueError(f"GLB length mismatch for {path}")

    offset = GLB_HEADER_STRUCT.size
    gltf = None
    bin_chunk = None
    while offset < len(raw):
        chunk_length, chunk_type = GLB_CHUNK_HEADER_STRUCT.unpack_from(raw, offset)
        offset += GLB_CHUNK_HEADER_STRUCT.size
        chunk_data = raw[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == b"JSON":
            gltf = json.loads(chunk_data.rstrip(b"\x00 ").decode("utf-8"))
        elif chunk_type == b"BIN\x00":
            bin_chunk = bytearray(chunk_data)

    if gltf is None or bin_chunk is None:
        raise ValueError(f"{path} is missing JSON or BIN chunk")
    return gltf, bin_chunk


def write_glb(path: Path, gltf: dict, bin_chunk: bytearray) -> None:
    json_bytes = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes = pad_to_4(json_bytes, b" ")
    bin_bytes = pad_to_4(bytes(bin_chunk), b"\x00")

    total_length = (
        GLB_HEADER_STRUCT.size
        + GLB_CHUNK_HEADER_STRUCT.size
        + len(json_bytes)
        + GLB_CHUNK_HEADER_STRUCT.size
        + len(bin_bytes)
    )

    output = bytearray()
    output.extend(GLB_HEADER_STRUCT.pack(b"glTF", 2, total_length))
    output.extend(GLB_CHUNK_HEADER_STRUCT.pack(len(json_bytes), b"JSON"))
    output.extend(json_bytes)
    output.extend(GLB_CHUNK_HEADER_STRUCT.pack(len(bin_bytes), b"BIN\x00"))
    output.extend(bin_bytes)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output)


def get_accessor_info(gltf: dict, accessor_index: int) -> AccessorInfo:
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    component_count = COMPONENT_COUNTS[accessor["type"]]
    component_size = COMPONENT_BYTE_SIZES[accessor["componentType"]]
    stride = view.get("byteStride", component_count * component_size)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    return AccessorInfo(
        accessor=accessor,
        view=view,
        component_count=component_count,
        component_size=component_size,
        stride=stride,
        offset=offset,
        count=accessor["count"],
    )


def read_accessor_rows(gltf: dict, bin_chunk: bytearray, accessor_index: int) -> list[list[float]]:
    info = get_accessor_info(gltf, accessor_index)
    if info.accessor["componentType"] != 5126:
        raise ValueError(f"Accessor {accessor_index} must be float32")
    fmt = "<" + (COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]] * info.component_count)
    rows: list[list[float]] = []
    for row_index in range(info.count):
        row_offset = info.offset + (row_index * info.stride)
        rows.append(list(struct.unpack_from(fmt, bin_chunk, row_offset)))
    return rows


def write_accessor_rows(
    gltf: dict,
    bin_chunk: bytearray,
    accessor_index: int,
    rows: Iterable[Iterable[float]],
) -> None:
    info = get_accessor_info(gltf, accessor_index)
    if info.accessor["componentType"] != 5126:
        raise ValueError(f"Accessor {accessor_index} must be float32")
    rows_list = [tuple(float(value) for value in row) for row in rows]
    if len(rows_list) != info.count:
        raise ValueError(f"Accessor {accessor_index} row count changed")
    fmt = "<" + (COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]] * info.component_count)
    for row_index, row in enumerate(rows_list):
        row_offset = info.offset + (row_index * info.stride)
        struct.pack_into(fmt, bin_chunk, row_offset, *row)


def read_accessor_scalars(gltf: dict, bin_chunk: bytearray, accessor_index: int) -> list[int]:
    info = get_accessor_info(gltf, accessor_index)
    if info.component_count != 1:
        raise ValueError(f"Accessor {accessor_index} must be scalar")
    fmt = "<" + COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]]
    values: list[int] = []
    for row_index in range(info.count):
        row_offset = info.offset + (row_index * info.stride)
        (value,) = struct.unpack_from(fmt, bin_chunk, row_offset)
        values.append(int(value))
    return values


def update_accessor_min_max(gltf: dict, accessor_index: int, rows: list[list[float]]) -> None:
    accessor = gltf["accessors"][accessor_index]
    component_count = COMPONENT_COUNTS[accessor["type"]]
    mins = [float("inf")] * component_count
    maxes = [float("-inf")] * component_count
    for row in rows:
        for index, value in enumerate(row):
            mins[index] = min(mins[index], value)
            maxes[index] = max(maxes[index], value)
    accessor["min"] = mins
    accessor["max"] = maxes


def get_node_lookup(gltf: dict) -> dict[str, dict]:
    return {node.get("name"): node for node in gltf["nodes"] if node.get("name")}


def get_node_scale_translation(node: dict) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    scale = tuple(float(value) for value in node.get("scale", [1.0, 1.0, 1.0]))
    translation = tuple(float(value) for value in node.get("translation", [0.0, 0.0, 0.0]))
    return scale, translation


def local_point_to_world(
    row: list[float] | tuple[float, float, float],
    scale: tuple[float, float, float],
    translation: tuple[float, float, float],
) -> tuple[float, float, float]:
    return (
        (float(row[0]) * scale[0]) + translation[0],
        (float(row[1]) * scale[1]) + translation[1],
        (float(row[2]) * scale[2]) + translation[2],
    )


def world_point_to_local(
    point: tuple[float, float, float],
    scale: tuple[float, float, float],
    translation: tuple[float, float, float],
) -> list[float]:
    return [
        (point[0] - translation[0]) / scale[0],
        (point[1] - translation[1]) / scale[1],
        (point[2] - translation[2]) / scale[2],
    ]


def subtract(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        (a[1] * b[2]) - (a[2] * b[1]),
        (a[2] * b[0]) - (a[0] * b[2]),
        (a[0] * b[1]) - (a[1] * b[0]),
    )


def normalize(vec: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = vec
    length = math.sqrt((x * x) + (y * y) + (z * z))
    if length <= 1e-10:
        return (0.0, 1.0, 0.0)
    return (x / length, y / length, z / length)


def recalculate_normals(gltf: dict, bin_chunk: bytearray, primitive: dict, positions: list[list[float]]) -> list[list[float]]:
    normals = [[0.0, 0.0, 0.0] for _ in positions]
    if primitive.get("mode", 4) != 4:
        raise ValueError("Only TRIANGLES mode is supported")
    if "indices" in primitive:
        indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
    else:
        indices = list(range(len(positions)))

    for index_offset in range(0, len(indices), 3):
        i0, i1, i2 = indices[index_offset : index_offset + 3]
        p0 = tuple(float(value) for value in positions[i0])
        p1 = tuple(float(value) for value in positions[i1])
        p2 = tuple(float(value) for value in positions[i2])
        face = cross(subtract(p1, p0), subtract(p2, p0))
        for vertex_index in (i0, i1, i2):
            normals[vertex_index][0] += face[0]
            normals[vertex_index][1] += face[1]
            normals[vertex_index][2] += face[2]

    return [list(normalize((row[0], row[1], row[2]))) for row in normals]


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - (2.0 * t))


def circle_half_width(z_world: float, source_radius: float) -> float:
    clamped = min(abs(z_world), source_radius)
    return math.sqrt(max((source_radius * source_radius) - (clamped * clamped), 0.0))


def capsule_half_width(z_world: float, half_length: float, target_half_width: float) -> float:
    body_half_length = max(half_length - target_half_width, 0.0)
    abs_z = abs(z_world)
    if abs_z <= body_half_length:
        return target_half_width
    cap_offset = abs_z - body_half_length
    return math.sqrt(max((target_half_width * target_half_width) - (cap_offset * cap_offset), 0.0))


def angle_from_front_for_point(rel_x: float, forward: float) -> float:
    angle_degrees = math.degrees(math.atan2(forward, rel_x))
    wrapped = ((90.0 - angle_degrees + 180.0) % 360.0) - 180.0
    return abs(wrapped)


def deform_mesh_x_to_capsule(
    gltf: dict,
    bin_chunk: bytearray,
    node_name: str,
    target_half_width: float,
    protected_spheres: tuple[ProtectedSphere, ...] = (),
) -> dict[str, float | int]:
    node_lookup = get_node_lookup(gltf)
    node = node_lookup[node_name]
    mesh = gltf["meshes"][node["mesh"]]
    primitive = mesh["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale, translation = get_node_scale_translation(node)
    world_positions = [local_point_to_world(row, scale, translation) for row in positions]
    half_length = max(abs(point[2]) for point in world_positions)
    source_half_width = max(abs(point[0]) for point in world_positions)

    updated_rows: list[list[float]] = []
    moved_rows = 0
    for row, world_point in zip(positions, world_positions):
        x_world, y_world, z_world = world_point
        source_width = max(circle_half_width(z_world, source_half_width), 1e-9)
        target_width = capsule_half_width(z_world, half_length, target_half_width)
        target_x_world = x_world * (target_width / source_width)

        deform_weight = 1.0
        for sphere in protected_spheres:
            distance = math.dist(world_point, sphere.center)
            deform_weight = min(
                deform_weight,
                smoothstep(sphere.inner_radius, sphere.outer_radius, distance),
            )

        next_x_world = x_world + ((target_x_world - x_world) * deform_weight)
        next_row = [row[0], row[1], row[2]]
        if abs(next_x_world - x_world) > 1e-12:
            next_row[0] = (next_x_world - translation[0]) / scale[0]
            moved_rows += 1
        updated_rows.append(next_row)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": node_name,
        "movedRows": moved_rows,
        "sourceHalfWidthWorld": source_half_width,
        "targetHalfWidthWorld": target_half_width,
        "protectedSphereCount": len(protected_spheres),
    }


def collect_lid_canopy_restore_rows(
    gltf: dict,
    source_positions: list[list[float]],
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    scale, translation = get_node_scale_translation(shell_node)
    source_world_positions = [local_point_to_world(row, scale, translation) for row in source_positions]

    restore_rows: set[int] = set()
    for triangle_start in range(0, len(source_positions), 3):
        triangle = source_world_positions[triangle_start : triangle_start + 3]
        rel_points = [(point[0] - hole_center[0], point[2] - hole_center[2]) for point in triangle]
        centroid_y = sum(point[1] for point in triangle) / 3.0
        centroid_forward = sum(point[1] for point in rel_points) / 3.0
        centroid_x = sum(point[0] for point in rel_points) / 3.0
        angle_from_front = angle_from_front_for_point(centroid_x, centroid_forward)
        edges = [
            (math.dist(triangle[0], triangle[1]) * 1000.0, (0, 1)),
            (math.dist(triangle[1], triangle[2]) * 1000.0, (1, 2)),
            (math.dist(triangle[2], triangle[0]) * 1000.0, (2, 0)),
        ]
        longest_edge = max(edge[0] for edge in edges)
        shortest_edge, shortest_pair = min(edges, key=lambda item: item[0])

        if not (
            0.00370 <= centroid_y <= 0.00410
            and angle_from_front >= 22.0
            and longest_edge >= 10.0
            and shortest_edge <= 1.2
            and max(point[1] for point in rel_points) >= 0.01350
            and min(point[1] for point in rel_points) <= 0.00600
        ):
            continue

        restore_rows.add(triangle_start + shortest_pair[0])
        restore_rows.add(triangle_start + shortest_pair[1])

    return sorted(restore_rows)


def restore_lid_canopy_source_x(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
    canopy_width_floor: float,
) -> dict[str, float | int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    scale, translation = get_node_scale_translation(shell_node)

    source_world_positions = [local_point_to_world(row, scale, translation) for row in source_positions]
    restore_rows = collect_lid_canopy_restore_rows(gltf, source_positions)
    updated_rows = [list(row) for row in positions]
    restored_rows = 0
    min_ratio = 1.0

    for row_index in restore_rows:
        source_world = source_world_positions[row_index]
        current_world = local_point_to_world(positions[row_index], scale, translation)
        source_rel_x = source_world[0] - hole_center[0]
        current_rel_x = current_world[0] - hole_center[0]
        source_forward = source_world[2] - hole_center[2]

        if abs(source_rel_x) <= 1e-9:
            continue

        # Farther from the hole, keep more of the source canopy width.
        forward_blend = smoothstep(0.0060, 0.0160, source_forward)
        target_ratio = canopy_width_floor * forward_blend
        target_abs_x = min(
            abs(source_rel_x),
            max(abs(current_rel_x), abs(source_rel_x) * target_ratio),
        )

        ratio = target_abs_x / abs(source_rel_x)
        min_ratio = min(min_ratio, ratio)
        if target_abs_x <= abs(current_rel_x) + 1e-12:
            continue

        target_world = (
            hole_center[0] + math.copysign(target_abs_x, source_rel_x),
            current_world[1],
            current_world[2],
        )
        updated_rows[row_index] = world_point_to_local(target_world, scale, translation)
        restored_rows += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "canopyRestoreRows": len(restore_rows),
        "canopyRowsMoved": restored_rows,
        "canopyWidthRatioFloor": canopy_width_floor,
        "canopyWidthRatioMinApplied": min_ratio,
    }


def realign_lid_split_edge_clusters(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict[str, float | int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    scale, translation = get_node_scale_translation(shell_node)
    source_world_positions = [local_point_to_world(row, scale, translation) for row in source_positions]

    source_clusters: dict[tuple[float, float, float], list[int]] = {}
    for row_index, world_point in enumerate(source_world_positions):
        key = (round(world_point[0], 7), round(world_point[1], 7), round(world_point[2], 7))
        source_clusters.setdefault(key, []).append(row_index)

    updated_rows = [list(row) for row in positions]
    aligned_cluster_count = 0
    aligned_row_count = 0

    for world_key, row_indices in source_clusters.items():
        if len(row_indices) < 2:
            continue

        rel_x = world_key[0] - translation[0]
        forward = translation[2] - world_key[2]
        local_y = world_key[1] - translation[1]
        angle_from_front = abs(math.degrees(math.atan2(rel_x, max(forward, 1e-9))))
        if not (
            0.00390 <= local_y <= 0.00410
            and 0.01300 <= forward <= 0.01950
            and 10.0 <= angle_from_front <= 60.0
        ):
            continue

        x_groups: dict[float, list[int]] = {}
        for row_index in row_indices:
            current_world = local_point_to_world(updated_rows[row_index], scale, translation)
            rounded_x = round(current_world[0], 7)
            x_groups.setdefault(rounded_x, []).append(row_index)

        if len(x_groups) < 2:
            continue

        target_x_world = world_key[0]

        changed_rows_in_cluster = 0
        for row_index in row_indices:
            current_world = local_point_to_world(updated_rows[row_index], scale, translation)
            if abs(current_world[0] - target_x_world) <= 1e-10:
                continue
            target_world = (target_x_world, current_world[1], current_world[2])
            updated_rows[row_index] = world_point_to_local(target_world, scale, translation)
            changed_rows_in_cluster += 1

        if changed_rows_in_cluster == 0:
            continue

        aligned_cluster_count += 1
        aligned_row_count += changed_rows_in_cluster

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "splitEdgeClustersAligned": aligned_cluster_count,
        "splitEdgeRowsMoved": aligned_row_count,
    }


def build_lid_pivot_protection(gltf: dict) -> tuple[ProtectedSphere, ...]:
    node_lookup = get_node_lookup(gltf)
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    return (
        ProtectedSphere(center=hole_center, inner_radius=0.0115, outer_radius=0.0210),
    )


def build_base_pivot_protection(gltf: dict) -> tuple[ProtectedSphere, ...]:
    node_lookup = get_node_lookup(gltf)
    pin_center = tuple(float(value) for value in node_lookup["Pivot_Pin_Printable"]["translation"])
    return (
        ProtectedSphere(center=pin_center, inner_radius=0.0100, outer_radius=0.0180),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Make qihang_product_pearl.glb flatter while preserving pivot topology.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("apps/web/public/qihang_product_pearl.glb"),
        help="Source GLB path.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("apps/web/public/qihang_product_pearl_capsule.glb"),
        help="Output GLB path.",
    )
    parser.add_argument(
        "--capsule-half-width",
        type=float,
        default=0.0162,
        help="Target half-width in meters for the flattened shell body.",
    )
    parser.add_argument(
        "--canopy-width-floor",
        type=float,
        default=1.0,
        help="How much source width to preserve for the pivot canopy fan short-edge rows.",
    )
    args = parser.parse_args()

    gltf, bin_chunk = parse_glb(args.input)
    node_lookup = get_node_lookup(gltf)
    lid_shell_primitive = gltf["meshes"][node_lookup["Case_Lid_Shell"]["mesh"]]["primitives"][0]
    original_lid_shell_positions = read_accessor_rows(
        gltf,
        bin_chunk,
        lid_shell_primitive["attributes"]["POSITION"],
    )

    reports = [
        deform_mesh_x_to_capsule(
            gltf,
            bin_chunk,
            "Case_Base_Shell",
            args.capsule_half_width,
            protected_spheres=build_base_pivot_protection(gltf),
        ),
        deform_mesh_x_to_capsule(
            gltf,
            bin_chunk,
            "Case_Lid_Shell",
            args.capsule_half_width,
            protected_spheres=build_lid_pivot_protection(gltf),
        ),
        restore_lid_canopy_source_x(
            gltf,
            bin_chunk,
            original_lid_shell_positions,
            canopy_width_floor=args.canopy_width_floor,
        ),
        realign_lid_split_edge_clusters(
            gltf,
            bin_chunk,
            original_lid_shell_positions,
        ),
    ]

    write_glb(args.output, gltf, bin_chunk)
    print(
        json.dumps(
            {
                "input": str(args.input),
                "output": str(args.output),
                "capsuleHalfWidth": args.capsule_half_width,
                "canopyWidthFloor": args.canopy_width_floor,
                "reports": reports,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
