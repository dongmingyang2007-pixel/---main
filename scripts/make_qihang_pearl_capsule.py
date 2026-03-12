from __future__ import annotations

import argparse
import json
import math
import struct
from collections import Counter, defaultdict, deque
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


@dataclass
class AccessorData:
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


LID_PIVOT_HOLE_BOTTOM_Y = -0.003205279987305403
LID_PIVOT_HOLE_THROAT_Y = -0.0006610000000000001
LID_PIVOT_HOLE_MOUTH_Y = 0.0007937000575475395
LID_PIVOT_HOLE_TOP_Y = 0.004093700088560581
LID_PIVOT_HOLE_BORE_RADIUS = 0.0048994450841373695
LID_PIVOT_HOLE_MOUTH_RADIUS = 0.00825
LID_PIVOT_HOLE_TOP_RADIUS = 0.0112
LID_PIVOT_HOLE_OUTER_INFLUENCE_RADIUS = 0.0128


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

    out = bytearray()
    out.extend(GLB_HEADER_STRUCT.pack(b"glTF", 2, total_length))
    out.extend(GLB_CHUNK_HEADER_STRUCT.pack(len(json_bytes), b"JSON"))
    out.extend(json_bytes)
    out.extend(GLB_CHUNK_HEADER_STRUCT.pack(len(bin_bytes), b"BIN\x00"))
    out.extend(bin_bytes)
    path.write_bytes(out)


def get_accessor_data(gltf: dict, accessor_index: int) -> AccessorData:
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    component_count = COMPONENT_COUNTS[accessor["type"]]
    component_size = COMPONENT_BYTE_SIZES[accessor["componentType"]]
    stride = view.get("byteStride", component_count * component_size)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    return AccessorData(
        accessor=accessor,
        view=view,
        component_count=component_count,
        component_size=component_size,
        stride=stride,
        offset=offset,
        count=count,
    )


def read_accessor_rows(gltf: dict, bin_chunk: bytearray, accessor_index: int) -> list[list[float]]:
    info = get_accessor_data(gltf, accessor_index)
    fmt = "<" + (COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]] * info.component_count)
    if info.accessor["componentType"] != 5126:
        raise ValueError(f"Accessor {accessor_index} must be float32")

    rows: list[list[float]] = []
    for row_index in range(info.count):
        row_offset = info.offset + (row_index * info.stride)
        rows.append(list(struct.unpack_from(fmt, bin_chunk, row_offset)))
    return rows


def write_accessor_rows(
    gltf: dict, bin_chunk: bytearray, accessor_index: int, rows: Iterable[Iterable[float]]
) -> None:
    info = get_accessor_data(gltf, accessor_index)
    fmt = "<" + (COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]] * info.component_count)
    if info.accessor["componentType"] != 5126:
        raise ValueError(f"Accessor {accessor_index} must be float32")

    rows_list = [tuple(float(value) for value in row) for row in rows]
    if len(rows_list) != info.count:
        raise ValueError(f"Accessor {accessor_index} row count changed")

    for row_index, row in enumerate(rows_list):
        row_offset = info.offset + (row_index * info.stride)
        struct.pack_into(fmt, bin_chunk, row_offset, *row)


def read_accessor_scalars(gltf: dict, bin_chunk: bytearray, accessor_index: int) -> list[int]:
    info = get_accessor_data(gltf, accessor_index)
    if info.component_count != 1:
        raise ValueError(f"Accessor {accessor_index} must be scalar")

    fmt = "<" + COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]]
    values: list[int] = []
    for row_index in range(info.count):
        row_offset = info.offset + (row_index * info.stride)
        (value,) = struct.unpack_from(fmt, bin_chunk, row_offset)
        values.append(int(value))
    return values


def build_vertex_neighbors(gltf: dict, bin_chunk: bytearray, primitive: dict, vertex_count: int) -> list[set[int]]:
    neighbors = [set() for _ in range(vertex_count)]
    if primitive.get("mode", 4) != 4:
        raise ValueError("Only TRIANGLES mode is supported")

    if "indices" in primitive:
        indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
    else:
        indices = list(range(vertex_count))

    for index_offset in range(0, len(indices), 3):
        i0 = indices[index_offset]
        i1 = indices[index_offset + 1]
        i2 = indices[index_offset + 2]
        neighbors[i0].update((i1, i2))
        neighbors[i1].update((i0, i2))
        neighbors[i2].update((i0, i1))

    return neighbors


def normalize(vec: tuple[float, float, float]) -> tuple[float, float, float]:
    x, y, z = vec
    length = math.sqrt((x * x) + (y * y) + (z * z))
    if length <= 1e-9:
        return (0.0, 1.0, 0.0)
    return (x / length, y / length, z / length)


def subtract(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a: tuple[float, float, float], b: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        (a[1] * b[2]) - (a[2] * b[1]),
        (a[2] * b[0]) - (a[0] * b[2]),
        (a[0] * b[1]) - (a[1] * b[0]),
    )


def add(a: list[float], b: tuple[float, float, float]) -> None:
    a[0] += b[0]
    a[1] += b[1]
    a[2] += b[2]


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


def circle_half_width(z_world: float, source_radius: float) -> float:
    clamped = min(abs(z_world), source_radius)
    return math.sqrt(max((source_radius * source_radius) - (clamped * clamped), 0.0))


def capsule_half_width(z_world: float, half_length: float, capsule_radius: float) -> float:
    body_half_length = half_length - capsule_radius
    abs_z = abs(z_world)
    if abs_z <= body_half_length:
        return capsule_radius
    cap_offset = abs_z - body_half_length
    return math.sqrt(max((capsule_radius * capsule_radius) - (cap_offset * cap_offset), 0.0))


def quantize_key(row: tuple[float, float, float]) -> tuple[int, int, int]:
    return tuple(int(round(value * 1_000_000)) for value in row)


def build_welded_vertex_groups(
    positions: list[list[float]],
) -> tuple[dict[tuple[int, int, int], list[int]], list[tuple[int, int, int]]]:
    groups: dict[tuple[int, int, int], list[int]] = {}
    keys: list[tuple[int, int, int]] = []
    for row_index, row in enumerate(positions):
        key = quantize_key(tuple(float(value) for value in row))
        keys.append(key)
        groups.setdefault(key, []).append(row_index)
    return groups, keys


def build_welded_group_neighbors(
    gltf: dict,
    bin_chunk: bytearray,
    primitive: dict,
    position_keys: list[tuple[int, int, int]],
) -> dict[tuple[int, int, int], set[tuple[int, int, int]]]:
    if "indices" in primitive:
        triangle_indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
    else:
        triangle_indices = list(range(len(position_keys)))

    neighbors: dict[tuple[int, int, int], set[tuple[int, int, int]]] = {
        key: set() for key in set(position_keys)
    }
    for index_offset in range(0, len(triangle_indices), 3):
        tri_keys = {
            position_keys[triangle_indices[index_offset]],
            position_keys[triangle_indices[index_offset + 1]],
            position_keys[triangle_indices[index_offset + 2]],
        }
        for key in tri_keys:
            neighbors[key].update(other for other in tri_keys if other != key)

    # The lid shell is exported as triangle soup, so a second hop helps smooth across coincident strips.
    expanded_neighbors = {key: set(value) for key, value in neighbors.items()}
    for key, neighbor_keys in neighbors.items():
        for neighbor_key in neighbor_keys:
            expanded_neighbors[key].update(neighbors[neighbor_key])
        expanded_neighbors[key].discard(key)
    return expanded_neighbors


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if value <= edge0:
        return 0.0
    if value >= edge1:
        return 1.0
    t = (value - edge0) / (edge1 - edge0)
    return t * t * (3.0 - (2.0 * t))


def lid_pivot_hole_target_radius(y_world: float) -> float | None:
    if y_world < LID_PIVOT_HOLE_BOTTOM_Y or y_world > LID_PIVOT_HOLE_TOP_Y:
        return None
    if y_world <= LID_PIVOT_HOLE_MOUTH_Y:
        axial_blend = smoothstep(LID_PIVOT_HOLE_THROAT_Y, LID_PIVOT_HOLE_MOUTH_Y, y_world)
        return LID_PIVOT_HOLE_BORE_RADIUS + (
            (LID_PIVOT_HOLE_MOUTH_RADIUS - LID_PIVOT_HOLE_BORE_RADIUS) * axial_blend
        )
    axial_blend = smoothstep(LID_PIVOT_HOLE_MOUTH_Y, LID_PIVOT_HOLE_TOP_Y, y_world)
    return LID_PIVOT_HOLE_MOUTH_RADIUS + (
        (LID_PIVOT_HOLE_TOP_RADIUS - LID_PIVOT_HOLE_MOUTH_RADIUS) * axial_blend
    )


def minimal_angle_span(
    points: tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]],
    center: tuple[float, float, float],
) -> float:
    ordered_angles = sorted(
        math.atan2(point[2] - center[2], point[0] - center[0]) % (2.0 * math.pi)
        for point in points
    )
    gaps: list[float] = []
    for index, value in enumerate(ordered_angles):
        next_value = ordered_angles[(index + 1) % len(ordered_angles)]
        if index == len(ordered_angles) - 1:
            next_value += 2.0 * math.pi
        gaps.append(next_value - value)
    return (2.0 * math.pi) - max(gaps)


def median(values: list[float]) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def recalculate_normals(
    gltf: dict,
    bin_chunk: bytearray,
    primitive: dict,
    positions: list[list[float]],
) -> list[list[float]]:
    position_tuples = [tuple(float(value) for value in row) for row in positions]
    accumulators: dict[tuple[int, int, int], list[float]] = {}

    def accumulate_triangle(i0: int, i1: int, i2: int) -> None:
        p0 = position_tuples[i0]
        p1 = position_tuples[i1]
        p2 = position_tuples[i2]
        edge_a = subtract(p1, p0)
        edge_b = subtract(p2, p0)
        face_normal = cross(edge_a, edge_b)
        if face_normal == (0.0, 0.0, 0.0):
            return
        for vertex_index in (i0, i1, i2):
            key = quantize_key(position_tuples[vertex_index])
            accumulators.setdefault(key, [0.0, 0.0, 0.0])
            add(accumulators[key], face_normal)

    if primitive.get("mode", 4) != 4:
        raise ValueError("Only TRIANGLES mode is supported")

    if "indices" in primitive:
        indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
        for index_offset in range(0, len(indices), 3):
            accumulate_triangle(indices[index_offset], indices[index_offset + 1], indices[index_offset + 2])
    else:
        for index_offset in range(0, len(position_tuples), 3):
            accumulate_triangle(index_offset, index_offset + 1, index_offset + 2)

    normals: list[list[float]] = []
    for row in position_tuples:
        normal = normalize(tuple(accumulators.get(quantize_key(row), [0.0, 1.0, 0.0])))
        normals.append([normal[0], normal[1], normal[2]])
    return normals


def reshape_lid_pivot_pocket(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = shell_node.get("scale", [1.0, 1.0, 1.0])
    translation = shell_node.get("translation", [0.0, 0.0, 0.0])
    scale_x = float(scale[0])
    scale_y = float(scale[1])
    scale_z = float(scale[2])
    translate_x = float(translation[0])
    translate_y = float(translation[1])
    translate_z = float(translation[2])

    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    updated_rows = [list(row) for row in positions]
    adjusted_count = 0
    strongest_blend = 0.0

    for row_index, (current_row, source_row) in enumerate(zip(positions, source_positions)):
        current_world_x = (current_row[0] * scale_x) + translate_x
        current_world_y = (current_row[1] * scale_y) + translate_y
        current_world_z = (current_row[2] * scale_z) + translate_z
        source_world_x = (source_row[0] * scale_x) + translate_x
        source_world_y = (source_row[1] * scale_y) + translate_y
        source_world_z = (source_row[2] * scale_z) + translate_z

        source_radius = math.hypot(source_world_x - hole_center[0], source_world_z - hole_center[2])
        if (
            source_world_y < LID_PIVOT_HOLE_BOTTOM_Y
            or source_world_y > LID_PIVOT_HOLE_TOP_Y
            or source_radius > LID_PIVOT_HOLE_OUTER_INFLUENCE_RADIUS
        ):
            continue

        target_radius = lid_pivot_hole_target_radius(source_world_y)
        if target_radius is None:
            continue

        if source_world_y <= LID_PIVOT_HOLE_MOUTH_Y:
            radial_blend = 1.0
        else:
            radial_blend = 1.0 - smoothstep(
                LID_PIVOT_HOLE_TOP_RADIUS,
                LID_PIVOT_HOLE_OUTER_INFLUENCE_RADIUS,
                source_radius,
            )

        blend = max(0.0, min(1.0, radial_blend))
        if blend <= 0.0:
            continue

        angle = math.atan2(source_world_z - hole_center[2], source_world_x - hole_center[0])
        target_world_x = hole_center[0] + (math.cos(angle) * target_radius)
        target_world_y = source_world_y
        target_world_z = hole_center[2] + (math.sin(angle) * target_radius)

        strongest_blend = max(strongest_blend, blend)
        blended_world_x = current_world_x + ((target_world_x - current_world_x) * blend)
        blended_world_y = current_world_y + ((target_world_y - current_world_y) * blend)
        blended_world_z = current_world_z + ((target_world_z - current_world_z) * blend)
        updated_rows[row_index][0] = (blended_world_x - translate_x) / scale_x
        updated_rows[row_index][1] = (blended_world_y - translate_y) / scale_y
        updated_rows[row_index][2] = (blended_world_z - translate_z) / scale_z
        adjusted_count += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)

    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotPocketAdjustedRows": adjusted_count,
        "holeCenter": hole_center,
        "boreRadius": LID_PIVOT_HOLE_BORE_RADIUS,
        "mouthRadius": LID_PIVOT_HOLE_MOUTH_RADIUS,
        "topRadius": LID_PIVOT_HOLE_TOP_RADIUS,
        "outerInfluenceRadius": LID_PIVOT_HOLE_OUTER_INFLUENCE_RADIUS,
        "strongestBlend": strongest_blend,
    }


def clear_lid_pivot_hole_chords(gltf: dict, bin_chunk: bytearray) -> dict:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    if "indices" in primitive:
        return {
            "node": "Case_Lid_Shell",
            "pivotHoleChordTrianglesCleared": 0,
            "skipped": "Indexed lid-shell primitives are not supported by the chord cleanup pass",
        }

    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = shell_node.get("scale", [1.0, 1.0, 1.0])
    translation = shell_node.get("translation", [0.0, 0.0, 0.0])
    scale_x = float(scale[0])
    scale_y = float(scale[1])
    scale_z = float(scale[2])
    translate_x = float(translation[0])
    translate_y = float(translation[1])
    translate_z = float(translation[2])

    def to_world(row: list[float]) -> tuple[float, float, float]:
        return (
            (row[0] * scale_x) + translate_x,
            (row[1] * scale_y) + translate_y,
            (row[2] * scale_z) + translate_z,
        )

    updated_rows = [list(row) for row in positions]
    cleared_triangles = 0
    strongest_midpoint_penetration = 0.0

    for triangle_start in range(0, len(positions), 3):
        triangle_world = (
            to_world(positions[triangle_start]),
            to_world(positions[triangle_start + 1]),
            to_world(positions[triangle_start + 2]),
        )
        y_values = [point[1] for point in triangle_world]
        if max(y_values) < LID_PIVOT_HOLE_MOUTH_Y or min(y_values) > LID_PIVOT_HOLE_TOP_Y + 0.0002:
            continue

        radii = [
            math.hypot(point[0] - hole_center[0], point[2] - hole_center[2])
            for point in triangle_world
        ]
        if min(radii) > LID_PIVOT_HOLE_OUTER_INFLUENCE_RADIUS + 0.004:
            continue

        angle_span = minimal_angle_span(triangle_world, hole_center)
        if angle_span < 0.30:
            continue

        midpoint_crosses_hole = False
        for start_index, end_index in ((0, 1), (1, 2), (2, 0)):
            midpoint = (
                (triangle_world[start_index][0] + triangle_world[end_index][0]) / 2.0,
                (triangle_world[start_index][1] + triangle_world[end_index][1]) / 2.0,
                (triangle_world[start_index][2] + triangle_world[end_index][2]) / 2.0,
            )
            target_radius = lid_pivot_hole_target_radius(midpoint[1])
            if target_radius is None:
                continue
            midpoint_radius = math.hypot(midpoint[0] - hole_center[0], midpoint[2] - hole_center[2])
            penetration = target_radius - midpoint_radius
            if penetration > 0.00010:
                midpoint_crosses_hole = True
                strongest_midpoint_penetration = max(strongest_midpoint_penetration, penetration)
                break

        if not midpoint_crosses_hole:
            continue

        collapse_row = positions[triangle_start]
        for row_index in range(triangle_start, triangle_start + 3):
            updated_rows[row_index][0] = collapse_row[0]
            updated_rows[row_index][1] = collapse_row[1]
            updated_rows[row_index][2] = collapse_row[2]
        cleared_triangles += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)

    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotHoleChordTrianglesCleared": cleared_triangles,
        "pivotHoleChordStrongestPenetration": strongest_midpoint_penetration,
    }


def clear_lid_pivot_top_fans(gltf: dict, bin_chunk: bytearray) -> dict:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    if "indices" in primitive:
        return {
            "node": "Case_Lid_Shell",
            "pivotTopFanTrianglesCleared": 0,
            "skipped": "Indexed lid-shell primitives are not supported by the top-fan cleanup pass",
        }

    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = shell_node.get("scale", [1.0, 1.0, 1.0])
    translation = shell_node.get("translation", [0.0, 0.0, 0.0])
    scale_x = float(scale[0])
    scale_y = float(scale[1])
    scale_z = float(scale[2])
    translate_x = float(translation[0])
    translate_y = float(translation[1])
    translate_z = float(translation[2])

    def to_world(row: list[float]) -> tuple[float, float, float]:
        return (
            (row[0] * scale_x) + translate_x,
            (row[1] * scale_y) + translate_y,
            (row[2] * scale_z) + translate_z,
        )

    updated_rows = [list(row) for row in positions]
    cleared_triangles = 0
    strongest_span = 0.0

    for triangle_start in range(0, len(positions), 3):
        triangle_world = (
            to_world(positions[triangle_start]),
            to_world(positions[triangle_start + 1]),
            to_world(positions[triangle_start + 2]),
        )
        y_values = [point[1] for point in triangle_world]
        if min(y_values) < LID_PIVOT_HOLE_TOP_Y - 0.00038 or max(y_values) > LID_PIVOT_HOLE_TOP_Y + 0.00002:
            continue

        radii = [
            math.hypot(point[0] - hole_center[0], point[2] - hole_center[2])
            for point in triangle_world
        ]
        radial_span = max(radii) - min(radii)
        min_radius = min(radii)
        if min_radius < LID_PIVOT_HOLE_TOP_RADIUS - 0.0001 or max(radii) > 0.0295:
            continue

        forward_offsets = [point[2] - hole_center[2] for point in triangle_world]
        if min(forward_offsets) < -0.001 or max(forward_offsets) > 0.028:
            continue

        is_primary_fan = radial_span >= 0.0031
        is_outer_fan = min_radius >= 0.0230 and radial_span >= 0.0020
        if not is_primary_fan and not is_outer_fan:
            continue

        collapse_row = positions[triangle_start]
        for row_index in range(triangle_start, triangle_start + 3):
            updated_rows[row_index][0] = collapse_row[0]
            updated_rows[row_index][1] = collapse_row[1]
            updated_rows[row_index][2] = collapse_row[2]
        cleared_triangles += 1
        strongest_span = max(strongest_span, radial_span)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)

    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotTopFanTrianglesCleared": cleared_triangles,
        "pivotTopFanStrongestSpan": strongest_span,
    }


def smooth_lid_tail_transition(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = shell_node.get("scale", [1.0, 1.0, 1.0])
    translation = shell_node.get("translation", [0.0, 0.0, 0.0])
    scale_x = float(scale[0])
    scale_y = float(scale[1])
    scale_z = float(scale[2])
    translate_x = float(translation[0])
    translate_y = float(translation[1])
    translate_z = float(translation[2])

    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    groups, position_keys = build_welded_vertex_groups(positions)
    welded_neighbors = build_welded_group_neighbors(gltf, bin_chunk, primitive, position_keys)

    def to_world(row: list[float]) -> tuple[float, float, float]:
        return (
            (row[0] * scale_x) + translate_x,
            (row[1] * scale_y) + translate_y,
            (row[2] * scale_z) + translate_z,
        )

    group_rows = {key: list(positions[members[0]]) for key, members in groups.items()}
    source_group_rows = {key: list(source_positions[members[0]]) for key, members in groups.items()}

    region_keys: set[tuple[int, int, int]] = set()
    protected_keys: set[tuple[int, int, int]] = set()
    movable_keys: set[tuple[int, int, int]] = set()

    for key, members in groups.items():
        source_world_x, source_world_y, source_world_z = to_world(source_positions[members[0]])
        source_radius = math.hypot(source_world_x - hole_center[0], source_world_z - hole_center[2])
        forward_offset = source_world_z - hole_center[2]

        if source_world_y < -0.0002 or source_world_y > 0.0048:
            continue
        if forward_offset < -0.0005 or forward_offset > 0.020:
            continue
        if source_radius > 0.030:
            continue

        region_keys.add(key)
        if source_radius <= 0.0122:
            protected_keys.add(key)
            continue

        if 0.0122 < source_radius < 0.024 and 0.0003 < forward_offset < 0.015 and 0.0006 < source_world_y < 0.0044:
            movable_keys.add(key)

    smoothed_group_rows = group_rows
    iteration_count = 8
    strongest_blend = 0.0
    max_local_x_shift = 0.00025 / max(abs(scale_x), 1e-9)
    max_local_y_shift = 0.00020 / max(abs(scale_y), 1e-9)

    for _ in range(iteration_count):
        next_group_rows = {key: list(row) for key, row in smoothed_group_rows.items()}
        for key in movable_keys:
            neighbor_keys = [
                neighbor_key
                for neighbor_key in welded_neighbors[key]
                if neighbor_key in region_keys and neighbor_key not in protected_keys
            ]
            if len(neighbor_keys) < 3:
                continue

            current_row = smoothed_group_rows[key]
            source_row = source_group_rows[key]
            source_world_x, source_world_y, source_world_z = to_world(source_row)
            source_radius = math.hypot(source_world_x - hole_center[0], source_world_z - hole_center[2])
            forward_offset = source_world_z - hole_center[2]

            top_weight = smoothstep(0.0008, 0.0038, source_world_y)
            forward_weight = 1.0 - smoothstep(0.010, 0.018, forward_offset)
            radial_weight = smoothstep(0.0122, 0.016, source_radius) * (
                1.0 - smoothstep(0.021, 0.0245, source_radius)
            )
            smooth_weight = 0.14 * top_weight * forward_weight * radial_weight
            if smooth_weight <= 1e-5:
                continue

            avg_x = sum(smoothed_group_rows[neighbor_key][0] for neighbor_key in neighbor_keys) / len(neighbor_keys)
            avg_y = sum(smoothed_group_rows[neighbor_key][1] for neighbor_key in neighbor_keys) / len(neighbor_keys)
            next_local_x = current_row[0] + ((avg_x - current_row[0]) * smooth_weight)
            next_local_y = current_row[1] + ((avg_y - current_row[1]) * smooth_weight * 0.45)
            next_group_rows[key][0] = current_row[0] + max(
                -max_local_x_shift,
                min(max_local_x_shift, next_local_x - current_row[0]),
            )
            next_group_rows[key][1] = current_row[1] + max(
                -max_local_y_shift,
                min(max_local_y_shift, next_local_y - current_row[1]),
            )
            strongest_blend = max(strongest_blend, smooth_weight)
        smoothed_group_rows = next_group_rows

    updated_rows = [list(row) for row in positions]
    smoothed_count = 0
    for key, members in groups.items():
        group_row = smoothed_group_rows[key]
        original_group_row = group_rows[key]
        if group_row[0] != original_group_row[0] or group_row[1] != original_group_row[1]:
            smoothed_count += len(members)
        for row_index in members:
            updated_rows[row_index][0] = group_row[0]
            updated_rows[row_index][1] = group_row[1]

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)

    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "tailTransitionRegionRows": sum(len(groups[key]) for key in region_keys),
        "tailTransitionProtectedRows": sum(len(groups[key]) for key in protected_keys),
        "tailTransitionSmoothedRows": smoothed_count,
        "tailTransitionIterations": iteration_count,
        "tailTransitionStrongestBlend": strongest_blend,
    }


def deform_shell(
    gltf: dict,
    bin_chunk: bytearray,
    node_name: str,
    capsule_radius_world: float,
    protected_spheres: tuple[ProtectedSphere, ...] = (),
) -> dict:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    if node_name not in node_lookup:
        raise ValueError(f"Node {node_name} not found")

    node = node_lookup[node_name]
    rotation = node.get("rotation")
    if rotation not in (None, [0, 0, 0, 1]):
        raise ValueError(f"Node {node_name} must stay axis-aligned for this script")

    mesh = gltf["meshes"][node["mesh"]]
    primitive = mesh["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = node.get("scale", [1.0, 1.0, 1.0])
    translation = node.get("translation", [0.0, 0.0, 0.0])
    scale_x = float(scale[0])
    scale_z = float(scale[2])
    translate_x = float(translation[0])
    translate_z = float(translation[2])

    z_world_values = [(row[2] * scale_z) + translate_z for row in positions]
    half_length = max(abs(min(z_world_values)), abs(max(z_world_values)))
    source_radius = max(abs((row[0] * scale_x) + translate_x) for row in positions)

    deformed_positions: list[list[float]] = []
    for row in positions:
        x_world = (row[0] * scale_x) + translate_x
        y_world = (row[1] * float(scale[1])) + float(translation[1])
        z_world = (row[2] * scale_z) + translate_z
        source_width = max(circle_half_width(z_world, source_radius), 1e-6)
        target_width = capsule_half_width(z_world, half_length, capsule_radius_world)
        x_world_deformed = x_world * (target_width / source_width)
        deform_weight = 1.0
        for sphere in protected_spheres:
            distance = math.dist((x_world, y_world, z_world), sphere.center)
            deform_weight = min(
                deform_weight,
                smoothstep(sphere.inner_radius, sphere.outer_radius, distance),
            )
        x_world_deformed = x_world + ((x_world_deformed - x_world) * deform_weight)
        row[0] = (x_world_deformed - translate_x) / scale_x
        deformed_positions.append(row)

    deformed_normals = recalculate_normals(gltf, bin_chunk, primitive, deformed_positions)

    write_accessor_rows(gltf, bin_chunk, position_accessor, deformed_positions)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, deformed_normals)
    update_accessor_min_max(gltf, position_accessor, deformed_positions)
    update_accessor_min_max(gltf, normal_accessor, deformed_normals)

    x_world_values = [((row[0] * scale_x) + translate_x) for row in deformed_positions]
    return {
        "node": node_name,
        "halfLengthWorld": half_length,
        "sourceHalfWidthWorld": source_radius,
        "targetHalfWidthWorld": capsule_radius_world,
        "protectedSphereCount": len(protected_spheres),
        "resultWorldBounds": {
            "minX": min(x_world_values),
            "maxX": max(x_world_values),
            "minZ": min(z_world_values),
            "maxZ": max(z_world_values),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Make qihang_product_pearl.glb more capsule-shaped.")
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
        help="Target half-width in meters for the capsule body.",
    )
    args = parser.parse_args()

    gltf, bin_chunk = parse_glb(args.input)
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    lid_shell_primitive = gltf["meshes"][node_lookup["Case_Lid_Shell"]["mesh"]]["primitives"][0]
    original_lid_shell_positions = read_accessor_rows(
        gltf,
        bin_chunk,
        lid_shell_primitive["attributes"]["POSITION"],
    )
    lid_hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    lid_hole_protection = (
        ProtectedSphere(
            center=lid_hole_center,
            inner_radius=0.0065,
            outer_radius=0.0115,
        ),
    )
    reports = [
        deform_shell(gltf, bin_chunk, "Case_Base_Shell", args.capsule_half_width),
        deform_shell(
            gltf,
            bin_chunk,
            "Case_Lid_Shell",
            args.capsule_half_width,
            protected_spheres=lid_hole_protection,
        ),
    ]
    reports.append(smooth_lid_tail_transition(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(reshape_lid_pivot_pocket(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(clear_lid_pivot_hole_chords(gltf, bin_chunk))
    reports.append(clear_lid_pivot_top_fans(gltf, bin_chunk))

    write_glb(args.output, gltf, bin_chunk)
    print(json.dumps({"output": str(args.output), "reports": reports}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
