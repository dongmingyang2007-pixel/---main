from __future__ import annotations

import argparse
import hashlib
import json
import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import numpy as np


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
REQUIRED_NODE_NAMES = (
    "QIHANG_Product",
    "Case_Base",
    "Case_Lid",
    "Case_Lid_Pivot",
    "Case_Base_Shell",
    "Case_Lid_Shell",
    "Earbud_Left",
    "Earbud_Right",
    "Brooch_Camera",
    "Pivot_Pin_Printable",
    "Lid_Pivot_Hole_Center",
    "DockWell_L",
    "DockWell_R",
)
REPORT_PARTS = (
    "Case_Base_Shell",
    "Case_Lid_Shell",
    "Earbud_Left",
    "Earbud_Right",
    "Brooch_Camera",
    "Pivot_Pin_Printable",
)
ROTATABLE_TOP_LEVEL_NODES = (
    "Case_Base",
    "Case_Lid_Pivot",
)


@dataclass(frozen=True)
class AccessorInfo:
    accessor: dict
    view: dict
    component_count: int
    component_size: int
    stride: int
    offset: int
    count: int


def pad_to_4(data: bytes, fill: bytes) -> bytes:
    padding = (-len(data)) % 4
    return data + (fill * padding)


def sha256_for_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


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


def get_named_node_indices(gltf: dict) -> dict[str, int]:
    return {
        node.get("name"): index
        for index, node in enumerate(gltf["nodes"])
        if node.get("name")
    }


def build_parent_lookup(gltf: dict) -> dict[int, int]:
    parent_lookup: dict[int, int] = {}
    for parent_index, node in enumerate(gltf["nodes"]):
        for child_index in node.get("children", []):
            parent_lookup[child_index] = parent_index
    return parent_lookup


def quaternion_to_matrix(quaternion: list[float]) -> np.ndarray:
    x, y, z, w = (float(value) for value in quaternion)
    xx = x * x
    yy = y * y
    zz = z * z
    xy = x * y
    xz = x * z
    yz = y * z
    wx = w * x
    wy = w * y
    wz = w * z
    return np.array(
        [
            [1.0 - (2.0 * (yy + zz)), 2.0 * (xy - wz), 2.0 * (xz + wy), 0.0],
            [2.0 * (xy + wz), 1.0 - (2.0 * (xx + zz)), 2.0 * (yz - wx), 0.0],
            [2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - (2.0 * (xx + yy)), 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        dtype=float,
    )


def quaternion_multiply(left: list[float], right: list[float]) -> list[float]:
    lx, ly, lz, lw = (float(value) for value in left)
    rx, ry, rz, rw = (float(value) for value in right)
    return [
        (lw * rx) + (lx * rw) + (ly * rz) - (lz * ry),
        (lw * ry) - (lx * rz) + (ly * rw) + (lz * rx),
        (lw * rz) + (lx * ry) - (ly * rx) + (lz * rw),
        (lw * rw) - (lx * rx) - (ly * ry) - (lz * rz),
    ]


def quaternion_about_y(degrees: float) -> list[float]:
    radians = np.deg2rad(float(degrees))
    half_angle = radians * 0.5
    return [0.0, float(np.sin(half_angle)), 0.0, float(np.cos(half_angle))]


def rotate_vector_about_y(values: list[float], degrees: float) -> list[float]:
    radians = np.deg2rad(float(degrees))
    cos_theta = float(np.cos(radians))
    sin_theta = float(np.sin(radians))
    x_value = float(values[0])
    y_value = float(values[1])
    z_value = float(values[2])
    return [
        (x_value * cos_theta) + (z_value * sin_theta),
        y_value,
        (-x_value * sin_theta) + (z_value * cos_theta),
    ]


def get_local_matrix(node: dict) -> np.ndarray:
    if "matrix" in node:
        return np.array(node["matrix"], dtype=float).reshape((4, 4), order="F")

    translation = node.get("translation", [0.0, 0.0, 0.0])
    rotation = node.get("rotation", [0.0, 0.0, 0.0, 1.0])
    scale = node.get("scale", [1.0, 1.0, 1.0])

    translation_matrix = np.eye(4, dtype=float)
    translation_matrix[:3, 3] = np.array(translation, dtype=float)
    scale_matrix = np.diag([float(scale[0]), float(scale[1]), float(scale[2]), 1.0])
    rotation_matrix = quaternion_to_matrix(rotation)
    return translation_matrix @ rotation_matrix @ scale_matrix


def collect_subtree_node_indices(gltf: dict, root_index: int) -> list[int]:
    stack = [root_index]
    collected: list[int] = []
    while stack:
        node_index = stack.pop()
        collected.append(node_index)
        stack.extend(reversed(gltf["nodes"][node_index].get("children", [])))
    return collected


def transform_points(points: list[list[float]], matrix: np.ndarray) -> list[np.ndarray]:
    transformed: list[np.ndarray] = []
    for row in points:
        local = np.array([float(row[0]), float(row[1]), float(row[2]), 1.0], dtype=float)
        world = matrix @ local
        transformed.append(world[:3] / max(world[3], 1e-12))
    return transformed


def read_triangles_for_mesh(
    gltf: dict,
    bin_chunk: bytearray,
    mesh_index: int,
    world_matrix: np.ndarray,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    mesh = gltf["meshes"][mesh_index]
    for primitive in mesh["primitives"]:
        if primitive.get("mode", 4) != 4:
            continue

        positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
        world_positions = transform_points(positions, world_matrix)
        if "indices" in primitive:
            indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
        else:
            indices = list(range(len(world_positions)))

        for index_offset in range(0, len(indices), 3):
            i0, i1, i2 = indices[index_offset : index_offset + 3]
            p0 = world_positions[i0]
            p1 = world_positions[i1]
            p2 = world_positions[i2]
            if np.allclose(p0, p1) or np.allclose(p1, p2) or np.allclose(p0, p2):
                continue
            triangles.append((p0, p1, p2))
    return triangles


def compute_bbox(points: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    stacked = np.stack(points, axis=0)
    return stacked.min(axis=0), stacked.max(axis=0)


def vector_to_mm_list(values: np.ndarray) -> list[float]:
    return [round(float(value) * 1000.0, 4) for value in values]


def validate_required_nodes(named_node_indices: dict[str, int]) -> None:
    missing = [name for name in REQUIRED_NODE_NAMES if name not in named_node_indices]
    if missing:
        raise ValueError(f"Input GLB is missing required nodes: {missing}")


def apply_horizontal_case_rotation(gltf: dict, degrees: float) -> list[dict[str, object]]:
    named_node_indices = get_named_node_indices(gltf)
    validate_required_nodes(named_node_indices)
    rotation_quaternion = quaternion_about_y(degrees)
    change_log: list[dict[str, object]] = []

    for node_name in ROTATABLE_TOP_LEVEL_NODES:
        node = gltf["nodes"][named_node_indices[node_name]]
        if "matrix" in node:
            raise ValueError(f"Node {node_name} uses matrix transforms; horizontal rotation expects TRS.")

        original_translation = [float(value) for value in node.get("translation", [0.0, 0.0, 0.0])]
        original_rotation = [float(value) for value in node.get("rotation", [0.0, 0.0, 0.0, 1.0])]

        rotated_translation = rotate_vector_about_y(original_translation, degrees)
        rotated_rotation = quaternion_multiply(rotation_quaternion, original_rotation)

        node["translation"] = rotated_translation
        node["rotation"] = rotated_rotation
        change_log.append(
            {
                "node": node_name,
                "translationBefore": [round(value, 8) for value in original_translation],
                "translationAfter": [round(value, 8) for value in rotated_translation],
                "rotationBefore": [round(value, 8) for value in original_rotation],
                "rotationAfter": [round(value, 8) for value in rotated_rotation],
            }
        )

    return change_log


def build_baseline_report(
    model_path: Path,
    gltf: dict,
    bin_chunk: bytearray,
) -> dict:
    named_node_indices = get_named_node_indices(gltf)
    validate_required_nodes(named_node_indices)
    parent_lookup = build_parent_lookup(gltf)
    product_root_index = named_node_indices["QIHANG_Product"]

    @lru_cache(maxsize=None)
    def get_world_matrix(node_index: int) -> np.ndarray:
        node = gltf["nodes"][node_index]
        local_matrix = get_local_matrix(node)
        parent_index = parent_lookup.get(node_index)
        if parent_index is None:
            return local_matrix
        return get_world_matrix(parent_index) @ local_matrix

    product_inverse = np.linalg.inv(get_world_matrix(product_root_index))

    def get_product_local_origin(node_name: str) -> np.ndarray:
        node_index = named_node_indices[node_name]
        product_local = product_inverse @ get_world_matrix(node_index) @ np.array([0.0, 0.0, 0.0, 1.0], dtype=float)
        return product_local[:3] / max(product_local[3], 1e-12)

    node_summaries: dict[str, dict[str, object]] = {}
    for node_name in REQUIRED_NODE_NAMES:
        node_index = named_node_indices[node_name]
        node = gltf["nodes"][node_index]
        parent_name = None
        if node_index in parent_lookup:
            parent_name = gltf["nodes"][parent_lookup[node_index]].get("name")
        children = [gltf["nodes"][child_index].get("name") for child_index in node.get("children", [])]
        node_summaries[node_name] = {
            "index": node_index,
            "parent": parent_name,
            "children": children,
            "mesh": node.get("mesh"),
            "translation": [round(float(value), 8) for value in node.get("translation", [])],
            "rotation": [round(float(value), 8) for value in node.get("rotation", [])],
            "scale": [round(float(value), 8) for value in node.get("scale", [])],
            "productLocalOriginMm": vector_to_mm_list(get_product_local_origin(node_name)),
        }

    part_reports: dict[str, dict[str, object]] = {}
    for part_name in REPORT_PARTS:
        root_index = named_node_indices[part_name]
        points: list[np.ndarray] = []
        for node_index in collect_subtree_node_indices(gltf, root_index):
            node = gltf["nodes"][node_index]
            mesh_index = node.get("mesh")
            if mesh_index is None:
                continue
            triangles = read_triangles_for_mesh(gltf, bin_chunk, mesh_index, product_inverse @ get_world_matrix(node_index))
            for triangle in triangles:
                points.extend(triangle)
        if not points:
            continue
        mins, maxs = compute_bbox(points)
        part_reports[part_name] = {
            "bboxMinMm": vector_to_mm_list(mins),
            "bboxMaxMm": vector_to_mm_list(maxs),
            "bboxSizeMm": vector_to_mm_list(maxs - mins),
            "bboxCenterMm": vector_to_mm_list((mins + maxs) * 0.5),
        }

    model_bytes = model_path.read_bytes()
    scene_root_indices = gltf["scenes"][gltf.get("scene", 0)]["nodes"]
    report = {
        "modelGlbPath": str(model_path),
        "modelGlbSha256": sha256_for_bytes(model_bytes),
        "asset": gltf.get("asset", {}),
        "counts": {
            "scenes": len(gltf.get("scenes", [])),
            "nodes": len(gltf.get("nodes", [])),
            "meshes": len(gltf.get("meshes", [])),
            "materials": len(gltf.get("materials", [])),
            "bufferViews": len(gltf.get("bufferViews", [])),
            "accessors": len(gltf.get("accessors", [])),
            "animations": len(gltf.get("animations", [])),
            "binBytes": len(bin_chunk),
        },
        "sceneRoots": [gltf["nodes"][index].get("name") for index in scene_root_indices],
        "requiredNodeSummaries": node_summaries,
        "partBoundingBoxes": part_reports,
        "hierarchyGuards": {
            "QIHANG_Product_children": node_summaries["QIHANG_Product"]["children"],
            "Case_Base_children": node_summaries["Case_Base"]["children"],
            "Case_Lid_Pivot_children": node_summaries["Case_Lid_Pivot"]["children"],
            "Case_Lid_children": node_summaries["Case_Lid"]["children"],
        },
    }
    return report


def bootstrap_v3(input_path: Path, output_path: Path) -> str:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(input_path.read_bytes())
    return sha256_for_bytes(output_path.read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Bootstrap and validate qihang_product_pearl_V3.glb from the V2 baseline."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("apps/web/public/qihang_product_pearl_V2.glb"),
        help="Immutable V2 source GLB path.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("apps/web/public/qihang_product_pearl_V3.glb"),
        help="Versioned V3 output GLB path.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("output/debug_v3/qihang_product_pearl_V3_baseline.json"),
        help="JSON report path for the locked V3 baseline.",
    )
    parser.add_argument(
        "--report-only",
        action="store_true",
        help="Validate and write the report without writing the V3 GLB file.",
    )
    parser.add_argument(
        "--rotate-y-deg",
        type=float,
        default=90.0,
        help="Rotate the full case layout around product-local Y to make the box horizontal.",
    )
    args = parser.parse_args()

    gltf, bin_chunk = parse_glb(args.input)
    change_log = apply_horizontal_case_rotation(gltf, args.rotate_y_deg)

    output_sha = None
    if not args.report_only:
        output_sha = bootstrap_v3(args.input, args.output)
        write_glb(args.output, gltf, bin_chunk)
        output_sha = sha256_for_bytes(args.output.read_bytes())
        report_gltf, report_bin_chunk = parse_glb(args.output)
        report = build_baseline_report(args.output, report_gltf, report_bin_chunk)
    else:
        report = build_baseline_report(args.input, gltf, bin_chunk)

    report["sourceInputPath"] = str(args.input)
    report["sourceInputSha256"] = sha256_for_bytes(args.input.read_bytes())
    report["v3RotationDegreesY"] = args.rotate_y_deg
    report["topLevelRotationChangeLog"] = change_log
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {
        "input": str(args.input),
        "output": None if args.report_only else str(args.output),
        "report": str(args.report),
        "inputSha256": report["sourceInputSha256"],
        "outputSha256": output_sha,
        "rotateYDeg": args.rotate_y_deg,
        "sceneRoots": report["sceneRoots"],
        "requiredNodes": list(report["requiredNodeSummaries"].keys()),
        "topLevelRotationChangeLog": change_log,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
