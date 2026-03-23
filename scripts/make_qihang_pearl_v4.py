from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np

from make_qihang_pearl_capsule import (
    recalculate_normals,
    update_accessor_min_max,
    write_accessor_rows,
)
from make_qihang_pearl_v3 import (
    COMPONENT_STRUCT_FORMATS,
    append_accessor,
    append_aligned_bytes,
    append_buffer_view,
    apply_horizontal_case_rotation,
    build_baseline_report,
    build_world_matrix_getter,
    get_accessor_info,
    get_named_node_indices,
    parse_glb,
    quaternion_multiply,
    quaternion_to_matrix,
    read_accessor_rows,
    read_accessor_scalars,
    rotate_vector_about_y,
    set_node_origin_in_product_space,
    sha256_for_bytes,
    write_glb,
)


TRAY_NODE_NAME = "Case_Base_Linear_Tray_V3"
PLATFORM_NODE_NAME = "Case_Base_Platform_V4"
RAMP_NODE_NAME = "Case_Base_Arc_Ramp_V4"
BASE_SHELL_WALL_THICKNESS_M = 0.0008
PHASE_NAMES = {
    1: "tray_ramp",
    2: "base_shell_split",
    3: "lid_shell_cover",
}
PLATFORM_PROGRESS_STATION_COUNT = 21
PLATFORM_SPAN_STATION_COUNT = 49
PLATFORM_SPAN_LIMIT_RATIO = 0.94
RAMP_PROGRESS_STATION_COUNT = 57
RAMP_SPAN_STATION_COUNT = 49
RAMP_SPAN_LIMIT_RATIO = 0.94
RAMP_PLATFORM_OVERLAP_M = 0.0
RAMP_START_SOLID_BLEND_RATIO = 0.085
BASE_SHELL_SEAL_CLEARANCE_M = 0.0
TRAY_OUTLINE_Z_TO_X_CONTROL_POINTS_M = [
    (0.0, 0.041226),
    (0.001221, 0.041177),
    (0.002435, 0.041028),
    (0.003635, 0.04078),
    (0.004816, 0.040434),
    (0.005969, 0.039991),
    (0.007088, 0.039451),
    (0.008167, 0.038816),
    (0.009198, 0.038088),
    (0.010174, 0.037268),
    (0.011088, 0.036358),
    (0.011932, 0.035361),
    (0.012698, 0.034278),
    (0.013378, 0.033113),
    (0.013963, 0.031868),
    (0.014444, 0.030547),
    (0.01481, 0.029151),
    (0.015049, 0.027686),
    (0.015157, 0.026154),
    (0.015227, 0.024558),
    (0.015287, 0.022904),
    (0.015338, 0.021195),
    (0.015381, 0.019434),
    (0.015417, 0.017626),
    (0.015448, 0.015777),
    (0.015475, 0.013889),
    (0.015496, 0.011967),
    (0.015514, 0.010017),
    (0.015528, 0.008043),
    (0.015539, 0.006049),
    (0.015546, 0.004041),
    (0.015551, 0.002023),
    (0.015552, 0.0),
]
TRAY_OUTLINE_X_TO_Z_CONTROL_POINTS_M = sorted(
    [(x_value, z_value) for z_value, x_value in TRAY_OUTLINE_Z_TO_X_CONTROL_POINTS_M],
    key=lambda item: item[0],
)
TRAY_OUTLINE_MAX_HALF_WIDTH_M = TRAY_OUTLINE_Z_TO_X_CONTROL_POINTS_M[-1][0]
TRAY_SPLIT_BOUNDARY_MARGIN_M = 0.00035
PHASE_DEVICE_TARGETS_PRODUCT_M = {
    "Earbud_Left": (-0.0105, 0.0039, -0.00115),
    "DockWell_L": (-0.0105, 0.0078, -0.00115),
    "Earbud_Right": (0.0087, 0.0034, 0.00045),
    "DockWell_R": (0.0087, 0.0071, 0.00045),
    "Brooch_Camera": (0.0288, 0.0024, 0.00095),
}


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if abs(edge1 - edge0) <= 1e-12:
        return 1.0 if value >= edge1 else 0.0
    t = max(0.0, min(1.0, (value - edge0) / (edge1 - edge0)))
    return t * t * (3.0 - (2.0 * t))


def lerp(start: float, end: float, amount: float) -> float:
    return start + ((end - start) * amount)


def normalize_vector(vector: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(vector))
    if length <= 1e-12:
        return np.array([0.0, 1.0, 0.0], dtype=float)
    return vector / length


def compute_triangle_area(point_a: np.ndarray, point_b: np.ndarray, point_c: np.ndarray) -> float:
    return float(np.linalg.norm(np.cross(point_b - point_a, point_c - point_a)) * 0.5)


def compute_indexed_vertex_normals(
    positions: list[list[float]] | list[np.ndarray],
    indices: list[int],
) -> list[np.ndarray]:
    normals = [np.zeros(3, dtype=float) for _ in positions]
    for index_offset in range(0, len(indices), 3):
        i0, i1, i2 = indices[index_offset : index_offset + 3]
        p0 = np.array(positions[i0], dtype=float)
        p1 = np.array(positions[i1], dtype=float)
        p2 = np.array(positions[i2], dtype=float)
        face_normal = np.cross(p1 - p0, p2 - p0)
        if float(np.linalg.norm(face_normal)) <= 1e-12:
            continue
        normals[i0] += face_normal
        normals[i1] += face_normal
        normals[i2] += face_normal
    return [normalize_vector(row) for row in normals]


def clean_indexed_surface_mesh(
    positions: list[list[float]],
    indices: list[int],
    *,
    merge_decimals: int = 9,
) -> tuple[list[list[float]], list[int], dict[str, int]]:
    merged_positions: list[list[float]] = []
    old_to_new: dict[int, int] = {}
    key_to_new: dict[tuple[float, float, float], int] = {}

    for old_index, row in enumerate(positions):
        key = tuple(round(float(value), merge_decimals) for value in row)
        new_index = key_to_new.get(key)
        if new_index is None:
            new_index = len(merged_positions)
            key_to_new[key] = new_index
            merged_positions.append([float(value) for value in row])
        old_to_new[old_index] = new_index

    cleaned_indices: list[int] = []
    seen_triangles: set[tuple[int, int, int]] = set()
    removed_degenerate_triangles = 0
    removed_duplicate_triangles = 0

    for index_offset in range(0, len(indices), 3):
        i0 = old_to_new[indices[index_offset]]
        i1 = old_to_new[indices[index_offset + 1]]
        i2 = old_to_new[indices[index_offset + 2]]
        if len({i0, i1, i2}) < 3:
            removed_degenerate_triangles += 1
            continue

        p0 = np.array(merged_positions[i0], dtype=float)
        p1 = np.array(merged_positions[i1], dtype=float)
        p2 = np.array(merged_positions[i2], dtype=float)
        if compute_triangle_area(p0, p1, p2) <= 1e-12:
            removed_degenerate_triangles += 1
            continue

        triangle_key = tuple(sorted((i0, i1, i2)))
        if triangle_key in seen_triangles:
            removed_duplicate_triangles += 1
            continue
        seen_triangles.add(triangle_key)
        cleaned_indices.extend((i0, i1, i2))

    stats = {
        "sourceVertexCount": len(positions),
        "mergedVertexCount": len(merged_positions),
        "removedVertexCount": len(positions) - len(merged_positions),
        "sourceTriangleCount": len(indices) // 3,
        "cleanedTriangleCount": len(cleaned_indices) // 3,
        "removedDegenerateTriangleCount": removed_degenerate_triangles,
        "removedDuplicateTriangleCount": removed_duplicate_triangles,
    }
    return merged_positions, cleaned_indices, stats


def stitch_sharp_boundary_notch(
    positions: list[list[float]],
    indices: list[int],
    *,
    max_notch_angle_degrees: float = 35.0,
    max_closure_span_m: float = 0.0025,
) -> tuple[list[int], dict[str, object] | None]:
    edge_counts: dict[tuple[int, int], int] = {}
    for index_offset in range(0, len(indices), 3):
        triangle = indices[index_offset : index_offset + 3]
        for vertex_a, vertex_b in (
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ):
            edge = (min(vertex_a, vertex_b), max(vertex_a, vertex_b))
            edge_counts[edge] = edge_counts.get(edge, 0) + 1

    boundary_edges = [edge for edge, count in edge_counts.items() if count == 1]
    boundary_adjacency: dict[int, list[int]] = {}
    for vertex_a, vertex_b in boundary_edges:
        boundary_adjacency.setdefault(vertex_a, []).append(vertex_b)
        boundary_adjacency.setdefault(vertex_b, []).append(vertex_a)

    source_normals = compute_indexed_vertex_normals(positions, indices)
    best_candidate: dict[str, object] | None = None

    for center_index, neighbor_indices in boundary_adjacency.items():
        if len(neighbor_indices) != 2:
            continue
        neighbor_a, neighbor_b = neighbor_indices
        point_a = np.array(positions[neighbor_a], dtype=float)
        point_center = np.array(positions[center_index], dtype=float)
        point_b = np.array(positions[neighbor_b], dtype=float)
        vector_a = point_a - point_center
        vector_b = point_b - point_center
        length_a = float(np.linalg.norm(vector_a))
        length_b = float(np.linalg.norm(vector_b))
        if length_a <= 1e-12 or length_b <= 1e-12:
            continue
        cosine = float(np.dot(vector_a, vector_b) / (length_a * length_b))
        cosine = max(-1.0, min(1.0, cosine))
        angle_degrees = math.degrees(math.acos(cosine))
        closure_span = float(np.linalg.norm(point_b - point_a))
        if angle_degrees > max_notch_angle_degrees or closure_span > max_closure_span_m:
            continue

        candidate = {
            "center": center_index,
            "left": neighbor_a,
            "right": neighbor_b,
            "angleDegrees": angle_degrees,
            "closureSpanM": closure_span,
        }
        if best_candidate is None or angle_degrees < float(best_candidate["angleDegrees"]):
            best_candidate = candidate

    if best_candidate is None:
        return indices, None

    left_index = int(best_candidate["left"])
    center_index = int(best_candidate["center"])
    right_index = int(best_candidate["right"])
    point_left = np.array(positions[left_index], dtype=float)
    point_center = np.array(positions[center_index], dtype=float)
    point_right = np.array(positions[right_index], dtype=float)
    preferred_normal = normalize_vector(
        source_normals[left_index] + source_normals[center_index] + source_normals[right_index]
    )
    triangle = [left_index, center_index, right_index]
    triangle_normal = normalize_vector(np.cross(point_center - point_left, point_right - point_left))
    if float(np.dot(triangle_normal, preferred_normal)) < 0.0:
        triangle = [right_index, center_index, left_index]

    stitched_indices = list(indices) + triangle
    return stitched_indices, {
        "centerVertex": center_index,
        "leftVertex": left_index,
        "rightVertex": right_index,
        "angleDegrees": round(float(best_candidate["angleDegrees"]), 4),
        "closureSpanMm": round(float(best_candidate["closureSpanM"]) * 1000.0, 4),
        "addedTriangle": triangle,
    }


def build_product_space_matrices(gltf: dict, node_name: str) -> tuple[int, np.ndarray, np.ndarray]:
    named_node_indices = get_named_node_indices(gltf)
    _, get_world_matrix = build_world_matrix_getter(gltf)
    product_root_index = named_node_indices["QIHANG_Product"]
    node_index = named_node_indices[node_name]
    to_product = np.linalg.inv(get_world_matrix(product_root_index)) @ get_world_matrix(node_index)
    return node_index, to_product, np.linalg.inv(to_product)


def transform_local_rows(rows: list[list[float]], matrix: np.ndarray) -> list[np.ndarray]:
    transformed: list[np.ndarray] = []
    for row in rows:
        local = np.array([float(row[0]), float(row[1]), float(row[2]), 1.0], dtype=float)
        world = matrix @ local
        transformed.append(world[:3] / max(world[3], 1e-12))
    return transformed


def quaternion_about_axis(axis: tuple[float, float, float], degrees: float) -> list[float]:
    radians = math.radians(float(degrees))
    half_angle = radians * 0.5
    axis_vector = normalize_vector(np.array(axis, dtype=float))
    sin_half = math.sin(half_angle)
    return [
        float(axis_vector[0] * sin_half),
        float(axis_vector[1] * sin_half),
        float(axis_vector[2] * sin_half),
        float(math.cos(half_angle)),
    ]


def apply_device_layout_v4(gltf: dict) -> list[dict[str, object]]:
    change_log: list[dict[str, object]] = []
    for node_name, target_position in PHASE_DEVICE_TARGETS_PRODUCT_M.items():
        change_log.append(set_node_origin_in_product_space(gltf, node_name, target_position))

    named_node_indices = get_named_node_indices(gltf)
    for node_name, degrees in (("Earbud_Left", 90.0), ("Earbud_Right", -90.0)):
        node = gltf["nodes"][named_node_indices[node_name]]
        original_rotation = [float(value) for value in node.get("rotation", [0.0, 0.0, 0.0, 1.0])]
        tilt_quaternion = quaternion_about_axis((0.0, 0.0, 1.0), degrees)
        node["rotation"] = quaternion_multiply(tilt_quaternion, original_rotation)
        change_log.append(
            {
                "node": node_name,
                "rotationBefore": [round(value, 8) for value in original_rotation],
                "rotationAfter": [round(float(value), 8) for value in node["rotation"]],
                "tiltDegreesAboutProductZ": degrees,
            }
        )

    return change_log


def tray_platform_height_y(x_value: float) -> float:
    return 0.00925


def tray_pitch_height(x_value: float) -> float:
    return 0.0051


def ramp_surface_peak_y(x_value: float) -> float:
    return tray_platform_height_y(x_value)


def ramp_surface_base_y(x_value: float) -> float:
    return ramp_surface_peak_y(x_value) - tray_pitch_height(x_value)


def tray_half_width(x_value: float) -> float:
    return profile_value_from_points(abs(float(x_value)), TRAY_OUTLINE_X_TO_Z_CONTROL_POINTS_M)


def tray_center_z(x_value: float) -> float:
    return 0.0


def tray_outer_half_length(z_value: float) -> float:
    return profile_value_from_points(abs(float(z_value)), TRAY_OUTLINE_Z_TO_X_CONTROL_POINTS_M)


def tray_outer_left_x(z_value: float) -> float:
    return -tray_outer_half_length(z_value)


def tray_outer_right_x(z_value: float) -> float:
    return tray_outer_half_length(z_value)


def tray_split_profile_weight(span_ratio: float) -> float:
    normalized = max(-1.0, min(1.0, float(span_ratio)))
    cosine = math.cos(abs(normalized) * (math.pi * 0.5))
    return smoothstep(0.0, 1.0, cosine)


def tray_split_boundary_raw_x(z_value: float) -> float:
    arc_mid_z = tray_center_z(0.0)
    arc_half_span = tray_half_width(0.0)
    back_flat_x = -0.0196
    left_edge_z = arc_mid_z - arc_half_span
    corner_radius = max(0.0, arc_half_span)
    if corner_radius <= 1e-9:
        return back_flat_x
    flat_join_z = arc_mid_z
    front_rounded_x = back_flat_x - corner_radius
    if z_value >= flat_join_z:
        return back_flat_x
    clamped_z = max(left_edge_z, min(flat_join_z, z_value))
    z_delta = clamped_z - flat_join_z
    return front_rounded_x + math.sqrt(max(0.0, (corner_radius * corner_radius) - (z_delta * z_delta)))


def tray_split_boundary_x(z_value: float) -> float:
    outer_left = tray_outer_left_x(z_value)
    outer_right = tray_outer_right_x(z_value)
    min_boundary = outer_left + TRAY_SPLIT_BOUNDARY_MARGIN_M
    max_boundary = outer_right - TRAY_SPLIT_BOUNDARY_MARGIN_M
    if min_boundary >= max_boundary:
        return (outer_left + outer_right) * 0.5
    return max(min_boundary, min(max_boundary, tray_split_boundary_raw_x(z_value)))


def ramp_tip_end_x(span_ratio: float) -> float:
    z_value = tray_center_z(0.0) + (TRAY_OUTLINE_MAX_HALF_WIDTH_M * max(-1.0, min(1.0, float(span_ratio))))
    return tray_outer_right_x(z_value)


def platform_surface_top_y(x_value: float, z_value: float) -> float:
    return tray_platform_height_y(x_value)


def ramp_surface_top_y(x_value: float, z_value: float) -> float:
    span_ratio = max(-1.0, min(1.0, (z_value - tray_center_z(x_value)) / max(tray_half_width(x_value), 1e-9)))
    return ramp_surface_base_y(x_value) + (tray_pitch_height(x_value) * math.sin(span_ratio * (math.pi * 0.5)))


def platform_surface_bottom_y(x_value: float, z_value: float) -> float:
    return platform_surface_top_y(x_value, z_value) - 0.00145


def ramp_surface_bottom_y(x_value: float, z_value: float) -> float:
    thickness = lerp(0.00155, 0.00175, smoothstep(-0.012, 0.030, x_value))
    return ramp_surface_top_y(x_value, z_value) - thickness


def tray_surface_top_y(x_value: float, z_value: float) -> float:
    if x_value <= tray_split_boundary_x(z_value):
        return platform_surface_top_y(x_value, z_value)
    return ramp_surface_top_y(x_value, z_value)


def tray_surface_bottom_y(x_value: float, z_value: float) -> float:
    if x_value <= tray_split_boundary_x(z_value):
        thickness = 0.00145
    else:
        thickness = lerp(0.00155, 0.00175, smoothstep(-0.012, 0.030, x_value))
    return tray_surface_top_y(x_value, z_value) - thickness


def oriented_quad_triangles(
    a: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    d: np.ndarray,
    preferred_normal: np.ndarray,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    tri1 = (a, b, c)
    tri2 = (a, c, d)
    normal = np.cross(b - a, c - a)
    if float(np.dot(normalize_vector(normal), normalize_vector(preferred_normal))) < 0.0:
        tri1 = (a, c, b)
        tri2 = (a, d, c)
    return [tri1, tri2]


def build_thin_surface_triangles(
    top_grid: list[list[np.ndarray]],
    bottom_grid: list[list[np.ndarray]],
    *,
    cap_z_edges: bool = True,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    row_count = len(top_grid)
    column_count = len(top_grid[0])

    for row_index in range(row_count - 1):
        for column_index in range(column_count - 1):
            top_a = top_grid[row_index][column_index]
            top_b = top_grid[row_index + 1][column_index]
            top_c = top_grid[row_index + 1][column_index + 1]
            top_d = top_grid[row_index][column_index + 1]
            bottom_a = bottom_grid[row_index][column_index]
            bottom_b = bottom_grid[row_index + 1][column_index]
            bottom_c = bottom_grid[row_index + 1][column_index + 1]
            bottom_d = bottom_grid[row_index][column_index + 1]

            triangles.extend(
                oriented_quad_triangles(
                    top_a,
                    top_b,
                    top_c,
                    top_d,
                    np.array([0.0, 1.0, 0.0], dtype=float),
                )
            )
            triangles.extend(
                oriented_quad_triangles(
                    bottom_d,
                    bottom_c,
                    bottom_b,
                    bottom_a,
                    np.array([0.0, -1.0, 0.0], dtype=float),
                )
            )

    if cap_z_edges:
        for row_index in range(row_count - 1):
            front_top_a = top_grid[row_index][0]
            front_top_b = top_grid[row_index + 1][0]
            front_bottom_b = bottom_grid[row_index + 1][0]
            front_bottom_a = bottom_grid[row_index][0]
            triangles.extend(
                oriented_quad_triangles(
                    front_top_a,
                    front_top_b,
                    front_bottom_b,
                    front_bottom_a,
                    np.array([0.0, 0.0, -1.0], dtype=float),
                )
            )

            back_top_a = top_grid[row_index][-1]
            back_top_b = top_grid[row_index + 1][-1]
            back_bottom_b = bottom_grid[row_index + 1][-1]
            back_bottom_a = bottom_grid[row_index][-1]
            triangles.extend(
                oriented_quad_triangles(
                    back_bottom_a,
                    back_bottom_b,
                    back_top_b,
                    back_top_a,
                    np.array([0.0, 0.0, 1.0], dtype=float),
                )
            )

    start_top = top_grid[0]
    start_bottom = bottom_grid[0]
    end_top = top_grid[-1]
    end_bottom = bottom_grid[-1]
    for column_index in range(column_count - 1):
        triangles.extend(
            oriented_quad_triangles(
                start_bottom[column_index],
                start_bottom[column_index + 1],
                start_top[column_index + 1],
                start_top[column_index],
                np.array([-1.0, 0.0, 0.0], dtype=float),
            )
        )
        triangles.extend(
            oriented_quad_triangles(
                end_top[column_index],
                end_top[column_index + 1],
                end_bottom[column_index + 1],
                end_bottom[column_index],
                np.array([1.0, 0.0, 0.0], dtype=float),
            )
        )
    return triangles


def build_platform_triangles_product() -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    progress_stations = np.linspace(0.0, 1.0, PLATFORM_PROGRESS_STATION_COUNT)
    span_angles = np.linspace(-math.pi * 0.5, math.pi * 0.5, PLATFORM_SPAN_STATION_COUNT)
    span_stations = [math.sin(float(angle)) for angle in span_angles]
    platform_span_limit_z = TRAY_OUTLINE_MAX_HALF_WIDTH_M * PLATFORM_SPAN_LIMIT_RATIO
    top_grid: list[list[np.ndarray]] = []
    bottom_grid: list[list[np.ndarray]] = []

    for progress in progress_stations:
        top_row: list[np.ndarray] = []
        bottom_row: list[np.ndarray] = []
        for span in span_stations:
            z_value = tray_center_z(0.0) + (platform_span_limit_z * float(span))
            outer_x = tray_outer_left_x(float(z_value))
            boundary_x = tray_split_boundary_x(float(z_value))
            x_value = lerp(outer_x, boundary_x, float(progress))
            top_row.append(
                np.array([x_value, platform_surface_top_y(float(x_value), float(z_value)), z_value], dtype=float)
            )
            bottom_row.append(
                np.array([x_value, tray_surface_bottom_y(float(x_value), float(z_value)), z_value], dtype=float)
            )
        top_grid.append(top_row)
        bottom_grid.append(bottom_row)
    return build_thin_surface_triangles(top_grid, bottom_grid, cap_z_edges=True)


def build_arc_ramp_triangles_product() -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    progress_values = np.linspace(0.0, 1.0, RAMP_PROGRESS_STATION_COUNT)
    progress_stations = [1.0 - ((1.0 - float(value)) ** 1.6) for value in progress_values]
    span_angles = np.linspace(-math.pi * 0.5, math.pi * 0.5, RAMP_SPAN_STATION_COUNT)
    span_stations = [math.sin(float(angle)) for angle in span_angles]
    ramp_span_limit_z = TRAY_OUTLINE_MAX_HALF_WIDTH_M * RAMP_SPAN_LIMIT_RATIO
    top_grid: list[list[np.ndarray]] = []
    bottom_grid: list[list[np.ndarray]] = []

    for progress in progress_stations:
        top_row: list[np.ndarray] = []
        bottom_row: list[np.ndarray] = []
        solid_blend = smoothstep(0.0, RAMP_START_SOLID_BLEND_RATIO, float(progress))
        for span in span_stations:
            span_ratio = float(span)
            boundary_sample_z = tray_center_z(0.0) + (ramp_span_limit_z * span_ratio)
            boundary_x = tray_split_boundary_x(float(boundary_sample_z))
            outer_x = tray_outer_right_x(float(boundary_sample_z))
            start_x = max(
                tray_outer_left_x(float(boundary_sample_z)) + TRAY_SPLIT_BOUNDARY_MARGIN_M,
                boundary_x - RAMP_PLATFORM_OVERLAP_M,
            )
            if start_x >= outer_x:
                start_x = lerp(boundary_x, outer_x, 0.35)
            x_value = lerp(start_x, outer_x, float(progress))
            z_value = boundary_sample_z
            platform_top_y = platform_surface_top_y(float(x_value), float(z_value))
            platform_bottom_y = platform_surface_bottom_y(float(x_value), float(z_value))
            ramp_top_y = ramp_surface_top_y(float(x_value), float(z_value))
            ramp_bottom_y = ramp_surface_bottom_y(float(x_value), float(z_value))
            solid_join_top_y = lerp(platform_top_y, ramp_top_y, solid_blend)
            solid_join_bottom_y = lerp(platform_bottom_y, ramp_bottom_y, solid_blend)
            solid_join_bottom_y = min(solid_join_bottom_y, solid_join_top_y - 0.0006)
            top_row.append(np.array([x_value, solid_join_top_y, z_value], dtype=float))
            bottom_row.append(np.array([x_value, solid_join_bottom_y, z_value], dtype=float))
        top_grid.append(top_row)
        bottom_grid.append(bottom_row)
    return build_thin_surface_triangles(top_grid, bottom_grid, cap_z_edges=True)


def append_sculpted_tray_mesh(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    named_node_indices = get_named_node_indices(gltf)
    _, get_world_matrix = build_world_matrix_getter(gltf)
    product_root_index = named_node_indices["QIHANG_Product"]
    case_base_index = named_node_indices["Case_Base"]
    product_inverse = np.linalg.inv(get_world_matrix(product_root_index))
    case_base_in_product = product_inverse @ get_world_matrix(case_base_index)
    product_to_case_base = np.linalg.inv(case_base_in_product)

    base_shell_primitive = gltf["meshes"][gltf["nodes"][named_node_indices["Case_Base_Shell"]]["mesh"]]["primitives"][0]

    def append_surface_node(
        node_name: str,
        triangles_product: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    ) -> dict[str, object]:
        local_positions: list[list[float]] = []
        local_normals: list[list[float]] = []
        product_points: list[np.ndarray] = []

        for p0_product, p1_product, p2_product in triangles_product:
            local_triangle = []
            for product_point in (p0_product, p1_product, p2_product):
                transformed = product_to_case_base @ np.array(
                    [float(product_point[0]), float(product_point[1]), float(product_point[2]), 1.0],
                    dtype=float,
                )
                local_triangle.append(transformed[:3] / max(transformed[3], 1e-12))
                product_points.append(product_point)

            p0_local, p1_local, p2_local = local_triangle
            normal_local = normalize_vector(np.cross(p1_local - p0_local, p2_local - p0_local))
            for point_local in local_triangle:
                local_positions.append([float(value) for value in point_local])
                local_normals.append([float(value) for value in normal_local])

        position_bytes = struct.pack(
            "<" + ("f" * (len(local_positions) * 3)),
            *(value for row in local_positions for value in row),
        )
        normal_bytes = struct.pack(
            "<" + ("f" * (len(local_normals) * 3)),
            *(value for row in local_normals for value in row),
        )
        position_offset = append_aligned_bytes(bin_chunk, position_bytes)
        normal_offset = append_aligned_bytes(bin_chunk, normal_bytes)
        gltf["buffers"][0]["byteLength"] = len(bin_chunk)

        position_view_index = append_buffer_view(gltf, position_offset, len(position_bytes), target=34962)
        normal_view_index = append_buffer_view(gltf, normal_offset, len(normal_bytes), target=34962)
        position_mins = [min(row[index] for row in local_positions) for index in range(3)]
        position_maxes = [max(row[index] for row in local_positions) for index in range(3)]
        normal_mins = [min(row[index] for row in local_normals) for index in range(3)]
        normal_maxes = [max(row[index] for row in local_normals) for index in range(3)]

        position_accessor_index = append_accessor(
            gltf,
            position_view_index,
            component_type=5126,
            count=len(local_positions),
            accessor_type="VEC3",
            mins=position_mins,
            maxes=position_maxes,
        )
        normal_accessor_index = append_accessor(
            gltf,
            normal_view_index,
            component_type=5126,
            count=len(local_normals),
            accessor_type="VEC3",
            mins=normal_mins,
            maxes=normal_maxes,
        )

        mesh_index = len(gltf["meshes"])
        gltf["meshes"].append(
            {
                "name": node_name,
                "primitives": [
                    {
                        "attributes": {
                            "POSITION": position_accessor_index,
                            "NORMAL": normal_accessor_index,
                        },
                        "material": base_shell_primitive["material"],
                        "mode": 4,
                    }
                ],
            }
        )
        node_index = len(gltf["nodes"])
        gltf["nodes"].append({"name": node_name, "mesh": mesh_index})
        gltf["nodes"][case_base_index].setdefault("children", []).append(node_index)

        mins_product = np.min(np.stack(product_points, axis=0), axis=0)
        maxs_product = np.max(np.stack(product_points, axis=0), axis=0)
        return {
            "node": node_name,
            "meshIndex": mesh_index,
            "nodeIndex": node_index,
            "triangleCount": len(triangles_product),
            "bboxMinProductMm": [round(float(value) * 1000.0, 4) for value in mins_product],
            "bboxMaxProductMm": [round(float(value) * 1000.0, 4) for value in maxs_product],
            "bboxSizeProductMm": [round(float((maxs_product - mins_product)[index]) * 1000.0, 4) for index in range(3)],
        }

    platform_change_log = append_surface_node(PLATFORM_NODE_NAME, build_platform_triangles_product())
    ramp_change_log = append_surface_node(RAMP_NODE_NAME, build_arc_ramp_triangles_product())
    return {
        "integrationMode": "split_internal_solids",
        "platformChangeLog": platform_change_log,
        "rampChangeLog": ramp_change_log,
        "splitProfile": {
            "boundaryBackMm": round(tray_split_boundary_x(tray_center_z(0.0) + (tray_half_width(0.0) * 0.88)) * 1000.0, 4),
            "boundaryMidMm": round(tray_split_boundary_x(tray_center_z(0.0)) * 1000.0, 4),
            "boundaryFrontMm": round(tray_split_boundary_x(tray_center_z(0.0) - (tray_half_width(0.0) * 0.64)) * 1000.0, 4),
            "platformTopMm": round(platform_surface_top_y(-0.028, tray_center_z(-0.028)) * 1000.0, 4),
            "rampStartTopMm": round(ramp_surface_top_y(-0.020, tray_center_z(-0.020)) * 1000.0, 4),
            "rampBackAtEarbudMm": round(ramp_surface_top_y(0.002, tray_center_z(0.002) + (tray_half_width(0.002) * 0.72)) * 1000.0, 4),
            "rampFrontAtEarbudMm": round(ramp_surface_top_y(0.002, tray_center_z(0.002) - (tray_half_width(0.002) * 0.72)) * 1000.0, 4),
            "rampBackAtCameraMm": round(ramp_surface_top_y(0.029, tray_center_z(0.029) + (tray_half_width(0.029) * 0.72)) * 1000.0, 4),
            "rampFrontAtCameraMm": round(ramp_surface_top_y(0.029, tray_center_z(0.029) - (tray_half_width(0.029) * 0.72)) * 1000.0, 4),
        },
    }


def depress_base_shell_for_tray_join(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, to_product, to_local = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    product_positions = transform_local_rows(positions, to_product)

    updated_rows: list[list[float]] = []
    moved_rows = 0
    max_delta_y_mm = 0.0
    max_delta_z_mm = 0.0

    for row, point in zip(positions, product_positions):
        x_mm = float(point[0] * 1000.0)
        y_mm = float(point[1] * 1000.0)
        z_mm = float(point[2] * 1000.0)

        if x_mm < -31.5 or x_mm > 42.5 or y_mm < 5.5:
            updated_point = np.array(point, dtype=float)
        else:
            center_z_mm = tray_center_z(point[0]) * 1000.0
            tray_half_width_mm = tray_half_width(point[0]) * 1000.0
            lateral_distance_mm = abs(z_mm - center_z_mm)
            rim_start_mm = tray_half_width_mm * 0.64
            rim_full_mm = tray_half_width_mm * 0.92
            lateral_weight = smoothstep(rim_start_mm, rim_full_mm, lateral_distance_mm)
            clamped_z_mm = max(center_z_mm - tray_half_width_mm, min(center_z_mm + tray_half_width_mm, z_mm))
            profile_target_y_mm = tray_surface_top_y(point[0], clamped_z_mm / 1000.0) * 1000.0
            updated_point = np.array(point, dtype=float)

            if lateral_weight <= 1e-6:
                pass
            else:
                if x_mm <= -24.0:
                    x_weight = smoothstep(-31.5, -24.0, x_mm)
                elif x_mm <= 35.5:
                    x_weight = 1.0
                else:
                    x_weight = 1.0 - smoothstep(35.5, 41.0, x_mm)
                y_weight = smoothstep(5.0, 10.9, y_mm)
                weight = x_weight * y_weight * lateral_weight

                target_y_mm = profile_target_y_mm + 0.16

                if target_y_mm < y_mm:
                    updated_point[1] = lerp(y_mm, target_y_mm, weight) / 1000.0
                    wall_target_z_mm = max(
                        center_z_mm - (tray_half_width_mm + 0.10),
                        min(center_z_mm + (tray_half_width_mm + 0.10), z_mm),
                    )
                    updated_point[2] = lerp(z_mm, wall_target_z_mm, min(weight * 0.22, 1.0)) / 1000.0
                    max_delta_y_mm = max(max_delta_y_mm, abs(y_mm - (updated_point[1] * 1000.0)))
                    max_delta_z_mm = max(max_delta_z_mm, abs(z_mm - (updated_point[2] * 1000.0)))

            end_cap_weight = smoothstep(30.5, 34.0, x_mm) * smoothstep(4.8, 10.6, y_mm)
            current_y_mm = float(updated_point[1] * 1000.0)
            current_z_mm = float(updated_point[2] * 1000.0)
            if profile_target_y_mm < current_y_mm and end_cap_weight > 1e-6:
                updated_point[1] = lerp(current_y_mm, profile_target_y_mm + 0.10, end_cap_weight) / 1000.0
                target_z_mm = max(
                    center_z_mm - tray_half_width_mm,
                    min(center_z_mm + tray_half_width_mm, current_z_mm),
                )
                updated_point[2] = lerp(current_z_mm, target_z_mm, min(end_cap_weight * 0.48, 1.0)) / 1000.0
                max_delta_y_mm = max(max_delta_y_mm, abs(y_mm - (updated_point[1] * 1000.0)))
                max_delta_z_mm = max(max_delta_z_mm, abs(z_mm - (updated_point[2] * 1000.0)))

            if np.linalg.norm(updated_point - point) > 1e-10:
                moved_rows += 1

        local_point = to_local @ np.array([updated_point[0], updated_point[1], updated_point[2], 1.0], dtype=float)
        updated_rows.append(
            [
                float(local_point[0] / max(local_point[3], 1e-12)),
                float(local_point[1] / max(local_point[3], 1e-12)),
                float(local_point[2] / max(local_point[3], 1e-12)),
            ]
        )

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Base_Shell",
        "joinMode": "depressed_top_band",
        "movedRows": moved_rows,
        "maxDeltaYmm": round(max_delta_y_mm, 4),
        "maxDeltaZmm": round(max_delta_z_mm, 4),
        "joinStartXmm": -31.5,
        "joinEndXmm": 42.5,
    }


def snap_base_shell_edge_to_ramp_profile(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, to_product, to_local = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    product_positions = transform_local_rows(positions, to_product)

    updated_rows: list[list[float]] = []
    moved_rows = 0
    max_delta_y_mm = 0.0
    max_delta_z_mm = 0.0

    for point in product_positions:
        x_mm = float(point[0] * 1000.0)
        y_mm = float(point[1] * 1000.0)
        z_mm = float(point[2] * 1000.0)
        updated_point = np.array(point, dtype=float)

        if -22.8 <= x_mm <= 38.9:
            center_z_mm = tray_center_z(point[0]) * 1000.0
            tray_half_width_mm = tray_half_width(point[0]) * 1000.0
            signed_distance_mm = z_mm - center_z_mm
            lateral_distance_mm = abs(signed_distance_mm)
            edge_gap_mm = abs(lateral_distance_mm - tray_half_width_mm)

            if lateral_distance_mm >= (tray_half_width_mm * 0.70) and edge_gap_mm <= 1.8:
                edge_sign = -1.0 if signed_distance_mm < 0.0 else 1.0
                edge_z_mm = center_z_mm + (edge_sign * tray_half_width_mm)
                edge_y_mm = tray_surface_top_y(point[0], edge_z_mm / 1000.0) * 1000.0
                above_edge_mm = y_mm - edge_y_mm

                if -5.0 <= above_edge_mm <= 7.2:
                    x_weight = smoothstep(-22.8, -18.0, x_mm) * (1.0 - smoothstep(36.4, 38.9, x_mm))
                    edge_weight = 1.0 - smoothstep(0.0, 1.8, edge_gap_mm)
                    if above_edge_mm < -0.6:
                        vertical_weight = 1.0 - smoothstep(-5.0, -0.6, above_edge_mm)
                    elif above_edge_mm <= 5.8:
                        vertical_weight = 1.0
                    else:
                        vertical_weight = 1.0 - smoothstep(5.8, 7.2, above_edge_mm)
                    weight = x_weight * edge_weight * vertical_weight

                    if edge_gap_mm <= 0.70 and -4.8 <= above_edge_mm <= 5.4:
                        weight = max(weight, 0.97)
                    elif edge_gap_mm <= 1.10 and -4.8 <= above_edge_mm <= 6.0:
                        weight = max(weight, 0.9)

                    if weight > 1e-6:
                        target_y_mm = edge_y_mm + 0.03
                        target_z_mm = edge_z_mm
                        updated_point[1] = lerp(y_mm, target_y_mm, min(weight, 1.0)) / 1000.0
                        updated_point[2] = lerp(z_mm, target_z_mm, min(weight, 1.0)) / 1000.0
                        max_delta_y_mm = max(max_delta_y_mm, abs(y_mm - (updated_point[1] * 1000.0)))
                        max_delta_z_mm = max(max_delta_z_mm, abs(z_mm - (updated_point[2] * 1000.0)))

        if np.linalg.norm(updated_point - point) > 1e-10:
            moved_rows += 1

        local_point = to_local @ np.array([updated_point[0], updated_point[1], updated_point[2], 1.0], dtype=float)
        updated_rows.append(
            [
                float(local_point[0] / max(local_point[3], 1e-12)),
                float(local_point[1] / max(local_point[3], 1e-12)),
                float(local_point[2] / max(local_point[3], 1e-12)),
            ]
        )

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Base_Shell",
        "operation": "snap_edge_to_ramp_profile",
        "movedRows": moved_rows,
        "maxDeltaYmm": round(max_delta_y_mm, 4),
        "maxDeltaZmm": round(max_delta_z_mm, 4),
        "snapStartXmm": -22.8,
        "snapEndXmm": 38.9,
    }


def profile_value_from_points(x_mm: float, control_points: list[tuple[float, float]]) -> float:
    if x_mm <= control_points[0][0]:
        return control_points[0][1]
    if x_mm >= control_points[-1][0]:
        return control_points[-1][1]

    for start, end in zip(control_points, control_points[1:]):
        start_x, start_y = start
        end_x, end_y = end
        if start_x <= x_mm <= end_x:
            amount = 0.0 if abs(end_x - start_x) <= 1e-12 else ((x_mm - start_x) / (end_x - start_x))
            return lerp(start_y, end_y, amount)
    return control_points[-1][1]


def write_accessor_scalars(
    gltf: dict,
    bin_chunk: bytearray,
    accessor_index: int,
    values: list[int],
) -> None:
    info = get_accessor_info(gltf, accessor_index)
    if info.component_count != 1:
        raise ValueError(f"Accessor {accessor_index} must be scalar")
    if len(values) != info.count:
        raise ValueError(f"Accessor {accessor_index} scalar count changed")
    fmt = "<" + COMPONENT_STRUCT_FORMATS[info.accessor["componentType"]]
    for row_index, value in enumerate(values):
        row_offset = info.offset + (row_index * info.stride)
        struct.pack_into(fmt, bin_chunk, row_offset, int(value))


def compute_rows_min_max(rows: list[list[float]]) -> tuple[list[float], list[float]]:
    component_count = len(rows[0])
    mins = [float("inf")] * component_count
    maxes = [float("-inf")] * component_count
    for row in rows:
        for index, value in enumerate(row):
            mins[index] = min(mins[index], float(value))
            maxes[index] = max(maxes[index], float(value))
    return mins, maxes


def smooth_closed_ring(points: list[np.ndarray], iterations: int = 6) -> list[np.ndarray]:
    smoothed = [np.array(point, dtype=float) for point in points]
    point_count = len(smoothed)
    if point_count < 5:
        return smoothed

    for _ in range(iterations):
        next_ring: list[np.ndarray] = []
        for index in range(point_count):
            next_ring.append(
                (
                    smoothed[(index - 2) % point_count]
                    + (4.0 * smoothed[(index - 1) % point_count])
                    + (6.0 * smoothed[index])
                    + (4.0 * smoothed[(index + 1) % point_count])
                    + smoothed[(index + 2) % point_count]
                )
                / 16.0
            )
        smoothed = next_ring
    return smoothed


def delete_base_shell_ring_faces(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, _, _ = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
    ring_stride = 9
    ring_rows = (6, 7)
    if len(positions) % ring_stride != 0:
        raise ValueError("Case_Base_Shell vertex layout is not divisible into expected 9-ring columns")

    column_count = len(positions) // ring_stride
    target_vertex_indices = {
        (column_index * ring_stride) + ring_row
        for column_index in range(column_count)
        for ring_row in ring_rows
    }

    original_edge_counts: dict[tuple[int, int], int] = {}
    for index_offset in range(0, len(indices), 3):
        triangle = indices[index_offset : index_offset + 3]
        for vertex_a, vertex_b in (
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ):
            edge = (min(vertex_a, vertex_b), max(vertex_a, vertex_b))
            original_edge_counts[edge] = original_edge_counts.get(edge, 0) + 1

    original_boundary_edges = {
        edge for edge, edge_count in original_edge_counts.items() if edge_count == 1
    }

    kept_positions: list[list[float]] = []
    old_to_new: dict[int, int] = {}
    removed_vertex_indices: set[int] = set(target_vertex_indices)
    for old_index, row in enumerate(positions):
        if old_index in target_vertex_indices:
            continue
        old_to_new[old_index] = len(kept_positions)
        kept_positions.append(list(row))

    kept_old_indices: list[int] = []
    removed_triangle_count = 0
    for index_offset in range(0, len(indices), 3):
        triangle = indices[index_offset : index_offset + 3]
        if any(vertex_index in target_vertex_indices for vertex_index in triangle):
            removed_triangle_count += 1
            continue
        kept_old_indices.extend(triangle)

    kept_edge_counts: dict[tuple[int, int], int] = {}
    for index_offset in range(0, len(kept_old_indices), 3):
        triangle = kept_old_indices[index_offset : index_offset + 3]
        for vertex_a, vertex_b in (
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ):
            edge = (min(vertex_a, vertex_b), max(vertex_a, vertex_b))
            kept_edge_counts[edge] = kept_edge_counts.get(edge, 0) + 1

    introduced_boundary_edges = {
        edge
        for edge, edge_count in kept_edge_counts.items()
        if edge_count == 1 and edge not in original_boundary_edges
    }

    bridge_lower_row = min(ring_rows) - 1
    bridge_upper_row = max(ring_rows) + 1
    bridge_segment_count = 0
    bridge_triangle_count = 0

    for column_index in range(column_count - 1):
        lower_left_old = (column_index * ring_stride) + bridge_lower_row
        lower_right_old = ((column_index + 1) * ring_stride) + bridge_lower_row
        upper_left_old = (column_index * ring_stride) + bridge_upper_row
        upper_right_old = ((column_index + 1) * ring_stride) + bridge_upper_row
        lower_edge = (min(lower_left_old, lower_right_old), max(lower_left_old, lower_right_old))
        upper_edge = (min(upper_left_old, upper_right_old), max(upper_left_old, upper_right_old))

        if lower_edge not in introduced_boundary_edges or upper_edge not in original_boundary_edges:
            continue

        kept_old_indices.extend(
            [
                lower_left_old,
                lower_right_old,
                upper_left_old,
                upper_right_old,
                upper_left_old,
                lower_right_old,
            ]
        )
        bridge_segment_count += 1
        bridge_triangle_count += 2

    kept_indices = [old_to_new[vertex_index] for vertex_index in kept_old_indices]

    normals = [[0.0, 0.0, 0.0] for _ in kept_positions]
    for index_offset in range(0, len(kept_indices), 3):
        i0, i1, i2 = kept_indices[index_offset : index_offset + 3]
        p0 = np.array(kept_positions[i0], dtype=float)
        p1 = np.array(kept_positions[i1], dtype=float)
        p2 = np.array(kept_positions[i2], dtype=float)
        face = np.cross(p1 - p0, p2 - p0)
        for vertex_index in (i0, i1, i2):
            normals[vertex_index][0] += float(face[0])
            normals[vertex_index][1] += float(face[1])
            normals[vertex_index][2] += float(face[2])
    kept_normals = [list(normalize_vector(np.array(row, dtype=float))) for row in normals]

    position_mins, position_maxes = compute_rows_min_max(kept_positions)
    normal_mins, normal_maxes = compute_rows_min_max(kept_normals)

    position_bytes = b"".join(struct.pack("<3f", *row) for row in kept_positions)
    normal_bytes = b"".join(struct.pack("<3f", *row) for row in kept_normals)
    index_bytes = b"".join(struct.pack("<H", value) for value in kept_indices)

    position_offset = append_aligned_bytes(bin_chunk, position_bytes)
    normal_offset = append_aligned_bytes(bin_chunk, normal_bytes)
    index_offset = append_aligned_bytes(bin_chunk, index_bytes, alignment=4)

    position_view = append_buffer_view(gltf, position_offset, len(position_bytes), target=34962)
    normal_view = append_buffer_view(gltf, normal_offset, len(normal_bytes), target=34962)
    index_view = append_buffer_view(gltf, index_offset, len(index_bytes), target=34963)

    new_position_accessor = append_accessor(
        gltf,
        position_view,
        5126,
        len(kept_positions),
        "VEC3",
        mins=position_mins,
        maxes=position_maxes,
    )
    new_normal_accessor = append_accessor(
        gltf,
        normal_view,
        5126,
        len(kept_normals),
        "VEC3",
        mins=normal_mins,
        maxes=normal_maxes,
    )
    new_index_accessor = append_accessor(
        gltf,
        index_view,
        5123,
        len(kept_indices),
        "SCALAR",
    )

    primitive["attributes"] = {
        "POSITION": new_position_accessor,
        "NORMAL": new_normal_accessor,
    }
    primitive["indices"] = new_index_accessor
    return {
        "node": "Case_Base_Shell",
        "operation": "delete_ring_faces",
        "ringRows": list(ring_rows),
        "columnCount": column_count,
        "targetVertexCount": len(target_vertex_indices),
        "removedVertexCount": len(removed_vertex_indices),
        "removedTriangleCount": removed_triangle_count,
        "bridgeSegmentCount": bridge_segment_count,
        "bridgeTriangleCount": bridge_triangle_count,
        "keptVertexCount": len(kept_positions),
        "keptTriangleCount": len(kept_indices) // 3,
    }


def smooth_base_shell_upper_rings(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, _, _ = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    ring_stride = 7
    if len(positions) % ring_stride != 0:
        raise ValueError("Case_Base_Shell vertex layout is not divisible into expected 7-ring columns")

    column_count = len(positions) // ring_stride
    updated_rows = [list(row) for row in positions]
    moved_rows = 0
    max_delta_mm = 0.0
    ring_configs = (
        (5, 4),
        (6, 2),
    )

    for target_row, iterations in ring_configs:
        original_ring = [
            np.array(positions[(column_index * ring_stride) + target_row], dtype=float)
            for column_index in range(column_count)
        ]
        smoothed_ring = smooth_closed_ring(original_ring, iterations=iterations)
        for column_index, smoothed_point in enumerate(smoothed_ring):
            target_index = (column_index * ring_stride) + target_row
            delta_mm = float(np.linalg.norm((smoothed_point - original_ring[column_index]) * 1000.0))
            updated_rows[target_index] = [float(value) for value in smoothed_point]
            if delta_mm > 1e-6:
                moved_rows += 1
                max_delta_mm = max(max_delta_mm, delta_mm)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Base_Shell",
        "operation": "smooth_upper_rings",
        "ringRows": [target_row + 1 for target_row, _ in ring_configs],
        "columnCount": column_count,
        "iterationsByRing": {str(target_row + 1): iterations for target_row, iterations in ring_configs},
        "movedRows": moved_rows,
        "maxDeltaMm": round(max_delta_mm, 4),
    }


def restore_base_shell_reference_ring(
    gltf: dict,
    bin_chunk: bytearray,
    reference_positions: list[list[float]],
    *,
    source_ring_stride: int = 9,
    source_row_index: int = 4,
    target_ring_stride: int = 7,
    target_row_index: int = 4,
) -> dict[str, object]:
    node_index, _, _ = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    if len(reference_positions) % source_ring_stride != 0:
        raise ValueError("Reference Case_Base_Shell positions do not match expected source ring stride")
    if len(positions) % target_ring_stride != 0:
        raise ValueError("Current Case_Base_Shell positions do not match expected target ring stride")

    source_column_count = len(reference_positions) // source_ring_stride
    target_column_count = len(positions) // target_ring_stride
    if source_column_count != target_column_count:
        raise ValueError("Case_Base_Shell column counts do not match between reference and target")

    updated_rows = [list(row) for row in positions]
    moved_rows = 0
    max_delta_mm = 0.0
    for column_index in range(target_column_count):
        source_index = (column_index * source_ring_stride) + source_row_index
        target_index = (column_index * target_ring_stride) + target_row_index
        source_point = np.array(reference_positions[source_index], dtype=float)
        target_point = np.array(positions[target_index], dtype=float)
        delta_mm = float(np.linalg.norm((source_point - target_point) * 1000.0))
        updated_rows[target_index] = [float(value) for value in source_point]
        if delta_mm > 1e-6:
            moved_rows += 1
            max_delta_mm = max(max_delta_mm, delta_mm)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Base_Shell",
        "operation": "restore_reference_ring",
        "sourceRow": source_row_index + 1,
        "targetRow": target_row_index + 1,
        "columnCount": target_column_count,
        "movedRows": moved_rows,
        "maxDeltaMm": round(max_delta_mm, 4),
    }


def restore_base_shell_reference_row(
    gltf: dict,
    bin_chunk: bytearray,
    reference_positions: list[list[float]],
    *,
    source_ring_stride: int,
    source_row_index: int,
    target_ring_stride: int,
    target_row_index: int,
) -> dict[str, object]:
    node_index, _, _ = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)

    if len(reference_positions) % source_ring_stride != 0:
        raise ValueError("Reference Case_Base_Shell positions do not match expected source ring stride")
    if len(positions) % target_ring_stride != 0:
        raise ValueError("Current Case_Base_Shell positions do not match expected target ring stride")

    source_column_count = len(reference_positions) // source_ring_stride
    target_column_count = len(positions) // target_ring_stride
    if source_column_count != target_column_count:
        raise ValueError("Case_Base_Shell column counts do not match between reference and target")

    updated_rows = [list(row) for row in positions]
    moved_rows = 0
    max_delta_mm = 0.0
    for column_index in range(target_column_count):
        source_index = (column_index * source_ring_stride) + source_row_index
        target_index = (column_index * target_ring_stride) + target_row_index
        source_point = np.array(reference_positions[source_index], dtype=float)
        target_point = np.array(positions[target_index], dtype=float)
        delta_mm = float(np.linalg.norm((source_point - target_point) * 1000.0))
        updated_rows[target_index] = [float(value) for value in source_point]
        if delta_mm > 1e-6:
            moved_rows += 1
            max_delta_mm = max(max_delta_mm, delta_mm)

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Base_Shell",
        "operation": "restore_reference_row",
        "sourceRow": source_row_index + 1,
        "targetRow": target_row_index + 1,
        "columnCount": target_column_count,
        "movedRows": moved_rows,
        "maxDeltaMm": round(max_delta_mm, 4),
    }


def delete_base_shell_outermost_ring(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, _, _ = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    indices = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
    ring_stride = 7
    target_row = ring_stride - 1
    if len(positions) % ring_stride != 0:
        raise ValueError("Case_Base_Shell vertex layout is not divisible into expected 7-ring columns")

    column_count = len(positions) // ring_stride
    target_vertex_indices = {(column_index * ring_stride) + target_row for column_index in range(column_count)}

    kept_positions: list[list[float]] = []
    old_to_new: dict[int, int] = {}
    for old_index, row in enumerate(positions):
        if old_index in target_vertex_indices:
            continue
        old_to_new[old_index] = len(kept_positions)
        kept_positions.append(list(row))

    kept_indices: list[int] = []
    removed_triangle_count = 0
    for index_offset in range(0, len(indices), 3):
        triangle = indices[index_offset : index_offset + 3]
        if any(vertex_index in target_vertex_indices for vertex_index in triangle):
            removed_triangle_count += 1
            continue
        kept_indices.extend(old_to_new[vertex_index] for vertex_index in triangle)

    normals = [[0.0, 0.0, 0.0] for _ in kept_positions]
    for index_offset in range(0, len(kept_indices), 3):
        i0, i1, i2 = kept_indices[index_offset : index_offset + 3]
        p0 = np.array(kept_positions[i0], dtype=float)
        p1 = np.array(kept_positions[i1], dtype=float)
        p2 = np.array(kept_positions[i2], dtype=float)
        face = np.cross(p1 - p0, p2 - p0)
        for vertex_index in (i0, i1, i2):
            normals[vertex_index][0] += float(face[0])
            normals[vertex_index][1] += float(face[1])
            normals[vertex_index][2] += float(face[2])
    kept_normals = [list(normalize_vector(np.array(row, dtype=float))) for row in normals]

    position_mins, position_maxes = compute_rows_min_max(kept_positions)
    normal_mins, normal_maxes = compute_rows_min_max(kept_normals)

    position_bytes = b"".join(struct.pack("<3f", *row) for row in kept_positions)
    normal_bytes = b"".join(struct.pack("<3f", *row) for row in kept_normals)
    index_bytes = b"".join(struct.pack("<H", value) for value in kept_indices)

    position_offset = append_aligned_bytes(bin_chunk, position_bytes)
    normal_offset = append_aligned_bytes(bin_chunk, normal_bytes)
    index_offset = append_aligned_bytes(bin_chunk, index_bytes, alignment=4)

    position_view = append_buffer_view(gltf, position_offset, len(position_bytes), target=34962)
    normal_view = append_buffer_view(gltf, normal_offset, len(normal_bytes), target=34962)
    index_view = append_buffer_view(gltf, index_offset, len(index_bytes), target=34963)

    new_position_accessor = append_accessor(
        gltf,
        position_view,
        5126,
        len(kept_positions),
        "VEC3",
        mins=position_mins,
        maxes=position_maxes,
    )
    new_normal_accessor = append_accessor(
        gltf,
        normal_view,
        5126,
        len(kept_normals),
        "VEC3",
        mins=normal_mins,
        maxes=normal_maxes,
    )
    new_index_accessor = append_accessor(
        gltf,
        index_view,
        5123,
        len(kept_indices),
        "SCALAR",
    )

    primitive["attributes"] = {
        "POSITION": new_position_accessor,
        "NORMAL": new_normal_accessor,
    }
    primitive["indices"] = new_index_accessor
    return {
        "node": "Case_Base_Shell",
        "operation": "delete_outermost_ring",
        "ringRow": target_row + 1,
        "columnCount": column_count,
        "removedVertexCount": len(target_vertex_indices),
        "removedTriangleCount": removed_triangle_count,
        "keptVertexCount": len(kept_positions),
        "keptTriangleCount": len(kept_indices) // 3,
    }


def seal_base_shell_to_tray(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, to_product, to_local = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    product_positions = transform_local_rows(positions, to_product)

    ring_stride = 6
    if len(product_positions) % ring_stride != 0:
        raise ValueError("Case_Base_Shell vertex layout is not divisible into expected 6-ring columns")

    column_count = len(product_positions) // ring_stride
    base_row_index = 3
    top_row_index = 5
    updated_product_positions = [np.array(point, dtype=float) for point in product_positions]
    moved_rows = 0
    moved_columns = 0
    max_delta_mm = 0.0
    max_gap_mm = 0.0

    for column_index in range(column_count):
        base_index = (column_index * ring_stride) + base_row_index
        top_index = (column_index * ring_stride) + top_row_index

        base_point = np.array(updated_product_positions[base_index], dtype=float)
        top_point = np.array(updated_product_positions[top_index], dtype=float)

        target_x = float(base_point[0])
        target_z = float(base_point[2])
        tray_top_y = tray_surface_top_y(target_x, target_z)
        target_top_y = tray_top_y + BASE_SHELL_SEAL_CLEARANCE_M
        next_top_point = np.array([target_x, target_top_y, target_z], dtype=float)

        top_delta_mm = float(np.linalg.norm((next_top_point - top_point) * 1000.0))

        if top_delta_mm > 1e-6:
            updated_product_positions[top_index] = next_top_point
            moved_rows += 1
            max_delta_mm = max(max_delta_mm, top_delta_mm)
        if top_delta_mm > 1e-6:
            moved_columns += 1

        max_gap_mm = max(max_gap_mm, abs((target_top_y - tray_top_y) * 1000.0))

    updated_rows: list[list[float]] = []
    for updated_point in updated_product_positions:
        local_point = to_local @ np.array(
            [float(updated_point[0]), float(updated_point[1]), float(updated_point[2]), 1.0],
            dtype=float,
        )
        updated_rows.append(
            [
                float(local_point[0] / max(local_point[3], 1e-12)),
                float(local_point[1] / max(local_point[3], 1e-12)),
                float(local_point[2] / max(local_point[3], 1e-12)),
            ]
        )

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Base_Shell",
        "operation": "seal_to_tray_surface",
        "columnCount": column_count,
        "referenceRow": base_row_index + 1,
        "topRow": top_row_index + 1,
        "movedColumns": moved_columns,
        "movedRows": moved_rows,
        "sealClearanceMm": round(BASE_SHELL_SEAL_CLEARANCE_M * 1000.0, 4),
        "maxDeltaMm": round(max_delta_mm, 4),
        "maxGapMm": round(max_gap_mm, 4),
    }


def solidify_base_shell(gltf: dict, bin_chunk: bytearray, thickness_m: float = BASE_SHELL_WALL_THICKNESS_M) -> dict[str, object]:
    node_index, to_product, to_local = build_product_space_matrices(gltf, "Case_Base_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    positions_local_raw = read_accessor_rows(gltf, bin_chunk, position_accessor)
    indices_raw = read_accessor_scalars(gltf, bin_chunk, primitive["indices"])
    positions_local, indices, cleanup_stats = clean_indexed_surface_mesh(positions_local_raw, indices_raw)
    indices, notch_stitch_stats = stitch_sharp_boundary_notch(positions_local, indices)
    normals_local = compute_indexed_vertex_normals(positions_local, indices)

    product_positions = transform_local_rows(positions_local, to_product)
    transform_linear = to_product[:3, :3]
    normal_matrix = np.transpose(np.linalg.inv(transform_linear))
    product_normals = [
        normalize_vector(normal_matrix @ np.array(row, dtype=float))
        for row in normals_local
    ]

    shell_center = np.mean(np.stack(product_positions, axis=0), axis=0)
    average_alignment = float(
        np.mean(
            [
                np.dot(product_normals[index], product_positions[index] - shell_center)
                for index in range(len(product_positions))
            ]
        )
    )
    outward_scale = 1.0 if average_alignment >= 0.0 else -1.0
    outer_positions_product = [
        np.array(point, dtype=float) + (product_normals[index] * thickness_m * outward_scale)
        for index, point in enumerate(product_positions)
    ]
    coincident_groups: dict[tuple[float, float, float], list[int]] = {}
    for index, point in enumerate(product_positions):
        key = tuple(round(float(value), 9) for value in point)
        coincident_groups.setdefault(key, []).append(index)
    for group_indices in coincident_groups.values():
        if len(group_indices) <= 1:
            continue
        averaged_outer = np.mean(np.stack([outer_positions_product[index] for index in group_indices], axis=0), axis=0)
        for index in group_indices:
            outer_positions_product[index] = np.array(averaged_outer, dtype=float)

    edge_counts: dict[tuple[int, int], int] = {}
    boundary_oriented_edges: dict[tuple[int, int], tuple[int, int]] = {}
    triangle_indices = [tuple(indices[offset : offset + 3]) for offset in range(0, len(indices), 3)]
    for triangle in triangle_indices:
        for vertex_a, vertex_b in (
            (triangle[0], triangle[1]),
            (triangle[1], triangle[2]),
            (triangle[2], triangle[0]),
        ):
            edge = (min(vertex_a, vertex_b), max(vertex_a, vertex_b))
            edge_counts[edge] = edge_counts.get(edge, 0) + 1
            boundary_oriented_edges[edge] = (vertex_a, vertex_b)

    solid_positions_local: list[list[float]] = []
    solid_normals_local: list[list[float]] = []

    def append_product_triangle(p0_product: np.ndarray, p1_product: np.ndarray, p2_product: np.ndarray) -> None:
        local_triangle: list[np.ndarray] = []
        for product_point in (p0_product, p1_product, p2_product):
            local_point = to_local @ np.array(
                [float(product_point[0]), float(product_point[1]), float(product_point[2]), 1.0],
                dtype=float,
            )
            local_triangle.append(local_point[:3] / max(local_point[3], 1e-12))

        p0_local, p1_local, p2_local = local_triangle
        normal_local = normalize_vector(np.cross(p1_local - p0_local, p2_local - p0_local))
        for point_local in local_triangle:
            solid_positions_local.append([float(value) for value in point_local])
            solid_normals_local.append([float(value) for value in normal_local])

    for vertex_a, vertex_b, vertex_c in triangle_indices:
        append_product_triangle(
            outer_positions_product[vertex_a],
            outer_positions_product[vertex_b],
            outer_positions_product[vertex_c],
        )
        append_product_triangle(product_positions[vertex_a], product_positions[vertex_c], product_positions[vertex_b])

    bridge_triangle_count = 0
    skipped_boundary_edges = 0
    for edge, edge_count in edge_counts.items():
        if edge_count != 1:
            continue
        vertex_a, vertex_b = boundary_oriented_edges[edge]
        inner_a = np.array(product_positions[vertex_a], dtype=float)
        inner_b = np.array(product_positions[vertex_b], dtype=float)
        outer_a = np.array(outer_positions_product[vertex_a], dtype=float)
        outer_b = np.array(outer_positions_product[vertex_b], dtype=float)
        edge_direction = outer_b - outer_a
        if float(np.linalg.norm(edge_direction)) <= 1e-10:
            skipped_boundary_edges += 1
            continue
        average_normal = normalize_vector(product_normals[vertex_a] + product_normals[vertex_b])
        preferred_normal = np.cross(edge_direction, average_normal)
        if float(np.linalg.norm(preferred_normal)) <= 1e-10:
            preferred_normal = np.cross(edge_direction, outer_a - inner_a)
        side_triangles = oriented_quad_triangles(
            outer_a,
            outer_b,
            inner_b,
            inner_a,
            preferred_normal,
        )
        for side_triangle in side_triangles:
            append_product_triangle(*side_triangle)
            bridge_triangle_count += 1

    position_bytes = struct.pack(
        "<" + ("f" * (len(solid_positions_local) * 3)),
        *(value for row in solid_positions_local for value in row),
    )
    normal_bytes = struct.pack(
        "<" + ("f" * (len(solid_normals_local) * 3)),
        *(value for row in solid_normals_local for value in row),
    )
    position_offset = append_aligned_bytes(bin_chunk, position_bytes)
    normal_offset = append_aligned_bytes(bin_chunk, normal_bytes)
    gltf["buffers"][0]["byteLength"] = len(bin_chunk)

    position_view_index = append_buffer_view(gltf, position_offset, len(position_bytes), target=34962)
    normal_view_index = append_buffer_view(gltf, normal_offset, len(normal_bytes), target=34962)
    position_mins = [min(row[index] for row in solid_positions_local) for index in range(3)]
    position_maxes = [max(row[index] for row in solid_positions_local) for index in range(3)]
    normal_mins = [min(row[index] for row in solid_normals_local) for index in range(3)]
    normal_maxes = [max(row[index] for row in solid_normals_local) for index in range(3)]

    position_accessor_index = append_accessor(
        gltf,
        position_view_index,
        component_type=5126,
        count=len(solid_positions_local),
        accessor_type="VEC3",
        mins=position_mins,
        maxes=position_maxes,
    )
    normal_accessor_index = append_accessor(
        gltf,
        normal_view_index,
        component_type=5126,
        count=len(solid_normals_local),
        accessor_type="VEC3",
        mins=normal_mins,
        maxes=normal_maxes,
    )

    primitive["attributes"] = {
        "POSITION": position_accessor_index,
        "NORMAL": normal_accessor_index,
    }
    primitive.pop("indices", None)
    primitive["mode"] = 4

    return {
        "node": "Case_Base_Shell",
        "operation": "solidify_shell",
        "wallThicknessMm": round(thickness_m * 1000.0, 4),
        "surfaceMode": "sealed_source_as_inner_surface",
        "sourceVertexCount": cleanup_stats["sourceVertexCount"],
        "cleanedSourceVertexCount": len(positions_local),
        "removedSourceVertexCount": cleanup_stats["removedVertexCount"],
        "sourceTriangleCount": cleanup_stats["sourceTriangleCount"],
        "cleanedSourceTriangleCount": len(indices) // 3,
        "removedDegenerateSourceTriangleCount": cleanup_stats["removedDegenerateTriangleCount"],
        "removedDuplicateSourceTriangleCount": cleanup_stats["removedDuplicateTriangleCount"],
        "notchStitchChangeLog": notch_stitch_stats,
        "boundaryEdgeCount": sum(1 for count in edge_counts.values() if count == 1),
        "bridgeTriangleCount": bridge_triangle_count,
        "skippedBoundaryEdges": skipped_boundary_edges,
        "outputVertexCount": len(solid_positions_local),
        "outputTriangleCount": len(solid_positions_local) // 3,
    }


def shorten_lid_side_wall_height(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, to_product, to_local = build_product_space_matrices(gltf, "Case_Lid_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    product_positions = transform_local_rows(positions, to_product)

    updated_rows: list[list[float]] = []
    moved_rows = 0
    max_delta_y_mm = 0.0

    for row, point in zip(positions, product_positions):
        x_mm = float(point[0] * 1000.0)
        y_mm = float(point[1] * 1000.0)
        z_mm = float(point[2] * 1000.0)
        updated_point = np.array(point, dtype=float)

        if 18.0 <= x_mm <= 40.0 and 9.0 <= y_mm <= 13.9 and abs(z_mm) >= 8.8:
            x_weight = smoothstep(18.0, 24.0, x_mm)
            z_weight = smoothstep(8.8, 11.6, abs(z_mm))
            low_band_weight = 1.0 - smoothstep(12.2, 13.9, y_mm)
            weight = x_weight * z_weight * low_band_weight
            target_floor_y_mm = lerp(12.7, 12.1, smoothstep(18.0, 39.0, x_mm))
            if target_floor_y_mm > y_mm and weight > 1e-6:
                updated_point[1] = lerp(y_mm, target_floor_y_mm, weight) / 1000.0
                max_delta_y_mm = max(max_delta_y_mm, abs(y_mm - (updated_point[1] * 1000.0)))

        local_point = to_local @ np.array([updated_point[0], updated_point[1], updated_point[2], 1.0], dtype=float)
        updated_rows.append(
            [
                float(local_point[0] / max(local_point[3], 1e-12)),
                float(local_point[1] / max(local_point[3], 1e-12)),
                float(local_point[2] / max(local_point[3], 1e-12)),
            ]
        )
        if np.linalg.norm(updated_point - point) > 1e-10:
            moved_rows += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Lid_Shell",
        "operation": "shorten_side_wall_height",
        "movedRows": moved_rows,
        "maxDeltaYmm": round(max_delta_y_mm, 4),
    }


def press_lid_shell_edge_flat(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    node_index, to_product, to_local = build_product_space_matrices(gltf, "Case_Lid_Shell")
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    product_positions = transform_local_rows(positions, to_product)

    updated_rows: list[list[float]] = []
    moved_rows = 0
    max_delta_y_mm = 0.0

    for row, point in zip(positions, product_positions):
        x_mm = float(point[0] * 1000.0)
        y_mm = float(point[1] * 1000.0)
        z_mm = float(point[2] * 1000.0)
        updated_point = np.array(point, dtype=float)

        if 13.5 <= x_mm <= 36.8 and -12.6 <= z_mm <= -6.8 and 8.6 <= y_mm <= 13.8:
            x_weight = smoothstep(13.5, 19.0, x_mm) * (1.0 - smoothstep(34.2, 36.8, x_mm))
            z_weight = smoothstep(6.8, 8.8, -z_mm)
            low_band_weight = 1.0 - smoothstep(12.3, 13.8, y_mm)
            weight = min(1.0, x_weight * z_weight * low_band_weight * 1.75)
            target_floor_y_mm = lerp(12.0, 11.35, smoothstep(14.0, 36.0, x_mm))
            if target_floor_y_mm > y_mm and weight > 1e-6:
                updated_point[1] = lerp(y_mm, target_floor_y_mm, weight) / 1000.0
                max_delta_y_mm = max(max_delta_y_mm, abs(y_mm - (updated_point[1] * 1000.0)))

        local_point = to_local @ np.array([updated_point[0], updated_point[1], updated_point[2], 1.0], dtype=float)
        updated_rows.append(
            [
                float(local_point[0] / max(local_point[3], 1e-12)),
                float(local_point[1] / max(local_point[3], 1e-12)),
                float(local_point[2] / max(local_point[3], 1e-12)),
            ]
        )
        if np.linalg.norm(updated_point - point) > 1e-10:
            moved_rows += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)
    return {
        "node": "Case_Lid_Shell",
        "operation": "press_edge_flat",
        "movedRows": moved_rows,
        "maxDeltaYmm": round(max_delta_y_mm, 4),
    }


def seam_drop_mm(x_mm: float) -> float:
    if x_mm <= 8.0:
        return 0.0
    if x_mm <= 18.0:
        return lerp(0.0, 1.25, smoothstep(8.0, 18.0, x_mm))
    if x_mm <= 29.0:
        return lerp(1.25, 3.05, smoothstep(18.0, 29.0, x_mm))
    return lerp(3.05, 3.95, smoothstep(29.0, 35.0, x_mm))


def seam_center_shift_mm(x_mm: float) -> float:
    if x_mm <= 8.0:
        return 0.0
    if x_mm <= 18.0:
        return lerp(0.0, -4.8, smoothstep(8.0, 18.0, x_mm))
    if x_mm <= 28.0:
        return lerp(-4.8, -1.35, smoothstep(18.0, 28.0, x_mm))
    return lerp(-1.35, 4.2, smoothstep(28.0, 35.0, x_mm))


def seam_pitch_mm(x_mm: float) -> float:
    if x_mm <= 10.0:
        return 0.0
    if x_mm <= 22.0:
        return lerp(0.0, 1.45, smoothstep(10.0, 22.0, x_mm))
    if x_mm <= 30.0:
        return lerp(1.45, 1.85, smoothstep(22.0, 30.0, x_mm))
    return lerp(1.85, 1.25, smoothstep(30.0, 35.0, x_mm))


def seam_width_scale(x_mm: float) -> float:
    if x_mm <= 8.0:
        return 1.0
    if x_mm <= 22.0:
        return lerp(1.0, 0.81, smoothstep(8.0, 22.0, x_mm))
    return lerp(0.81, 0.9, smoothstep(22.0, 35.0, x_mm))


def capsule_radius_mm_at_x(x_mm: float, radius_mm: float, body_half_length_mm: float) -> float:
    abs_x = abs(x_mm)
    if abs_x <= body_half_length_mm:
        return radius_mm
    cap_offset = abs_x - body_half_length_mm
    return math.sqrt(max((radius_mm * radius_mm) - (cap_offset * cap_offset), 0.0))


def deform_shell_band(
    gltf: dict,
    bin_chunk: bytearray,
    node_name: str,
    y_band: tuple[float, float],
    x_band_mm: tuple[float, float],
    x_center_mm: float,
    x_radius_mm: float,
    base_weight: float,
    y_drop_scale: float,
    z_shift_scale: float,
    top_crown_drop_scale: float = 0.0,
    top_crown_band: tuple[float, float] | None = None,
    protect_center_product: tuple[float, float, float] | None = None,
    protect_inner_radius_mm: float = 0.0,
    protect_outer_radius_mm: float = 0.0,
    barrelize: bool = False,
    barrel_outer_radius_mm: float = 16.2,
    barrel_body_half_length_mm: float = 26.75,
    barrel_inner_offset_mm: float = 2.25,
) -> dict[str, object]:
    named_node_indices = get_named_node_indices(gltf)
    node_index, to_product, to_local = build_product_space_matrices(gltf, node_name)
    primitive = gltf["meshes"][gltf["nodes"][node_index]["mesh"]]["primitives"][0]
    position_accessor = primitive["attributes"]["POSITION"]
    normal_accessor = primitive["attributes"]["NORMAL"]
    positions = read_accessor_rows(gltf, bin_chunk, position_accessor)
    product_positions = transform_local_rows(positions, to_product)

    updated_rows: list[list[float]] = []
    moved_rows = 0
    max_delta_y_mm = 0.0
    max_delta_z_mm = 0.0

    for row, point in zip(positions, product_positions):
        x_mm = float(point[0] * 1000.0)
        y_mm = float(point[1] * 1000.0)
        z_mm = float(point[2] * 1000.0)

        y_weight = smoothstep(y_band[0], y_band[1], point[1])
        if y_band[0] > y_band[1]:
            y_weight = 1.0 - smoothstep(y_band[1], y_band[0], point[1])
        x_weight = smoothstep(x_band_mm[0] / 1000.0, x_band_mm[1] / 1000.0, point[0])
        lateral_profile = max(0.0, 1.0 - (abs(x_mm - x_center_mm) / max(x_radius_mm, 1e-6)))
        lateral_weight = (0.30 + (0.70 * lateral_profile))
        weight = base_weight * y_weight * x_weight * lateral_weight

        if protect_center_product is not None and protect_outer_radius_mm > 0.0:
            distance_mm = math.dist(
                (point[0] * 1000.0, point[1] * 1000.0, point[2] * 1000.0),
                protect_center_product,
            )
            protect_weight = smoothstep(protect_inner_radius_mm, protect_outer_radius_mm, distance_mm)
            weight *= protect_weight

        next_point = np.array(point, dtype=float)
        if weight > 1e-6:
            drop_mm = seam_drop_mm(x_mm) * y_drop_scale
            center_shift_mm = seam_center_shift_mm(x_mm) * z_shift_scale
            width_scale = seam_width_scale(x_mm)
            pitch_mm = seam_pitch_mm(x_mm)
            z_normalized = max(-1.0, min(1.0, (z_mm - center_shift_mm) / 8.5))
            front_bias_drop_mm = ((1.0 - z_normalized) * 0.5) * pitch_mm

            target_y_mm = y_mm - drop_mm - front_bias_drop_mm
            target_z_mm = center_shift_mm + (z_mm * width_scale)
            next_point[1] = lerp(y_mm, target_y_mm, weight) / 1000.0
            next_point[2] = lerp(z_mm, target_z_mm, min(weight * 0.82, 1.0)) / 1000.0

            if top_crown_band is not None and top_crown_drop_scale > 0.0:
                crown_weight = smoothstep(top_crown_band[0], top_crown_band[1], point[1])
                crown_drop_mm = seam_drop_mm(x_mm) * top_crown_drop_scale * crown_weight
                next_point[1] -= crown_drop_mm / 1000.0

            max_delta_y_mm = max(max_delta_y_mm, abs((next_point[1] - point[1]) * 1000.0))
            max_delta_z_mm = max(max_delta_z_mm, abs((next_point[2] - point[2]) * 1000.0))

        if barrelize:
            radial_mm = math.sqrt((next_point[1] * 1000.0) ** 2 + (next_point[2] * 1000.0) ** 2)
            if radial_mm > 1e-6:
                target_outer_radius_mm = capsule_radius_mm_at_x(x_mm, barrel_outer_radius_mm, barrel_body_half_length_mm)
                target_inner_radius_mm = max(target_outer_radius_mm - barrel_inner_offset_mm, target_outer_radius_mm * 0.76)
                target_radius_mm = target_outer_radius_mm if radial_mm >= (target_inner_radius_mm + 1.0) else target_inner_radius_mm
                radial_scale = target_radius_mm / radial_mm
                radial_weight = 0.78 if radial_mm >= (target_inner_radius_mm + 1.0) else 0.62
                next_point[1] = lerp(next_point[1], next_point[1] * radial_scale, radial_weight)
                next_point[2] = lerp(next_point[2], next_point[2] * radial_scale, radial_weight)

        local_point = to_local @ np.array([next_point[0], next_point[1], next_point[2], 1.0], dtype=float)
        updated_rows.append(
            [
                float(local_point[0] / max(local_point[3], 1e-12)),
                float(local_point[1] / max(local_point[3], 1e-12)),
                float(local_point[2] / max(local_point[3], 1e-12)),
            ]
        )
        if np.linalg.norm(next_point - point) > 1e-10:
            moved_rows += 1

    updated_normals = recalculate_normals(gltf, bin_chunk, primitive, updated_rows)
    write_accessor_rows(gltf, bin_chunk, position_accessor, updated_rows)
    write_accessor_rows(gltf, bin_chunk, normal_accessor, updated_normals)
    update_accessor_min_max(gltf, position_accessor, updated_rows)
    update_accessor_min_max(gltf, normal_accessor, updated_normals)

    return {
        "node": node_name,
        "movedRows": moved_rows,
        "maxDeltaYmm": round(max_delta_y_mm, 4),
        "maxDeltaZmm": round(max_delta_z_mm, 4),
        "dropAtEarbudMm": round(seam_drop_mm(0.0) * y_drop_scale, 4),
        "dropAtCameraMm": round(seam_drop_mm(29.0) * y_drop_scale, 4),
        "centerShiftLeftMm": round(seam_center_shift_mm(-12.0) * z_shift_scale, 4),
        "centerShiftRightMm": round(seam_center_shift_mm(24.0) * z_shift_scale, 4),
        "pitchAtEarbudMm": round(seam_pitch_mm(0.0), 4),
        "pitchAtCameraMm": round(seam_pitch_mm(29.0), 4),
    }


def apply_phase_1(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    rotation_change_log = apply_horizontal_case_rotation(gltf, 90.0)
    layout_change_log = apply_device_layout_v4(gltf)
    tray_change_log = append_sculpted_tray_mesh(gltf, bin_chunk)
    shell_join_change_log = depress_base_shell_for_tray_join(gltf, bin_chunk)
    return {
        "phase": 1,
        "name": PHASE_NAMES[1],
        "rotationChangeLog": rotation_change_log,
        "deviceLayoutChangeLog": layout_change_log,
        "trayChangeLog": tray_change_log,
        "shellJoinChangeLog": shell_join_change_log,
    }


def apply_phase_2(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    named_node_indices = get_named_node_indices(gltf)
    _, get_world_matrix = build_world_matrix_getter(gltf)
    product_root_index = named_node_indices["QIHANG_Product"]
    pin_index = named_node_indices["Pivot_Pin_Printable"]
    product_inverse = np.linalg.inv(get_world_matrix(product_root_index))
    pin_world = product_inverse @ get_world_matrix(pin_index) @ np.array([0.0, 0.0, 0.0, 1.0], dtype=float)
    pin_center_product = tuple(float(value) * 1000.0 for value in (pin_world[:3] / max(pin_world[3], 1e-12)))
    base_shell_node_index = named_node_indices["Case_Base_Shell"]
    base_shell_primitive = gltf["meshes"][gltf["nodes"][base_shell_node_index]["mesh"]]["primitives"][0]
    base_shell_reference_positions = read_accessor_rows(
        gltf, bin_chunk, base_shell_primitive["attributes"]["POSITION"]
    )
    shell_change = deform_shell_band(
        gltf,
        bin_chunk,
        "Case_Base_Shell",
        y_band=(0.0048, 0.0128),
        x_band_mm=(7.5, 34.5),
        x_center_mm=26.0,
        x_radius_mm=14.5,
        base_weight=1.0,
        y_drop_scale=0.95,
        z_shift_scale=1.08,
        protect_center_product=pin_center_product,
        protect_inner_radius_mm=13.0,
        protect_outer_radius_mm=24.0,
        barrelize=False,
    )
    wall_height_change = depress_base_shell_for_tray_join(gltf, bin_chunk)
    edge_alignment_change = snap_base_shell_edge_to_ramp_profile(gltf, bin_chunk)
    ring_delete_change = delete_base_shell_ring_faces(gltf, bin_chunk)
    upper_ring_smooth_change = smooth_base_shell_upper_rings(gltf, bin_chunk)
    reference_ring_change = restore_base_shell_reference_ring(
        gltf,
        bin_chunk,
        base_shell_reference_positions,
    )
    outermost_ring_delete_change = delete_base_shell_outermost_ring(gltf, bin_chunk)
    reference_wall_row_change = restore_base_shell_reference_row(
        gltf,
        bin_chunk,
        base_shell_reference_positions,
        source_ring_stride=9,
        source_row_index=3,
        target_ring_stride=6,
        target_row_index=3,
    )
    shell_tray_seal_change = seal_base_shell_to_tray(gltf, bin_chunk)
    shell_solidify_change = solidify_base_shell(gltf, bin_chunk)
    return {
        "phase": 2,
        "name": PHASE_NAMES[2],
        "shellChangeLog": shell_change,
        "wallHeightChangeLog": wall_height_change,
        "edgeAlignmentChangeLog": edge_alignment_change,
        "ringDeleteChangeLog": ring_delete_change,
        "upperRingSmoothChangeLog": upper_ring_smooth_change,
        "referenceRingRestoreChangeLog": reference_ring_change,
        "outermostRingDeleteChangeLog": outermost_ring_delete_change,
        "referenceWallRowRestoreChangeLog": reference_wall_row_change,
        "shellTraySealChangeLog": shell_tray_seal_change,
        "shellSolidifyChangeLog": shell_solidify_change,
    }


def apply_phase_3(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    named_node_indices = get_named_node_indices(gltf)
    _, get_world_matrix = build_world_matrix_getter(gltf)
    product_root_index = named_node_indices["QIHANG_Product"]
    hole_index = named_node_indices["Lid_Pivot_Hole_Center"]
    product_inverse = np.linalg.inv(get_world_matrix(product_root_index))
    hole_world = product_inverse @ get_world_matrix(hole_index) @ np.array([0.0, 0.0, 0.0, 1.0], dtype=float)
    hole_center_product = tuple(float(value) * 1000.0 for value in (hole_world[:3] / max(hole_world[3], 1e-12)))
    shell_change = deform_shell_band(
        gltf,
        bin_chunk,
        "Case_Lid_Shell",
        y_band=(0.0160, 0.0115),
        x_band_mm=(7.5, 34.5),
        x_center_mm=26.0,
        x_radius_mm=14.5,
        base_weight=1.0,
        y_drop_scale=0.78,
        z_shift_scale=1.0,
        top_crown_drop_scale=0.06,
        top_crown_band=(0.0156, 0.0186),
        protect_center_product=hole_center_product,
        protect_inner_radius_mm=12.0,
        protect_outer_radius_mm=23.0,
        barrelize=False,
    )
    wall_height_change = shorten_lid_side_wall_height(gltf, bin_chunk)
    return {
        "phase": 3,
        "name": PHASE_NAMES[3],
        "shellChangeLog": shell_change,
        "wallHeightChangeLog": wall_height_change,
    }


def default_output_path(phase: int) -> Path:
    return Path(f"output/debug_v4/qihang_product_pearl_phase{phase}.glb")


def default_report_path(phase: int) -> Path:
    return Path(f"output/debug_v4/qihang_product_pearl_phase{phase}.json")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the staged V4 qihang pearl case with taiji split geometry.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path("apps/web/public/qihang_product_pearl_V2.glb"),
        help="Immutable V2 source GLB path.",
    )
    parser.add_argument(
        "--phase",
        type=int,
        choices=(1, 2, 3),
        default=3,
        help="Apply phases cumulatively up to this stage.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output GLB path. Defaults to output/debug_v4/qihang_product_pearl_phaseN.glb.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="JSON report path. Defaults to output/debug_v4/qihang_product_pearl_phaseN.json.",
    )
    args = parser.parse_args()

    output_path = args.output or default_output_path(args.phase)
    report_path = args.report or default_report_path(args.phase)

    gltf, bin_chunk = parse_glb(args.input)
    phase_logs: list[dict[str, object]] = []
    phase_logs.append(apply_phase_1(gltf, bin_chunk))
    if args.phase >= 2:
        phase_logs.append(apply_phase_2(gltf, bin_chunk))
    if args.phase >= 3:
        phase_logs.append(apply_phase_3(gltf, bin_chunk))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    write_glb(output_path, gltf, bin_chunk)
    report_gltf, report_bin_chunk = parse_glb(output_path)
    report = build_baseline_report(output_path, report_gltf, report_bin_chunk)
    report["sourceInputPath"] = str(args.input)
    report["sourceInputSha256"] = sha256_for_bytes(args.input.read_bytes())
    report["outputSha256"] = sha256_for_bytes(output_path.read_bytes())
    report["phase"] = args.phase
    report["phaseName"] = PHASE_NAMES[args.phase]
    report["phaseLogs"] = phase_logs
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {
        "input": str(args.input),
        "output": str(output_path),
        "report": str(report_path),
        "phase": args.phase,
        "phaseName": PHASE_NAMES[args.phase],
        "outputSha256": report["outputSha256"],
        "phaseLogs": phase_logs,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
