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
    append_accessor,
    append_aligned_bytes,
    append_buffer_view,
    apply_horizontal_case_rotation,
    build_baseline_report,
    build_world_matrix_getter,
    get_named_node_indices,
    parse_glb,
    quaternion_multiply,
    quaternion_to_matrix,
    read_accessor_rows,
    rotate_vector_about_y,
    set_node_origin_in_product_space,
    sha256_for_bytes,
    write_glb,
)


TRAY_NODE_NAME = "Case_Base_Linear_Tray_V3"
PLATFORM_NODE_NAME = "Case_Base_Platform_V4"
RAMP_NODE_NAME = "Case_Base_Arc_Ramp_V4"
PHASE_NAMES = {
    1: "tray_ramp",
    2: "base_shell_split",
    3: "lid_shell_cover",
}
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


def tray_half_width(x_value: float) -> float:
    x_mm = float(x_value) * 1000.0
    if x_mm <= 27.5:
        return 0.0151
    return lerp(0.0151, 0.0132, smoothstep(27.5, 38.8, x_mm))


def tray_center_z(x_value: float) -> float:
    return 0.0


def tray_split_boundary_x(z_value: float) -> float:
    arc_mid_z = tray_center_z(0.0)
    arc_half_span = tray_half_width(0.0) * 0.84
    normalized = max(-1.0, min(1.0, (z_value - arc_mid_z) / arc_half_span))
    arc = math.sqrt(max(0.0, 1.0 - (normalized * normalized)))
    return -0.0228 + (0.0032 * arc)


def ramp_tip_end_x(span_ratio: float) -> float:
    normalized = max(-1.0, min(1.0, float(span_ratio)))
    arc = math.sqrt(max(0.0, 1.0 - (normalized * normalized)))
    return 0.0360 + (0.0028 * arc)


def platform_surface_top_y(x_value: float, z_value: float) -> float:
    return tray_platform_height_y(x_value)


def ramp_surface_top_y(x_value: float, z_value: float) -> float:
    span_ratio = max(-1.0, min(1.0, (z_value - tray_center_z(x_value)) / max(tray_half_width(x_value), 1e-9)))
    return 0.0060 + (tray_pitch_height(x_value) * math.sin(span_ratio * (math.pi * 0.5)))


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
    platform_x_start = -0.0365
    progress_stations = np.linspace(0.0, 1.0, 9)
    span_stations = np.linspace(-1.0, 1.0, 15)
    top_grid: list[list[np.ndarray]] = []
    bottom_grid: list[list[np.ndarray]] = []

    for progress in progress_stations:
        top_row: list[np.ndarray] = []
        bottom_row: list[np.ndarray] = []
        for span in span_stations:
            z_value = tray_center_z(0.0) + (tray_half_width(0.0) * float(span))
            boundary_x = tray_split_boundary_x(float(z_value))
            x_value = lerp(platform_x_start, boundary_x, float(progress))
            top_row.append(
                np.array([x_value, platform_surface_top_y(float(x_value), float(z_value)), z_value], dtype=float)
            )
            bottom_row.append(
                np.array([x_value, tray_surface_bottom_y(float(x_value), float(z_value)), z_value], dtype=float)
            )
        top_grid.append(top_row)
        bottom_grid.append(bottom_row)
    return build_thin_surface_triangles(top_grid, bottom_grid, cap_z_edges=False)


def build_arc_ramp_triangles_product() -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    progress_stations = np.linspace(0.0, 1.0, 27)
    span_stations = np.linspace(-1.0, 1.0, 17)
    top_grid: list[list[np.ndarray]] = []
    bottom_grid: list[list[np.ndarray]] = []

    for progress in progress_stations:
        top_row: list[np.ndarray] = []
        bottom_row: list[np.ndarray] = []
        for span in span_stations:
            span_ratio = float(span)
            boundary_sample_z = tray_center_z(0.0) + (tray_half_width(0.0) * span_ratio)
            boundary_x = tray_split_boundary_x(float(boundary_sample_z))
            x_value = lerp(boundary_x, ramp_tip_end_x(span_ratio), float(progress))
            z_value = tray_center_z(float(x_value)) + (tray_half_width(float(x_value)) * span_ratio)
            top_row.append(np.array([x_value, ramp_surface_top_y(float(x_value), float(z_value)), z_value], dtype=float))
            bottom_row.append(
                np.array([x_value, tray_surface_bottom_y(float(x_value), float(z_value)), z_value], dtype=float)
            )
        top_grid.append(top_row)
        bottom_grid.append(bottom_row)
    return build_thin_surface_triangles(top_grid, bottom_grid, cap_z_edges=False)


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
        "integrationMode": "split_internal_surfaces",
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
    return {
        "phase": 2,
        "name": PHASE_NAMES[2],
        "shellChangeLog": shell_change,
        "wallHeightChangeLog": wall_height_change,
        "edgeAlignmentChangeLog": edge_alignment_change,
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
