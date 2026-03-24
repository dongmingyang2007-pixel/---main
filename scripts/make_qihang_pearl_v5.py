from __future__ import annotations

import argparse
import json
import struct
from collections import defaultdict, deque
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import matplotlib.collections as mc
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import to_rgba

from make_qihang_pearl_v4 import (
    append_accessor,
    append_aligned_bytes,
    append_buffer_view,
    build_baseline_report,
    compute_rows_min_max,
    parse_glb,
    read_accessor_rows,
    read_accessor_scalars,
    sha256_for_bytes,
)


AXIS_LABELS = ("X", "Y", "Z")
PHASE_NAMES = {
    1: "baseline_six_view_diagnostics",
    2: "remove_front_right_sidewall",
}


@dataclass(frozen=True)
class PartSpec:
    label: str
    node_name: str
    color: str
    line_width: float
    include_subtree: bool = False


@dataclass(frozen=True)
class ViewSpec:
    title: str
    dims: tuple[int, int]
    depth_axis: int
    camera_sign: int


PART_SPECS = (
    PartSpec("Base Shell", "Case_Base_Shell", "#4b5563", 0.22),
    PartSpec("Base Platform", "Case_Base_Platform_V4", "#c2410c", 0.40),
    PartSpec("Base Ramp", "Case_Base_Arc_Ramp_V4", "#f59e0b", 0.35),
)

VIEW_SPECS = (
    ViewSpec("Front View (camera +Z)", dims=(0, 1), depth_axis=2, camera_sign=1),
    ViewSpec("Back View (camera -Z)", dims=(0, 1), depth_axis=2, camera_sign=-1),
    ViewSpec("Right View (camera +X)", dims=(2, 1), depth_axis=0, camera_sign=1),
    ViewSpec("Left View (camera -X)", dims=(2, 1), depth_axis=0, camera_sign=-1),
    ViewSpec("Top View (camera +Y)", dims=(0, 2), depth_axis=1, camera_sign=1),
    ViewSpec("Bottom View (camera -Y)", dims=(0, 2), depth_axis=1, camera_sign=-1),
)

HEURISTIC_X_RANGE_MM = (6.0, 36.0)
HEURISTIC_Y_RANGE_MM = (-0.6, 9.35)
HEURISTIC_ABS_Z_RANGE_MM = (13.0, 16.25)
HEURISTIC_NORMAL_Z_ABS_MIN = 0.7
HEURISTIC_NORMAL_Y_ABS_MAX = 0.3
FRONT_RIGHT_WALL_X_RANGE_MM = (31.8, 43.8)
FRONT_RIGHT_WALL_Y_RANGE_MM = (-0.5, 9.45)
FRONT_RIGHT_WALL_Z_RANGE_MM = (-0.7, 15.65)
EXPECTED_FRONT_RIGHT_WALL_TRIANGLE_COUNT = 84


def default_output_path(phase: int) -> Path:
    return Path(f"output/debug_v5/qihang_product_pearl_phase{phase}.glb")


def default_report_path(phase: int) -> Path:
    return Path(f"output/debug_v5/qihang_product_pearl_phase{phase}.json")


def default_sheet_path(phase: int) -> Path:
    return Path(f"output/debug_v5/qihang_product_pearl_phase{phase}_six_views.png")


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


def triangle_normal(triangle: tuple[np.ndarray, np.ndarray, np.ndarray]) -> np.ndarray:
    point_a, point_b, point_c = triangle
    normal = np.cross(point_b - point_a, point_c - point_a)
    length = float(np.linalg.norm(normal))
    if length <= 1e-12:
        return np.zeros(3, dtype=float)
    return normal / length


def project_point(point: np.ndarray, dims: tuple[int, int]) -> tuple[float, float]:
    return (float(point[dims[0]] * 1000.0), float(point[dims[1]] * 1000.0))


def vector_to_mm_list(values: np.ndarray) -> list[float]:
    return [round(float(value) * 1000.0, 4) for value in values]


def triangle_matches_side_candidate(
    triangle: tuple[np.ndarray, np.ndarray, np.ndarray],
    *,
    side_sign: int,
) -> bool:
    xs_mm = [float(point[0]) * 1000.0 for point in triangle]
    ys_mm = [float(point[1]) * 1000.0 for point in triangle]
    zs_mm = [float(point[2]) * 1000.0 for point in triangle]

    if min(xs_mm) < HEURISTIC_X_RANGE_MM[0] or max(xs_mm) > HEURISTIC_X_RANGE_MM[1]:
        return False
    if min(ys_mm) < HEURISTIC_Y_RANGE_MM[0] or max(ys_mm) > HEURISTIC_Y_RANGE_MM[1]:
        return False

    abs_zs_mm = [abs(value) for value in zs_mm]
    if min(abs_zs_mm) < HEURISTIC_ABS_Z_RANGE_MM[0] or max(abs_zs_mm) > HEURISTIC_ABS_Z_RANGE_MM[1]:
        return False

    center_z_mm = sum(zs_mm) / 3.0
    if side_sign == 1 and center_z_mm <= 0.0:
        return False
    if side_sign == -1 and center_z_mm >= 0.0:
        return False

    normal = triangle_normal(triangle)
    if abs(float(normal[1])) > HEURISTIC_NORMAL_Y_ABS_MAX:
        return False
    if abs(float(normal[2])) < HEURISTIC_NORMAL_Z_ABS_MIN:
        return False

    if side_sign == 1:
        return float(normal[2]) < 0.0
    return float(normal[2]) > 0.0


def analyze_shell_candidate_components(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_vertex_ids: list[tuple[int, int, int]] = []
    vertex_key_to_id: dict[tuple[float, float, float], int] = {}

    for triangle in shell_triangles:
        vertex_ids: list[int] = []
        for point in triangle:
            key = tuple(round(float(value), 9) for value in point)
            if key not in vertex_key_to_id:
                vertex_key_to_id[key] = len(vertex_key_to_id)
            vertex_ids.append(vertex_key_to_id[key])
        triangle_vertex_ids.append(tuple(vertex_ids))

    vertex_to_triangles: dict[int, list[int]] = defaultdict(list)
    for triangle_index, vertex_ids in enumerate(triangle_vertex_ids):
        for vertex_id in vertex_ids:
            vertex_to_triangles[vertex_id].append(triangle_index)

    adjacency: list[set[int]] = [set() for _ in shell_triangles]
    for touching_triangles in vertex_to_triangles.values():
        for triangle_index in touching_triangles:
            adjacency[triangle_index].update(
                other_index for other_index in touching_triangles if other_index != triangle_index
            )

    def build_components(side_sign: int) -> list[dict[str, object]]:
        candidate_set = {
            triangle_index
            for triangle_index, triangle in enumerate(shell_triangles)
            if triangle_matches_side_candidate(triangle, side_sign=side_sign)
        }
        components: list[dict[str, object]] = []
        seen: set[int] = set()
        for start_index in sorted(candidate_set):
            if start_index in seen:
                continue
            queue = deque([start_index])
            seen.add(start_index)
            component_indices: list[int] = []
            while queue:
                current_index = queue.popleft()
                component_indices.append(current_index)
                for neighbor_index in adjacency[current_index]:
                    if neighbor_index in seen or neighbor_index not in candidate_set:
                        continue
                    seen.add(neighbor_index)
                    queue.append(neighbor_index)

            component_triangles = [shell_triangles[index] for index in sorted(component_indices)]
            component_points = [point for triangle in component_triangles for point in triangle]
            mins, maxs = compute_bbox(component_points)
            normals = [triangle_normal(triangle) for triangle in component_triangles]
            average_normal = np.mean(np.stack(normals, axis=0), axis=0) if normals else np.zeros(3, dtype=float)
            components.append(
                {
                    "triangleIndices": sorted(component_indices),
                    "triangleCount": len(component_indices),
                    "bboxMinProductMm": vector_to_mm_list(mins),
                    "bboxMaxProductMm": vector_to_mm_list(maxs),
                    "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
                    "averageNormal": [round(float(value), 4) for value in average_normal],
                }
            )
        return components

    positive_components = build_components(side_sign=1)
    negative_components = build_components(side_sign=-1)
    return {
        "heuristicName": "vertical_inner_wall_strip",
        "xRangeMm": list(HEURISTIC_X_RANGE_MM),
        "yRangeMm": list(HEURISTIC_Y_RANGE_MM),
        "absZRangeMm": list(HEURISTIC_ABS_Z_RANGE_MM),
        "normalZAbsMin": HEURISTIC_NORMAL_Z_ABS_MIN,
        "normalYAbsMax": HEURISTIC_NORMAL_Y_ABS_MAX,
        "positiveZ": {
            "componentCount": len(positive_components),
            "triangleCount": sum(int(component["triangleCount"]) for component in positive_components),
            "components": positive_components,
        },
        "negativeZ": {
            "componentCount": len(negative_components),
            "triangleCount": sum(int(component["triangleCount"]) for component in negative_components),
            "components": negative_components,
        },
    }


def build_part_geometries(gltf: dict, bin_chunk: bytearray) -> dict[str, dict[str, object]]:
    node_lookup = {node.get("name"): index for index, node in enumerate(gltf["nodes"]) if node.get("name")}
    parent_lookup = build_parent_lookup(gltf)

    @lru_cache(maxsize=None)
    def get_world_matrix(node_index: int) -> np.ndarray:
        node = gltf["nodes"][node_index]
        local_matrix = get_local_matrix(node)
        parent_index = parent_lookup.get(node_index)
        if parent_index is None:
            return local_matrix
        return get_world_matrix(parent_index) @ local_matrix

    product_root_index = node_lookup["QIHANG_Product"]
    product_inverse = np.linalg.inv(get_world_matrix(product_root_index))

    part_geometries: dict[str, dict[str, object]] = {}
    for spec in PART_SPECS:
        if spec.node_name not in node_lookup:
            continue

        root_index = node_lookup[spec.node_name]
        node_indices = collect_subtree_node_indices(gltf, root_index) if spec.include_subtree else [root_index]
        triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
        points: list[np.ndarray] = []
        for node_index in node_indices:
            node = gltf["nodes"][node_index]
            mesh_index = node.get("mesh")
            if mesh_index is None:
                continue
            node_triangles = read_triangles_for_mesh(
                gltf,
                bin_chunk,
                mesh_index,
                product_inverse @ get_world_matrix(node_index),
            )
            triangles.extend(node_triangles)
            for triangle in node_triangles:
                points.extend(triangle)

        if not points:
            continue

        part_geometries[spec.node_name] = {
            "label": spec.label,
            "color": spec.color,
            "lineWidth": spec.line_width,
            "triangles": triangles,
            "bbox": compute_bbox(points),
        }

    return part_geometries


def draw_depth_weighted_view(
    ax: plt.Axes,
    part_geometries: dict[str, dict[str, object]],
    view_spec: ViewSpec,
    *,
    front_triangle_count: int,
    back_triangle_count: int,
) -> None:
    all_points = [
        point
        for geometry in part_geometries.values()
        for triangle in geometry["triangles"]
        for point in triangle
    ]
    depth_values = [float(point[view_spec.depth_axis]) * float(view_spec.camera_sign) for point in all_points]
    min_depth = min(depth_values)
    max_depth = max(depth_values)
    depth_span = max(max_depth - min_depth, 1e-9)

    all_projected_x: list[float] = []
    all_projected_y: list[float] = []

    for geometry in part_geometries.values():
        segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
        colors: list[tuple[float, float, float, float]] = []
        line_widths: list[float] = []
        base_rgba = to_rgba(geometry["color"])
        alpha_floor = 0.04 if geometry["label"] == "Base Shell" else 0.09
        alpha_ceiling = 0.34 if geometry["label"] == "Base Shell" else 0.62

        for triangle in geometry["triangles"]:
            projected = [project_point(point, view_spec.dims) for point in triangle]
            projected_xs = [point[0] for point in projected]
            projected_ys = [point[1] for point in projected]
            all_projected_x.extend(projected_xs)
            all_projected_y.extend(projected_ys)

            triangle_depth = sum(
                float(point[view_spec.depth_axis]) * float(view_spec.camera_sign) for point in triangle
            ) / 3.0
            depth_weight = (triangle_depth - min_depth) / depth_span
            alpha = alpha_floor + ((alpha_ceiling - alpha_floor) * depth_weight)
            rgba = (base_rgba[0], base_rgba[1], base_rgba[2], alpha)

            for start, end in ((0, 1), (1, 2), (2, 0)):
                segments.append((projected[start], projected[end]))
                colors.append(rgba)
                line_widths.append(float(geometry["lineWidth"]))

        if segments:
            ax.add_collection(
                mc.LineCollection(
                    segments,
                    colors=colors,
                    linewidths=line_widths,
                )
            )

    x_margin = max((max(all_projected_x) - min(all_projected_x)) * 0.04, 1.5)
    y_margin = max((max(all_projected_y) - min(all_projected_y)) * 0.06, 1.5)
    ax.set_xlim(min(all_projected_x) - x_margin, max(all_projected_x) + x_margin)
    ax.set_ylim(min(all_projected_y) - y_margin, max(all_projected_y) + y_margin)
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.15)

    title = view_spec.title
    if view_spec.title.startswith("Front"):
        title = f"{title}\nHeuristic +Z triangles: {front_triangle_count}"
    elif view_spec.title.startswith("Back"):
        title = f"{title}\nHeuristic -Z triangles: {back_triangle_count}"
    ax.set_title(title, fontsize=10)
    ax.set_xlabel(f"{AXIS_LABELS[view_spec.dims[0]]} (mm)")
    ax.set_ylabel(f"{AXIS_LABELS[view_spec.dims[1]]} (mm)")


def render_six_view_sheet(
    part_geometries: dict[str, dict[str, object]],
    candidate_summary: dict[str, object],
    output_path: Path,
    *,
    label: str,
) -> None:
    fig, axes = plt.subplots(2, 3, figsize=(18, 12))
    front_count = int(candidate_summary["positiveZ"]["triangleCount"])
    back_count = int(candidate_summary["negativeZ"]["triangleCount"])
    fig.suptitle(
        f"{label}\nHeuristic shell-wall triangles: +Z={front_count}, -Z={back_count}",
        fontsize=15,
        fontweight="bold",
    )

    for ax, view_spec in zip(axes.flat, VIEW_SPECS):
        draw_depth_weighted_view(
            ax,
            part_geometries,
            view_spec,
            front_triangle_count=front_count,
            back_triangle_count=back_count,
        )

    fig.tight_layout(rect=(0.0, 0.0, 1.0, 0.95))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=180)
    plt.close(fig)


def copy_input_to_output(input_path: Path, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(input_path.read_bytes())


def replace_nonindexed_primitive_rows(
    gltf: dict,
    bin_chunk: bytearray,
    primitive: dict,
    positions: list[list[float]],
    normals: list[list[float]],
) -> None:
    position_mins, position_maxes = compute_rows_min_max(positions)
    normal_mins, normal_maxes = compute_rows_min_max(normals)

    position_bytes = b"".join(struct.pack("<3f", *row) for row in positions)
    normal_bytes = b"".join(struct.pack("<3f", *row) for row in normals)
    position_offset = append_aligned_bytes(bin_chunk, position_bytes)
    normal_offset = append_aligned_bytes(bin_chunk, normal_bytes)
    gltf["buffers"][0]["byteLength"] = len(bin_chunk)

    position_view = append_buffer_view(gltf, position_offset, len(position_bytes), target=34962)
    normal_view = append_buffer_view(gltf, normal_offset, len(normal_bytes), target=34962)
    position_accessor = append_accessor(
        gltf,
        position_view,
        5126,
        len(positions),
        "VEC3",
        mins=position_mins,
        maxes=position_maxes,
    )
    normal_accessor = append_accessor(
        gltf,
        normal_view,
        5126,
        len(normals),
        "VEC3",
        mins=normal_mins,
        maxes=normal_maxes,
    )

    primitive["attributes"]["POSITION"] = position_accessor
    primitive["attributes"]["NORMAL"] = normal_accessor
    primitive.pop("indices", None)
    primitive["mode"] = 4


def remove_triangle_indices_from_shell(
    gltf: dict,
    bin_chunk: bytearray,
    target_triangle_indices: set[int],
) -> tuple[int, int]:
    named_node_indices = {
        node.get("name"): index for index, node in enumerate(gltf["nodes"]) if node.get("name")
    }
    shell_node_index = named_node_indices["Case_Base_Shell"]
    primitive = gltf["meshes"][gltf["nodes"][shell_node_index]["mesh"]]["primitives"][0]
    if "indices" in primitive:
        raise ValueError("Expected non-indexed Case_Base_Shell primitive in V4 phase3 input.")

    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    normals = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["NORMAL"])
    if len(positions) != len(normals) or len(positions) % 3 != 0:
        raise ValueError("Case_Base_Shell primitive is not a triangle soup with matching normals.")

    kept_positions: list[list[float]] = []
    kept_normals: list[list[float]] = []
    for triangle_index in range(len(positions) // 3):
        start = triangle_index * 3
        if triangle_index in target_triangle_indices:
            continue
        kept_positions.extend(positions[start : start + 3])
        kept_normals.extend(normals[start : start + 3])

    replace_nonindexed_primitive_rows(gltf, bin_chunk, primitive, kept_positions, kept_normals)
    return len(target_triangle_indices), len(kept_positions) // 3


def select_front_right_sidewall_component(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    component_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        xs_mm = [float(point[0]) * 1000.0 for point in triangle]
        ys_mm = [float(point[1]) * 1000.0 for point in triangle]
        zs_mm = [float(point[2]) * 1000.0 for point in triangle]
        if min(xs_mm) < FRONT_RIGHT_WALL_X_RANGE_MM[0] or max(xs_mm) > FRONT_RIGHT_WALL_X_RANGE_MM[1]:
            continue
        if min(ys_mm) < FRONT_RIGHT_WALL_Y_RANGE_MM[0] or max(ys_mm) > FRONT_RIGHT_WALL_Y_RANGE_MM[1]:
            continue
        if min(zs_mm) < FRONT_RIGHT_WALL_Z_RANGE_MM[0] or max(zs_mm) > FRONT_RIGHT_WALL_Z_RANGE_MM[1]:
            continue
        component_indices.append(triangle_index)

    if len(component_indices) != EXPECTED_FRONT_RIGHT_WALL_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_RIGHT_WALL_TRIANGLE_COUNT} front-right sidewall triangles, "
            f"found {len(component_indices)}."
        )

    component_triangles = [shell_triangles[index] for index in component_indices]
    component_points = [point for triangle in component_triangles for point in triangle]
    mins, maxs = compute_bbox(component_points)
    normals = [triangle_normal(triangle) for triangle in component_triangles]
    average_normal = np.mean(np.stack(normals, axis=0), axis=0)
    return {
        "triangleIndices": component_indices,
        "triangleCount": len(component_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "averageNormal": [round(float(value), 4) for value in average_normal],
        "selectionRangesMm": {
            "x": list(FRONT_RIGHT_WALL_X_RANGE_MM),
            "y": list(FRONT_RIGHT_WALL_Y_RANGE_MM),
            "z": list(FRONT_RIGHT_WALL_Z_RANGE_MM),
        },
    }


def remove_front_right_sidewall(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    part_geometries = build_part_geometries(gltf, bin_chunk)
    shell_triangles = part_geometries["Case_Base_Shell"]["triangles"]
    component = select_front_right_sidewall_component(shell_triangles)

    target_triangle_indices = set(int(index) for index in component["triangleIndices"])
    removed_points = [point for triangle_index in sorted(target_triangle_indices) for point in shell_triangles[triangle_index]]
    removed_triangle_count, kept_triangle_count = remove_triangle_indices_from_shell(
        gltf,
        bin_chunk,
        target_triangle_indices,
    )

    removed_mins, removed_maxs = compute_bbox(removed_points)
    return {
        "node": "Case_Base_Shell",
        "operation": "delete_front_right_sidewall_component",
        "removedTriangleCount": removed_triangle_count,
        "keptTriangleCount": kept_triangle_count,
        "removedComponent": component,
        "removedBboxMinProductMm": vector_to_mm_list(removed_mins),
        "removedBboxMaxProductMm": vector_to_mm_list(removed_maxs),
        "removedBboxSizeProductMm": vector_to_mm_list(removed_maxs - removed_mins),
    }


def apply_phase_1(
    gltf: dict,
    bin_chunk: bytearray,
    *,
    sheet_path: Path,
) -> dict[str, object]:
    part_geometries = build_part_geometries(gltf, bin_chunk)
    candidate_summary = analyze_shell_candidate_components(part_geometries["Case_Base_Shell"]["triangles"])
    render_six_view_sheet(
        part_geometries,
        candidate_summary,
        sheet_path,
        label="V5 Phase 1 Baseline Six-View Diagnostics",
    )
    return {
        "phase": 1,
        "name": PHASE_NAMES[1],
        "geometryModified": False,
        "diagnosticSheetPath": str(sheet_path),
        "candidateSummary": candidate_summary,
    }


def apply_phase_2(
    gltf: dict,
    bin_chunk: bytearray,
    *,
    sheet_path: Path,
) -> dict[str, object]:
    delete_change_log = remove_front_right_sidewall(gltf, bin_chunk)
    part_geometries = build_part_geometries(gltf, bin_chunk)
    candidate_summary = analyze_shell_candidate_components(part_geometries["Case_Base_Shell"]["triangles"])
    render_six_view_sheet(
        part_geometries,
        candidate_summary,
        sheet_path,
        label="V5 Phase 2 Front-Right Sidewall Removal",
    )
    return {
        "phase": 2,
        "name": PHASE_NAMES[2],
        "geometryModified": True,
        "diagnosticSheetPath": str(sheet_path),
        "deleteChangeLog": delete_change_log,
        "postDeleteCandidateSummary": candidate_summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the staged V5 qihang pearl case from V4 phase3.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("output/debug_v4/qihang_product_pearl_phase3.glb"),
        help="V4 phase3 source GLB path.",
    )
    parser.add_argument(
        "--phase",
        type=int,
        choices=(1, 2),
        default=2,
        help="Apply phases cumulatively up to this stage.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output GLB path. Defaults to output/debug_v5/qihang_product_pearl_phaseN.glb.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="JSON report path. Defaults to output/debug_v5/qihang_product_pearl_phaseN.json.",
    )
    parser.add_argument(
        "--sheet-output",
        type=Path,
        default=None,
        help="Phase-N six-view image path. Defaults to output/debug_v5/qihang_product_pearl_phaseN_six_views.png.",
    )
    args = parser.parse_args()

    output_path = args.output or default_output_path(args.phase)
    report_path = args.report or default_report_path(args.phase)
    sheet_path = args.sheet_output or default_sheet_path(args.phase)
    phase1_sheet_path = default_sheet_path(1)

    gltf, bin_chunk = parse_glb(args.input)
    phase_logs = [apply_phase_1(gltf, bin_chunk, sheet_path=phase1_sheet_path)]
    if args.phase >= 2:
        phase_logs.append(apply_phase_2(gltf, bin_chunk, sheet_path=sheet_path))
    else:
        sheet_path = phase1_sheet_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    if args.phase == 1:
        copy_input_to_output(args.input, output_path)
    else:
        from make_qihang_pearl_v4 import write_glb

        write_glb(output_path, gltf, bin_chunk)

    report_gltf, report_bin_chunk = parse_glb(output_path)
    report = build_baseline_report(output_path, report_gltf, report_bin_chunk)
    report["sourceInputPath"] = str(args.input)
    report["sourceInputSha256"] = sha256_for_bytes(args.input.read_bytes())
    report["outputSha256"] = sha256_for_bytes(output_path.read_bytes())
    report["phase"] = args.phase
    report["phaseName"] = PHASE_NAMES[args.phase]
    report["phaseLogs"] = phase_logs
    report["diagnosticSheetPath"] = str(sheet_path)
    if args.phase >= 1:
        report["phase1DiagnosticSheetPath"] = str(phase1_sheet_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {
        "input": str(args.input),
        "output": str(output_path),
        "report": str(report_path),
        "sheet": str(sheet_path),
        "phase": args.phase,
        "phaseName": PHASE_NAMES[args.phase],
        "outputSha256": report["outputSha256"],
        "phaseLogs": phase_logs,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
