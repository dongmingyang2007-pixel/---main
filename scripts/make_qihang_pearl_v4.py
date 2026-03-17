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
PHASE_NAMES = {
    1: "tray_ramp",
    2: "base_shell_split",
    3: "lid_shell_cover",
}
PHASE_DEVICE_TARGETS_PRODUCT_M = {
    "Earbud_Left": (-0.0105, -0.00105, -0.00135),
    "DockWell_L": (-0.0105, 0.009545, -0.00135),
    "Earbud_Right": (0.0087, -0.00135, 0.00035),
    "DockWell_R": (0.0087, 0.009545, 0.00035),
    "Brooch_Camera": (0.0288, 0.00175, 0.00115),
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
    for node_name, degrees in (("Earbud_Left", 12.0), ("Earbud_Right", 12.0), ("Brooch_Camera", 8.0)):
        node = gltf["nodes"][named_node_indices[node_name]]
        original_rotation = [float(value) for value in node.get("rotation", [0.0, 0.0, 0.0, 1.0])]
        tilt_quaternion = quaternion_about_axis((1.0, 0.0, 0.0), degrees)
        node["rotation"] = quaternion_multiply(tilt_quaternion, original_rotation)
        change_log.append(
            {
                "node": node_name,
                "rotationBefore": [round(value, 8) for value in original_rotation],
                "rotationAfter": [round(float(value), 8) for value in node["rotation"]],
                "tiltDegreesAboutProductX": degrees,
            }
        )

    return change_log


def tray_platform_height_y(x_value: float) -> float:
    if x_value <= -0.022:
        return 0.00285
    if x_value <= -0.010:
        return lerp(0.00285, 0.00165, smoothstep(-0.022, -0.010, x_value))
    if x_value <= 0.022:
        return lerp(0.00165, -0.00245, smoothstep(-0.010, 0.022, x_value))
    return lerp(-0.00245, -0.00305, smoothstep(0.022, 0.035, x_value))


def tray_pitch_height(x_value: float) -> float:
    if x_value <= -0.017:
        return 0.0
    if x_value <= -0.004:
        return lerp(0.0, 0.00135, smoothstep(-0.017, -0.004, x_value))
    if x_value <= 0.022:
        return lerp(0.00135, 0.00215, smoothstep(-0.004, 0.022, x_value))
    return lerp(0.00215, 0.00180, smoothstep(0.022, 0.035, x_value))


def tray_half_width(x_value: float) -> float:
    if x_value <= -0.016:
        return 0.00690
    if x_value <= 0.016:
        return lerp(0.00690, 0.00595, smoothstep(-0.016, 0.016, x_value))
    return lerp(0.00595, 0.00485, smoothstep(0.016, 0.035, x_value))


def tray_center_z(x_value: float) -> float:
    if x_value <= -0.020:
        return 0.00190
    if x_value <= 0.004:
        return lerp(0.00190, -0.00160, smoothstep(-0.020, 0.004, x_value))
    return lerp(-0.00160, -0.00035, smoothstep(0.004, 0.035, x_value))


def tray_surface_top_y(x_value: float, z_value: float) -> float:
    center_z = tray_center_z(x_value)
    half_width = tray_half_width(x_value)
    span_ratio = max(-1.0, min(1.0, (z_value - center_z) / max(half_width, 1e-9)))
    return tray_platform_height_y(x_value) + (tray_pitch_height(x_value) * span_ratio)


def tray_surface_bottom_y(x_value: float, z_value: float) -> float:
    thickness = lerp(0.00265, 0.00310, smoothstep(-0.010, 0.030, x_value))
    return tray_surface_top_y(x_value, z_value) - thickness


def build_sculpted_tray_triangles_product() -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    def oriented_triangles(
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

    x_stations = np.linspace(-0.0365, 0.0350, 33)
    span_stations = np.linspace(-1.0, 1.0, 13)
    top_grid: list[list[np.ndarray]] = []
    bottom_grid: list[list[np.ndarray]] = []

    for x_value in x_stations:
        center_z = tray_center_z(float(x_value))
        half_width = tray_half_width(float(x_value))
        top_row: list[np.ndarray] = []
        bottom_row: list[np.ndarray] = []
        for span in span_stations:
            z_value = center_z + (half_width * float(span))
            top_row.append(
                np.array(
                    [x_value, tray_surface_top_y(float(x_value), float(z_value)), z_value],
                    dtype=float,
                )
            )
            bottom_row.append(
                np.array(
                    [x_value, tray_surface_bottom_y(float(x_value), float(z_value)), z_value],
                    dtype=float,
                )
            )
        top_grid.append(top_row)
        bottom_grid.append(bottom_row)

    triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for x_index in range(len(x_stations) - 1):
        for span_index in range(len(span_stations) - 1):
            top_a = top_grid[x_index][span_index]
            top_b = top_grid[x_index + 1][span_index]
            top_c = top_grid[x_index + 1][span_index + 1]
            top_d = top_grid[x_index][span_index + 1]
            bottom_a = bottom_grid[x_index][span_index]
            bottom_b = bottom_grid[x_index + 1][span_index]
            bottom_c = bottom_grid[x_index + 1][span_index + 1]
            bottom_d = bottom_grid[x_index][span_index + 1]

            triangles.extend(
                oriented_triangles(
                    top_a,
                    top_b,
                    top_c,
                    top_d,
                    np.array([0.0, 1.0, 0.0], dtype=float),
                )
            )
            triangles.extend(
                oriented_triangles(
                    bottom_d,
                    bottom_c,
                    bottom_b,
                    bottom_a,
                    np.array([0.0, -1.0, 0.0], dtype=float),
                )
            )

    for x_index in range(len(x_stations) - 1):
        front_top_a = top_grid[x_index][0]
        front_top_b = top_grid[x_index + 1][0]
        front_bottom_b = bottom_grid[x_index + 1][0]
        front_bottom_a = bottom_grid[x_index][0]
        triangles.extend(
            oriented_triangles(
                front_top_a,
                front_top_b,
                front_bottom_b,
                front_bottom_a,
                np.array([0.0, 0.0, -1.0], dtype=float),
            )
        )

        back_top_a = top_grid[x_index][-1]
        back_top_b = top_grid[x_index + 1][-1]
        back_bottom_b = bottom_grid[x_index + 1][-1]
        back_bottom_a = bottom_grid[x_index][-1]
        triangles.extend(
            oriented_triangles(
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
    for span_index in range(len(span_stations) - 1):
        triangles.extend(
            oriented_triangles(
                start_bottom[span_index],
                start_bottom[span_index + 1],
                start_top[span_index + 1],
                start_top[span_index],
                np.array([-1.0, 0.0, 0.0], dtype=float),
            )
        )
        triangles.extend(
            oriented_triangles(
                end_top[span_index],
                end_top[span_index + 1],
                end_bottom[span_index + 1],
                end_bottom[span_index],
                np.array([1.0, 0.0, 0.0], dtype=float),
            )
        )
    return triangles


def append_sculpted_tray_mesh(gltf: dict, bin_chunk: bytearray) -> dict[str, object]:
    named_node_indices = get_named_node_indices(gltf)
    if TRAY_NODE_NAME in named_node_indices:
        raise ValueError(f"{TRAY_NODE_NAME} already exists; expected a clean V2 input.")

    _, get_world_matrix = build_world_matrix_getter(gltf)
    product_root_index = named_node_indices["QIHANG_Product"]
    case_base_index = named_node_indices["Case_Base"]
    product_inverse = np.linalg.inv(get_world_matrix(product_root_index))
    case_base_in_product = product_inverse @ get_world_matrix(case_base_index)
    product_to_case_base = np.linalg.inv(case_base_in_product)

    product_triangles = build_sculpted_tray_triangles_product()
    local_positions: list[list[float]] = []
    local_normals: list[list[float]] = []
    product_points: list[np.ndarray] = []

    for p0_product, p1_product, p2_product in product_triangles:
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

    base_shell_primitive = gltf["meshes"][gltf["nodes"][named_node_indices["Case_Base_Shell"]]["mesh"]]["primitives"][0]
    tray_mesh_index = len(gltf["meshes"])
    gltf["meshes"].append(
        {
            "name": TRAY_NODE_NAME,
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

    tray_node_index = len(gltf["nodes"])
    gltf["nodes"].append(
        {
            "name": TRAY_NODE_NAME,
            "mesh": tray_mesh_index,
        }
    )
    gltf["nodes"][case_base_index].setdefault("children", []).append(tray_node_index)

    mins_product = np.min(np.stack(product_points, axis=0), axis=0)
    maxs_product = np.max(np.stack(product_points, axis=0), axis=0)
    return {
        "node": TRAY_NODE_NAME,
        "meshIndex": tray_mesh_index,
        "nodeIndex": tray_node_index,
        "triangleCount": len(product_triangles),
        "bboxMinProductMm": [round(float(value) * 1000.0, 4) for value in mins_product],
        "bboxMaxProductMm": [round(float(value) * 1000.0, 4) for value in maxs_product],
        "bboxSizeProductMm": [round(float((maxs_product - mins_product)[index]) * 1000.0, 4) for index in range(3)],
        "trayProfile": {
            "platformTopMm": round(tray_surface_top_y(-0.028, tray_center_z(-0.028)) * 1000.0, 4),
            "earbudBackTopMm": round(
                tray_surface_top_y(0.002, tray_center_z(0.002) + (tray_half_width(0.002) * 0.72)) * 1000.0,
                4,
            ),
            "earbudFrontTopMm": round(
                tray_surface_top_y(0.002, tray_center_z(0.002) - (tray_half_width(0.002) * 0.72)) * 1000.0,
                4,
            ),
            "cameraBackTopMm": round(
                tray_surface_top_y(0.029, tray_center_z(0.029) + (tray_half_width(0.029) * 0.72)) * 1000.0,
                4,
            ),
            "cameraFrontTopMm": round(
                tray_surface_top_y(0.029, tray_center_z(0.029) - (tray_half_width(0.029) * 0.72)) * 1000.0,
                4,
            ),
            "leftBiasMm": round(tray_center_z(-0.028) * 1000.0, 4),
            "earbudBiasMm": round(tray_center_z(0.002) * 1000.0, 4),
            "cameraBiasMm": round(tray_center_z(0.029) * 1000.0, 4),
        },
    }


def seam_drop_mm(x_mm: float) -> float:
    if x_mm <= -18.0:
        return 0.0
    if x_mm <= -5.0:
        return lerp(0.0, 0.9, smoothstep(-18.0, -5.0, x_mm))
    if x_mm <= 18.0:
        return lerp(0.9, 2.8, smoothstep(-5.0, 18.0, x_mm))
    return lerp(2.8, 3.6, smoothstep(18.0, 35.0, x_mm))


def seam_center_shift_mm(x_mm: float) -> float:
    if x_mm <= -20.0:
        return 4.6
    if x_mm <= -5.0:
        return lerp(4.6, -3.8, smoothstep(-20.0, -5.0, x_mm))
    if x_mm <= 18.0:
        return lerp(-3.8, -1.2, smoothstep(-5.0, 18.0, x_mm))
    return lerp(-1.2, 3.2, smoothstep(18.0, 35.0, x_mm))


def seam_pitch_mm(x_mm: float) -> float:
    if x_mm <= -18.0:
        return 0.0
    if x_mm <= -4.0:
        return lerp(0.0, 1.25, smoothstep(-18.0, -4.0, x_mm))
    if x_mm <= 22.0:
        return lerp(1.25, 1.75, smoothstep(-4.0, 22.0, x_mm))
    return lerp(1.75, 1.20, smoothstep(22.0, 35.0, x_mm))


def seam_width_scale(x_mm: float) -> float:
    if x_mm <= -12.0:
        return 1.0
    if x_mm <= 12.0:
        return lerp(1.0, 0.84, smoothstep(-12.0, 12.0, x_mm))
    return lerp(0.84, 0.92, smoothstep(12.0, 35.0, x_mm))


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
    return {
        "phase": 1,
        "name": PHASE_NAMES[1],
        "rotationChangeLog": rotation_change_log,
        "deviceLayoutChangeLog": layout_change_log,
        "trayChangeLog": tray_change_log,
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
        y_band=(0.0032, 0.0110),
        x_band_mm=(-18.0, 35.0),
        x_center_mm=8.0,
        x_radius_mm=42.0,
        base_weight=1.0,
        y_drop_scale=1.0,
        z_shift_scale=1.0,
        protect_center_product=pin_center_product,
        protect_inner_radius_mm=13.0,
        protect_outer_radius_mm=24.0,
    )
    return {
        "phase": 2,
        "name": PHASE_NAMES[2],
        "shellChangeLog": shell_change,
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
        y_band=(0.0148, 0.0117),
        x_band_mm=(-16.0, 35.0),
        x_center_mm=10.0,
        x_radius_mm=44.0,
        base_weight=1.0,
        y_drop_scale=0.92,
        z_shift_scale=0.82,
        top_crown_drop_scale=0.12,
        top_crown_band=(0.0156, 0.0186),
        protect_center_product=hole_center_product,
        protect_inner_radius_mm=12.0,
        protect_outer_radius_mm=23.0,
    )
    return {
        "phase": 3,
        "name": PHASE_NAMES[3],
        "shellChangeLog": shell_change,
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
