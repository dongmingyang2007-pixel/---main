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


LID_PIVOT_HOLE_TOP_Y = 0.004093700088560581
LID_PIVOT_HOLE_BORE_RADIUS = 0.00455
LID_PIVOT_HOLE_TOP_RADIUS = LID_PIVOT_HOLE_BORE_RADIUS


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


def collect_shell_world_positions(
    positions: list[list[float]],
    scale: tuple[float, float, float],
    translation: tuple[float, float, float],
) -> list[tuple[float, float, float]]:
    return [local_point_to_world(row, scale, translation) for row in positions]


def collect_shell_triangle_indices(primitive: dict, positions: list[list[float]]) -> list[tuple[int, int, int]]:
    if primitive.get("mode", 4) != 4:
        raise ValueError("Only TRIANGLES mode is supported")
    if "indices" in primitive:
        raise ValueError("Indexed lid-shell primitives are not supported by this capsule script")
    return [(offset, offset + 1, offset + 2) for offset in range(0, len(positions), 3)]


def collect_lid_pivot_source_groups(
    source_positions: list[list[float]],
    shell_node: dict,
    hole_center: tuple[float, float, float],
) -> tuple[
    dict[tuple[int, int, int], list[int]],
    dict[tuple[int, int, int], dict[str, object]],
    dict[str, object],
]:
    groups, _ = build_welded_vertex_groups(source_positions)
    scale, translation = get_node_scale_translation(shell_node)
    descriptors: dict[tuple[int, int, int], dict[str, object]] = {}

    bore_radius_by_band: dict[float, list[float]] = defaultdict(list)
    inner_step_y_samples: list[float] = []
    rim_y_samples: list[float] = []
    rim_radius_samples: list[float] = []

    for key, members in groups.items():
        source_row = source_positions[members[0]]
        source_world = local_point_to_world(source_row, scale, translation)
        rel_x = source_world[0] - hole_center[0]
        forward = source_world[2] - hole_center[2]
        radius = math.hypot(rel_x, forward)
        angle = math.atan2(forward, rel_x)
        angle_from_front = angle_from_front_degrees(angle)
        surface = "other"
        y_band = round(source_world[1], 4)

        if -0.00085 <= source_world[1] <= -0.00050 and radius <= 0.00505 and -0.00410 <= forward <= 0.00520:
            surface = "bore"
            bore_radius_by_band[y_band].append(radius)
        elif 0.00065 <= source_world[1] <= 0.00090 and 0.00555 <= radius <= 0.00740 and -0.00410 <= forward <= 0.00750:
            surface = "inner_step"
            inner_step_y_samples.append(source_world[1])
        elif 0.00370 <= source_world[1] <= 0.00405 and 0.00720 <= radius <= 0.00745 and -0.00410 <= forward <= 0.00760:
            surface = "rim"
            rim_y_samples.append(source_world[1])
            rim_radius_samples.append(radius)
        elif (
            0.00360 <= source_world[1] <= 0.00415
            and 0.00320 <= forward <= 0.01580
            and 0.00025 <= abs(rel_x) <= 0.01080
            and 0.00480 <= radius <= 0.01180
        ):
            if angle_from_front <= 22.0:
                surface = "front_spine"
            elif angle_from_front <= 35.0:
                surface = "front_shoulder"
            else:
                surface = "side_transition"

        descriptors[key] = {
            "surface": surface,
            "source_world": source_world,
            "source_local": tuple(float(value) for value in source_row),
            "angle": angle,
            "angle_from_front": angle_from_front,
            "radius": radius,
            "forward": forward,
            "rel_x": rel_x,
            "y": source_world[1],
            "y_band": y_band,
            "member_count": len(members),
        }

    medians: dict[str, object] = {
        "bore_radius_by_band": {
            band: median(values) for band, values in bore_radius_by_band.items() if values
        },
        "inner_step_y": median(inner_step_y_samples) if inner_step_y_samples else 0.0007937000575475395,
        "rim_y": median(rim_y_samples) if rim_y_samples else 0.0038943014728526277,
        "rim_radius": median(rim_radius_samples) if rim_radius_samples else 0.00730,
    }
    return groups, descriptors, medians


def apply_group_world_targets(
    positions: list[list[float]],
    groups: dict[tuple[int, int, int], list[int]],
    group_targets: dict[tuple[int, int, int], tuple[float, float, float]],
    scale: tuple[float, float, float],
    translation: tuple[float, float, float],
) -> tuple[list[list[float]], int]:
    updated_rows = [list(row) for row in positions]
    moved_rows = 0

    for key, world_point in group_targets.items():
        local_point = world_point_to_local(world_point, scale, translation)
        for row_index in groups[key]:
            if updated_rows[row_index] != local_point:
                moved_rows += 1
            updated_rows[row_index][0] = local_point[0]
            updated_rows[row_index][1] = local_point[1]
            updated_rows[row_index][2] = local_point[2]
    return updated_rows, moved_rows


def angle_from_front_degrees(angle_radians: float) -> float:
    angle_degrees = math.degrees(angle_radians)
    wrapped = ((90.0 - angle_degrees + 180.0) % 360.0) - 180.0
    return abs(wrapped)


def angle_from_front_for_point(rel_x: float, forward: float) -> float:
    return angle_from_front_degrees(math.atan2(forward, rel_x))


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


def collect_lid_pivot_top_fan_triangles(gltf: dict, bin_chunk: bytearray) -> list[dict[str, object]]:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    indices = (
        read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
        if "indices" in primitive
        else list(range(len(positions)))
    )

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

    suspects: list[dict[str, object]] = []
    for triangle_offset in range(0, len(indices), 3):
        triangle_indices = indices[triangle_offset:triangle_offset + 3]
        triangle_world = tuple(to_world(positions[index]) for index in triangle_indices)
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

        edges = (
            math.dist(triangle_world[0], triangle_world[1]),
            math.dist(triangle_world[1], triangle_world[2]),
            math.dist(triangle_world[2], triangle_world[0]),
        )
        if max(edges) <= 1e-5:
            continue

        suspects.append(
            {
                "triangle_offset": triangle_offset,
                "triangle_indices": triangle_indices,
                "triangle_world": triangle_world,
                "radial_span": radial_span,
            }
        )

    return suspects


def clear_lid_pivot_isolated_bridge_faces(gltf: dict, bin_chunk: bytearray) -> dict:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    if "indices" in primitive:
        return {
            "node": "Case_Lid_Shell",
            "pivotIsolatedBridgeFacesCleared": 0,
            "skipped": "Indexed lid-shell primitives are not supported by the isolated-bridge cleanup pass",
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

    groups, _ = build_welded_vertex_groups(positions)
    vertex_to_group = {
        row_index: key
        for key, members in groups.items()
        for row_index in members
    }

    edge_counts: dict[tuple[tuple[int, int, int], tuple[int, int, int]], int] = defaultdict(int)
    triangle_edges: list[list[tuple[tuple[int, int, int], tuple[int, int, int]]]] = []

    for triangle_start in range(0, len(positions), 3):
        triangle_groups = [vertex_to_group[triangle_start + offset] for offset in range(3)]
        edges: list[tuple[tuple[int, int, int], tuple[int, int, int]]] = []
        for edge_start, edge_end in ((0, 1), (1, 2), (2, 0)):
            group_a = triangle_groups[edge_start]
            group_b = triangle_groups[edge_end]
            if group_a == group_b:
                continue
            edge_key = tuple(sorted((group_a, group_b)))
            edges.append(edge_key)
            edge_counts[edge_key] += 1
        triangle_edges.append(edges)

    candidate_offsets: list[int] = []
    strongest_span = 0.0
    for triangle_start in range(0, len(positions), 3):
        triangle_world = (
            to_world(positions[triangle_start]),
            to_world(positions[triangle_start + 1]),
            to_world(positions[triangle_start + 2]),
        )
        y_values = [point[1] for point in triangle_world]
        if min(y_values) < 0.0036 or max(y_values) > 0.00415:
            continue

        forward_offsets = [point[2] - hole_center[2] for point in triangle_world]
        if min(forward_offsets) < 0.0035 or max(forward_offsets) > 0.0148:
            continue

        x_offsets = [point[0] - hole_center[0] for point in triangle_world]
        if max(abs(value) for value in x_offsets) < 0.0025:
            continue

        max_edge_span = max(
            math.dist(triangle_world[0], triangle_world[1]),
            math.dist(triangle_world[1], triangle_world[2]),
            math.dist(triangle_world[2], triangle_world[0]),
        )
        if max_edge_span < 0.0070:
            continue

        isolated_edge_count = sum(1 for edge_key in triangle_edges[triangle_start // 3] if edge_counts[edge_key] == 1)
        if isolated_edge_count != 3:
            continue

        candidate_offsets.append(triangle_start)
        strongest_span = max(strongest_span, max_edge_span)

    if not candidate_offsets:
        return {
            "node": "Case_Lid_Shell",
            "pivotIsolatedBridgeFacesCleared": 0,
            "pivotIsolatedBridgeFacesRemaining": 0,
            "pivotIsolatedBridgeStrongestSpan": 0.0,
        }

    updated_rows = [list(row) for row in positions]
    for triangle_start in candidate_offsets:
        collapse_row = list(updated_rows[triangle_start])
        updated_rows[triangle_start + 1] = list(collapse_row)
        updated_rows[triangle_start + 2] = list(collapse_row)

    remaining_faces = 0
    for triangle_start in candidate_offsets:
        row_a = updated_rows[triangle_start]
        row_b = updated_rows[triangle_start + 1]
        row_c = updated_rows[triangle_start + 2]
        if row_a != row_b and row_b != row_c and row_a != row_c:
            remaining_faces += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotIsolatedBridgeFacesCleared": len(candidate_offsets),
        "pivotIsolatedBridgeFacesRemaining": remaining_faces,
        "pivotIsolatedBridgeStrongestSpan": strongest_span,
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


def rebuild_lid_pivot_cap_and_hole(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    source_groups, source_descriptors, source_medians = collect_lid_pivot_source_groups(
        source_positions,
        shell_node,
        hole_center,
    )

    group_targets: dict[tuple[int, int, int], tuple[float, float, float]] = {}
    restored_transition_rows = 0
    rebuilt_rows = 0

    bore_radius_by_band = source_medians["bore_radius_by_band"]
    inner_step_y = float(source_medians["inner_step_y"])
    rim_y = float(source_medians["rim_y"])
    rim_radius = float(source_medians["rim_radius"])

    for key, descriptor in source_descriptors.items():
        surface = descriptor["surface"]
        if surface == "other":
            continue

        source_world = descriptor["source_world"]
        angle = float(descriptor["angle"])
        radius = float(descriptor["radius"])
        y_band = float(descriptor["y_band"])

        if surface == "bore":
            target_radius = float(bore_radius_by_band.get(y_band, radius))
            target_world = (
                hole_center[0] + (math.cos(angle) * target_radius),
                source_world[1],
                hole_center[2] + (math.sin(angle) * target_radius),
            )
            rebuilt_rows += len(source_groups[key])
        elif surface == "inner_step":
            target_world = (
                hole_center[0] + (math.cos(angle) * radius),
                inner_step_y,
                hole_center[2] + (math.sin(angle) * radius),
            )
            rebuilt_rows += len(source_groups[key])
        elif surface == "rim":
            target_world = (
                hole_center[0] + (math.cos(angle) * rim_radius),
                rim_y,
                hole_center[2] + (math.sin(angle) * rim_radius),
            )
            rebuilt_rows += len(source_groups[key])
        elif surface in {"front_spine", "front_shoulder"}:
            target_world = source_world
            restored_transition_rows += len(source_groups[key])
        else:
            continue

        group_targets[key] = target_world

    updated_rows, moved_rows = apply_group_world_targets(
        positions,
        source_groups,
        group_targets,
        scale,
        translation,
    )
    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotRebuildTargetGroups": len(group_targets),
        "pivotRebuildMovedRows": moved_rows,
        "pivotRebuildRestoredTransitionRows": restored_transition_rows,
        "pivotRebuildSurfaceRows": rebuilt_rows,
        "pivotRebuildBoreBands": {str(key): value for key, value in bore_radius_by_band.items()},
        "pivotRebuildInnerStepY": inner_step_y,
        "pivotRebuildRimY": rim_y,
        "pivotRebuildRimRadius": rim_radius,
    }


def collect_lid_pivot_side_corridor_offsets(
    gltf: dict,
    bin_chunk: bytearray,
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    scale, translation = get_node_scale_translation(shell_node)
    world_positions = collect_shell_world_positions(positions, scale, translation)
    triangles = collect_shell_triangle_indices(primitive, positions)

    candidate_offsets: list[int] = []
    for triangle_index, triangle in enumerate(triangles):
        points = [world_positions[index] for index in triangle]
        rel_points = [
            (point[0] - hole_center[0], point[1], point[2] - hole_center[2])
            for point in points
        ]
        centroid_x = sum(point[0] for point in rel_points) / 3.0
        centroid_y = sum(point[1] for point in rel_points) / 3.0
        centroid_forward = sum(point[2] for point in rel_points) / 3.0
        centroid_radius = math.hypot(centroid_x, centroid_forward)
        front_angle = angle_from_front_for_point(centroid_x, centroid_forward)
        x_values_mm = [point[0] * 1000.0 for point in rel_points]
        forward_values_mm = [point[2] * 1000.0 for point in rel_points]
        x_span_mm = max(x_values_mm) - min(x_values_mm)
        forward_span_mm = max(forward_values_mm) - min(forward_values_mm)

        if not (
            0.00355 <= centroid_y <= 0.00415
            and front_angle >= 35.0
            and 0.00600 <= centroid_radius <= 0.01250
            and x_span_mm >= 5.5
            and forward_span_mm >= 10.0
        ):
            continue

        candidate_offsets.append(triangle_index * 3)

    return candidate_offsets


def reroute_lid_pivot_side_corridors(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    scale, translation = get_node_scale_translation(shell_node)
    _, _, source_medians = collect_lid_pivot_source_groups(source_positions, shell_node, hole_center)
    rim_y = float(source_medians["rim_y"])
    rim_radius = float(source_medians["rim_radius"])

    candidate_offsets = collect_lid_pivot_side_corridor_offsets(gltf, bin_chunk)
    if not candidate_offsets:
        return {
            "node": "Case_Lid_Shell",
            "pivotSideCorridorsRerouted": 0,
            "pivotSideCorridorsToUpper": 0,
            "pivotSideCorridorsToLower": 0,
            "pivotSideCorridorsRemaining": 0,
        }

    world_positions = collect_shell_world_positions(positions, scale, translation)
    updated_rows = [list(row) for row in positions]
    to_upper = 0
    to_lower = 0

    for triangle_start in candidate_offsets:
        triangle_points = world_positions[triangle_start:triangle_start + 3]
        rel_points = [
            (point[0] - hole_center[0], point[1], point[2] - hole_center[2])
            for point in triangle_points
        ]
        centroid = (
            sum(point[0] for point in triangle_points) / 3.0,
            sum(point[1] for point in triangle_points) / 3.0,
            sum(point[2] for point in triangle_points) / 3.0,
        )
        sorted_by_forward = sorted(zip(rel_points, triangle_points), key=lambda item: item[0][2])
        upper_source_points = [item[1] for item in sorted_by_forward[:2]]
        upper_anchor = (
            sum(point[0] for point in upper_source_points) / len(upper_source_points),
            sum(point[1] for point in upper_source_points) / len(upper_source_points),
            sum(point[2] for point in upper_source_points) / len(upper_source_points),
        )

        centroid_rel_x = centroid[0] - hole_center[0]
        centroid_forward = centroid[2] - hole_center[2]
        centroid_angle = math.atan2(centroid_forward, centroid_rel_x)
        lower_anchor = (
            hole_center[0] + (math.cos(centroid_angle) * rim_radius),
            rim_y,
            hole_center[2] + (math.sin(centroid_angle) * rim_radius),
        )

        if math.dist(centroid, upper_anchor) <= math.dist(centroid, lower_anchor):
            target_world = upper_anchor
            to_upper += 1
        else:
            target_world = lower_anchor
            to_lower += 1

        local_target = world_point_to_local(target_world, scale, translation)
        for row_index in range(triangle_start, triangle_start + 3):
            updated_rows[row_index][0] = local_target[0]
            updated_rows[row_index][1] = local_target[1]
            updated_rows[row_index][2] = local_target[2]

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    remaining = len(collect_lid_pivot_side_corridor_offsets(gltf, bin_chunk))
    return {
        "node": "Case_Lid_Shell",
        "pivotSideCorridorsRerouted": len(candidate_offsets),
        "pivotSideCorridorsToUpper": to_upper,
        "pivotSideCorridorsToLower": to_lower,
        "pivotSideCorridorsRemaining": remaining,
    }


def collect_lid_pivot_front_spine_stitch_clusters(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
    current_tolerance: float = 0.00022,
    source_tolerance: float = 0.00022,
) -> list[list[tuple[int, int, int]]]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    groups, _ = build_welded_vertex_groups(positions)
    current_group_world: dict[tuple[int, int, int], tuple[float, float, float]] = {}
    source_group_world: dict[tuple[int, int, int], tuple[float, float, float]] = {}

    for key, members in groups.items():
        current_world_points = [local_point_to_world(positions[index], scale, translation) for index in members]
        source_world_points = [local_point_to_world(source_positions[index], scale, translation) for index in members]
        count = len(members)
        current_group_world[key] = (
            sum(point[0] for point in current_world_points) / count,
            sum(point[1] for point in current_world_points) / count,
            sum(point[2] for point in current_world_points) / count,
        )
        source_group_world[key] = (
            sum(point[0] for point in source_world_points) / count,
            sum(point[1] for point in source_world_points) / count,
            sum(point[2] for point in source_world_points) / count,
        )

    candidate_keys: list[tuple[int, int, int]] = []
    for key, current_world in current_group_world.items():
        rel_x = current_world[0] - hole_center[0]
        forward = current_world[2] - hole_center[2]
        angle_from_front = angle_from_front_for_point(rel_x, forward)
        if (
            0.00340 <= current_world[1] <= 0.00415
            and abs(rel_x) <= 0.00240
            and 0.00400 <= forward <= 0.01450
            and angle_from_front <= 22.0
        ):
            candidate_keys.append(key)

    ordered_keys = sorted(
        candidate_keys,
        key=lambda key: (
            round(current_group_world[key][1] * 1000.0, 3),
            round((current_group_world[key][2] - hole_center[2]) * 1000.0, 3),
            round((current_group_world[key][0] - hole_center[0]) * 1000.0, 3),
        ),
    )

    clusters: list[list[tuple[int, int, int]]] = []
    assigned: set[tuple[int, int, int]] = set()
    for key in ordered_keys:
        if key in assigned:
            continue
        seed_current = current_group_world[key]
        seed_source = source_group_world[key]
        cluster = [key]
        for other_key in ordered_keys:
            if other_key == key or other_key in assigned:
                continue
            if math.dist(seed_current, current_group_world[other_key]) > current_tolerance:
                continue
            if math.dist(seed_source, source_group_world[other_key]) > source_tolerance:
                continue
            cluster.append(other_key)
        if len(cluster) > 1:
            clusters.append(cluster)
            assigned.update(cluster)

    return clusters


def stitch_lid_pivot_front_spine(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    scale, translation = get_node_scale_translation(shell_node)
    total_clusters_stitched = 0
    total_rows_moved = 0
    iteration_count = 0

    while True:
        positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
        groups, _ = build_welded_vertex_groups(positions)
        clusters = collect_lid_pivot_front_spine_stitch_clusters(gltf, bin_chunk, source_positions)
        if not clusters:
            break

        current_group_world: dict[tuple[int, int, int], tuple[float, float, float]] = {}
        for key, members in groups.items():
            world_points = [local_point_to_world(positions[index], scale, translation) for index in members]
            count = len(world_points)
            current_group_world[key] = (
                sum(point[0] for point in world_points) / count,
                sum(point[1] for point in world_points) / count,
                sum(point[2] for point in world_points) / count,
            )

        group_targets: dict[tuple[int, int, int], tuple[float, float, float]] = {}
        for cluster in clusters:
            avg_world = (
                sum(current_group_world[key][0] for key in cluster) / len(cluster),
                sum(current_group_world[key][1] for key in cluster) / len(cluster),
                sum(current_group_world[key][2] for key in cluster) / len(cluster),
            )
            for key in cluster:
                group_targets[key] = avg_world

        updated_rows, moved_rows = apply_group_world_targets(
            positions,
            groups,
            group_targets,
            scale,
            translation,
        )
        updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
        write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
        write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
        update_accessor_min_max(gltf, position_accessor, updated_rows)
        update_accessor_min_max(gltf, normal_accessor, updated_normals)

        total_clusters_stitched += len(clusters)
        total_rows_moved += moved_rows
        iteration_count += 1
        if iteration_count >= 6:
            break

    remaining_clusters = collect_lid_pivot_front_spine_stitch_clusters(gltf, bin_chunk, source_positions)
    return {
        "node": "Case_Lid_Shell",
        "pivotFrontSpineClustersStitched": total_clusters_stitched,
        "pivotFrontSpineRowsMoved": total_rows_moved,
        "pivotFrontSpineClustersRemaining": len(remaining_clusters),
        "pivotFrontSpineIterations": iteration_count,
    }


def approximate_weld_lid_pivot_region(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
    tolerance: float = 0.00008,
    source_tolerance: float = 0.00005,
) -> dict:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    source_groups, source_descriptors, _ = collect_lid_pivot_source_groups(source_positions, shell_node, hole_center)
    surface_order = {"bore": 0, "inner_step": 1, "rim": 2, "transition_band": 3}
    candidate_keys = [
        key
        for key, descriptor in source_descriptors.items()
        if descriptor["surface"] in surface_order
    ]

    current_group_world: dict[tuple[int, int, int], tuple[float, float, float]] = {}
    for key, members in source_groups.items():
        world_points = [local_point_to_world(positions[index], scale, translation) for index in members]
        count = len(world_points)
        current_group_world[key] = (
            sum(point[0] for point in world_points) / count,
            sum(point[1] for point in world_points) / count,
            sum(point[2] for point in world_points) / count,
        )

    ordered_keys = sorted(
        candidate_keys,
        key=lambda key: (
            surface_order[source_descriptors[key]["surface"]],
            round(float(source_descriptors[key]["y"]) * 1000.0, 3),
            round(float(source_descriptors[key]["radius"]) * 1000.0, 3),
            round(float(source_descriptors[key]["angle"]), 6),
        ),
    )

    assigned: set[tuple[int, int, int]] = set()
    group_targets: dict[tuple[int, int, int], tuple[float, float, float]] = {}
    cluster_count = 0
    max_cluster_spread = 0.0

    for key in ordered_keys:
        if key in assigned:
            continue

        seed_descriptor = source_descriptors[key]
        seed_source_world = seed_descriptor["source_world"]
        seed_current_world = current_group_world[key]
        cluster = [key]

        for other_key in ordered_keys:
            if other_key == key or other_key in assigned:
                continue
            other_descriptor = source_descriptors[other_key]
            if other_descriptor["surface"] != seed_descriptor["surface"]:
                continue
            if math.dist(seed_source_world, other_descriptor["source_world"]) > source_tolerance:
                continue
            current_distance = math.dist(seed_current_world, current_group_world[other_key])
            if current_distance > tolerance:
                continue
            cluster.append(other_key)

        if len(cluster) <= 1:
            continue

        avg_world = (
            sum(current_group_world[group_key][0] for group_key in cluster) / len(cluster),
            sum(current_group_world[group_key][1] for group_key in cluster) / len(cluster),
            sum(current_group_world[group_key][2] for group_key in cluster) / len(cluster),
        )
        cluster_spread = max(
            math.dist(seed_current_world, current_group_world[group_key]) for group_key in cluster
        )
        max_cluster_spread = max(max_cluster_spread, cluster_spread)

        for group_key in cluster:
            group_targets[group_key] = avg_world
        assigned.update(cluster)
        cluster_count += 1

    if not group_targets:
        return {
            "node": "Case_Lid_Shell",
            "pivotApproxWeldClusters": 0,
            "pivotApproxWeldMovedRows": 0,
            "pivotApproxWeldToleranceMm": tolerance * 1000.0,
            "pivotApproxWeldSourceToleranceMm": source_tolerance * 1000.0,
            "pivotApproxWeldMaxClusterSpreadMm": 0.0,
        }

    updated_rows, moved_rows = apply_group_world_targets(
        positions,
        source_groups,
        group_targets,
        scale,
        translation,
    )
    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotApproxWeldClusters": cluster_count,
        "pivotApproxWeldMovedRows": moved_rows,
        "pivotApproxWeldToleranceMm": tolerance * 1000.0,
        "pivotApproxWeldSourceToleranceMm": source_tolerance * 1000.0,
        "pivotApproxWeldMaxClusterSpreadMm": max_cluster_spread * 1000.0,
    }


def collect_lid_pivot_residual_side_wedge_offsets(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    world_positions = collect_shell_world_positions(positions, scale, translation)
    source_world_positions = collect_shell_world_positions(source_positions, scale, translation)

    groups, _ = build_welded_vertex_groups(positions)
    vertex_to_group = {row_index: key for key, members in groups.items() for row_index in members}
    edge_counts: dict[tuple[tuple[int, int, int], tuple[int, int, int]], int] = defaultdict(int)
    triangle_edges: list[list[tuple[tuple[int, int, int], tuple[int, int, int]]]] = []

    for triangle_start in range(0, len(positions), 3):
        tri_groups = [vertex_to_group[triangle_start + offset] for offset in range(3)]
        edges: list[tuple[tuple[int, int, int], tuple[int, int, int]]] = []
        for edge_start, edge_end in ((0, 1), (1, 2), (2, 0)):
            group_a = tri_groups[edge_start]
            group_b = tri_groups[edge_end]
            if group_a == group_b:
                continue
            edge_key = tuple(sorted((group_a, group_b)))
            edge_counts[edge_key] += 1
            edges.append(edge_key)
        triangle_edges.append(edges)

    candidate_offsets: list[int] = []
    for triangle_start in range(0, len(positions), 3):
        triangle_world = world_positions[triangle_start:triangle_start + 3]
        source_triangle_world = source_world_positions[triangle_start:triangle_start + 3]
        centroid_x = sum(point[0] for point in triangle_world) / 3.0
        centroid_y = sum(point[1] for point in triangle_world) / 3.0
        centroid_z = sum(point[2] for point in triangle_world) / 3.0
        rel_x = centroid_x - hole_center[0]
        forward = centroid_z - hole_center[2]
        if not (
            0.00355 <= centroid_y <= 0.00415
            and 0.00400 <= forward <= 0.00485
            and 0.00520 <= abs(rel_x) <= 0.01050
        ):
            continue

        max_edge_span = max(
            math.dist(triangle_world[0], triangle_world[1]),
            math.dist(triangle_world[1], triangle_world[2]),
            math.dist(triangle_world[2], triangle_world[0]),
        )
        source_max_edge_span = max(
            math.dist(source_triangle_world[0], source_triangle_world[1]),
            math.dist(source_triangle_world[1], source_triangle_world[2]),
            math.dist(source_triangle_world[2], source_triangle_world[0]),
        )
        isolated_edge_count = sum(
            1 for edge_key in triangle_edges[triangle_start // 3] if edge_counts[edge_key] == 1
        )
        if isolated_edge_count < 2:
            continue
        if max_edge_span < max(source_max_edge_span + 0.00015, source_max_edge_span * 1.15):
            continue

        candidate_offsets.append(triangle_start)

    return candidate_offsets


def clear_lid_pivot_residual_side_wedges(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    candidate_offsets = collect_lid_pivot_residual_side_wedge_offsets(gltf, bin_chunk, source_positions)
    if not candidate_offsets:
        return {
            "node": "Case_Lid_Shell",
            "pivotResidualSideWedgesCleared": 0,
            "pivotResidualSideWedgesRemaining": 0,
        }

    updated_rows = [list(row) for row in positions]
    for triangle_start in candidate_offsets:
        source_triangle = source_positions[triangle_start:triangle_start + 3]
        collapse_row = [
            sum(row[axis] for row in source_triangle) / 3.0
            for axis in range(3)
        ]
        updated_rows[triangle_start] = list(collapse_row)
        updated_rows[triangle_start + 1] = list(collapse_row)
        updated_rows[triangle_start + 2] = list(collapse_row)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    remaining_faces = len(collect_lid_pivot_residual_side_wedge_offsets(gltf, bin_chunk, source_positions))
    return {
        "node": "Case_Lid_Shell",
        "pivotResidualSideWedgesCleared": len(candidate_offsets),
        "pivotResidualSideWedgesRemaining": remaining_faces,
    }


def restore_lid_pivot_side_bridges(
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
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

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
    anchor_indices: set[int] = set()
    bridge_band_indices: set[int] = set()
    restored_count = 0
    max_world_x_shift = 0.0

    def classify_bridge_row(source_world: tuple[float, float, float]) -> tuple[bool, bool]:
        source_x = source_world[0] - hole_center[0]
        source_forward = source_world[2] - hole_center[2]
        source_y = source_world[1]
        source_radius = math.hypot(source_x, source_forward)

        is_anchor = (
            0.00355 <= source_y <= 0.00412
            and 0.01310 <= source_forward <= 0.01610
            and 0.01300 <= source_radius <= 0.01860
            and 0.00075 <= abs(source_x) <= 0.00960
        )
        is_bridge_band = (
            0.00055 <= source_y <= 0.00415
            and 0.00300 <= source_forward <= 0.01640
            and 0.00580 <= source_radius <= 0.01920
            and 0.00060 <= abs(source_x) <= 0.01020
        )
        return is_anchor, is_bridge_band

    for row_index, (current_row, source_row) in enumerate(zip(positions, source_positions)):
        source_world = to_world(source_row)
        current_world = to_world(current_row)
        source_x = source_world[0] - hole_center[0]
        current_x = current_world[0] - hole_center[0]
        source_forward = source_world[2] - hole_center[2]
        source_y = source_world[1]
        source_radius = math.hypot(source_x, source_forward)
        compression = max(0.0, abs(source_x) - abs(current_x))
        is_anchor, is_bridge_band = classify_bridge_row(source_world)

        if is_anchor:
            anchor_indices.add(row_index)
            if compression > 0.00015:
                updated_rows[row_index][0] = source_row[0]
                restored_count += 1
                max_world_x_shift = max(max_world_x_shift, abs(current_x - source_x))
            continue

        if not is_bridge_band:
            continue

        bridge_band_indices.add(row_index)
        if compression <= 0.00020:
            continue

        top_weight = smoothstep(0.00055, 0.00380, source_y)
        forward_weight = smoothstep(0.00320, 0.01480, source_forward)
        outer_weight = smoothstep(0.00600, 0.01480, source_radius)
        compression_weight = smoothstep(0.00020, 0.00130, compression)
        restore_weight = min(0.82, 0.18 + (0.46 * top_weight) + (0.20 * forward_weight) + (0.16 * outer_weight))
        restore_weight *= compression_weight
        if restore_weight <= 1e-5:
            continue

        updated_rows[row_index][0] = current_row[0] + ((source_row[0] - current_row[0]) * restore_weight)
        restored_count += 1
        max_world_x_shift = max(max_world_x_shift, abs(current_x - source_x) * restore_weight)

    if not anchor_indices:
        return {
            "node": "Case_Lid_Shell",
            "pivotSideBridgeRowsRestored": 0,
            "pivotSideBridgeRowsSmoothed": 0,
            "pivotSideBridgeWorstXCompressionMm": 0.0,
            "skipped": "No side-bridge anchor rows found",
        }

    vertex_neighbors = build_vertex_neighbors(gltf, bin_chunk, primitive, len(updated_rows))
    smoothed_rows = 0
    for _ in range(4):
        next_rows = [list(row) for row in updated_rows]
        for row_index in bridge_band_indices:
            if row_index in anchor_indices:
                continue
            neighbor_values = [
                updated_rows[neighbor_index][0]
                for neighbor_index in vertex_neighbors[row_index]
                if neighbor_index in bridge_band_indices or neighbor_index in anchor_indices
            ]
            if not neighbor_values:
                continue
            source_world = to_world(source_positions[row_index])
            source_x = source_world[0] - hole_center[0]
            source_forward = source_world[2] - hole_center[2]
            source_y = source_world[1]
            source_radius = math.hypot(source_x, source_forward)
            band_weight = smoothstep(0.00055, 0.00390, source_y) * smoothstep(0.00420, 0.01420, source_forward)
            band_weight *= smoothstep(0.00600, 0.01380, source_radius)
            if band_weight <= 1e-5:
                continue
            neighbor_average = sum(neighbor_values) / len(neighbor_values)
            target_x = (neighbor_average * 0.58) + (source_positions[row_index][0] * 0.42)
            next_rows[row_index][0] = updated_rows[row_index][0] + (
                (target_x - updated_rows[row_index][0]) * (0.18 * band_weight)
            )
            smoothed_rows += 1
        updated_rows = next_rows

    remaining_compressed = 0
    worst_remaining = 0.0
    for row_index, source_row in enumerate(source_positions):
        source_world = to_world(source_row)
        is_anchor, _ = classify_bridge_row(source_world)
        if not is_anchor:
            continue
        source_world = to_world(source_positions[row_index])
        current_world = to_world(updated_rows[row_index])
        source_x = source_world[0] - hole_center[0]
        current_x = current_world[0] - hole_center[0]
        compression = max(0.0, abs(source_x) - abs(current_x))
        if compression > 0.00018:
            remaining_compressed += 1
            worst_remaining = max(worst_remaining, compression)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotSideBridgeRowsRestored": restored_count,
        "pivotSideBridgeRowsSmoothed": smoothed_rows,
        "pivotSideBridgeWorstXShiftMm": max_world_x_shift * 1000.0,
        "pivotSideBridgeRemainingCompressedRows": remaining_compressed,
        "pivotSideBridgeWorstXCompressionMm": worst_remaining * 1000.0,
    }


def add_lid_pivot_support_ring(gltf: dict, bin_chunk: bytearray) -> dict:
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

    def to_world(row: list[float]) -> tuple[float, float, float]:
        return (
            (row[0] * scale_x) + translate_x,
            (row[1] * scale_y) + translate_y,
            (row[2] * scale_z) + translate_z,
        )

    def to_local(point: tuple[float, float, float]) -> list[float]:
        return [
            (point[0] - translate_x) / scale_x,
            (point[1] - translate_y) / scale_y,
            (point[2] - translate_z) / scale_z,
        ]

    groups, position_keys = build_welded_vertex_groups(positions)
    group_rows = {key: list(positions[members[0]]) for key, members in groups.items()}
    welded_neighbors = build_welded_group_neighbors(gltf, bin_chunk, primitive, position_keys)

    support_ring_radius = 0.00605
    support_ring_y = 0.00110
    outer_ring_y_candidates: list[float] = []
    outer_ring_radius_candidates: list[float] = []
    support_ring_keys: set[tuple[int, int, int]] = set()
    outer_anchor_keys: set[tuple[int, int, int]] = set()
    relax_keys: set[tuple[int, int, int]] = set()

    for key in groups:
        world_point = to_world(group_rows[key])
        rel_x = world_point[0] - hole_center[0]
        rel_z = world_point[2] - hole_center[2]
        radius = math.hypot(rel_x, rel_z)

        if (
            0.00068 <= world_point[1] <= 0.00090
            and 0.00720 <= radius <= 0.00738
        ):
            outer_anchor_keys.add(key)
            outer_ring_y_candidates.append(world_point[1])
            outer_ring_radius_candidates.append(radius)

        if (
            0.00065 <= world_point[1] <= 0.00090
            and 0.00558 <= radius <= 0.00580
        ):
            support_ring_keys.add(key)

        if (
            -0.00080 <= world_point[1] <= 0.00115
            and 0.00485 <= radius <= 0.00738
        ):
            relax_keys.add(key)

    if not support_ring_keys:
        return {
            "node": "Case_Lid_Shell",
            "pivotSupportRingRows": 0,
            "skipped": "No candidate support-ring rows found",
        }

    outer_ring_y = median(outer_ring_y_candidates) if outer_ring_y_candidates else 0.0007937000575475395
    outer_ring_radius = (
        median(outer_ring_radius_candidates) if outer_ring_radius_candidates else 0.007282
    )

    for key in support_ring_keys:
        world_point = to_world(group_rows[key])
        angle = math.atan2(world_point[2] - hole_center[2], world_point[0] - hole_center[0])
        group_rows[key] = to_local(
            (
                hole_center[0] + (math.cos(angle) * support_ring_radius),
                support_ring_y,
                hole_center[2] + (math.sin(angle) * support_ring_radius),
            )
        )

    for key in outer_anchor_keys:
        world_point = to_world(group_rows[key])
        angle = math.atan2(world_point[2] - hole_center[2], world_point[0] - hole_center[0])
        group_rows[key] = to_local(
            (
                hole_center[0] + (math.cos(angle) * outer_ring_radius),
                outer_ring_y,
                hole_center[2] + (math.sin(angle) * outer_ring_radius),
            )
        )

    relaxed_keys = 0
    for _ in range(6):
        next_group_rows = {key: list(row) for key, row in group_rows.items()}
        for key in relax_keys - support_ring_keys - outer_anchor_keys:
            neighbor_keys = [neighbor_key for neighbor_key in welded_neighbors[key] if neighbor_key in relax_keys]
            if len(neighbor_keys) < 3:
                continue

            world_point = to_world(group_rows[key])
            radius = math.hypot(world_point[0] - hole_center[0], world_point[2] - hole_center[2])
            if not (support_ring_radius <= radius <= outer_ring_radius):
                continue

            relax_weight = 0.12 * smoothstep(
                0.00495,
                support_ring_radius - 0.00010,
                radius,
            ) * (1.0 - smoothstep(outer_ring_radius - 0.00025, outer_ring_radius, radius))
            if relax_weight <= 1e-5:
                continue

            avg_x = sum(group_rows[neighbor_key][0] for neighbor_key in neighbor_keys) / len(neighbor_keys)
            avg_y = sum(group_rows[neighbor_key][1] for neighbor_key in neighbor_keys) / len(neighbor_keys)
            avg_z = sum(group_rows[neighbor_key][2] for neighbor_key in neighbor_keys) / len(neighbor_keys)
            next_group_rows[key][0] = group_rows[key][0] + ((avg_x - group_rows[key][0]) * relax_weight)
            next_group_rows[key][1] = group_rows[key][1] + ((avg_y - group_rows[key][1]) * (relax_weight * 0.7))
            next_group_rows[key][2] = group_rows[key][2] + ((avg_z - group_rows[key][2]) * relax_weight)
            relaxed_keys += 1
        group_rows = next_group_rows

    updated_rows = [list(row) for row in positions]
    for key, members in groups.items():
        group_row = group_rows[key]
        for row_index in members:
            updated_rows[row_index][0] = group_row[0]
            updated_rows[row_index][1] = group_row[1]
            updated_rows[row_index][2] = group_row[2]

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)

    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": "Case_Lid_Shell",
        "pivotSupportRingRows": sum(len(groups[key]) for key in support_ring_keys),
        "pivotSupportRingY": support_ring_y,
        "pivotSupportRingRadius": support_ring_radius,
        "pivotSupportOuterAnchorRows": sum(len(groups[key]) for key in outer_anchor_keys),
        "pivotSupportOuterRingY": outer_ring_y,
        "pivotSupportOuterRingRadius": outer_ring_radius,
        "pivotSupportRelaxedKeys": relaxed_keys,
    }


def collect_lid_pivot_region_points(gltf: dict, bin_chunk: bytearray) -> list[tuple[float, float, float, float]]:
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = shell_node.get("scale", [1.0, 1.0, 1.0])
    translation = shell_node.get("translation", [0.0, 0.0, 0.0])
    scale_x = float(scale[0])
    scale_y = float(scale[1])
    scale_z = float(scale[2])
    translate_x = float(translation[0])
    translate_y = float(translation[1])
    translate_z = float(translation[2])

    points: list[tuple[float, float, float, float]] = []
    for row in positions:
        world_x = (row[0] * scale_x) + translate_x
        world_y = (row[1] * scale_y) + translate_y
        world_z = (row[2] * scale_z) + translate_z
        rel_x = world_x - hole_center[0]
        rel_forward = world_z - hole_center[2]
        radius = math.hypot(rel_x, rel_forward)
        if (
            -0.0100 <= rel_x <= 0.0100
            and -0.0085 <= rel_forward <= 0.0090
            and -0.0040 <= world_y <= 0.0050
        ):
            points.append((rel_x, rel_forward, world_y, radius))

    return points


def write_lid_pivot_qa_image(source_glb: Path, output_glb: Path, image_path: Path) -> None:
    import matplotlib.pyplot as plt

    source_gltf, source_bin_chunk = parse_glb(source_glb)
    output_gltf, output_bin_chunk = parse_glb(output_glb)
    source_node_lookup = {node.get("name"): node for node in source_gltf["nodes"] if node.get("name")}
    output_node_lookup = {node.get("name"): node for node in output_gltf["nodes"] if node.get("name")}
    source_hole_center = tuple(float(value) for value in source_node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    output_hole_center = tuple(float(value) for value in output_node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    source_points = collect_lid_pivot_region_points(source_gltf, source_bin_chunk)
    output_points = collect_lid_pivot_region_points(output_gltf, output_bin_chunk)
    source_top_fans = collect_lid_pivot_top_fan_triangles(source_gltf, source_bin_chunk)
    output_top_fans = collect_lid_pivot_top_fan_triangles(output_gltf, output_bin_chunk)

    fig, axes = plt.subplots(2, 2, figsize=(10, 10), constrained_layout=True)
    panels = (
        (axes[0][0], source_points, source_top_fans, source_hole_center, "Source Top View", "y"),
        (axes[0][1], output_points, output_top_fans, output_hole_center, "Output Top View", "y"),
        (axes[1][0], source_points, "Source Section", "radius"),
        (axes[1][1], output_points, "Output Section", "radius"),
    )

    for panel in panels:
        if len(panel) == 6:
            axis, points, fan_triangles, hole_center, title, color_mode = panel
        else:
            axis, points, title, color_mode = panel
            fan_triangles = []
            hole_center = None
        if color_mode == "y":
            scatter = axis.scatter(
                [point[0] * 1000.0 for point in points],
                [point[1] * 1000.0 for point in points],
                c=[point[2] * 1000.0 for point in points],
                cmap="viridis",
                s=6,
                linewidths=0.0,
            )
            axis.set_xlabel("x (mm)")
            axis.set_ylabel("forward (mm)")
            axis.set_aspect("equal", adjustable="box")
            fig.colorbar(scatter, ax=axis, shrink=0.78, label="y (mm)")
            for triangle in fan_triangles:
                triangle_world = triangle["triangle_world"]
                loop_x = [((point[0] - hole_center[0]) * 1000.0) for point in triangle_world]
                loop_z = [((point[2] - hole_center[2]) * 1000.0) for point in triangle_world]
                loop_x.append(loop_x[0])
                loop_z.append(loop_z[0])
                axis.plot(loop_x, loop_z, color="#d81b60", linewidth=0.8, alpha=0.95)
        else:
            scatter = axis.scatter(
                [point[1] * 1000.0 for point in points],
                [point[2] * 1000.0 for point in points],
                c=[point[3] * 1000.0 for point in points],
                cmap="plasma",
                s=6,
                linewidths=0.0,
            )
            axis.set_xlabel("forward (mm)")
            axis.set_ylabel("y (mm)")
            fig.colorbar(scatter, ax=axis, shrink=0.78, label="radius (mm)")
        axis.set_title(title)
        axis.grid(True, alpha=0.25)

    image_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(image_path, dpi=220)
    plt.close(fig)


def collect_lid_pivot_stretched_upper_patch_offsets(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    world_positions = collect_shell_world_positions(positions, scale, translation)
    source_world_positions = collect_shell_world_positions(source_positions, scale, translation)

    groups, _ = build_welded_vertex_groups(positions)
    vertex_to_group = {row_index: key for key, members in groups.items() for row_index in members}
    edge_counts: dict[tuple[tuple[int, int, int], tuple[int, int, int]], int] = defaultdict(int)
    triangle_edges: list[list[tuple[tuple[int, int, int], tuple[int, int, int]]]] = []

    for triangle_start in range(0, len(positions), 3):
        tri_groups = [vertex_to_group[triangle_start + offset] for offset in range(3)]
        edges: list[tuple[tuple[int, int, int], tuple[int, int, int]]] = []
        for edge_start, edge_end in ((0, 1), (1, 2), (2, 0)):
            group_a = tri_groups[edge_start]
            group_b = tri_groups[edge_end]
            if group_a == group_b:
                continue
            edge_key = tuple(sorted((group_a, group_b)))
            edge_counts[edge_key] += 1
            edges.append(edge_key)
        triangle_edges.append(edges)

    candidate_offsets: list[int] = []
    for triangle_start in range(0, len(positions), 3):
        triangle_world = world_positions[triangle_start:triangle_start + 3]
        source_triangle_world = source_world_positions[triangle_start:triangle_start + 3]
        centroid_x = sum(point[0] for point in triangle_world) / 3.0
        centroid_y = sum(point[1] for point in triangle_world) / 3.0
        centroid_z = sum(point[2] for point in triangle_world) / 3.0
        rel_x = centroid_x - hole_center[0]
        forward = centroid_z - hole_center[2]
        radius = math.hypot(rel_x, forward)
        if not (
            -0.00070 <= centroid_y <= 0.00430
            and 0.00400 <= forward <= 0.01550
            and 0.00500 <= radius <= 0.01580
        ):
            continue

        isolated_edge_count = sum(
            1 for edge_key in triangle_edges[triangle_start // 3] if edge_counts[edge_key] == 1
        )
        if isolated_edge_count < 2:
            continue

        max_edge_span = max(
            math.dist(triangle_world[0], triangle_world[1]),
            math.dist(triangle_world[1], triangle_world[2]),
            math.dist(triangle_world[2], triangle_world[0]),
        )
        source_max_edge_span = max(
            math.dist(source_triangle_world[0], source_triangle_world[1]),
            math.dist(source_triangle_world[1], source_triangle_world[2]),
            math.dist(source_triangle_world[2], source_triangle_world[0]),
        )
        if max_edge_span < max(source_max_edge_span + 0.00025, source_max_edge_span * 1.25):
            continue

        candidate_offsets.append(triangle_start)

    return candidate_offsets


def collect_lid_pivot_upper_canopy_triangle_offsets(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    source_world_positions = collect_shell_world_positions(source_positions, scale, translation)
    candidate_offsets: list[int] = []

    for triangle_start in range(0, len(positions), 3):
        source_triangle_world = source_world_positions[triangle_start:triangle_start + 3]
        rel_points = [
            (point[0] - hole_center[0], point[1], point[2] - hole_center[2])
            for point in source_triangle_world
        ]
        centroid_x = sum(point[0] for point in rel_points) / 3.0
        centroid_y = sum(point[1] for point in rel_points) / 3.0
        centroid_forward = sum(point[2] for point in rel_points) / 3.0
        angle_from_front = angle_from_front_for_point(centroid_x, centroid_forward)
        edges_mm = [
            math.dist(source_triangle_world[0], source_triangle_world[1]) * 1000.0,
            math.dist(source_triangle_world[1], source_triangle_world[2]) * 1000.0,
            math.dist(source_triangle_world[2], source_triangle_world[0]) * 1000.0,
        ]

        if not (
            0.00370 <= centroid_y <= 0.00405
            and angle_from_front >= 22.0
            and max(edges_mm) >= 10.0
            and min(edges_mm) <= 1.2
            and max(point[2] for point in rel_points) >= 0.01350
            and min(point[2] for point in rel_points) <= 0.00600
        ):
            continue

        candidate_offsets.append(triangle_start)

    return candidate_offsets


def measure_lid_pivot_upper_canopy_width(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
    width_ratio_floor: float = 0.75,
) -> dict[str, float | int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    world_positions = collect_shell_world_positions(positions, scale, translation)
    source_world_positions = collect_shell_world_positions(source_positions, scale, translation)
    canopy_offsets = collect_lid_pivot_upper_canopy_triangle_offsets(gltf, bin_chunk, source_positions)
    width_ratios: list[float] = []
    compressed_rows = 0
    comparison_epsilon = 1e-6

    for triangle_start in canopy_offsets:
        source_triangle_world = source_world_positions[triangle_start:triangle_start + 3]
        short_edge = min(
            (
                (math.dist(source_triangle_world[0], source_triangle_world[1]), (0, 1)),
                (math.dist(source_triangle_world[1], source_triangle_world[2]), (1, 2)),
                (math.dist(source_triangle_world[2], source_triangle_world[0]), (2, 0)),
            ),
            key=lambda item: item[0],
        )[1]
        for local_index in short_edge:
            row_index = triangle_start + local_index
            source_rel_x = source_world_positions[row_index][0] - hole_center[0]
            current_rel_x = world_positions[row_index][0] - hole_center[0]
            if abs(source_rel_x) <= 1e-9:
                continue
            ratio = abs(current_rel_x) / abs(source_rel_x)
            width_ratios.append(ratio)
            if ratio + comparison_epsilon < width_ratio_floor:
                compressed_rows += 1

    if not width_ratios:
        return {
            "pivotUpperCanopyTriangles": 0,
            "pivotUpperCanopyCompressedRows": 0,
            "pivotUpperCanopyWidthRatioMin": 0.0,
            "pivotUpperCanopyWidthRatioMedian": 0.0,
        }

    return {
        "pivotUpperCanopyTriangles": len(canopy_offsets),
        "pivotUpperCanopyCompressedRows": compressed_rows,
        "pivotUpperCanopyWidthRatioMin": min(width_ratios),
        "pivotUpperCanopyWidthRatioMedian": median(width_ratios),
    }


def restore_lid_pivot_upper_canopy_width(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
    width_ratio_floor: float = 0.75,
) -> dict[str, object]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    source_world_positions = collect_shell_world_positions(source_positions, scale, translation)
    canopy_offsets = collect_lid_pivot_upper_canopy_triangle_offsets(gltf, bin_chunk, source_positions)
    if not canopy_offsets:
        return {
            "node": "Case_Lid_Shell",
            "pivotUpperCanopyTriangles": 0,
            "pivotUpperCanopyRowsRestored": 0,
            "pivotUpperCanopyCompressedRows": 0,
        }

    updated_rows = [list(row) for row in positions]
    restored_rows = 0

    for triangle_start in canopy_offsets:
        source_triangle_world = source_world_positions[triangle_start:triangle_start + 3]
        short_edge = min(
            (
                (math.dist(source_triangle_world[0], source_triangle_world[1]), (0, 1)),
                (math.dist(source_triangle_world[1], source_triangle_world[2]), (1, 2)),
                (math.dist(source_triangle_world[2], source_triangle_world[0]), (2, 0)),
            ),
            key=lambda item: item[0],
        )[1]
        for local_index in short_edge:
            row_index = triangle_start + local_index
            source_world = source_world_positions[row_index]
            current_world = local_point_to_world(positions[row_index], scale, translation)
            source_rel_x = source_world[0] - hole_center[0]
            current_rel_x = current_world[0] - hole_center[0]
            if abs(source_rel_x) <= 1e-9:
                continue

            target_abs_x = min(
                abs(source_rel_x),
                max(abs(current_rel_x), abs(source_rel_x) * width_ratio_floor),
            )
            if target_abs_x <= abs(current_rel_x) + 1e-9:
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

    canopy_stats = measure_lid_pivot_upper_canopy_width(
        gltf,
        bin_chunk,
        source_positions,
        width_ratio_floor=width_ratio_floor,
    )
    return {
        "node": "Case_Lid_Shell",
        "pivotUpperCanopyTriangles": len(canopy_offsets),
        "pivotUpperCanopyRowsRestored": restored_rows,
        **canopy_stats,
    }


def collect_lid_pivot_front_spine_triangle_offsets(
    gltf: dict,
    bin_chunk: bytearray,
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    scale, translation = get_node_scale_translation(shell_node)
    world_positions = collect_shell_world_positions(positions, scale, translation)
    triangles = collect_shell_triangle_indices(primitive, positions)

    candidate_offsets: list[int] = []
    for triangle_index, triangle in enumerate(triangles):
        points = [world_positions[index] for index in triangle]
        rel_points = [
            (point[0] - hole_center[0], point[1], point[2] - hole_center[2])
            for point in points
        ]
        centroid_x = sum(point[0] for point in rel_points) / 3.0
        centroid_y = sum(point[1] for point in rel_points) / 3.0
        centroid_forward = sum(point[2] for point in rel_points) / 3.0
        if not (
            0.00340 <= centroid_y <= 0.00415
            and abs(centroid_x) <= 0.00240
            and 0.00400 <= centroid_forward <= 0.01450
            and angle_from_front_for_point(centroid_x, centroid_forward) <= 22.0
        ):
            continue
        candidate_offsets.append(triangle_index * 3)
    return candidate_offsets


def collect_lid_pivot_front_spine_gap_triangle_offsets(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> list[int]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    groups, _ = build_welded_vertex_groups(positions)
    row_to_group = {row_index: key for key, members in groups.items() for row_index in members}
    cluster_groups = {
        key
        for cluster in collect_lid_pivot_front_spine_stitch_clusters(gltf, bin_chunk, source_positions)
        for key in cluster
    }
    if not cluster_groups:
        return []

    offsets: list[int] = []
    for triangle_start in range(0, len(positions), 3):
        triangle_groups = {row_to_group[triangle_start + offset] for offset in range(3)}
        if triangle_groups & cluster_groups:
            offsets.append(triangle_start)
    return offsets


def measure_lid_pivot_bore_spread(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict[str, object]:
    node_lookup = get_node_lookup(gltf)
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    if len(source_positions) != len(positions):
        raise ValueError("Source lid-shell positions do not match current mesh row count")

    scale, translation = get_node_scale_translation(shell_node)
    source_groups, source_descriptors, _ = collect_lid_pivot_source_groups(source_positions, shell_node, hole_center)
    spread_by_band: dict[str, float] = {}
    max_spread_mm = 0.0
    min_radius_mm = float("inf")

    for y_band in sorted({descriptor["y_band"] for descriptor in source_descriptors.values() if descriptor["surface"] == "bore"}):
        radii_mm: list[float] = []
        for key, descriptor in source_descriptors.items():
            if descriptor["surface"] != "bore" or descriptor["y_band"] != y_band:
                continue
            row_index = source_groups[key][0]
            current_world = local_point_to_world(positions[row_index], scale, translation)
            rel_x = current_world[0] - hole_center[0]
            forward = current_world[2] - hole_center[2]
            radii_mm.append(math.hypot(rel_x, forward) * 1000.0)
        if not radii_mm:
            continue
        spread_mm = max(radii_mm) - min(radii_mm)
        spread_by_band[f"{y_band:.4f}"] = spread_mm
        max_spread_mm = max(max_spread_mm, spread_mm)
        min_radius_mm = min(min_radius_mm, min(radii_mm))

    if min_radius_mm == float("inf"):
        min_radius_mm = 0.0

    return {
        "pivotBoreSpreadByBandMm": spread_by_band,
        "pivotBoreMaxRadialSpreadMm": max_spread_mm,
        "pivotBoreMinRadiusMm": min_radius_mm,
    }


def measure_lid_pivot_quality(
    gltf: dict,
    bin_chunk: bytearray,
    source_positions: list[list[float]],
) -> dict[str, object]:
    upper_patch_stretched = collect_lid_pivot_stretched_upper_patch_offsets(gltf, bin_chunk, source_positions)
    upper_canopy_stats = measure_lid_pivot_upper_canopy_width(gltf, bin_chunk, source_positions)
    side_corridors = collect_lid_pivot_side_corridor_offsets(gltf, bin_chunk)
    front_spine_gap_clusters = collect_lid_pivot_front_spine_stitch_clusters(gltf, bin_chunk, source_positions)
    front_spine_gap_triangles = collect_lid_pivot_front_spine_gap_triangle_offsets(
        gltf,
        bin_chunk,
        source_positions,
    )
    front_spine_triangles = collect_lid_pivot_front_spine_triangle_offsets(gltf, bin_chunk)
    residual_side_wedges = collect_lid_pivot_residual_side_wedge_offsets(gltf, bin_chunk, source_positions)
    bore_stats = measure_lid_pivot_bore_spread(gltf, bin_chunk, source_positions)
    return {
        "pivotUpperPatchStretchedTriangles": len(upper_patch_stretched),
        **upper_canopy_stats,
        "pivotSideCorridorTriangles": len(side_corridors),
        "pivotFrontSpineGapClusters": len(front_spine_gap_clusters),
        "pivotFrontSpineGapTriangles": len(front_spine_gap_triangles),
        "pivotFrontSpineTriangles": len(front_spine_triangles),
        "pivotResidualSideWedgesRemaining": len(residual_side_wedges),
        **bore_stats,
    }


def write_lid_pivot_qa_bundle(source_glb: Path, output_glb: Path, output_dir: Path) -> dict[str, str]:
    import matplotlib.pyplot as plt
    import matplotlib.collections as mc

    source_gltf, source_bin_chunk = parse_glb(source_glb)
    output_gltf, output_bin_chunk = parse_glb(output_glb)
    source_node_lookup = get_node_lookup(source_gltf)
    output_node_lookup = get_node_lookup(output_gltf)
    shell_node = output_node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(value) for value in output_node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    primitive = output_gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(output_gltf, output_bin_chunk, primitive["attributes"]["POSITION"])
    source_positions = read_accessor_rows(
        source_gltf,
        source_bin_chunk,
        source_gltf["meshes"][source_node_lookup["Case_Lid_Shell"]["mesh"]]["primitives"][0]["attributes"]["POSITION"],
    )

    scale, translation = get_node_scale_translation(shell_node)
    world_positions = collect_shell_world_positions(positions, scale, translation)
    triangles = collect_shell_triangle_indices(primitive, positions)
    stretched_offsets = set(collect_lid_pivot_stretched_upper_patch_offsets(output_gltf, output_bin_chunk, source_positions))
    upper_canopy_offsets = set(
        collect_lid_pivot_upper_canopy_triangle_offsets(output_gltf, output_bin_chunk, source_positions)
    )
    side_corridor_offsets = set(collect_lid_pivot_side_corridor_offsets(output_gltf, output_bin_chunk))
    front_spine_gap_offsets = set(
        collect_lid_pivot_front_spine_gap_triangle_offsets(output_gltf, output_bin_chunk, source_positions)
    )
    side_wedge_offsets = set(collect_lid_pivot_residual_side_wedge_offsets(output_gltf, output_bin_chunk, source_positions))

    def to_relative(point: tuple[float, float, float]) -> tuple[float, float, float]:
        return (point[0] - hole_center[0], point[1], point[2] - hole_center[2])

    def write_projection_image(
        image_path: Path,
        title: str,
        region_filter,
        project,
        xlim: tuple[float, float],
        ylim: tuple[float, float],
        highlight_offsets: set[int] | None = None,
        highlight_color: str = "#d32f2f",
        context_alpha: float = 0.55,
    ) -> None:
        normal_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        stretched_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        highlight_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        wedge_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []

        for triangle_index, triangle in enumerate(triangles):
            triangle_start = triangle_index * 3
            points = [world_positions[index] for index in triangle]
            if not region_filter(points):
                continue
            projected = [project(point) for point in points]
            segments = [
                (projected[0], projected[1]),
                (projected[1], projected[2]),
                (projected[2], projected[0]),
            ]
            if highlight_offsets is not None and triangle_start in highlight_offsets:
                highlight_segments.extend(segments)
            elif triangle_start in side_wedge_offsets:
                wedge_segments.extend(segments)
            elif triangle_start in stretched_offsets:
                stretched_segments.extend(segments)
            else:
                normal_segments.extend(segments)

        fig, axis = plt.subplots(figsize=(8, 8))
        if normal_segments:
            axis.add_collection(
                mc.LineCollection(normal_segments, linewidths=0.35, colors="#2b2b2b", alpha=context_alpha)
            )
        if stretched_segments:
            axis.add_collection(
                mc.LineCollection(stretched_segments, linewidths=0.8, colors="#d32f2f", alpha=0.92)
            )
        if highlight_segments:
            axis.add_collection(
                mc.LineCollection(highlight_segments, linewidths=1.1, colors=highlight_color, alpha=0.96)
            )
        if wedge_segments:
            axis.add_collection(
                mc.LineCollection(wedge_segments, linewidths=1.0, colors="#fb8c00", alpha=0.95)
            )
        axis.set_title(title)
        axis.set_xlim(xlim)
        axis.set_ylim(ylim)
        axis.set_aspect("equal", adjustable="box")
        axis.grid(True, alpha=0.18)
        fig.tight_layout()
        fig.savefig(image_path, dpi=220)
        plt.close(fig)

    output_dir.mkdir(parents=True, exist_ok=True)
    upper_patch_path = output_dir / "pivot_upper_patch_front.png"
    hole_wall_path = output_dir / "pivot_hole_wall_front.png"
    top_view_path = output_dir / "pivot_top_view.png"
    perspective_path = output_dir / "pivot_perspective_view.png"
    upper_canopy_mask_path = output_dir / "pivot_upper_canopy_mask.png"
    side_corridor_mask_path = output_dir / "pivot_side_corridor_mask.png"
    front_spine_gap_mask_path = output_dir / "pivot_front_spine_gap_mask.png"

    write_projection_image(
        upper_patch_path,
        "Pivot Upper Patch Front",
        region_filter=lambda points: (
            0.00320 <= max(point[1] for point in points)
            and min(point[2] - hole_center[2] for point in points) <= 0.01600
            and max(point[2] - hole_center[2] for point in points) >= 0.00250
            and max(abs(point[0] - hole_center[0]) for point in points) <= 0.01250
        ),
        project=lambda point: (
            (point[0] - hole_center[0]) * 1000.0,
            point[1] * 1000.0,
        ),
        xlim=(-12.5, 12.5),
        ylim=(3.2, 4.2),
    )
    write_projection_image(
        hole_wall_path,
        "Pivot Hole Wall Front",
        region_filter=lambda points: (
            max(point[1] for point in points) >= -0.00350
            and min(point[1] for point in points) <= 0.00420
            and max(
                math.hypot(point[0] - hole_center[0], point[2] - hole_center[2]) for point in points
            ) <= 0.00820
        ),
        project=lambda point: (
            (point[2] - hole_center[2]) * 1000.0,
            point[1] * 1000.0,
        ),
        xlim=(-5.5, 8.5),
        ylim=(-3.6, 4.2),
    )
    write_projection_image(
        top_view_path,
        "Pivot Top View",
        region_filter=lambda points: (
            max(abs(point[0] - hole_center[0]) for point in points) <= 0.01650
            and min(point[2] - hole_center[2] for point in points) <= 0.01650
            and max(point[2] - hole_center[2] for point in points) >= -0.00600
            and max(point[1] for point in points) <= 0.00430
        ),
        project=lambda point: (
            (point[0] - hole_center[0]) * 1000.0,
            (point[2] - hole_center[2]) * 1000.0,
        ),
        xlim=(-16.5, 16.5),
        ylim=(-6.5, 16.5),
    )
    write_projection_image(
        perspective_path,
        "Pivot Perspective",
        region_filter=lambda points: (
            max(abs(point[0] - hole_center[0]) for point in points) <= 0.01650
            and min(point[2] - hole_center[2] for point in points) <= 0.01650
            and max(point[2] - hole_center[2] for point in points) >= -0.00600
            and max(point[1] for point in points) <= 0.00430
        ),
        project=lambda point: (
            (to_relative(point)[0] * 1000.0) - (to_relative(point)[2] * 650.0),
            (to_relative(point)[1] * 1350.0) + (to_relative(point)[2] * 450.0),
        ),
        xlim=(-18.0, 18.0),
        ylim=(-5.0, 15.5),
    )
    write_projection_image(
        upper_canopy_mask_path,
        "Pivot Upper Canopy Mask",
        region_filter=lambda points: (
            0.00365 <= (sum(point[1] for point in points) / 3.0) <= 0.00410
            and max(point[2] - hole_center[2] for point in points) >= 0.01350
            and min(point[2] - hole_center[2] for point in points) <= 0.00600
            and angle_from_front_for_point(
                (sum(point[0] for point in points) / 3.0) - hole_center[0],
                (sum(point[2] for point in points) / 3.0) - hole_center[2],
            ) >= 22.0
        ),
        project=lambda point: (
            (point[0] - hole_center[0]) * 1000.0,
            point[1] * 1000.0,
        ),
        xlim=(-13.0, 13.0),
        ylim=(3.6, 4.1),
        highlight_offsets=upper_canopy_offsets,
        highlight_color="#8e24aa",
        context_alpha=0.12,
    )
    write_projection_image(
        side_corridor_mask_path,
        "Pivot Side Corridor Mask",
        region_filter=lambda points: (
            0.00355 <= (sum(point[1] for point in points) / 3.0) <= 0.00415
            and angle_from_front_for_point(
                (sum(point[0] for point in points) / 3.0) - hole_center[0],
                (sum(point[2] for point in points) / 3.0) - hole_center[2],
            ) >= 35.0
            and max(abs(point[0] - hole_center[0]) for point in points) <= 0.01300
            and min(point[2] - hole_center[2] for point in points) <= 0.01600
            and max(point[2] - hole_center[2] for point in points) >= -0.00100
        ),
        project=lambda point: (
            (point[0] - hole_center[0]) * 1000.0,
            point[1] * 1000.0,
        ),
        xlim=(-13.0, 13.0),
        ylim=(3.4, 4.2),
        highlight_offsets=side_corridor_offsets,
        highlight_color="#d32f2f",
        context_alpha=0.12,
    )
    write_projection_image(
        front_spine_gap_mask_path,
        "Pivot Front Spine Gap Mask",
        region_filter=lambda points: (
            0.00335 <= (sum(point[1] for point in points) / 3.0) <= 0.00415
            and abs((sum(point[0] for point in points) / 3.0) - hole_center[0]) <= 0.00260
            and 0.00380 <= (sum(point[2] for point in points) / 3.0) - hole_center[2] <= 0.01480
            and angle_from_front_for_point(
                (sum(point[0] for point in points) / 3.0) - hole_center[0],
                (sum(point[2] for point in points) / 3.0) - hole_center[2],
            ) <= 22.0
        ),
        project=lambda point: (
            (point[0] - hole_center[0]) * 1000.0,
            point[1] * 1000.0,
        ),
        xlim=(-3.0, 3.0),
        ylim=(3.3, 4.2),
        highlight_offsets=front_spine_gap_offsets,
        highlight_color="#1e88e5",
        context_alpha=0.18,
    )

    return {
        "pivotUpperPatchFront": str(upper_patch_path),
        "pivotHoleWallFront": str(hole_wall_path),
        "pivotTopView": str(top_view_path),
        "pivotPerspectiveView": str(perspective_path),
        "pivotUpperCanopyMask": str(upper_canopy_mask_path),
        "pivotSideCorridorMask": str(side_corridor_mask_path),
        "pivotFrontSpineGapMask": str(front_spine_gap_mask_path),
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


def weld_seam_vertices(gltf: dict, bin_chunk: bytearray) -> dict:
    """Snap vertices at nearly-identical positions to exact same coordinates, closing micro-gaps."""
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    groups, _ = build_welded_vertex_groups(positions)

    welded_vertices = 0
    welded_groups = 0
    for key, indices in groups.items():
        if len(indices) < 2:
            continue
        n = len(indices)
        cx = sum(positions[i][0] for i in indices) / n
        cy = sum(positions[i][1] for i in indices) / n
        cz = sum(positions[i][2] for i in indices) / n
        moved = False
        for i in indices:
            if positions[i][0] != cx or positions[i][1] != cy or positions[i][2] != cz:
                positions[i] = [cx, cy, cz]
                moved = True
        if moved:
            welded_vertices += n
            welded_groups += 1

    normals = recalculate_normals(gltf, bin_chunk, primitive, positions)
    write_accessor_rows(gltf, bin_chunk, position_accessor, positions)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, normals)
    update_accessor_min_max(gltf, position_accessor, positions)
    update_accessor_min_max(gltf, normal_accessor, normals)
    return {
        "node": "Case_Lid_Shell",
        "weldedVertices": welded_vertices,
        "weldedGroups": welded_groups,
    }


def relax_hole_region(gltf: dict, bin_chunk: bytearray) -> dict:
    """Gentle Laplacian relaxation on the hole transition zone to reduce sliver severity."""
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    hole_center = tuple(float(v) for v in node_lookup["Lid_Pivot_Hole_Center"]["translation"])

    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    scale = shell_node.get("scale", [1, 1, 1])
    translation = shell_node.get("translation", [0, 0, 0])
    sx, sy, sz = float(scale[0]), float(scale[1]), float(scale[2])
    tx, ty, tz = float(translation[0]), float(translation[1]), float(translation[2])

    groups, keys = build_welded_vertex_groups(positions)
    group_neighbors = build_welded_group_neighbors(gltf, bin_chunk, primitive, keys)

    # Compute group centroids in local space
    group_centroids: dict[tuple[int, int, int], list[float]] = {}
    for key, indices in groups.items():
        n = len(indices)
        group_centroids[key] = [
            sum(positions[i][0] for i in indices) / n,
            sum(positions[i][1] for i in indices) / n,
            sum(positions[i][2] for i in indices) / n,
        ]

    # Blend factor per group based on world-space distance from hole center
    bore_radius = LID_PIVOT_HOLE_BORE_RADIUS
    relax_inner = 0.009
    relax_outer = 0.016
    iterations = 5
    step = 0.25

    group_blend: dict[tuple[int, int, int], float] = {}
    for key, lc in group_centroids.items():
        wx = lc[0] * sx + tx
        wz = lc[2] * sz + tz
        r = math.sqrt((wx - hole_center[0]) ** 2 + (wz - hole_center[2]) ** 2)
        if r <= bore_radius or r >= relax_outer:
            group_blend[key] = 0.0
        else:
            group_blend[key] = 1.0 - smoothstep(relax_inner, relax_outer, r)

    # Laplacian iterations in local space (XZ only, preserve Y)
    current = {k: list(v) for k, v in group_centroids.items()}
    for _ in range(iterations):
        updated: dict[tuple[int, int, int], list[float]] = {}
        for key, centroid in current.items():
            blend = group_blend.get(key, 0.0)
            if blend <= 0.0:
                updated[key] = centroid
                continue
            nbrs = [current[nk] for nk in group_neighbors.get(key, set()) if nk in current]
            if not nbrs:
                updated[key] = centroid
                continue
            avg_x = sum(p[0] for p in nbrs) / len(nbrs)
            avg_z = sum(p[2] for p in nbrs) / len(nbrs)
            b = step * blend
            updated[key] = [
                centroid[0] + (avg_x - centroid[0]) * b,
                centroid[1],
                centroid[2] + (avg_z - centroid[2]) * b,
            ]
        current = updated

    # Apply deltas to vertices
    moved = 0
    for key, indices in groups.items():
        old = group_centroids[key]
        new = current[key]
        dx = new[0] - old[0]
        dz = new[2] - old[2]
        if abs(dx) < 1e-12 and abs(dz) < 1e-12:
            continue
        for i in indices:
            positions[i][0] += dx
            positions[i][2] += dz
            moved += 1

    normals = recalculate_normals(gltf, bin_chunk, primitive, positions)
    write_accessor_rows(gltf, bin_chunk, position_accessor, positions)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, normals)
    update_accessor_min_max(gltf, position_accessor, positions)
    update_accessor_min_max(gltf, normal_accessor, normals)
    return {
        "node": "Case_Lid_Shell",
        "relaxedKeys": sum(1 for b in group_blend.values() if b > 0),
        "movedVertices": moved,
        "iterations": iterations,
    }


def smooth_shell_normals(gltf: dict, bin_chunk: bytearray) -> dict:
    """Final normal smoothing: blend each vertex normal with compatible neighbors."""
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    result: dict[str, int] = {}

    for node_name in ("Case_Lid_Shell", "Case_Base_Shell"):
        node = node_lookup[node_name]
        primitive = gltf["meshes"][node["mesh"]]["primitives"][0]
        position_accessor = primitive["attributes"]["POSITION"]
        normal_accessor = primitive["attributes"]["NORMAL"]
        positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

        # Start from area-weighted normals
        normals = recalculate_normals(gltf, bin_chunk, primitive, positions)

        groups, keys = build_welded_vertex_groups(positions)
        group_neighbors = build_welded_group_neighbors(gltf, bin_chunk, primitive, keys)

        # Compute average normal per group
        group_normals: dict[tuple[int, int, int], list[float]] = {}
        for key, indices in groups.items():
            n = len(indices)
            group_normals[key] = [
                sum(normals[i][0] for i in indices) / n,
                sum(normals[i][1] for i in indices) / n,
                sum(normals[i][2] for i in indices) / n,
            ]

        # One pass of neighbor blending with crease preservation
        normal_blend = 0.3
        crease_dot_threshold = 0.5  # ~60 degrees — don't blend across sharp edges
        smoothed: dict[tuple[int, int, int], list[float]] = {}
        for key, normal in group_normals.items():
            nbr_keys = group_neighbors.get(key, set())
            compatible = []
            for nk in nbr_keys:
                nn = group_normals.get(nk)
                if nn is None:
                    continue
                dot = normal[0] * nn[0] + normal[1] * nn[1] + normal[2] * nn[2]
                if dot > crease_dot_threshold:
                    compatible.append(nn)
            if not compatible:
                smoothed[key] = normal
                continue
            avg_nx = sum(n[0] for n in compatible) / len(compatible)
            avg_ny = sum(n[1] for n in compatible) / len(compatible)
            avg_nz = sum(n[2] for n in compatible) / len(compatible)
            blended = [
                normal[0] + (avg_nx - normal[0]) * normal_blend,
                normal[1] + (avg_ny - normal[1]) * normal_blend,
                normal[2] + (avg_nz - normal[2]) * normal_blend,
            ]
            length = math.sqrt(blended[0] ** 2 + blended[1] ** 2 + blended[2] ** 2)
            if length > 1e-10:
                smoothed[key] = [blended[0] / length, blended[1] / length, blended[2] / length]
            else:
                smoothed[key] = [0.0, 0.0, 0.0]

        # Apply to all vertices
        for i, row in enumerate(positions):
            key = quantize_key(tuple(float(v) for v in row))
            sn = smoothed.get(key)
            if sn is not None:
                normals[i] = list(sn)

        write_accessor_rows(gltf, bin_chunk, normal_accessor, normals)
        update_accessor_min_max(gltf, normal_accessor, normals)
        result[node_name] = len(positions)

    return {"normalSmoothing": result}


def hide_collapsed_triangles(gltf: dict, bin_chunk: bytearray) -> dict:
    """Zero normals for degenerate triangles (collapsed or near-zero area)."""
    node_lookup = {node.get("name"): node for node in gltf["nodes"] if node.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    primitive = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    normals = read_accessor_rows(gltf, bin_chunk, normal_accessor)

    hidden = 0
    for i in range(0, len(positions), 3):
        p0, p1, p2 = positions[i], positions[i + 1], positions[i + 2]
        if p0 == p1 == p2:
            normals[i] = [0.0, 0.0, 0.0]
            normals[i + 1] = [0.0, 0.0, 0.0]
            normals[i + 2] = [0.0, 0.0, 0.0]
            hidden += 1
            continue
        edge_a = subtract(tuple(p1), tuple(p0))
        edge_b = subtract(tuple(p2), tuple(p0))
        face_cross = cross(edge_a, edge_b)
        area_sq = face_cross[0] ** 2 + face_cross[1] ** 2 + face_cross[2] ** 2
        if area_sq < 1e-20:
            normals[i] = [0.0, 0.0, 0.0]
            normals[i + 1] = [0.0, 0.0, 0.0]
            normals[i + 2] = [0.0, 0.0, 0.0]
            hidden += 1

    write_accessor_rows(gltf, bin_chunk, normal_accessor, normals)
    update_accessor_min_max(gltf, normal_accessor, normals)
    return {"node": "Case_Lid_Shell", "hiddenCollapsedTriangles": hidden}


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
    parser.add_argument(
        "--pivot-qa-image",
        type=Path,
        help="Optional PNG path for a combined before/after lid-pivot QA visualization.",
    )
    parser.add_argument(
        "--pivot-qa-dir",
        type=Path,
        default=Path("output/debug_capsule"),
        help="Directory for the fixed lid-pivot QA image bundle and candidate output.",
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
    lid_hole_center = tuple(float(value) for value in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    lid_hole_protection = (
        ProtectedSphere(
            center=lid_hole_center,
            inner_radius=0.0105,
            outer_radius=0.0180,
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
    reports.append(rebuild_lid_pivot_cap_and_hole(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(reroute_lid_pivot_side_corridors(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(restore_lid_pivot_upper_canopy_width(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(clear_lid_pivot_residual_side_wedges(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(stitch_lid_pivot_front_spine(gltf, bin_chunk, original_lid_shell_positions))
    reports.append(weld_seam_vertices(gltf, bin_chunk))
    reports.append(smooth_shell_normals(gltf, bin_chunk))
    reports.append(hide_collapsed_triangles(gltf, bin_chunk))

    source_gltf, source_bin_chunk = parse_glb(args.input)
    source_node_lookup = get_node_lookup(source_gltf)
    source_lid_primitive = source_gltf["meshes"][source_node_lookup["Case_Lid_Shell"]["mesh"]]["primitives"][0]
    source_lid_positions = read_accessor_rows(
        source_gltf,
        source_bin_chunk,
        source_lid_primitive["attributes"]["POSITION"],
    )
    baseline_quality = measure_lid_pivot_quality(source_gltf, source_bin_chunk, source_lid_positions)
    candidate_quality = measure_lid_pivot_quality(gltf, bin_chunk, original_lid_shell_positions)

    failures: list[str] = []
    if int(candidate_quality["pivotUpperCanopyCompressedRows"]) != 0:
        failures.append(
            f"Upper canopy still inherits compressed source handling: {candidate_quality['pivotUpperCanopyCompressedRows']}"
        )
    if int(candidate_quality["pivotSideCorridorTriangles"]) != 0:
        failures.append(
            f"Side corridors remain in the forbidden side window: {candidate_quality['pivotSideCorridorTriangles']}"
        )
    if int(candidate_quality["pivotFrontSpineGapTriangles"]) != 0:
        failures.append(
            f"Front spine gap candidates remain: {candidate_quality['pivotFrontSpineGapTriangles']}"
        )
    if int(candidate_quality["pivotFrontSpineGapClusters"]) != 0:
        failures.append(
            f"Front spine stitch clusters remain unresolved: {candidate_quality['pivotFrontSpineGapClusters']}"
        )
    if int(candidate_quality["pivotResidualSideWedgesRemaining"]) != 0:
        failures.append(
            f"Residual side wedges remain: {candidate_quality['pivotResidualSideWedgesRemaining']}"
        )
    if int(candidate_quality["pivotUpperPatchStretchedTriangles"]) > int(
        baseline_quality["pivotUpperPatchStretchedTriangles"]
    ):
        failures.append(
            "Upper patch still contains stretched bridge triangles relative to the source baseline"
        )
    front_spine_floor = max(1, math.ceil(float(baseline_quality["pivotFrontSpineTriangles"]) * 0.6))
    if int(candidate_quality["pivotFrontSpineTriangles"]) < front_spine_floor:
        failures.append(
            "Front spine continuity regressed: too few front-spine triangles remain after cleanup"
        )

    bore_spread_limit = max(float(baseline_quality["pivotBoreMaxRadialSpreadMm"]) + 0.05, 0.08)
    if float(candidate_quality["pivotBoreMaxRadialSpreadMm"]) > bore_spread_limit:
        failures.append(
            f"Pivot bore radial spread is too large: {candidate_quality['pivotBoreMaxRadialSpreadMm']:.4f} mm"
        )

    bore_radius_floor = float(baseline_quality["pivotBoreMinRadiusMm"]) - 0.05
    if float(candidate_quality["pivotBoreMinRadiusMm"]) < bore_radius_floor:
        failures.append(
            f"Pivot bore minimum radius regressed: {candidate_quality['pivotBoreMinRadiusMm']:.4f} mm"
        )

    candidate_output = args.pivot_qa_dir / f"{args.output.stem}_candidate.glb"
    write_glb(candidate_output, gltf, bin_chunk)
    qa_images = write_lid_pivot_qa_bundle(args.input, candidate_output, args.pivot_qa_dir)
    if args.pivot_qa_image is not None:
        write_lid_pivot_qa_image(args.input, candidate_output, args.pivot_qa_image)

    if failures:
        raise RuntimeError(" | ".join(failures))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    write_glb(args.output, gltf, bin_chunk)
    result = {
        "output": str(args.output),
        "candidateOutput": str(candidate_output),
        "reports": reports,
        "pivotQualityBaseline": baseline_quality,
        "pivotQualityCandidate": candidate_quality,
        "pivotQaImages": qa_images,
    }
    if args.pivot_qa_image is not None:
        result["pivotQaImage"] = str(args.pivot_qa_image)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
