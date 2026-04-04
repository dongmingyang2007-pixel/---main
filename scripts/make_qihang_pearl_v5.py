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
    2: "open_front_window_and_rebuild_sidewalls",
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
FRONT_BLOCKER_SEED_X_RANGE_MM = (-29.0, -1.8)
FRONT_BLOCKER_SEED_Y_RANGE_MM = (-0.6, 9.5)
FRONT_BLOCKER_SEED_Z_RANGE_MM = (-17.1, -15.0)
FRONT_BLOCKER_ALLOWED_X_RANGE_MM = (-30.0, -1.0)
FRONT_BLOCKER_ALLOWED_Y_RANGE_MM = (-1.0, 10.0)
FRONT_BLOCKER_ALLOWED_Z_RANGE_MM = (-17.5, -14.5)
FRONT_BLOCKER_NORMAL_Y_ABS_MAX = 0.2
FRONT_BLOCKER_NORMAL_Z_ABS_MIN = 0.95
EXPECTED_FRONT_BLOCKER_TRIANGLE_COUNT = 86

REMAINING_FRONT_FACE_CENTER_X_RANGE_MM = (-1.6, -1.0)
REMAINING_FRONT_FACE_CENTER_Y_RANGE_MM = (-1.0, 10.0)
REMAINING_FRONT_FACE_CENTER_Z_RANGE_MM = (-16.7, -15.5)
REMAINING_FRONT_FACE_NORMAL_Z_ABS_MIN = 0.9
REMAINING_FRONT_FACE_ASPECT_MIN = 4.0
EXPECTED_REMAINING_FRONT_FACE_TRIANGLE_COUNT = 2

REMAINING_SIDEWALL_CENTER_X_RANGE_MM = (-2.5, 0.5)
REMAINING_SIDEWALL_CENTER_Y_RANGE_MM = (-1.0, 10.0)
REMAINING_SIDEWALL_CENTER_Z_RANGE_MM = (-16.6, -15.3)
REMAINING_SIDEWALL_NORMAL_X_MIN = 0.8
REMAINING_SIDEWALL_AREA_MM2_MIN = 1.0
EXPECTED_REMAINING_SIDEWALL_TRIANGLE_COUNT = 2
FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_X_RANGE_MM = (16.0, 18.95)
FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Y_RANGE_MM = (2.0, 10.8)
FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Z_RANGE_MM = (-39.5, -31.0)
EXPECTED_FRONT_WINDOW_SLOPED_RESIDUAL_TRIANGLE_COUNT = 20
EXPECTED_FRONT_WINDOW_BOUNDARY_VERTEX_COUNT = 36
EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT = 42
FRONT_WINDOW_REBUILD_OUTER_CHAIN_SLICE = (1, 20)
FRONT_WINDOW_REBUILD_INNER_CHAIN_SLICE = (20, 39)
FRONT_WINDOW_REFERENCE_RIM_X_RANGE_MM = (-35.5, -1.5)
FRONT_WINDOW_REFERENCE_RIM_Y_RANGE_MM = (9.2, 9.4)
FRONT_WINDOW_REFERENCE_RIM_Z_RANGE_MM = (-16.5, -12.5)
FRONT_WINDOW_REFERENCE_RIM_UPPER_Y_MIN_MM = 9.3
FRONT_WINDOW_REFERENCE_RIM_LOWER_Y_MM = 9.25
FRONT_WINDOW_REFERENCE_RIM_LOWER_Y_TOLERANCE_MM = 0.01
EXPECTED_FRONT_WINDOW_REFERENCE_RIM_CHAIN_COUNT = 20
GUIDED_FRONT_FILL_SAMPLE_COUNT = 24
GUIDED_FRONT_FILL_RAMP_X_TOLERANCE_MM = 0.8
GUIDED_FRONT_FILL_RAMP_Y_RANGE_MM = (-2.0, 10.0)
GUIDED_FRONT_FILL_FRONT_BAND_MM = 0.6
GUIDED_FRONT_FILL_MIN_RISE_MM = 0.6
GUIDED_FRONT_FILL_FALLBACK_Z_MM = -15.0
POSITIVE_X_OPENING_STRIP_X_RANGE_MM = (-0.5, 36.0)
POSITIVE_X_OPENING_STRIP_Y_RANGE_MM = (-1.1, 9.5)
POSITIVE_X_OPENING_STRIP_ABS_Z_RANGE_MM = (13.0, 17.05)
POSITIVE_X_OPENING_STRIP_LOCAL_EDGE_TOLERANCE_MM = 0.5
POSITIVE_X_OPENING_STRIP_TILT_START_X_MM = 6.35
POSITIVE_X_OPENING_STRIP_TILT_FULL_X_MM = 8.38
POSITIVE_X_FRONT_CENTER_TILT_VERTEX_X_RANGE_MM = (-0.01, 6.35)
POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Y_RANGE_MM = (-0.47, -0.44)
POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Z_RANGE_MM = (-16.25, -16.15)
EXPECTED_POSITIVE_X_FRONT_CENTER_TILT_VERTEX_COUNT = 4
NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_X_RANGE_MM = (-35.0, 0.01)
NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Y_RANGE_MM = (-0.47, -0.44)
NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Z_RANGE_MM = (-17.05, -14.2)
NEGATIVE_X_FRONT_STRIP_TILT_CLUSTER_GAP_MM = 0.5
EXPECTED_NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_COUNT = 20
FRONT_EDGE_UNIFORM_COARSE_X_RANGE_MM = (-34.9, 34.9)
FRONT_EDGE_UNIFORM_COARSE_Y_RANGE_MM = (-1.1, -0.1)
FRONT_EDGE_UNIFORM_COARSE_Z_RANGE_MM = (-17.1, -13.0)
FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_X_RANGE_MM = (-35.0, 35.0)
FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_Y_RANGE_MM = (-1.15, -0.04)
FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_Z_RANGE_MM = (-17.2, -12.9)
EXPECTED_FRONT_EDGE_UNIFORM_COARSE_TRIANGLE_COUNT = 67
EXPECTED_FRONT_EDGE_UNIFORM_COARSE_HOLE_VERTEX_COUNT = 69
EXPECTED_FRONT_EDGE_UNIFORM_COARSE_CHAIN_POINT_COUNT = 35
EXPECTED_FRONT_EDGE_UNIFORM_COARSE_REBUILT_TRIANGLE_COUNT = 67
FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_X_RANGE_MM = (-25.0, 25.7)
FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Y_RANGE_MM = (-1.05, -0.05)
FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Z_RANGE_MM = (-17.1, -14.45)
FRONT_EDGE_UNIFORM_REBUILD_CENTER_X_RANGE_MM = (-2.2, 2.2)
FRONT_EDGE_UNIFORM_REBUILD_CENTER_Y_RANGE_MM = (-4.8, -0.05)
FRONT_EDGE_UNIFORM_REBUILD_CENTER_Z_RANGE_MM = (-17.1, -14.4)
FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_X_RANGE_MM = (-25.2, 25.9)
FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_Y_RANGE_MM = (-4.9, -0.04)
FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_Z_RANGE_MM = (-17.2, -14.3)
EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_TRIANGLE_COUNT = 50
EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CENTER_TRIANGLE_COUNT = 8
EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_TRIANGLE_COUNT = 58
EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_HOLE_VERTEX_COUNT = 56
EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CHAIN_POINT_COUNT = 28
EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_REBUILT_TRIANGLE_COUNT = 54
NEGATIVE_X_PAIRING_REPAIR_X_NEG_RANGE_MM = (-25.8, 0.2)
NEGATIVE_X_PAIRING_REPAIR_X_POS_RANGE_MM = (0.0, 25.8)
NEGATIVE_X_PAIRING_REPAIR_Z_RANGE_MM = (-16.3, -14.45)
NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_NEG_X_RANGE_MM = (-26.0, 0.3)
NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_POS_X_RANGE_MM = (-0.1, 26.0)
NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM = (-5.0, -0.03)
NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM = (-16.35, -14.4)
NEGATIVE_X_PAIRING_REPAIR_TOP_Y_MIN_MM = -1.2
NEGATIVE_X_PAIRING_REPAIR_BOTTOM_Y_RANGE_MM = (-5.0, -4.2)
EXPECTED_NEGATIVE_X_PAIRING_REPAIR_REFERENCE_TRIANGLE_COUNT = 50
EXPECTED_NEGATIVE_X_PAIRING_REPAIR_TARGET_TRIANGLE_COUNT = 50
EXPECTED_NEGATIVE_X_PAIRING_REPAIR_HOLE_VERTEX_COUNT = 52
EXPECTED_NEGATIVE_X_PAIRING_REPAIR_CHAIN_POINT_COUNT = 13
EXPECTED_NEGATIVE_X_PAIRING_REPAIR_REBUILT_TRIANGLE_COUNT = 52
EXPECTED_NEGATIVE_X_ENDPOINT_ANCHOR_AFFECTED_TRIANGLE_COUNT = 8
POSITIVE_X_CORNER_THICKNESS_B_X_RANGE_MM = (25.4, 35.2)
POSITIVE_X_CORNER_THICKNESS_B_Y_RANGE_MM = (-0.6, -0.35)
POSITIVE_X_CORNER_THICKNESS_B_Z_RANGE_MM = (-17.2, -14.7)
EXPECTED_POSITIVE_X_CORNER_THICKNESS_B_POINT_COUNT = 7
NEGATIVE_X_CORNER_STYLE_REFERENCE_X_RANGE_MM = (24.0, 36.0)
NEGATIVE_X_CORNER_STYLE_TARGET_X_RANGE_MM = (-36.0, -24.0)
NEGATIVE_X_CORNER_STYLE_Y_RANGE_MM = (-5.5, 10.0)
NEGATIVE_X_CORNER_STYLE_Z_RANGE_MM = (-16.4, -14.0)
NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM = (-37.0, -23.0)
NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM = (-5.6, 10.1)
NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM = (-16.5, -13.9)
NEGATIVE_X_CORNER_STYLE_VISIBLE_UPPER_Y_RANGE_MM = (-0.6, -0.3)
NEGATIVE_X_CORNER_STYLE_VISIBLE_LOWER_Y_RANGE_MM = (-1.05, -0.6)
NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_X_RANGE_MM = (-27.0, -22.0)
NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_Y_RANGE_MM = (-1.2, -0.4)
NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_Z_RANGE_MM = (-16.3, -14.0)
EXPECTED_NEGATIVE_X_CORNER_STYLE_REFERENCE_TRIANGLE_COUNT = 28
EXPECTED_NEGATIVE_X_CORNER_STYLE_TARGET_TRIANGLE_COUNT = 34
EXPECTED_NEGATIVE_X_CORNER_STYLE_STAGE1_LOOP_VERTEX_COUNT = 26
EXPECTED_NEGATIVE_X_CORNER_STYLE_STAGE2_LOOP_VERTEX_COUNT = 6
EXPECTED_NEGATIVE_X_CORNER_STYLE_FILL_TRIANGLE_COUNT = 4
EXPECTED_NEGATIVE_X_CORNER_STYLE_OPEN_BOUNDARY_EDGE_COUNTS = (24, 26, 32)
POSITIVE_X_FRONT_CENTER_SEAM_X_RANGE_MM = (-0.1, 6.35)
POSITIVE_X_FRONT_CENTER_SEAM_Y_RANGE_MM = (-1.1, -0.45)
POSITIVE_X_FRONT_CENTER_SEAM_Z_RANGE_MM = (-17.1, -15.5)
EXPECTED_POSITIVE_X_FRONT_CENTER_SEAM_TRIANGLE_COUNT = 7
EXPECTED_POSITIVE_X_FRONT_CENTER_SEAM_HOLE_VERTEX_COUNT = 9
POSITIVE_X_FRONT_CENTER_SEAM_LOCAL_EDGE_TOLERANCE_MM = 0.05
POSITIVE_X_FRONT_CENTER_SEAM_LEFT_APEX_X_RANGE_MM = (-2.1, -1.9)
POSITIVE_X_FRONT_CENTER_SEAM_LEFT_APEX_Y_RANGE_MM = (-0.47, -0.44)
POSITIVE_X_FRONT_CENTER_SEAM_LEFT_APEX_Z_RANGE_MM = (-17.02, -16.97)
FRONT_CENTER_SPUR_NODE_X_RANGE_MM = (0.15, 0.35)
FRONT_CENTER_SPUR_NODE_Y_RANGE_MM = (-0.9, -0.7)
FRONT_CENTER_SPUR_NODE_Z_RANGE_MM = (-16.4, -16.1)
EXPECTED_FRONT_CENTER_SPUR_TRIANGLE_COUNT = 4
EXPECTED_FRONT_CENTER_SPUR_HOLE_VERTEX_COUNT = 4
FRONT_CENTER_SPUR_LOCAL_X_RANGE_MM = (-2.1, 2.1)
FRONT_CENTER_SPUR_LOCAL_Y_RANGE_MM = (-1.1, -0.44)
FRONT_CENTER_SPUR_LOCAL_Z_RANGE_MM = (-17.1, -15.5)
POSITIVE_X_CAP_APEX_X_RANGE_MM = (1.9, 2.1)
POSITIVE_X_CAP_APEX_Y_RANGE_MM = (-0.47, -0.44)
POSITIVE_X_CAP_APEX_Z_RANGE_MM = (-17.02, -16.97)
EXPECTED_POSITIVE_X_CAP_TRIANGLE_COUNT = 8
EXPECTED_POSITIVE_X_CAP_HOLE_VERTEX_COUNT = 8
EXPECTED_POSITIVE_X_CAP_REBUILT_TRIANGLE_COUNT = 6
POSITIVE_X_CAP_LOCAL_X_RANGE_MM = (-0.1, 6.5)
POSITIVE_X_CAP_LOCAL_Y_RANGE_MM = (-1.1, -0.44)
POSITIVE_X_CAP_LOCAL_Z_RANGE_MM = (-17.1, -15.5)
CENTER_CAP_ALIGNMENT_X_RANGE_MM = (-4.25, 6.35)
CENTER_CAP_ALIGNMENT_Y_RANGE_MM = (-1.1, -0.43)
CENTER_CAP_ALIGNMENT_Z_RANGE_MM = (-17.1, -15.45)
EXPECTED_CENTER_CAP_ALIGNMENT_TRIANGLE_COUNT = 11
EXPECTED_CENTER_CAP_ALIGNMENT_HOLE_VERTEX_COUNT = 11
EXPECTED_CENTER_CAP_ALIGNMENT_REBUILT_TRIANGLE_COUNT = 9
CENTER_CAP_ALIGNMENT_LOCAL_EDGE_X_RANGE_MM = (-4.3, 6.4)
CENTER_CAP_ALIGNMENT_LOCAL_EDGE_Y_RANGE_MM = (-0.5, -0.43)
CENTER_CAP_ALIGNMENT_LOCAL_EDGE_Z_RANGE_MM = (-17.1, -16.15)
POSITIVE_LIP_SYMMETRY_X_MAX_MM = 20.5
POSITIVE_LIP_SYMMETRY_Y_RANGE_MM = (-1.0, 9.35)
POSITIVE_LIP_SYMMETRY_Z_RANGE_MM = (15.3, 17.05)
EXPECTED_POSITIVE_LIP_CHAIN_POINT_COUNT = 11
POSITIVE_LIP_CENTER_REBUILD_X_RANGE_MM = (-2.2, 4.3)
POSITIVE_LIP_CENTER_REBUILD_Y_RANGE_MM = (-0.6, 9.4)
POSITIVE_LIP_CENTER_REBUILD_Z_RANGE_MM = (15.45, 17.05)
EXPECTED_POSITIVE_LIP_CENTER_REBUILD_TRIANGLE_COUNT = 18
EXPECTED_POSITIVE_LIP_CENTER_REBUILD_CHAIN_POINT_COUNT = 4
POSITIVE_LIP_UPPER_STRIP_REBUILD_X_RANGE_MM = (-0.1, 20.5)
POSITIVE_LIP_UPPER_STRIP_REBUILD_Y_RANGE_MM = (9.2, 9.33)
POSITIVE_LIP_UPPER_STRIP_REBUILD_Z_RANGE_MM = (15.35, 16.36)
EXPECTED_POSITIVE_LIP_UPPER_STRIP_TRIANGLE_COUNT = 20
NEGATIVE_FRONT_CENTER_TRANSITION_X_RANGE_MM = (-0.001, 2.11)
NEGATIVE_FRONT_CENTER_TRANSITION_Y_RANGE_MM = (-1.05, -0.25)
NEGATIVE_FRONT_CENTER_TRANSITION_Z_RANGE_MM = (-17.05, -15.0)
EXPECTED_NEGATIVE_FRONT_CENTER_TRANSITION_TRIANGLE_COUNT = 6
EXPECTED_NEGATIVE_FRONT_CENTER_TRANSITION_HOLE_EDGE_COUNT = 8
NEGATIVE_FRONT_CENTER_TRANSITION_FAN_APEX_PRODUCT_MM = (1.25, -0.456, -16.85)
FRONT_FILL_ARTIFACT_CENTER_X_RANGE_MM = (-27.1, -22.45)
FRONT_FILL_ARTIFACT_CENTER_Y_RANGE_MM = (-0.2, 3.0)
FRONT_FILL_ARTIFACT_CENTER_Z_RANGE_MM = (-16.05, -14.75)
FRONT_FILL_ARTIFACT_AREA_MM2_MIN = 1.8
EXPECTED_FRONT_FILL_ARTIFACT_TRIANGLE_COUNT = 12
EXPECTED_FRONT_FILL_ARTIFACT_HOLE_VERTEX_COUNT = 10


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


def point_key(point: np.ndarray) -> tuple[float, float, float]:
    return tuple(round(float(value), 9) for value in point)


def triangle_normal(triangle: tuple[np.ndarray, np.ndarray, np.ndarray]) -> np.ndarray:
    point_a, point_b, point_c = triangle
    normal = np.cross(point_b - point_a, point_c - point_a)
    length = float(np.linalg.norm(normal))
    if length <= 1e-12:
        return np.zeros(3, dtype=float)
    return normal / length


def triangle_area_mm2(triangle: tuple[np.ndarray, np.ndarray, np.ndarray]) -> float:
    point_a, point_b, point_c = triangle
    cross = np.cross(point_b - point_a, point_c - point_a)
    return float(np.linalg.norm(cross) * 0.5 * 1_000_000.0)


def project_point(point: np.ndarray, dims: tuple[int, int]) -> tuple[float, float]:
    return (float(point[dims[0]] * 1000.0), float(point[dims[1]] * 1000.0))


def vector_to_mm_list(values: np.ndarray) -> list[float]:
    return [round(float(value) * 1000.0, 4) for value in values]


def build_triangle_vertex_adjacency(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> list[set[int]]:
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
        touching_set = set(touching_triangles)
        for triangle_index in touching_set:
            adjacency[triangle_index].update(touching_set - {triangle_index})
    return adjacency


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


def build_named_node_product_matrices(gltf: dict) -> dict[str, np.ndarray]:
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
    return {
        name: product_inverse @ get_world_matrix(index)
        for name, index in node_lookup.items()
    }


def read_shell_primitive_rows(
    gltf: dict,
    bin_chunk: bytearray,
) -> tuple[dict, list[list[float]], list[list[float]]]:
    named_node_indices = {
        node.get("name"): index for index, node in enumerate(gltf["nodes"]) if node.get("name")
    }
    shell_node_index = named_node_indices["Case_Base_Shell"]
    primitive = gltf["meshes"][gltf["nodes"][shell_node_index]["mesh"]]["primitives"][0]
    if "indices" in primitive:
        raise ValueError("Expected non-indexed Case_Base_Shell primitive in V4/V5 shell processing.")

    positions = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["POSITION"])
    normals = read_accessor_rows(gltf, bin_chunk, primitive["attributes"]["NORMAL"])
    if len(positions) != len(normals) or len(positions) % 3 != 0:
        raise ValueError("Case_Base_Shell primitive is not a triangle soup with matching normals.")
    return primitive, positions, normals


def build_boundary_edges(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> list[tuple[tuple[float, float, float], tuple[float, float, float]]]:
    edge_count: dict[tuple[tuple[float, float, float], tuple[float, float, float]], int] = defaultdict(int)
    for triangle in shell_triangles:
        triangle_points = [tuple(round(float(value), 9) for value in point) for point in triangle]
        for start, end in ((0, 1), (1, 2), (2, 0)):
            edge = tuple(sorted((triangle_points[start], triangle_points[end])))
            edge_count[edge] += 1
    return [edge for edge, count in edge_count.items() if count == 1]


def ordered_boundary_loop(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> list[np.ndarray]:
    boundary_edges = build_boundary_edges(shell_triangles)
    if not boundary_edges:
        return []

    return ordered_boundary_loop_from_edges(boundary_edges)


def ordered_boundary_loop_from_edges(
    boundary_edges: list[tuple[tuple[float, float, float], tuple[float, float, float]]],
) -> list[np.ndarray]:
    if not boundary_edges:
        return []

    adjacency: dict[tuple[float, float, float], list[tuple[float, float, float]]] = defaultdict(list)
    for point_a, point_b in boundary_edges:
        adjacency[point_a].append(point_b)
        adjacency[point_b].append(point_a)

    invalid_vertices = [vertex for vertex, neighbors in adjacency.items() if len(neighbors) != 2]
    if invalid_vertices:
        raise ValueError(f"Boundary loop is not a simple 2-neighbor cycle: {len(invalid_vertices)} invalid vertices.")

    start = min(adjacency, key=lambda point: (point[0], point[1], point[2]))
    ordered_points = [np.array(start, dtype=float)]
    previous: tuple[float, float, float] | None = None
    current = start

    while True:
        neighbors = adjacency[current]
        next_point = neighbors[0] if neighbors[0] != previous else neighbors[1]
        if next_point == start:
            break
        ordered_points.append(np.array(next_point, dtype=float))
        previous, current = current, next_point
        if len(ordered_points) > len(adjacency):
            raise ValueError("Boundary traversal exceeded expected vertex count.")

    if len(ordered_points) != len(adjacency):
        raise ValueError("Boundary traversal did not cover the full boundary loop.")
    return ordered_points


def orient_triangle_away_from_center(
    triangle: tuple[np.ndarray, np.ndarray, np.ndarray],
    reference_center: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    points = np.stack(triangle, axis=0)
    raw_normal = np.cross(points[1] - points[0], points[2] - points[0])
    if float(np.dot(raw_normal, points.mean(axis=0) - reference_center)) < 0.0:
        return (triangle[0], triangle[2], triangle[1])
    return triangle


def remap_triangle_points(
    triangle: tuple[np.ndarray, np.ndarray, np.ndarray],
    point_map: dict[tuple[float, float, float], np.ndarray],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    return tuple(np.array(point_map.get(point_key(point), point), dtype=float) for point in triangle)


def interpolate_point_by_x(
    curve_points: list[np.ndarray],
    x_value: float,
) -> np.ndarray:
    if not curve_points:
        raise ValueError("Expected at least one curve point for interpolation.")
    ordered_points = sorted(curve_points, key=lambda point: (float(point[0]), float(point[1]), float(point[2])))
    if x_value <= float(ordered_points[0][0]):
        return ordered_points[0].copy()
    if x_value >= float(ordered_points[-1][0]):
        return ordered_points[-1].copy()

    for index in range(len(ordered_points) - 1):
        point_a = ordered_points[index]
        point_b = ordered_points[index + 1]
        if float(point_a[0]) <= x_value <= float(point_b[0]):
            span = float(point_b[0] - point_a[0])
            if abs(span) <= 1e-12:
                return point_a.copy()
            ratio = (x_value - float(point_a[0])) / span
            return point_a + ((point_b - point_a) * ratio)

    return ordered_points[-1].copy()


def orient_triangle_to_match_neighbor_normals(
    triangle: tuple[np.ndarray, np.ndarray, np.ndarray],
    neighbor_normals: list[np.ndarray],
    reference_center: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    valid_neighbor_normals = [normal for normal in neighbor_normals if float(np.linalg.norm(normal)) > 1e-9]
    if valid_neighbor_normals:
        average_normal = np.mean(np.stack(valid_neighbor_normals, axis=0), axis=0)
        if float(np.linalg.norm(average_normal)) > 1e-9:
            if float(np.dot(triangle_normal(triangle), average_normal)) < 0.0:
                return (triangle[0], triangle[2], triangle[1])
            return triangle
    return orient_triangle_away_from_center(triangle, reference_center)


def bridge_opening_loop(loop_points: list[np.ndarray]) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    if not loop_points:
        return []
    if len(loop_points) % 2 != 0:
        raise ValueError(f"Expected even boundary loop length, got {len(loop_points)}.")
    half_count = len(loop_points) // 2
    if half_count < 2:
        raise ValueError("Boundary loop too small to bridge.")

    ring_a = loop_points[:half_count]
    ring_b = list(reversed(loop_points[half_count:]))
    reference_center = np.mean(np.stack(loop_points, axis=0), axis=0)
    bridge_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for index in range(half_count - 2):
        point_a0 = ring_a[index]
        point_a1 = ring_a[index + 1]
        point_b0 = ring_b[index]
        point_b1 = ring_b[index + 1]
        bridge_triangles.append(
            orient_triangle_away_from_center((point_a0, point_a1, point_b1), reference_center)
        )
        bridge_triangles.append(
            orient_triangle_away_from_center((point_a0, point_b1, point_b0), reference_center)
        )

    # The final quad on the right-side lip becomes a visible spike if we reuse the old diagonal.
    final_a0 = ring_a[half_count - 2]
    final_a1 = ring_a[half_count - 1]
    final_b0 = ring_b[half_count - 1]
    final_b1 = ring_b[half_count - 2]
    bridge_triangles.append(
        orient_triangle_away_from_center((final_a0, final_a1, final_b1), reference_center)
    )
    bridge_triangles.append(
        orient_triangle_away_from_center((final_a1, final_b0, final_b1), reference_center)
    )
    return bridge_triangles


def build_equal_strip_between_chains(
    chain_a: list[np.ndarray],
    chain_b: list[np.ndarray],
    reference_center: np.ndarray,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    if len(chain_a) != len(chain_b):
        raise ValueError(
            f"Expected equal chain lengths for strip rebuild, got {len(chain_a)} and {len(chain_b)}."
        )

    strip_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for index in range(len(chain_a) - 1):
        strip_triangles.append(
            orient_triangle_away_from_center((chain_a[index], chain_a[index + 1], chain_b[index]), reference_center)
        )
        strip_triangles.append(
            orient_triangle_away_from_center(
                (chain_a[index + 1], chain_b[index + 1], chain_b[index]),
                reference_center,
            )
        )

    if len(chain_a) >= 2:
        # At the x=0 seam, match the positive-X shell's diagonal direction so the
        # negative-X rebuilt strip continues the same triangulation pattern.
        strip_triangles[-2] = orient_triangle_away_from_center(
            (chain_a[-2], chain_b[-2], chain_b[-1]),
            reference_center,
        )
        strip_triangles[-1] = orient_triangle_away_from_center(
            (chain_a[-2], chain_b[-1], chain_a[-1]),
            reference_center,
        )
    return strip_triangles


def build_uniform_strip_between_chains(
    chain_a: list[np.ndarray],
    chain_b: list[np.ndarray],
    reference_center: np.ndarray,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    if len(chain_a) != len(chain_b):
        raise ValueError(
            f"Expected equal chain lengths for strip rebuild, got {len(chain_a)} and {len(chain_b)}."
        )

    strip_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for index in range(len(chain_a) - 1):
        strip_triangles.append(
            orient_triangle_away_from_center((chain_a[index], chain_a[index + 1], chain_b[index]), reference_center)
        )
        strip_triangles.append(
            orient_triangle_away_from_center(
                (chain_a[index + 1], chain_b[index + 1], chain_b[index]),
                reference_center,
            )
        )
    return strip_triangles


def extract_front_window_reference_rim_chains(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    candidate_points: list[tuple[float, float, float]] = []
    for triangle in shell_triangles:
        for point in triangle:
            point_mm = point * 1000.0
            if (
                FRONT_WINDOW_REFERENCE_RIM_X_RANGE_MM[0] <= float(point_mm[0]) <= FRONT_WINDOW_REFERENCE_RIM_X_RANGE_MM[1]
                and FRONT_WINDOW_REFERENCE_RIM_Y_RANGE_MM[0] <= float(point_mm[1]) <= FRONT_WINDOW_REFERENCE_RIM_Y_RANGE_MM[1]
                and FRONT_WINDOW_REFERENCE_RIM_Z_RANGE_MM[0] <= float(point_mm[2]) <= FRONT_WINDOW_REFERENCE_RIM_Z_RANGE_MM[1]
            ):
                candidate_points.append(tuple(round(float(value), 6) for value in point_mm))

    unique_points = sorted(set(candidate_points))
    upper_chain = [np.array(point, dtype=float) / 1000.0 for point in unique_points if point[1] > FRONT_WINDOW_REFERENCE_RIM_UPPER_Y_MIN_MM]
    lower_chain = [
        np.array(point, dtype=float) / 1000.0
        for point in unique_points
        if abs(point[1] - FRONT_WINDOW_REFERENCE_RIM_LOWER_Y_MM) <= FRONT_WINDOW_REFERENCE_RIM_LOWER_Y_TOLERANCE_MM
    ]
    upper_chain.sort(key=lambda point: float(point[0]))
    lower_chain.sort(key=lambda point: float(point[0]))

    if len(upper_chain) != EXPECTED_FRONT_WINDOW_REFERENCE_RIM_CHAIN_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_WINDOW_REFERENCE_RIM_CHAIN_COUNT} upper rim reference points, found {len(upper_chain)}."
        )
    if len(lower_chain) != EXPECTED_FRONT_WINDOW_REFERENCE_RIM_CHAIN_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_WINDOW_REFERENCE_RIM_CHAIN_COUNT} lower rim reference points, found {len(lower_chain)}."
        )

    return {
        "upperChain": upper_chain,
        "lowerChain": lower_chain,
        "upperChainCount": len(upper_chain),
        "lowerChainCount": len(lower_chain),
        "xRangeMm": list(FRONT_WINDOW_REFERENCE_RIM_X_RANGE_MM),
        "yRangeMm": list(FRONT_WINDOW_REFERENCE_RIM_Y_RANGE_MM),
        "zRangeMm": list(FRONT_WINDOW_REFERENCE_RIM_Z_RANGE_MM),
    }


def serialize_front_window_reference_rim(
    rim_reference: dict[str, object],
) -> dict[str, object]:
    return {
        "upperChainCount": int(rim_reference["upperChainCount"]),
        "lowerChainCount": int(rim_reference["lowerChainCount"]),
        "xRangeMm": list(rim_reference["xRangeMm"]),
        "yRangeMm": list(rim_reference["yRangeMm"]),
        "zRangeMm": list(rim_reference["zRangeMm"]),
        "upperChainEndpointsProductMm": [
            vector_to_mm_list(rim_reference["upperChain"][0]),
            vector_to_mm_list(rim_reference["upperChain"][-1]),
        ],
        "lowerChainEndpointsProductMm": [
            vector_to_mm_list(rim_reference["lowerChain"][0]),
            vector_to_mm_list(rim_reference["lowerChain"][-1]),
        ],
    }


def polyline_parameters(polyline: list[np.ndarray]) -> list[float]:
    distances = [0.0]
    for index in range(1, len(polyline)):
        step = float(np.linalg.norm(polyline[index] - polyline[index - 1]))
        distances.append(distances[-1] + step)
    total_length = max(distances[-1], 1e-12)
    return [distance / total_length for distance in distances]


def resample_open_polyline(polyline: list[np.ndarray], sample_count: int) -> list[np.ndarray]:
    if sample_count < 2:
        raise ValueError(f"Expected at least 2 resample points, got {sample_count}.")
    parameters = polyline_parameters(polyline)
    target_parameters = np.linspace(0.0, 1.0, sample_count)
    result: list[np.ndarray] = []
    segment_index = 0

    for target in target_parameters:
        while segment_index < len(parameters) - 2 and parameters[segment_index + 1] < target:
            segment_index += 1
        start_param = parameters[segment_index]
        end_param = parameters[segment_index + 1]
        if end_param - start_param <= 1e-12:
            result.append(polyline[segment_index].copy())
            continue
        blend = (target - start_param) / (end_param - start_param)
        result.append((polyline[segment_index] * (1.0 - blend)) + (polyline[segment_index + 1] * blend))
    return result


def build_unique_points(triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]]) -> np.ndarray:
    unique_points = {
        tuple(round(float(value), 6) for value in point): point
        for triangle in triangles
        for point in triangle
    }
    return np.array(list(unique_points.values()), dtype=float)


def select_guided_fill_ramp_point(
    ramp_points: np.ndarray,
    *,
    x_mm: float,
    bottom_y_mm: float,
) -> np.ndarray:
    x_delta_mm = np.abs((ramp_points[:, 0] * 1000.0) - x_mm)
    candidates = ramp_points[x_delta_mm < GUIDED_FRONT_FILL_RAMP_X_TOLERANCE_MM]
    candidates = candidates[
        (candidates[:, 1] * 1000.0 > GUIDED_FRONT_FILL_RAMP_Y_RANGE_MM[0])
        & (candidates[:, 1] * 1000.0 < GUIDED_FRONT_FILL_RAMP_Y_RANGE_MM[1])
    ]
    if len(candidates) == 0:
        return np.array(
            [
                x_mm / 1000.0,
                (bottom_y_mm + 1.0) / 1000.0,
                GUIDED_FRONT_FILL_FALLBACK_Z_MM / 1000.0,
            ],
            dtype=float,
        )

    min_z = float(candidates[:, 2].min())
    front_band = candidates[candidates[:, 2] <= (min_z + (GUIDED_FRONT_FILL_FRONT_BAND_MM / 1000.0))]
    selected = front_band[np.argmax(front_band[:, 1])] if len(front_band) else candidates[np.argmax(candidates[:, 1])]
    return np.array(
        [
            x_mm / 1000.0,
            max(float(selected[1]) * 1000.0, bottom_y_mm + GUIDED_FRONT_FILL_MIN_RISE_MM) / 1000.0,
            float(selected[2]),
        ],
        dtype=float,
    )


def loft_open_polylines(
    polyline_a: list[np.ndarray],
    polyline_b: list[np.ndarray],
    reference_center: np.ndarray,
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    params_a = polyline_parameters(polyline_a)
    params_b = polyline_parameters(polyline_b)
    index_a = 0
    index_b = 0
    triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []

    while index_a < len(polyline_a) - 1 or index_b < len(polyline_b) - 1:
        if index_a == len(polyline_a) - 1:
            triangle = (polyline_a[index_a], polyline_b[index_b + 1], polyline_b[index_b])
            index_b += 1
        elif index_b == len(polyline_b) - 1:
            triangle = (polyline_a[index_a], polyline_a[index_a + 1], polyline_b[index_b])
            index_a += 1
        elif params_a[index_a + 1] <= params_b[index_b + 1]:
            triangle = (polyline_a[index_a], polyline_a[index_a + 1], polyline_b[index_b])
            index_a += 1
        else:
            triangle = (polyline_a[index_a], polyline_b[index_b + 1], polyline_b[index_b])
            index_b += 1

        area_vector = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
        if float(np.linalg.norm(area_vector)) <= 1e-12:
            continue
        triangles.append(orient_triangle_away_from_center(triangle, reference_center))
    return triangles


def signed_area_2d(points_2d: np.ndarray) -> float:
    area = 0.0
    for index in range(len(points_2d)):
        point_a = points_2d[index]
        point_b = points_2d[(index + 1) % len(points_2d)]
        area += (point_a[0] * point_b[1]) - (point_b[0] * point_a[1])
    return area * 0.5


def point_in_triangle_2d(
    point: np.ndarray,
    point_a: np.ndarray,
    point_b: np.ndarray,
    point_c: np.ndarray,
) -> bool:
    vector_0 = point_c - point_a
    vector_1 = point_b - point_a
    vector_2 = point - point_a
    denominator = (vector_0[0] * vector_1[1]) - (vector_1[0] * vector_0[1])
    if abs(denominator) <= 1e-12:
        return False
    barycentric_u = ((vector_2[0] * vector_1[1]) - (vector_1[0] * vector_2[1])) / denominator
    barycentric_v = ((vector_0[0] * vector_2[1]) - (vector_2[0] * vector_0[1])) / denominator
    return barycentric_u >= -1e-12 and barycentric_v >= -1e-12 and (barycentric_u + barycentric_v) <= 1.0 + 1e-12


def triangulate_boundary_loop_projected(
    loop_points: list[np.ndarray],
    *,
    dims: tuple[int, int],
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    projected_points = np.array([[point[dims[0]], point[dims[1]]] for point in loop_points], dtype=float)
    orientation_sign = 1 if signed_area_2d(projected_points) > 0.0 else -1
    remaining_indices = list(range(len(loop_points)))
    triangle_indices: list[tuple[int, int, int]] = []

    while len(remaining_indices) > 3:
        clipped = False
        for loop_index in range(len(remaining_indices)):
            index_a = remaining_indices[(loop_index - 1) % len(remaining_indices)]
            index_b = remaining_indices[loop_index]
            index_c = remaining_indices[(loop_index + 1) % len(remaining_indices)]
            point_a = projected_points[index_a]
            point_b = projected_points[index_b]
            point_c = projected_points[index_c]
            cross = ((point_b[0] - point_a[0]) * (point_c[1] - point_a[1])) - (
                (point_b[1] - point_a[1]) * (point_c[0] - point_a[0])
            )
            if orientation_sign * cross < -1e-12:
                continue
            if any(
                point_in_triangle_2d(projected_points[other_index], point_a, point_b, point_c)
                for other_index in remaining_indices
                if other_index not in (index_a, index_b, index_c)
            ):
                continue
            triangle_indices.append((index_a, index_b, index_c))
            del remaining_indices[loop_index]
            clipped = True
            break
        if not clipped:
            raise ValueError(
                f"Projected ear clipping stalled for dims={dims} with remaining vertices={remaining_indices}."
            )

    triangle_indices.append(tuple(remaining_indices))
    reference_center = np.mean(np.stack(loop_points, axis=0), axis=0)
    return [
        orient_triangle_away_from_center(
            (loop_points[index_a], loop_points[index_b], loop_points[index_c]),
            reference_center,
        )
        for index_a, index_b, index_c in triangle_indices
    ]


def build_guided_front_fill_patch(
    loop_points: list[np.ndarray],
    ramp_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray]], dict[str, object]]:
    if len(loop_points) != EXPECTED_FRONT_WINDOW_BOUNDARY_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_WINDOW_BOUNDARY_VERTEX_COUNT} boundary vertices for guided fill, "
            f"found {len(loop_points)}."
        )

    outer_chain = [point.copy() for point in loop_points[:18]]
    inner_chain = [loop_points[0].copy()] + [point.copy() for point in reversed(loop_points[18:])] + [loop_points[17].copy()]
    ramp_points = build_unique_points(ramp_triangles)
    outer_samples = resample_open_polyline(outer_chain, GUIDED_FRONT_FILL_SAMPLE_COUNT)
    inner_samples = resample_open_polyline(inner_chain, GUIDED_FRONT_FILL_SAMPLE_COUNT)

    guide_curve: list[np.ndarray] = []
    midpoint_y_mm: list[float] = []
    for outer_point, inner_point in zip(outer_samples, inner_samples):
        midpoint = (outer_point + inner_point) * 0.5
        sample_x_mm = float(midpoint[0]) * 1000.0
        bottom_y_mm = min(float(outer_point[1]) * 1000.0, float(inner_point[1]) * 1000.0)
        midpoint_y_mm.append(float(midpoint[1]) * 1000.0)
        guide_point = select_guided_fill_ramp_point(
            ramp_points,
            x_mm=sample_x_mm,
            bottom_y_mm=bottom_y_mm,
        )
        guide_point[0] = midpoint[0]
        guide_point[1] = max(float(guide_point[1]), float(midpoint[1]))
        guide_curve.append(guide_point)

    smoothed_curve = [guide_curve[0].copy()]
    for index in range(1, len(guide_curve) - 1):
        smoothed = (
            (guide_curve[index - 1] * 0.25)
            + (guide_curve[index] * 0.5)
            + (guide_curve[index + 1] * 0.25)
        )
        smoothed[0] = guide_curve[index][0]
        smoothed[1] = max(float(smoothed[1]), midpoint_y_mm[index] / 1000.0)
        smoothed_curve.append(smoothed)
    smoothed_curve.append(guide_curve[-1].copy())
    smoothed_curve[0] = outer_chain[0].copy()
    smoothed_curve[-1] = outer_chain[-1].copy()

    reference_center = np.mean(np.stack(loop_points, axis=0), axis=0)
    fill_triangles = (
        loft_open_polylines(outer_chain, smoothed_curve, reference_center)
        + loft_open_polylines(smoothed_curve, inner_chain, reference_center)
    )

    guide_points = np.stack(smoothed_curve, axis=0)
    guide_mins, guide_maxs = compute_bbox(list(guide_points))
    return fill_triangles, {
        "guideCurveSampleCount": len(smoothed_curve),
        "outerChainVertexCount": len(outer_chain),
        "innerChainVertexCount": len(inner_chain),
        "guideCurveBboxMinProductMm": vector_to_mm_list(guide_mins),
        "guideCurveBboxMaxProductMm": vector_to_mm_list(guide_maxs),
        "guideCurveBboxSizeProductMm": vector_to_mm_list(guide_maxs - guide_mins),
    }


def build_structured_front_window_patch(
    loop_points: list[np.ndarray],
    rim_reference: dict[str, object],
    *,
    corner_apex_override: np.ndarray | None = None,
) -> tuple[list[tuple[np.ndarray, np.ndarray, np.ndarray]], dict[str, object]]:
    if len(loop_points) not in (
        EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT,
        EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT + 1,
    ):
        raise ValueError(
            f"Expected {EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT} or "
            f"{EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT + 1} boundary vertices for front-window fill, "
            f"found {len(loop_points)}."
        )

    upper_chain = [point.copy() for point in rim_reference["upperChain"]]
    lower_chain = [point.copy() for point in rim_reference["lowerChain"]]
    reference_center = np.mean(np.stack(loop_points, axis=0), axis=0)
    outer_start, outer_stop = FRONT_WINDOW_REBUILD_OUTER_CHAIN_SLICE
    outer_strip = [point.copy() for point in loop_points[outer_start:outer_stop]]
    inner_start, inner_stop = FRONT_WINDOW_REBUILD_INNER_CHAIN_SLICE
    inner_strip = [point.copy() for point in reversed(loop_points[inner_start:inner_stop])]
    strip_triangles = build_equal_strip_between_chains(outer_strip, inner_strip, reference_center)

    has_explicit_top_lower_left = len(loop_points) == EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT + 1
    top_lower_left_boundary = loop_points[40].copy() if has_explicit_top_lower_left else None
    top_lower_right = loop_points[41].copy() if has_explicit_top_lower_left else loop_points[40].copy()
    top_upper_left = loop_points[42].copy() if has_explicit_top_lower_left else loop_points[41].copy()
    upper_match_index = min(
        range(len(upper_chain)),
        key=lambda index: abs(float(upper_chain[index][0] - top_upper_left[0])),
    )
    lower_match_index = min(
        range(len(lower_chain)),
        key=lambda index: abs(float(lower_chain[index][0] - top_lower_right[0])),
    )
    if upper_match_index + 1 >= len(upper_chain):
        raise ValueError("Upper rim reference chain does not extend past the front-window upper-left match point.")
    if lower_match_index - 1 < 0:
        raise ValueError("Lower rim reference chain does not extend before the front-window upper-right match point.")

    top_lower_left = (
        top_lower_left_boundary.copy()
        if top_lower_left_boundary is not None
        else lower_chain[lower_match_index - 1].copy()
    )
    if has_explicit_top_lower_left:
        explicit_corner_apex_index = min(lower_match_index + 2, len(lower_chain) - 1)
        top_upper_right = (
            corner_apex_override.copy()
            if corner_apex_override is not None
            else lower_chain[explicit_corner_apex_index].copy()
        )
    else:
        explicit_corner_apex_index = None
        top_upper_right = upper_chain[upper_match_index + 1].copy()

    lower_outer_left = loop_points[0].copy()
    lower_outer_next = loop_points[1].copy()
    lower_inner_next = loop_points[38].copy()
    lower_inner_left = loop_points[39].copy()
    if has_explicit_top_lower_left:
        local_patch_triangles = [
            (lower_outer_left, lower_outer_next, top_upper_right),
            (lower_outer_next, lower_inner_next, top_upper_right),
            (lower_inner_next, lower_inner_left, top_upper_right),
            (lower_inner_left, top_lower_left, top_upper_right),
            (top_lower_left, top_lower_right, top_upper_right),
            (top_lower_right, top_upper_left, top_upper_right),
            (top_upper_left, lower_outer_left, top_upper_right),
        ]
    else:
        local_patch_triangles = [
            (lower_outer_left, lower_outer_next, top_upper_right),
            (lower_outer_next, lower_inner_next, top_upper_right),
            # Fallback for the older 42-point boundary loop when the lower-left
            # corner cap triangle has not been peeled into the rebuild hole.
            (lower_inner_next, lower_inner_left, top_upper_right),
            (lower_inner_left, top_lower_right, top_upper_right),
            (top_lower_right, top_upper_left, top_upper_right),
            (top_upper_left, lower_outer_left, top_upper_right),
        ]
    local_patch_triangles = [
        orient_triangle_away_from_center(triangle, reference_center) for triangle in local_patch_triangles
    ]

    patch_triangles = strip_triangles + local_patch_triangles
    patch_points = [point for triangle in patch_triangles for point in triangle]
    patch_mins, patch_maxs = compute_bbox(patch_points)
    strip_points = [point for triangle in strip_triangles for point in triangle]
    strip_mins, strip_maxs = compute_bbox(strip_points)
    local_points = [point for triangle in local_patch_triangles for point in triangle]
    local_mins, local_maxs = compute_bbox(local_points)

    return patch_triangles, {
        "boundaryVertexCount": len(loop_points),
        "outerStripVertexCount": len(outer_strip),
        "innerStripVertexCount": len(inner_strip),
        "stripTriangleCount": len(strip_triangles),
        "localPatchTriangleCount": len(local_patch_triangles),
        "outerStripSlice": list(FRONT_WINDOW_REBUILD_OUTER_CHAIN_SLICE),
        "innerStripSlice": list(FRONT_WINDOW_REBUILD_INNER_CHAIN_SLICE),
        "hasExplicitTopLowerLeftBoundaryPoint": has_explicit_top_lower_left,
        "explicitCornerApexIndex": explicit_corner_apex_index,
        "usedCornerApexOverride": corner_apex_override is not None,
        "rimReferenceUpperChainCount": len(upper_chain),
        "rimReferenceLowerChainCount": len(lower_chain),
        "rimUpperMatchIndex": upper_match_index,
        "rimLowerMatchIndex": lower_match_index,
        "topUpperRightProductMm": vector_to_mm_list(top_upper_right),
        "topLowerLeftProductMm": vector_to_mm_list(top_lower_left),
        "patchBboxMinProductMm": vector_to_mm_list(patch_mins),
        "patchBboxMaxProductMm": vector_to_mm_list(patch_maxs),
        "patchBboxSizeProductMm": vector_to_mm_list(patch_maxs - patch_mins),
        "stripBboxMinProductMm": vector_to_mm_list(strip_mins),
        "stripBboxMaxProductMm": vector_to_mm_list(strip_maxs),
        "stripBboxSizeProductMm": vector_to_mm_list(strip_maxs - strip_mins),
        "localPatchBboxMinProductMm": vector_to_mm_list(local_mins),
        "localPatchBboxMaxProductMm": vector_to_mm_list(local_maxs),
        "localPatchBboxSizeProductMm": vector_to_mm_list(local_maxs - local_mins),
    }


def remove_front_window_corner_cap_triangle(
    gltf: dict,
    bin_chunk: bytearray,
    rim_reference: dict[str, object],
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    boundary_loop = ordered_boundary_loop(shell_triangles)
    if len(boundary_loop) != EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT:
        return {
            "skipped": True,
            "reason": (
                f"Expected {EXPECTED_FRONT_WINDOW_REBUILD_BOUNDARY_VERTEX_COUNT}-vertex boundary before corner-cap "
                f"removal, found {len(boundary_loop)}."
            ),
        }

    lower_chain = [point.copy() for point in rim_reference["lowerChain"]]
    top_lower_right = boundary_loop[40].copy()
    lower_match_index = min(
        range(len(lower_chain)),
        key=lambda index: abs(float(lower_chain[index][0] - top_lower_right[0])),
    )
    if lower_match_index - 1 < 0:
        return {
            "skipped": True,
            "reason": "Lower rim reference chain does not extend before the corner-cap match point.",
        }

    lower_inner_left = boundary_loop[39].copy()
    top_lower_left = lower_chain[lower_match_index - 1].copy()
    target_key = tuple(
        sorted(
            tuple(round(float(value), 6) for value in point)
            for point in (lower_inner_left, top_lower_left, top_lower_right)
        )
    )

    triangle_indices_to_remove: set[int] = set()
    for triangle_index, triangle in enumerate(shell_triangles):
        triangle_key = tuple(
            sorted(tuple(round(float(value), 6) for value in point) for point in triangle)
        )
        if triangle_key == target_key:
            triangle_indices_to_remove.add(int(triangle_index))

    if not triangle_indices_to_remove:
        return {
            "skipped": True,
            "reason": "No stale front-window corner cap triangle matched the expected D-H-E geometry.",
            "targetTriangleKey": [list(point) for point in target_key],
        }

    remove_triangle_indices_from_shell(gltf, bin_chunk, triangle_indices_to_remove)
    updated_boundary_loop = ordered_boundary_loop(build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"])
    return {
        "removedTriangleCount": len(triangle_indices_to_remove),
        "removedTriangleIndices": sorted(triangle_indices_to_remove),
        "boundaryVertexCountAfterRemoval": len(updated_boundary_loop),
        "targetTriangleKey": [list(point) for point in target_key],
    }


def extract_front_window_corner_ramp_contact_point(
    gltf: dict,
    bin_chunk: bytearray,
) -> tuple[np.ndarray | None, dict[str, object]]:
    ramp_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Arc_Ramp_V4"]["triangles"]
    candidate_points: list[np.ndarray] = []
    seen_keys: set[tuple[float, float, float]] = set()
    for triangle in ramp_triangles:
        for point in triangle:
            key = tuple(round(float(value), 7) for value in point)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            x_mm, y_mm, z_mm = (float(value) * 1000.0 for value in point)
            if x_mm < -28.8 and y_mm > 8.7 and z_mm < -14.0:
                candidate_points.append(point.copy())

    if not candidate_points:
        return None, {
            "skipped": True,
            "reason": "No ramp contact-point candidates found near the negative-X front corner.",
        }

    contact_point = min(candidate_points, key=lambda point: (float(point[0]), -float(point[1]), abs(float(point[2]))))
    return contact_point.copy(), {
        "candidateCount": len(candidate_points),
        "contactPointProductMm": vector_to_mm_list(contact_point),
    }


def collect_positive_x_opening_strip_component(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    *,
    z_positive: bool,
) -> dict[str, object]:
    adjacency = build_triangle_vertex_adjacency(shell_triangles)
    candidate_set: set[int] = set()

    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0
        abs_zs_mm = np.abs(zs_mm)
        center_z_mm = float(zs_mm.mean())

        if (
            min(xs_mm) >= POSITIVE_X_OPENING_STRIP_X_RANGE_MM[0]
            and max(xs_mm) <= POSITIVE_X_OPENING_STRIP_X_RANGE_MM[1]
            and min(ys_mm) >= POSITIVE_X_OPENING_STRIP_Y_RANGE_MM[0]
            and max(ys_mm) <= POSITIVE_X_OPENING_STRIP_Y_RANGE_MM[1]
            and min(abs_zs_mm) >= POSITIVE_X_OPENING_STRIP_ABS_Z_RANGE_MM[0]
            and max(abs_zs_mm) <= POSITIVE_X_OPENING_STRIP_ABS_Z_RANGE_MM[1]
            and ((center_z_mm > 0.0) if z_positive else (center_z_mm < 0.0))
        ):
            candidate_set.add(triangle_index)

    components: list[list[int]] = []
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
        components.append(sorted(component_indices))

    if not components:
        raise ValueError(
            f"Failed to find positive-X opening strip component for {'positive' if z_positive else 'negative'} Z."
        )

    selected_indices = max(components, key=len)
    selected_triangles = [shell_triangles[index] for index in selected_indices]
    selected_points = [point for triangle in selected_triangles for point in triangle]
    mins, maxs = compute_bbox(selected_points)
    return {
        "zSign": "positive" if z_positive else "negative",
        "candidateTriangleCount": len(candidate_set),
        "componentCount": len(components),
        "triangleIndices": selected_indices,
        "triangleCount": len(selected_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionRangesProductMm": {
            "x": list(POSITIVE_X_OPENING_STRIP_X_RANGE_MM),
            "y": list(POSITIVE_X_OPENING_STRIP_Y_RANGE_MM),
            "absZ": list(POSITIVE_X_OPENING_STRIP_ABS_Z_RANGE_MM),
        },
    }


def closest_point_on_triangle(
    point: np.ndarray,
    point_a: np.ndarray,
    point_b: np.ndarray,
    point_c: np.ndarray,
) -> np.ndarray:
    vector_ab = point_b - point_a
    vector_ac = point_c - point_a
    vector_ap = point - point_a
    dot_1 = float(np.dot(vector_ab, vector_ap))
    dot_2 = float(np.dot(vector_ac, vector_ap))
    if dot_1 <= 0.0 and dot_2 <= 0.0:
        return point_a

    vector_bp = point - point_b
    dot_3 = float(np.dot(vector_ab, vector_bp))
    dot_4 = float(np.dot(vector_ac, vector_bp))
    if dot_3 >= 0.0 and dot_4 <= dot_3:
        return point_b

    cross_vc = (dot_1 * dot_4) - (dot_3 * dot_2)
    if cross_vc <= 0.0 and dot_1 >= 0.0 and dot_3 <= 0.0:
        interpolation = dot_1 / (dot_1 - dot_3)
        return point_a + (interpolation * vector_ab)

    vector_cp = point - point_c
    dot_5 = float(np.dot(vector_ab, vector_cp))
    dot_6 = float(np.dot(vector_ac, vector_cp))
    if dot_6 >= 0.0 and dot_5 <= dot_6:
        return point_c

    cross_vb = (dot_5 * dot_2) - (dot_1 * dot_6)
    if cross_vb <= 0.0 and dot_2 >= 0.0 and dot_6 <= 0.0:
        interpolation = dot_2 / (dot_2 - dot_6)
        return point_a + (interpolation * vector_ac)

    cross_va = (dot_3 * dot_6) - (dot_5 * dot_4)
    if cross_va <= 0.0 and (dot_4 - dot_3) >= 0.0 and (dot_5 - dot_6) >= 0.0:
        interpolation = (dot_4 - dot_3) / ((dot_4 - dot_3) + (dot_5 - dot_6))
        return point_b + (interpolation * (point_c - point_b))

    denominator = 1.0 / (cross_va + cross_vb + cross_vc)
    barycentric_v = cross_vb * denominator
    barycentric_w = cross_vc * denominator
    return point_a + (vector_ab * barycentric_v) + (vector_ac * barycentric_w)


def build_positive_x_front_ramp_contact_chain(
    gltf: dict,
    bin_chunk: bytearray,
    seed_chain: list[np.ndarray],
    component_bbox_min_mm: np.ndarray,
    component_bbox_max_mm: np.ndarray,
) -> tuple[list[np.ndarray], dict[str, object]]:
    ramp_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Arc_Ramp_V4"]["triangles"]
    candidate_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for triangle in ramp_triangles:
        triangle_points = np.stack(triangle, axis=0)
        xs_mm = triangle_points[:, 0] * 1000.0
        ys_mm = triangle_points[:, 1] * 1000.0
        zs_mm = triangle_points[:, 2] * 1000.0
        if (
            min(xs_mm) >= component_bbox_min_mm[0] - 1.0
            and max(xs_mm) <= component_bbox_max_mm[0] + 1.5
            and min(ys_mm) >= -1.6
            and max(ys_mm) <= 10.1
            and min(zs_mm) >= component_bbox_min_mm[2] - 0.8
            and max(zs_mm) <= component_bbox_max_mm[2] + 1.2
        ):
            candidate_triangles.append(triangle)

    if not candidate_triangles:
        raise ValueError("Failed to find ramp triangles for positive-X front strip tilt adjustment.")

    contact_chain: list[np.ndarray] = []
    seed_to_ramp_distances_mm: list[float] = []
    for point in seed_chain:
        best_distance_mm: float | None = None
        best_contact_point: np.ndarray | None = None
        for triangle in candidate_triangles:
            contact_point = closest_point_on_triangle(point, triangle[0], triangle[1], triangle[2])
            distance_mm = float(np.linalg.norm(point - contact_point) * 1000.0)
            if best_distance_mm is None or distance_mm < best_distance_mm:
                best_distance_mm = distance_mm
                best_contact_point = contact_point.copy()
        if best_contact_point is None or best_distance_mm is None:
            raise ValueError("Failed to project positive-X front strip point onto ramp surface.")
        contact_chain.append(best_contact_point)
        seed_to_ramp_distances_mm.append(best_distance_mm)

    return contact_chain, {
        "candidateTriangleCount": len(candidate_triangles),
        "contactChainPointCount": len(contact_chain),
        "seedToRampDistanceRangeMm": [
            round(min(seed_to_ramp_distances_mm), 4),
            round(max(seed_to_ramp_distances_mm), 4),
        ],
        "contactChainStartProductMm": vector_to_mm_list(contact_chain[0]),
        "contactChainEndProductMm": vector_to_mm_list(contact_chain[-1]),
    }


def remap_product_points_in_triangles(
    triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    point_map: dict[tuple[float, float, float], np.ndarray],
) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
    remapped_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for triangle in triangles:
        remapped_triangle: list[np.ndarray] = []
        for point in triangle:
            point_key = tuple(round(float(value), 9) for value in point)
            replacement = point_map.get(point_key)
            remapped_triangle.append(replacement.copy() if replacement is not None else point.copy())
        remapped_triangles.append(tuple(remapped_triangle))
    return remapped_triangles


def finalize_positive_x_front_center_strip_tilt(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    target_points: dict[tuple[float, float, float], np.ndarray] = {}
    for triangle in shell_triangles:
        for point in triangle:
            point_mm = point * 1000.0
            if (
                POSITIVE_X_FRONT_CENTER_TILT_VERTEX_X_RANGE_MM[0] <= float(point_mm[0]) <= POSITIVE_X_FRONT_CENTER_TILT_VERTEX_X_RANGE_MM[1]
                and POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Y_RANGE_MM[0] <= float(point_mm[1]) <= POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Y_RANGE_MM[1]
                and POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Z_RANGE_MM[0] <= float(point_mm[2]) <= POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Z_RANGE_MM[1]
            ):
                target_points.setdefault(tuple(round(float(value), 9) for value in point), point.copy())

    if len(target_points) != EXPECTED_POSITIVE_X_FRONT_CENTER_TILT_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_FRONT_CENTER_TILT_VERTEX_COUNT} positive-X front-center tilt vertices, "
            f"found {len(target_points)}."
        )

    ramp_contact_chain, ramp_debug = build_positive_x_front_ramp_contact_chain(
        gltf,
        bin_chunk,
        list(target_points.values()),
        np.array([POSITIVE_X_FRONT_CENTER_TILT_VERTEX_X_RANGE_MM[0], -1.1, -17.05], dtype=float),
        np.array([POSITIVE_X_FRONT_CENTER_TILT_VERTEX_X_RANGE_MM[1], -0.4, -14.2], dtype=float),
    )
    point_map = {
        point_key: contact_point.copy()
        for point_key, contact_point in zip(target_points.keys(), ramp_contact_chain)
    }
    adjusted_distances_mm = [
        float(np.linalg.norm(original_point - point_map[point_key]) * 1000.0)
        for point_key, original_point in target_points.items()
    ]

    remapped_shell_triangles = remap_product_points_in_triangles(shell_triangles, point_map)
    replace_shell_with_product_triangles(gltf, bin_chunk, remapped_shell_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive-X front-center tilt finalization, found {len(final_boundary_edges)} boundary edges."
        )

    return {
        "adjustedVertexCount": len(point_map),
        "vertexRangesProductMm": {
            "x": list(POSITIVE_X_FRONT_CENTER_TILT_VERTEX_X_RANGE_MM),
            "y": list(POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Y_RANGE_MM),
            "z": list(POSITIVE_X_FRONT_CENTER_TILT_VERTEX_Z_RANGE_MM),
        },
        "adjustedVertexProductMm": [vector_to_mm_list(point) for point in point_map.values()],
        "adjustedDistanceToRampRangeMm": [
            round(min(adjusted_distances_mm), 4),
            round(max(adjusted_distances_mm), 4),
        ],
        "boundaryEdgeCountAfterAdjustment": len(final_boundary_edges),
        "rampContactChain": ramp_debug,
    }


def finalize_negative_x_front_strip_tilt(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    candidate_points: dict[tuple[float, float, float], np.ndarray] = {}
    for triangle in shell_triangles:
        for point in triangle:
            point_mm = point * 1000.0
            if (
                NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_X_RANGE_MM[0] <= float(point_mm[0]) <= NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_X_RANGE_MM[1]
                and NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Y_RANGE_MM[0] <= float(point_mm[1]) <= NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Y_RANGE_MM[1]
                and NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Z_RANGE_MM[0] <= float(point_mm[2]) <= NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Z_RANGE_MM[1]
            ):
                candidate_points.setdefault(tuple(round(float(value), 9) for value in point), point.copy())

    sorted_points = sorted(candidate_points.values(), key=lambda point: float(point[0]))
    clusters: list[list[np.ndarray]] = []
    current_cluster: list[np.ndarray] = []
    for point in sorted_points:
        if not current_cluster:
            current_cluster = [point]
            continue
        previous_point = current_cluster[-1]
        x_gap_mm = abs(float((point[0] - previous_point[0]) * 1000.0))
        if x_gap_mm <= NEGATIVE_X_FRONT_STRIP_TILT_CLUSTER_GAP_MM:
            current_cluster.append(point)
        else:
            clusters.append(current_cluster)
            current_cluster = [point]
    if current_cluster:
        clusters.append(current_cluster)

    selected_points = [min(cluster, key=lambda point: float(point[2])) for cluster in clusters]
    if len(selected_points) != EXPECTED_NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_COUNT} negative-X front-strip tilt vertices, "
            f"found {len(selected_points)}."
        )

    ramp_contact_chain, ramp_debug = build_positive_x_front_ramp_contact_chain(
        gltf,
        bin_chunk,
        selected_points,
        np.array([NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_X_RANGE_MM[0], -1.1, -17.2], dtype=float),
        np.array([NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_X_RANGE_MM[1], -0.4, -14.0], dtype=float),
    )
    point_map = {
        tuple(round(float(value), 9) for value in point): contact_point.copy()
        for point, contact_point in zip(selected_points, ramp_contact_chain)
    }
    adjusted_distances_mm = [
        float(np.linalg.norm(point - point_map[tuple(round(float(value), 9) for value in point)]) * 1000.0)
        for point in selected_points
    ]

    remapped_shell_triangles = remap_product_points_in_triangles(shell_triangles, point_map)
    replace_shell_with_product_triangles(gltf, bin_chunk, remapped_shell_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after negative-X front-strip tilt finalization, found {len(final_boundary_edges)} boundary edges."
        )

    return {
        "adjustedVertexCount": len(point_map),
        "vertexRangesProductMm": {
            "x": list(NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_X_RANGE_MM),
            "y": list(NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Y_RANGE_MM),
            "z": list(NEGATIVE_X_FRONT_STRIP_TILT_VERTEX_Z_RANGE_MM),
        },
        "clusterGapMm": NEGATIVE_X_FRONT_STRIP_TILT_CLUSTER_GAP_MM,
        "adjustedVertexProductMm": [vector_to_mm_list(point) for point in point_map.values()],
        "adjustedDistanceToRampRangeMm": [
            round(min(adjusted_distances_mm), 4),
            round(max(adjusted_distances_mm), 4),
        ],
        "boundaryEdgeCountAfterAdjustment": len(final_boundary_edges),
        "rampContactChain": ramp_debug,
    }


def rebuild_front_edge_uniform_strip_coarse(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    triangle_indices: list[int] = []
    selected_points: list[np.ndarray] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        triangle_points = np.stack(triangle, axis=0)
        xs_mm = triangle_points[:, 0] * 1000.0
        ys_mm = triangle_points[:, 1] * 1000.0
        zs_mm = triangle_points[:, 2] * 1000.0
        if (
            min(xs_mm) >= FRONT_EDGE_UNIFORM_COARSE_X_RANGE_MM[0]
            and max(xs_mm) <= FRONT_EDGE_UNIFORM_COARSE_X_RANGE_MM[1]
            and min(ys_mm) >= FRONT_EDGE_UNIFORM_COARSE_Y_RANGE_MM[0]
            and max(ys_mm) <= FRONT_EDGE_UNIFORM_COARSE_Y_RANGE_MM[1]
            and min(zs_mm) >= FRONT_EDGE_UNIFORM_COARSE_Z_RANGE_MM[0]
            and max(zs_mm) <= FRONT_EDGE_UNIFORM_COARSE_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)
            selected_points.extend(triangle)

    if len(triangle_indices) != EXPECTED_FRONT_EDGE_UNIFORM_COARSE_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_COARSE_TRIANGLE_COUNT} coarse front-edge strip triangles, "
            f"found {len(triangle_indices)}."
        )

    target_indices = set(triangle_indices)
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_region)
    hole_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= FRONT_EDGE_UNIFORM_COARSE_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(hole_boundary_edges)
    if len(hole_loop) != EXPECTED_FRONT_EDGE_UNIFORM_COARSE_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_COARSE_HOLE_VERTEX_COUNT} coarse front-edge strip hole vertices, "
            f"found {len(hole_loop)}."
        )

    chain_a = [point.copy() for point in hole_loop[:EXPECTED_FRONT_EDGE_UNIFORM_COARSE_CHAIN_POINT_COUNT]]
    chain_b = [
        point.copy()
        for point in reversed(hole_loop[EXPECTED_FRONT_EDGE_UNIFORM_COARSE_CHAIN_POINT_COUNT - 1 :])
    ]
    if (
        len(chain_a) != EXPECTED_FRONT_EDGE_UNIFORM_COARSE_CHAIN_POINT_COUNT
        or len(chain_b) != EXPECTED_FRONT_EDGE_UNIFORM_COARSE_CHAIN_POINT_COUNT
    ):
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_COARSE_CHAIN_POINT_COUNT}-point chains for coarse front-edge strip rebuild, "
            f"found {len(chain_a)} and {len(chain_b)}."
        )

    reference_center = np.mean(np.stack(chain_a + chain_b, axis=0), axis=0)
    rebuilt_triangles = [
        triangle
        for triangle in build_uniform_strip_between_chains(chain_a, chain_b, reference_center)
        if float(np.linalg.norm(np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0]))) > 1e-12
    ]
    if len(rebuilt_triangles) != EXPECTED_FRONT_EDGE_UNIFORM_COARSE_REBUILT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_COARSE_REBUILT_TRIANGLE_COUNT} rebuilt coarse front-edge strip triangles, "
            f"found {len(rebuilt_triangles)}."
        )

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after coarse front-edge strip rebuild, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    region_mins, region_maxs = compute_bbox(selected_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "holeLoopVertexCount": len(hole_loop),
        "chainAPointCount": len(chain_a),
        "chainBPointCount": len(chain_b),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "boundaryEdgeCountAfterRebuild": len(final_boundary_edges),
        "regionBboxMinProductMm": vector_to_mm_list(region_mins),
        "regionBboxMaxProductMm": vector_to_mm_list(region_maxs),
        "regionBboxSizeProductMm": vector_to_mm_list(region_maxs - region_mins),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "selectionRangesProductMm": {
            "x": list(FRONT_EDGE_UNIFORM_COARSE_X_RANGE_MM),
            "y": list(FRONT_EDGE_UNIFORM_COARSE_Y_RANGE_MM),
            "z": list(FRONT_EDGE_UNIFORM_COARSE_Z_RANGE_MM),
        },
    }


def refine_front_edge_uniform_strip(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    triangle_indices: list[int] = []
    visible_triangle_count = 0
    center_connector_triangle_count = 0
    selected_points: list[np.ndarray] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        triangle_points = np.stack(triangle, axis=0)
        xs_mm = triangle_points[:, 0] * 1000.0
        ys_mm = triangle_points[:, 1] * 1000.0
        zs_mm = triangle_points[:, 2] * 1000.0
        in_visible_strip = (
            min(xs_mm) >= FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_X_RANGE_MM[0]
            and max(xs_mm) <= FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_X_RANGE_MM[1]
            and min(ys_mm) >= FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Y_RANGE_MM[0]
            and max(ys_mm) <= FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Y_RANGE_MM[1]
            and min(zs_mm) >= FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Z_RANGE_MM[0]
            and max(zs_mm) <= FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Z_RANGE_MM[1]
        )
        in_center_connector = (
            min(xs_mm) >= FRONT_EDGE_UNIFORM_REBUILD_CENTER_X_RANGE_MM[0]
            and max(xs_mm) <= FRONT_EDGE_UNIFORM_REBUILD_CENTER_X_RANGE_MM[1]
            and min(ys_mm) >= FRONT_EDGE_UNIFORM_REBUILD_CENTER_Y_RANGE_MM[0]
            and max(ys_mm) <= FRONT_EDGE_UNIFORM_REBUILD_CENTER_Y_RANGE_MM[1]
            and min(zs_mm) >= FRONT_EDGE_UNIFORM_REBUILD_CENTER_Z_RANGE_MM[0]
            and max(zs_mm) <= FRONT_EDGE_UNIFORM_REBUILD_CENTER_Z_RANGE_MM[1]
        )
        if in_visible_strip or in_center_connector:
            triangle_indices.append(triangle_index)
            selected_points.extend(triangle)
            if in_visible_strip:
                visible_triangle_count += 1
            else:
                center_connector_triangle_count += 1

    if len(triangle_indices) != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_TRIANGLE_COUNT} front-edge strip triangles, "
            f"found {len(triangle_indices)}."
        )
    if visible_triangle_count != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_TRIANGLE_COUNT} visible front-edge strip triangles, "
            f"found {visible_triangle_count}."
        )
    if center_connector_triangle_count != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CENTER_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CENTER_TRIANGLE_COUNT} front-edge center connector triangles, "
            f"found {center_connector_triangle_count}."
        )

    target_indices = set(triangle_indices)
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_region)
    hole_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= FRONT_EDGE_UNIFORM_REBUILD_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(hole_boundary_edges)
    if len(hole_loop) != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_HOLE_VERTEX_COUNT} front-edge strip hole vertices, "
            f"found {len(hole_loop)}."
        )

    left_contact_chain = [point.copy() for point in hole_loop[0:12]]
    center_upper_chain = [point.copy() for point in hole_loop[12:15]]
    right_lower_chain = [point.copy() for point in hole_loop[15:28]]
    right_contact_chain = [point.copy() for point in reversed(hole_loop[28:41])]
    center_lower_chain = [point.copy() for point in reversed(hole_loop[41:44])]
    left_lower_chain = [point.copy() for point in reversed(hole_loop[44:56])]
    if (
        len(left_contact_chain) != 12
        or len(center_upper_chain) != 3
        or len(right_lower_chain) != 13
        or len(right_contact_chain) != 13
        or len(center_lower_chain) != 3
        or len(left_lower_chain) != 12
    ):
        raise ValueError(
            "Unexpected front-edge uniform rebuild chain partition lengths: "
            f"{len(left_contact_chain)}, {len(center_upper_chain)}, {len(right_lower_chain)}, "
            f"{len(right_contact_chain)}, {len(center_lower_chain)}, {len(left_lower_chain)}."
        )

    reference_lower_point = left_lower_chain[-1]
    adjusted_right_lower_chain: list[np.ndarray] = []
    point_map: dict[tuple[float, float, float], np.ndarray] = {}
    adjusted_distances_mm: list[float] = []
    for point in right_lower_chain:
        adjusted_point = point.copy()
        adjusted_point[1] = reference_lower_point[1]
        adjusted_point[2] = reference_lower_point[2]
        adjusted_right_lower_chain.append(adjusted_point)
        point_map[tuple(round(float(value), 9) for value in point)] = adjusted_point.copy()
        adjusted_distances_mm.append(float(np.linalg.norm(point - adjusted_point) * 1000.0))

    shell_without_region = remap_product_points_in_triangles(shell_without_region, point_map)

    chain_a = left_contact_chain + center_upper_chain + adjusted_right_lower_chain
    chain_b = left_lower_chain + center_lower_chain + right_contact_chain
    if (
        len(chain_a) != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CHAIN_POINT_COUNT
        or len(chain_b) != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CHAIN_POINT_COUNT
    ):
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_CHAIN_POINT_COUNT}-point chains for front-edge strip rebuild, "
            f"found {len(chain_a)} and {len(chain_b)}."
        )

    reference_center = np.mean(np.stack(chain_a + chain_b, axis=0), axis=0)
    rebuilt_triangles = [
        triangle
        for triangle in build_uniform_strip_between_chains(chain_a, chain_b, reference_center)
        if float(np.linalg.norm(np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0]))) > 1e-12
    ]
    if len(rebuilt_triangles) != EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_REBUILT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_EDGE_UNIFORM_REBUILD_REBUILT_TRIANGLE_COUNT} rebuilt front-edge strip triangles, "
            f"found {len(rebuilt_triangles)}."
        )

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after front-edge uniform strip rebuild, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    region_mins, region_maxs = compute_bbox(selected_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "visibleStripTriangleCount": visible_triangle_count,
        "centerConnectorTriangleCount": center_connector_triangle_count,
        "holeLoopVertexCount": len(hole_loop),
        "chainAPointCount": len(chain_a),
        "chainBPointCount": len(chain_b),
        "adjustedRightLowerPointCount": len(adjusted_right_lower_chain),
        "adjustedRightLowerDistanceRangeMm": [
            round(min(adjusted_distances_mm), 4),
            round(max(adjusted_distances_mm), 4),
        ],
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "boundaryEdgeCountAfterRebuild": len(final_boundary_edges),
        "regionBboxMinProductMm": vector_to_mm_list(region_mins),
        "regionBboxMaxProductMm": vector_to_mm_list(region_maxs),
        "regionBboxSizeProductMm": vector_to_mm_list(region_maxs - region_mins),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "selectionRangesProductMm": {
            "visibleStrip": {
                "x": list(FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_X_RANGE_MM),
                "y": list(FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Y_RANGE_MM),
                "z": list(FRONT_EDGE_UNIFORM_REBUILD_VISIBLE_Z_RANGE_MM),
            },
            "centerConnector": {
                "x": list(FRONT_EDGE_UNIFORM_REBUILD_CENTER_X_RANGE_MM),
                "y": list(FRONT_EDGE_UNIFORM_REBUILD_CENTER_Y_RANGE_MM),
                "z": list(FRONT_EDGE_UNIFORM_REBUILD_CENTER_Z_RANGE_MM),
            },
        },
    }


def rebuild_front_edge_uniform_strip(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    coarse_pass = rebuild_front_edge_uniform_strip_coarse(
        gltf,
        bin_chunk,
    )
    refinement_pass = refine_front_edge_uniform_strip(
        gltf,
        bin_chunk,
    )
    return {
        "mode": "coarseThenRefine",
        "initialPass": coarse_pass,
        "refinementPass": refinement_pass,
        "boundaryEdgeCountAfterRebuild": refinement_pass["boundaryEdgeCountAfterRebuild"],
        "finalRebuiltTriangleCount": refinement_pass["rebuiltTriangleCount"],
        "adjustedRightLowerPointCount": refinement_pass["adjustedRightLowerPointCount"],
        "adjustedRightLowerDistanceRangeMm": refinement_pass["adjustedRightLowerDistanceRangeMm"],
    }


def select_front_edge_cross_strip_triangles(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    *,
    x_range_mm: tuple[float, float],
) -> list[int]:
    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0
        if not (
            min(xs_mm) >= x_range_mm[0]
            and max(xs_mm) <= x_range_mm[1]
            and min(zs_mm) >= NEGATIVE_X_PAIRING_REPAIR_Z_RANGE_MM[0]
            and max(zs_mm) <= NEGATIVE_X_PAIRING_REPAIR_Z_RANGE_MM[1]
        ):
            continue
        has_top = bool(np.any(ys_mm > NEGATIVE_X_PAIRING_REPAIR_TOP_Y_MIN_MM))
        has_bottom = bool(
            np.any(
                (ys_mm > NEGATIVE_X_PAIRING_REPAIR_BOTTOM_Y_RANGE_MM[0])
                & (ys_mm < NEGATIVE_X_PAIRING_REPAIR_BOTTOM_Y_RANGE_MM[1])
            )
        )
        if has_top and has_bottom:
            triangle_indices.append(triangle_index)
    return triangle_indices


def classify_positive_x_pairing_repair_loop(
    hole_loop: list[np.ndarray],
) -> dict[str, list[np.ndarray]]:
    if len(hole_loop) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_PAIRING_REPAIR_HOLE_VERTEX_COUNT} positive-X pairing-repair hole vertices, "
            f"found {len(hole_loop)}."
        )
    chains = {
        "C": [point.copy() for point in hole_loop[0:13]],
        "A": [point.copy() for point in hole_loop[13:26]],
        "B": [point.copy() for point in hole_loop[26:39]],
        "D": [point.copy() for point in hole_loop[39:52]],
    }
    if any(len(chain) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_CHAIN_POINT_COUNT for chain in chains.values()):
        raise ValueError("Unexpected positive-X pairing-repair chain lengths.")
    return chains


def classify_negative_x_pairing_repair_loop(
    hole_loop: list[np.ndarray],
) -> dict[str, list[np.ndarray]]:
    if len(hole_loop) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_PAIRING_REPAIR_HOLE_VERTEX_COUNT} negative-X pairing-repair hole vertices, "
            f"found {len(hole_loop)}."
        )
    chains = {
        "C": [point.copy() for point in hole_loop[1:14]],
        "A": [point.copy() for point in hole_loop[27:40]],
        "B": [hole_loop[0].copy()] + [point.copy() for point in reversed(hole_loop[40:52])],
        "D": [point.copy() for point in reversed(hole_loop[14:27])],
    }
    if any(len(chain) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_CHAIN_POINT_COUNT for chain in chains.values()):
        raise ValueError("Unexpected negative-X pairing-repair chain lengths.")
    return chains


def repair_negative_x_front_strip_pairing(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    reference_indices = select_front_edge_cross_strip_triangles(
        shell_triangles,
        x_range_mm=NEGATIVE_X_PAIRING_REPAIR_X_POS_RANGE_MM,
    )
    target_indices = select_front_edge_cross_strip_triangles(
        shell_triangles,
        x_range_mm=NEGATIVE_X_PAIRING_REPAIR_X_NEG_RANGE_MM,
    )
    if len(reference_indices) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_REFERENCE_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_PAIRING_REPAIR_REFERENCE_TRIANGLE_COUNT} positive-X pairing-repair reference triangles, "
            f"found {len(reference_indices)}."
        )
    if len(target_indices) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_TARGET_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_PAIRING_REPAIR_TARGET_TRIANGLE_COUNT} negative-X pairing-repair target triangles, "
            f"found {len(target_indices)}."
        )

    reference_triangle_set = set(reference_indices)
    target_triangle_set = set(target_indices)

    shell_without_reference = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in reference_triangle_set
    ]
    reference_boundary_edges = build_boundary_edges(shell_without_reference)
    reference_hole_edges = [
        edge
        for edge in reference_boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_POS_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_POS_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    reference_loop = ordered_boundary_loop_from_edges(reference_hole_edges)
    reference_chains = classify_positive_x_pairing_repair_loop(reference_loop)

    shell_without_target = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_triangle_set
    ]
    target_boundary_edges = build_boundary_edges(shell_without_target)
    target_hole_edges = [
        edge
        for edge in target_boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_NEG_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_NEG_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    target_loop = ordered_boundary_loop_from_edges(target_hole_edges)
    target_chains = classify_negative_x_pairing_repair_loop(target_loop)

    point_map: dict[tuple[float, float, float], np.ndarray] = {}
    for chain_label in ("A", "B", "C", "D"):
        reference_sorted = sorted(reference_chains[chain_label], key=lambda point: abs(float(point[0])))
        target_sorted = sorted(target_chains[chain_label], key=lambda point: abs(float(point[0])))
        for reference_point, target_point in zip(reference_sorted, target_sorted):
            point_map[tuple(round(float(value), 9) for value in reference_point)] = target_point.copy()

    rebuilt_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for triangle_index in reference_indices:
        remapped_triangle: list[np.ndarray] = []
        for point in shell_triangles[triangle_index]:
            replacement = point_map.get(tuple(round(float(value), 9) for value in point))
            if replacement is None:
                raise ValueError("Failed to map positive-X reference triangle into negative-X pairing repair region.")
            remapped_triangle.append(replacement.copy())
        rebuilt_triangles.append(tuple(remapped_triangle))

    reference_center = np.mean(np.stack([point for triangle in rebuilt_triangles for point in triangle], axis=0), axis=0)
    rebuilt_triangles.append(
        orient_triangle_away_from_center(
            (
                target_chains["A"][0],
                target_chains["C"][0],
                target_chains["D"][0],
            ),
            reference_center,
        )
    )
    rebuilt_triangles.append(
        orient_triangle_away_from_center(
            (
                target_chains["B"][0],
                target_chains["D"][0],
                target_chains["C"][0],
            ),
            reference_center,
        )
    )

    if len(rebuilt_triangles) != EXPECTED_NEGATIVE_X_PAIRING_REPAIR_REBUILT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_PAIRING_REPAIR_REBUILT_TRIANGLE_COUNT} rebuilt negative-X pairing-repair triangles, "
            f"found {len(rebuilt_triangles)}."
        )

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_target + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after negative-X pairing repair, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    target_points = [point for triangle_index in target_indices for point in shell_triangles[triangle_index]]
    target_mins, target_maxs = compute_bbox(target_points)
    return {
        "referenceTriangleCount": len(reference_indices),
        "targetTriangleCount": len(target_indices),
        "referenceHoleVertexCount": len(reference_loop),
        "targetHoleVertexCount": len(target_loop),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
        "targetTriangleIndices": sorted(target_triangle_set),
        "referenceTriangleIndices": sorted(reference_triangle_set),
        "targetBboxMinProductMm": vector_to_mm_list(target_mins),
        "targetBboxMaxProductMm": vector_to_mm_list(target_maxs),
        "targetBboxSizeProductMm": vector_to_mm_list(target_maxs - target_mins),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
    }


def repair_negative_x_front_strip_endpoint_anchor(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    reference_indices = select_front_edge_cross_strip_triangles(
        shell_triangles,
        x_range_mm=NEGATIVE_X_PAIRING_REPAIR_X_POS_RANGE_MM,
    )
    target_indices = select_front_edge_cross_strip_triangles(
        shell_triangles,
        x_range_mm=NEGATIVE_X_PAIRING_REPAIR_X_NEG_RANGE_MM,
    )
    reference_triangle_set = set(reference_indices)
    target_triangle_set = set(target_indices)

    shell_without_reference = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in reference_triangle_set
    ]
    reference_boundary_edges = build_boundary_edges(shell_without_reference)
    reference_hole_edges = [
        edge
        for edge in reference_boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_POS_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_POS_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    reference_loop = ordered_boundary_loop_from_edges(reference_hole_edges)
    reference_chains = classify_positive_x_pairing_repair_loop(reference_loop)

    shell_without_target = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_triangle_set
    ]
    target_boundary_edges = build_boundary_edges(shell_without_target)
    target_hole_edges = [
        edge
        for edge in target_boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_NEG_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_NEG_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_PAIRING_REPAIR_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    target_loop = ordered_boundary_loop_from_edges(target_hole_edges)
    target_chains = classify_negative_x_pairing_repair_loop(target_loop)

    reference_sorted = sorted(reference_chains["A"], key=lambda point: abs(float(point[0])))
    target_sorted = sorted(target_chains["A"], key=lambda point: abs(float(point[0])))
    old_endpoint = target_sorted[-1].copy()
    new_endpoint = reference_sorted[-1].copy()
    new_endpoint[0] *= -1.0

    endpoint_key = tuple(round(float(value), 9) for value in old_endpoint)
    affected_triangle_indices = [
        triangle_index
        for triangle_index, triangle in enumerate(shell_triangles)
        if any(tuple(round(float(value), 9) for value in point) == endpoint_key for point in triangle)
    ]
    if len(affected_triangle_indices) != EXPECTED_NEGATIVE_X_ENDPOINT_ANCHOR_AFFECTED_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_ENDPOINT_ANCHOR_AFFECTED_TRIANGLE_COUNT} triangles sharing negative-X endpoint anchor, "
            f"found {len(affected_triangle_indices)}."
        )

    remapped_shell_triangles = remap_product_points_in_triangles(
        shell_triangles,
        {
            endpoint_key: new_endpoint,
        },
    )
    replace_shell_with_product_triangles(gltf, bin_chunk, remapped_shell_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after negative-X endpoint anchor repair, found {len(final_boundary_edges)} boundary edges."
        )

    return {
        "affectedTriangleCount": len(affected_triangle_indices),
        "affectedTriangleIndices": affected_triangle_indices,
        "oldEndpointProductMm": vector_to_mm_list(old_endpoint),
        "newEndpointProductMm": vector_to_mm_list(new_endpoint),
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
    }


def regularize_positive_x_corner_strip_thickness(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    target_points: dict[tuple[float, float, float], np.ndarray] = {}
    for triangle in shell_triangles:
        for point in triangle:
            point_mm = point * 1000.0
            if (
                POSITIVE_X_CORNER_THICKNESS_B_X_RANGE_MM[0] <= float(point_mm[0]) <= POSITIVE_X_CORNER_THICKNESS_B_X_RANGE_MM[1]
                and POSITIVE_X_CORNER_THICKNESS_B_Y_RANGE_MM[0] <= float(point_mm[1]) <= POSITIVE_X_CORNER_THICKNESS_B_Y_RANGE_MM[1]
                and POSITIVE_X_CORNER_THICKNESS_B_Z_RANGE_MM[0] <= float(point_mm[2]) <= POSITIVE_X_CORNER_THICKNESS_B_Z_RANGE_MM[1]
            ):
                target_points.setdefault(tuple(round(float(value), 9) for value in point), point.copy())

    sorted_points = sorted(target_points.values(), key=lambda point: float(point[0]))
    if len(sorted_points) != EXPECTED_POSITIVE_X_CORNER_THICKNESS_B_POINT_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_CORNER_THICKNESS_B_POINT_COUNT} positive-X corner thickness points, "
            f"found {len(sorted_points)}."
        )

    start_point = sorted_points[0]
    end_point = sorted_points[-1]
    point_map: dict[tuple[float, float, float], np.ndarray] = {}
    for point_index, point in enumerate(sorted_points):
        blend = point_index / max(len(sorted_points) - 1, 1)
        replacement = point.copy()
        replacement[1] = (start_point[1] * (1.0 - blend)) + (end_point[1] * blend)
        replacement[2] = (start_point[2] * (1.0 - blend)) + (end_point[2] * blend)
        point_map[tuple(round(float(value), 9) for value in point)] = replacement

    remapped_shell_triangles = remap_product_points_in_triangles(shell_triangles, point_map)
    replace_shell_with_product_triangles(gltf, bin_chunk, remapped_shell_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive-X corner thickness regularization, found {len(final_boundary_edges)} boundary edges."
        )

    adjusted_points = [point_map[tuple(round(float(value), 9) for value in point)] for point in sorted_points]
    adjusted_depths_mm = [float(point[2] * 1000.0) for point in adjusted_points]
    return {
        "adjustedPointCount": len(adjusted_points),
        "originalPointsProductMm": [vector_to_mm_list(point) for point in sorted_points],
        "adjustedPointsProductMm": [vector_to_mm_list(point) for point in adjusted_points],
        "selectionRangesProductMm": {
            "x": list(POSITIVE_X_CORNER_THICKNESS_B_X_RANGE_MM),
            "y": list(POSITIVE_X_CORNER_THICKNESS_B_Y_RANGE_MM),
            "z": list(POSITIVE_X_CORNER_THICKNESS_B_Z_RANGE_MM),
        },
        "adjustedDepthRangeMm": [
            round(min(adjusted_depths_mm), 4),
            round(max(adjusted_depths_mm), 4),
        ],
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
    }


def select_front_corner_region_triangles(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    *,
    x_range_mm: tuple[float, float],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    selected_points: list[np.ndarray] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        triangle_points = np.stack(triangle, axis=0)
        xs_mm = triangle_points[:, 0] * 1000.0
        ys_mm = triangle_points[:, 1] * 1000.0
        zs_mm = triangle_points[:, 2] * 1000.0
        if (
            min(xs_mm) >= x_range_mm[0]
            and max(xs_mm) <= x_range_mm[1]
            and min(ys_mm) >= NEGATIVE_X_CORNER_STYLE_Y_RANGE_MM[0]
            and max(ys_mm) <= NEGATIVE_X_CORNER_STYLE_Y_RANGE_MM[1]
            and min(zs_mm) >= NEGATIVE_X_CORNER_STYLE_Z_RANGE_MM[0]
            and max(zs_mm) <= NEGATIVE_X_CORNER_STYLE_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)
            selected_points.extend(triangle)

    mins, maxs = compute_bbox(selected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
    }


def repair_negative_x_front_corner_line_style(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    reference_region = select_front_corner_region_triangles(
        shell_triangles,
        x_range_mm=NEGATIVE_X_CORNER_STYLE_REFERENCE_X_RANGE_MM,
    )
    target_region = select_front_corner_region_triangles(
        shell_triangles,
        x_range_mm=NEGATIVE_X_CORNER_STYLE_TARGET_X_RANGE_MM,
    )
    reference_indices = reference_region["triangleIndices"]
    target_indices = target_region["triangleIndices"]
    if len(reference_indices) != EXPECTED_NEGATIVE_X_CORNER_STYLE_REFERENCE_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_CORNER_STYLE_REFERENCE_TRIANGLE_COUNT} positive-X corner reference triangles, "
            f"found {len(reference_indices)}."
        )
    if len(target_indices) != EXPECTED_NEGATIVE_X_CORNER_STYLE_TARGET_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_CORNER_STYLE_TARGET_TRIANGLE_COUNT} negative-X corner target triangles, "
            f"found {len(target_indices)}."
        )

    def is_point_in_y_range(point: np.ndarray, y_range_mm: tuple[float, float]) -> bool:
        y_mm = float(point[1] * 1000.0)
        return y_range_mm[0] <= y_mm <= y_range_mm[1]

    def align_curve_to_ramp_arc(curve_points: list[np.ndarray]) -> list[np.ndarray]:
        if not curve_points:
            return []

        ramp_points_xz: list[np.ndarray] = []
        seen_ramp_keys: set[tuple[float, float]] = set()
        for triangle in build_part_geometries(gltf, bin_chunk)["Case_Base_Arc_Ramp_V4"]["triangles"]:
            for point in triangle:
                x_mm, y_mm, z_mm = (float(value) * 1000.0 for value in point)
                if (
                    NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[0] <= x_mm <= -20.0
                    and -3.0 <= y_mm <= 10.0
                    and NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[0] <= z_mm <= -12.0
                ):
                    ramp_key = (round(float(point[0]), 6), round(float(point[2]), 6))
                    if ramp_key in seen_ramp_keys:
                        continue
                    seen_ramp_keys.add(ramp_key)
                    ramp_points_xz.append(np.array([float(point[0]), float(point[2])], dtype=float))

        if not ramp_points_xz:
            return [point.copy() for point in sorted(curve_points, key=lambda point: float(point[0]))]

        def select_nearest_ramp_point(reference_point: np.ndarray) -> np.ndarray | None:
            candidates = [
                ramp_point
                for ramp_point in ramp_points_xz
                if abs(float(ramp_point[0] - reference_point[0]) * 1000.0) <= 2.5
            ]
            if not candidates:
                return None
            return min(
                candidates,
                key=lambda ramp_point: (
                    abs(float(ramp_point[0] - reference_point[0]) * 1000.0)
                    + (0.35 * abs(float(ramp_point[1] - reference_point[2]) * 1000.0))
                ),
            )

        sorted_curve = sorted(curve_points, key=lambda point: float(point[0]))
        overlap_matches: list[tuple[np.ndarray, np.ndarray]] = []
        for point in sorted_curve:
            nearest_point = select_nearest_ramp_point(point)
            if nearest_point is None:
                continue
            overlap_matches.append((point, nearest_point))

        if not overlap_matches:
            return [point.copy() for point in sorted_curve]

        z_offset = float(
            np.median(
                [float(reference_point[2] - ramp_point[1]) for reference_point, ramp_point in overlap_matches]
            )
        )
        adjusted_curve: list[np.ndarray] = []
        for point in sorted_curve:
            adjusted_point = point.copy()
            nearest_point = select_nearest_ramp_point(point)
            if nearest_point is not None:
                ramp_aligned_z = float(nearest_point[1] + z_offset)
                adjusted_point[2] = float((0.65 * float(point[2])) + (0.35 * ramp_aligned_z))
            adjusted_curve.append(adjusted_point)
        return adjusted_curve

    def fix_visible_strip_triangle_orientation(
        triangle: tuple[np.ndarray, np.ndarray, np.ndarray],
    ) -> tuple[tuple[np.ndarray, np.ndarray, np.ndarray], bool]:
        triangle_points = np.stack(triangle, axis=0)
        center_mm = triangle_points.mean(axis=0) * 1000.0
        normal = triangle_normal(triangle)
        if (
            NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_X_RANGE_MM[0] <= float(center_mm[0]) <= NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_X_RANGE_MM[1]
            and NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_Y_RANGE_MM[0] <= float(center_mm[1]) <= NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_Y_RANGE_MM[1]
            and NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_Z_RANGE_MM[0] <= float(center_mm[2]) <= NEGATIVE_X_CORNER_STYLE_VISIBLE_NORMAL_FIX_Z_RANGE_MM[1]
            and float(normal[1]) < -0.25
        ):
            return (triangle[0], triangle[2], triangle[1]), True
        return triangle, False

    target_triangle_set = set(target_indices)
    shell_without_target = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_triangle_set
    ]
    boundary_edges = build_boundary_edges(shell_without_target)
    local_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    boundary_point_lookup = {
        tuple(round(float(value), 9) for value in point): np.array(point, dtype=float)
        for edge in local_boundary_edges
        for point in edge
    }

    mirrored_point_map: dict[tuple[float, float, float], np.ndarray] = {}
    mirrored_reference_upper_curve: list[np.ndarray] = []
    mirrored_reference_lower_curve: list[np.ndarray] = []
    seen_reference_points: set[tuple[float, float, float]] = set()
    for triangle_index in reference_indices:
        for point in shell_triangles[triangle_index]:
            point_key_value = tuple(round(float(value), 9) for value in point)
            if point_key_value in mirrored_point_map:
                continue
            mirrored_point = np.array(point, dtype=float)
            mirrored_point[0] *= -1.0
            mirrored_key = tuple(round(float(value), 9) for value in mirrored_point)
            mirrored_point_map[point_key_value] = boundary_point_lookup.get(mirrored_key, mirrored_point)
            if point_key_value in seen_reference_points:
                continue
            seen_reference_points.add(point_key_value)
            if is_point_in_y_range(mirrored_point, NEGATIVE_X_CORNER_STYLE_VISIBLE_UPPER_Y_RANGE_MM):
                mirrored_reference_upper_curve.append(mirrored_point.copy())
            elif is_point_in_y_range(mirrored_point, NEGATIVE_X_CORNER_STYLE_VISIBLE_LOWER_Y_RANGE_MM):
                mirrored_reference_lower_curve.append(mirrored_point.copy())

    reference_center = np.mean(
        np.stack([point for triangle_index in reference_indices for point in shell_triangles[triangle_index]], axis=0),
        axis=0,
    )
    mirrored_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    mirrored_center = reference_center * np.array([-1.0, 1.0, 1.0], dtype=float)
    for triangle_index in reference_indices:
        remapped_triangle = tuple(
            np.array(mirrored_point_map[tuple(round(float(value), 9) for value in point)], dtype=float)
            for point in shell_triangles[triangle_index]
        )
        remapped_triangle = (remapped_triangle[0], remapped_triangle[2], remapped_triangle[1])
        mirrored_triangles.append(
            orient_triangle_away_from_center(
                remapped_triangle,
                mirrored_center,
            )
        )

    adjusted_upper_curve = align_curve_to_ramp_arc(mirrored_reference_upper_curve)
    adjusted_lower_curve = align_curve_to_ramp_arc(mirrored_reference_lower_curve)

    if len(adjusted_upper_curve) < 2 or len(adjusted_lower_curve) < 2:
        raise ValueError(
            "Expected both negative-X corner visible curves to contain at least two points."
        )

    leading_upper_count = max(len(adjusted_upper_curve) - len(adjusted_lower_curve), 0)
    if leading_upper_count >= len(adjusted_upper_curve):
        raise ValueError(
            "Negative-X corner visible curve alignment left no points for the rebuilt strip."
        )

    leading_upper_curve = adjusted_upper_curve[: leading_upper_count + 1] if leading_upper_count > 0 else []
    strip_upper_curve = adjusted_upper_curve[leading_upper_count:]
    strip_lower_curve = adjusted_lower_curve
    if len(strip_upper_curve) != len(strip_lower_curve):
        strip_lower_curve = resample_open_polyline(strip_lower_curve, len(strip_upper_curve))

    stage_one_shell = shell_without_target + mirrored_triangles
    stage_one_boundary_edges = build_boundary_edges(stage_one_shell)
    stage_one_local_edges = [
        edge
        for edge in stage_one_boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    stage_one_loop = ordered_boundary_loop_from_edges(stage_one_local_edges)
    if len(stage_one_loop) != EXPECTED_NEGATIVE_X_CORNER_STYLE_STAGE1_LOOP_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_X_CORNER_STYLE_STAGE1_LOOP_VERTEX_COUNT} vertices in the negative-X corner stage-one loop, "
            f"found {len(stage_one_loop)}."
        )

    visible_boundary_point_map: dict[tuple[float, float, float], np.ndarray] = {}
    for point in stage_one_loop:
        point_key_value = point_key(point)
        if is_point_in_y_range(point, NEGATIVE_X_CORNER_STYLE_VISIBLE_UPPER_Y_RANGE_MM) and adjusted_upper_curve:
            visible_boundary_point_map[point_key_value] = interpolate_point_by_x(
                adjusted_upper_curve,
                float(point[0]),
            )
        elif is_point_in_y_range(point, NEGATIVE_X_CORNER_STYLE_VISIBLE_LOWER_Y_RANGE_MM) and adjusted_lower_curve:
            visible_boundary_point_map[point_key_value] = interpolate_point_by_x(
                adjusted_lower_curve,
                float(point[0]),
            )

    adjusted_mirrored_triangles = [
        remap_triangle_points(triangle, visible_boundary_point_map) for triangle in mirrored_triangles
    ]

    visible_orientation_flip_count = 0
    oriented_shell_without_target: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for triangle in shell_without_target:
        fixed_triangle, flipped = fix_visible_strip_triangle_orientation(triangle)
        visible_orientation_flip_count += int(flipped)
        oriented_shell_without_target.append(fixed_triangle)

    support_edge_normals: dict[tuple[tuple[float, float, float], tuple[float, float, float]], list[np.ndarray]] = defaultdict(list)
    for triangle in oriented_shell_without_target:
        normal = triangle_normal(triangle)
        if float(np.linalg.norm(normal)) <= 1e-9:
            continue
        triangle_points = [point_key(point) for point in triangle]
        for start, end in ((0, 1), (1, 2), (2, 0)):
            edge = tuple(sorted((triangle_points[start], triangle_points[end])))
            support_edge_normals[edge].append(normal)

    oriented_mirrored_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    rebuilt_orientation_flip_count = 0
    rebuilt_strip_source_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    if leading_upper_curve:
        fan_anchor = np.array(strip_lower_curve[0], dtype=float)
        for point_a, point_b in zip(leading_upper_curve[:-1], leading_upper_curve[1:]):
            rebuilt_strip_source_triangles.append(
                (
                    np.array(point_a, dtype=float),
                    np.array(point_b, dtype=float),
                    fan_anchor.copy(),
                )
            )
    rebuilt_strip_source_triangles.extend(
        build_uniform_strip_between_chains(
            [np.array(point, dtype=float) for point in strip_upper_curve],
            [np.array(point, dtype=float) for point in strip_lower_curve],
            mirrored_center,
        )
    )

    for triangle in rebuilt_strip_source_triangles:
        pre_fixed_triangle, pre_fixed_flipped = fix_visible_strip_triangle_orientation(triangle)
        rebuilt_orientation_flip_count += int(pre_fixed_flipped)
        triangle_points = [point_key(point) for point in pre_fixed_triangle]
        neighbor_normals: list[np.ndarray] = []
        for start, end in ((0, 1), (1, 2), (2, 0)):
            edge = tuple(sorted((triangle_points[start], triangle_points[end])))
            neighbor_normals.extend(support_edge_normals.get(edge, []))
        oriented_triangle = orient_triangle_to_match_neighbor_normals(
            pre_fixed_triangle,
            neighbor_normals,
            mirrored_center,
        )
        if any(
            point_key(oriented_triangle[index]) != point_key(pre_fixed_triangle[index])
            for index in range(3)
        ):
            rebuilt_orientation_flip_count += 1
        oriented_mirrored_triangles.append(oriented_triangle)

    # Leave the corner hole open here. We only restore the visible outer strip;
    # the missing corner cap should be filled later by a dedicated patch model.
    final_shell = oriented_shell_without_target + oriented_mirrored_triangles
    replace_shell_with_product_triangles(gltf, bin_chunk, final_shell)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    rebuilt_points = [point for triangle in oriented_mirrored_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    target_points = [point for triangle_index in target_indices for point in shell_triangles[triangle_index]]
    target_mins, target_maxs = compute_bbox(target_points)
    final_local_boundary_edges = [
        edge
        for edge in final_boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_X_CORNER_STYLE_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    final_stage_one_loop_error: str | None = None
    try:
        final_stage_one_loop = ordered_boundary_loop_from_edges(final_local_boundary_edges)
    except ValueError as error:
        final_stage_one_loop_error = str(error)
        final_stage_one_loop = [
            np.array(point, dtype=float)
            for point in sorted(
                {
                    point
                    for edge in final_local_boundary_edges
                    for point in edge
                },
                key=lambda point: (point[0], point[1], point[2]),
            )
        ]
    return {
        "referenceTriangleCount": len(reference_indices),
        "targetTriangleCount": len(target_indices),
        "mirroredTriangleCount": len(oriented_mirrored_triangles),
        "snapPairCount": 0,
        "capFillTriangleCount": 0,
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
        "visibleBoundaryPointAdjustmentCount": len(visible_boundary_point_map),
        "visibleOrientationFlipCount": visible_orientation_flip_count,
        "rebuiltOrientationFlipCount": rebuilt_orientation_flip_count,
        "referenceTriangleIndices": sorted(reference_indices),
        "targetTriangleIndices": sorted(target_indices),
        "stageOneLoopProductMm": [vector_to_mm_list(point) for point in final_stage_one_loop],
        "stageOneLoopError": final_stage_one_loop_error,
        "stageTwoLoopProductMm": [],
        "snapPairs": [],
        "adjustedUpperCurveProductMm": [vector_to_mm_list(point) for point in adjusted_upper_curve],
        "adjustedLowerCurveProductMm": [vector_to_mm_list(point) for point in adjusted_lower_curve],
        "targetBboxMinProductMm": vector_to_mm_list(target_mins),
        "targetBboxMaxProductMm": vector_to_mm_list(target_maxs),
        "targetBboxSizeProductMm": vector_to_mm_list(target_maxs - target_mins),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
    }


def rebuild_positive_x_opening_strip_component(
    gltf: dict,
    bin_chunk: bytearray,
    *,
    z_positive: bool,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    component = collect_positive_x_opening_strip_component(shell_triangles, z_positive=z_positive)
    target_indices = set(int(index) for index in component["triangleIndices"])
    shell_without_component = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_component)
    bbox_min = np.array(component["bboxMinProductMm"], dtype=float)
    bbox_max = np.array(component["bboxMaxProductMm"], dtype=float)
    tolerance = POSITIVE_X_OPENING_STRIP_LOCAL_EDGE_TOLERANCE_MM
    local_hole_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= bbox_min[0] - tolerance
            and max(edge[0][0], edge[1][0]) * 1000.0 <= bbox_max[0] + tolerance
            and min(edge[0][1], edge[1][1]) * 1000.0 >= bbox_min[1] - tolerance
            and max(edge[0][1], edge[1][1]) * 1000.0 <= bbox_max[1] + tolerance
            and min(edge[0][2], edge[1][2]) * 1000.0 >= bbox_min[2] - tolerance
            and max(edge[0][2], edge[1][2]) * 1000.0 <= bbox_max[2] + tolerance
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(local_hole_edges)
    split_index = len(hole_loop) // 2
    chain_a = [point.copy() for point in hole_loop[: split_index + 1]]
    chain_b = [hole_loop[0].copy()] + [point.copy() for point in reversed(hole_loop[split_index:])]
    adjusted_chain_b = [point.copy() for point in chain_b]
    ramp_contact_chain_debug: dict[str, object] | None = None
    adjusted_point_count = 0
    adjusted_distances_mm: list[float] = []

    if not z_positive:
        ramp_contact_chain, ramp_contact_chain_debug = build_positive_x_front_ramp_contact_chain(
            gltf,
            bin_chunk,
            chain_b,
            bbox_min,
            bbox_max,
        )
        point_map: dict[tuple[float, float, float], np.ndarray] = {}
        for index, (original_point, ramp_point) in enumerate(zip(chain_b, ramp_contact_chain)):
            x_mm = float(original_point[0] * 1000.0)
            if index in (0, len(chain_b) - 1) or x_mm <= POSITIVE_X_OPENING_STRIP_TILT_START_X_MM:
                continue
            if x_mm >= POSITIVE_X_OPENING_STRIP_TILT_FULL_X_MM:
                blend = 1.0
            else:
                blend = (x_mm - POSITIVE_X_OPENING_STRIP_TILT_START_X_MM) / (
                    POSITIVE_X_OPENING_STRIP_TILT_FULL_X_MM - POSITIVE_X_OPENING_STRIP_TILT_START_X_MM
                )
            adjusted_point = (original_point * (1.0 - blend)) + (ramp_point * blend)
            adjusted_chain_b[index] = adjusted_point
            point_map[tuple(round(float(value), 9) for value in original_point)] = adjusted_point
            adjusted_point_count += 1
            adjusted_distances_mm.append(float(np.linalg.norm(adjusted_point - ramp_point) * 1000.0))

        if point_map:
            shell_without_component = remap_product_points_in_triangles(shell_without_component, point_map)

    reference_center = np.mean(np.stack(chain_a + adjusted_chain_b, axis=0), axis=0)
    rebuilt_triangles = loft_open_polylines(chain_a, adjusted_chain_b, reference_center)

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_component + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive-X {'positive' if z_positive else 'negative'}-Z strip rebuild, "
            f"found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "zSign": component["zSign"],
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "holeLoopVertexCount": len(hole_loop),
        "holeSplitIndex": split_index,
        "chainAPointCount": len(chain_a),
        "chainBPointCount": len(chain_b),
        "adjustedChainBPointCount": adjusted_point_count,
        "tiltBlendXRangeMm": [
            POSITIVE_X_OPENING_STRIP_TILT_START_X_MM,
            POSITIVE_X_OPENING_STRIP_TILT_FULL_X_MM,
        ],
        "boundaryEdgeCountAfterRebuild": len(final_boundary_edges),
        "adjustedPointDistanceToRampRangeMm": (
            [round(min(adjusted_distances_mm), 4), round(max(adjusted_distances_mm), 4)]
            if adjusted_distances_mm
            else None
        ),
        "rampContactChain": ramp_contact_chain_debug,
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "region": component,
    }


def select_positive_x_front_center_seam_triangles(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0
        if (
            min(xs_mm) >= POSITIVE_X_FRONT_CENTER_SEAM_X_RANGE_MM[0]
            and max(xs_mm) <= POSITIVE_X_FRONT_CENTER_SEAM_X_RANGE_MM[1]
            and min(ys_mm) >= POSITIVE_X_FRONT_CENTER_SEAM_Y_RANGE_MM[0]
            and max(ys_mm) <= POSITIVE_X_FRONT_CENTER_SEAM_Y_RANGE_MM[1]
            and min(zs_mm) >= POSITIVE_X_FRONT_CENTER_SEAM_Z_RANGE_MM[0]
            and max(zs_mm) <= POSITIVE_X_FRONT_CENTER_SEAM_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_POSITIVE_X_FRONT_CENTER_SEAM_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_FRONT_CENTER_SEAM_TRIANGLE_COUNT} positive-X front center seam triangles, "
            f"found {len(triangle_indices)}."
        )

    selected_triangles = [shell_triangles[index] for index in triangle_indices]
    selected_points = [point for triangle in selected_triangles for point in triangle]
    mins, maxs = compute_bbox(selected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionRangesProductMm": {
            "x": list(POSITIVE_X_FRONT_CENTER_SEAM_X_RANGE_MM),
            "y": list(POSITIVE_X_FRONT_CENTER_SEAM_Y_RANGE_MM),
            "z": list(POSITIVE_X_FRONT_CENTER_SEAM_Z_RANGE_MM),
        },
    }


def find_unique_shell_vertex_in_ranges(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    *,
    x_range_mm: tuple[float, float],
    y_range_mm: tuple[float, float],
    z_range_mm: tuple[float, float],
) -> np.ndarray:
    matching_points: list[np.ndarray] = []
    seen_points: set[tuple[float, float, float]] = set()

    for triangle in shell_triangles:
        for point in triangle:
            rounded_point = tuple(round(float(value), 9) for value in point)
            if rounded_point in seen_points:
                continue
            seen_points.add(rounded_point)

            point_mm = point * 1000.0
            if (
                x_range_mm[0] <= float(point_mm[0]) <= x_range_mm[1]
                and y_range_mm[0] <= float(point_mm[1]) <= y_range_mm[1]
                and z_range_mm[0] <= float(point_mm[2]) <= z_range_mm[1]
            ):
                matching_points.append(point.copy())

    if len(matching_points) != 1:
        raise ValueError(
            f"Expected exactly one shell vertex in ranges x={x_range_mm}, y={y_range_mm}, z={z_range_mm}; "
            f"found {len(matching_points)}."
        )
    return matching_points[0]


def repair_positive_x_front_center_seam(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    seam_region = select_positive_x_front_center_seam_triangles(shell_triangles)
    target_indices = set(int(index) for index in seam_region["triangleIndices"])
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_region)
    bbox_min = np.array(seam_region["bboxMinProductMm"], dtype=float)
    bbox_max = np.array(seam_region["bboxMaxProductMm"], dtype=float)
    tolerance = POSITIVE_X_FRONT_CENTER_SEAM_LOCAL_EDGE_TOLERANCE_MM
    hole_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= bbox_min[0] - tolerance
            and max(edge[0][0], edge[1][0]) * 1000.0 <= bbox_max[0] + tolerance
            and min(edge[0][1], edge[1][1]) * 1000.0 >= bbox_min[1] - tolerance
            and max(edge[0][1], edge[1][1]) * 1000.0 <= bbox_max[1] + tolerance
            and min(edge[0][2], edge[1][2]) * 1000.0 >= bbox_min[2] - tolerance
            and max(edge[0][2], edge[1][2]) * 1000.0 <= bbox_max[2] + tolerance
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(hole_boundary_edges)
    if len(hole_loop) != EXPECTED_POSITIVE_X_FRONT_CENTER_SEAM_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_FRONT_CENTER_SEAM_HOLE_VERTEX_COUNT} front center seam hole vertices, "
            f"found {len(hole_loop)}."
        )

    left_apex = find_unique_shell_vertex_in_ranges(
        shell_triangles,
        x_range_mm=POSITIVE_X_FRONT_CENTER_SEAM_LEFT_APEX_X_RANGE_MM,
        y_range_mm=POSITIVE_X_FRONT_CENTER_SEAM_LEFT_APEX_Y_RANGE_MM,
        z_range_mm=POSITIVE_X_FRONT_CENTER_SEAM_LEFT_APEX_Z_RANGE_MM,
    )
    mirrored_apex = left_apex.copy()
    mirrored_apex[0] *= -1.0

    reference_center = np.mean(np.stack([point for triangle in shell_triangles for point in triangle], axis=0), axis=0)
    rebuilt_triangles = [
        orient_triangle_away_from_center((hole_loop[index], hole_loop[(index + 1) % len(hole_loop)], mirrored_apex), reference_center)
        for index in range(len(hole_loop))
    ]

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive-X front center seam repair, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "holeLoopVertexCount": len(hole_loop),
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
        "leftApexProductMm": vector_to_mm_list(left_apex),
        "mirroredApexProductMm": vector_to_mm_list(mirrored_apex),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "region": seam_region,
    }


def repair_front_center_spur_node(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    spur_vertex = find_unique_shell_vertex_in_ranges(
        shell_triangles,
        x_range_mm=FRONT_CENTER_SPUR_NODE_X_RANGE_MM,
        y_range_mm=FRONT_CENTER_SPUR_NODE_Y_RANGE_MM,
        z_range_mm=FRONT_CENTER_SPUR_NODE_Z_RANGE_MM,
    )
    spur_key = tuple(round(float(value), 9) for value in spur_vertex)

    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        rounded_points = [tuple(round(float(value), 9) for value in point) for point in triangle]
        if spur_key in rounded_points:
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_FRONT_CENTER_SPUR_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_CENTER_SPUR_TRIANGLE_COUNT} triangles touching the front-center spur node, "
            f"found {len(triangle_indices)}."
        )

    target_indices = set(triangle_indices)
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_region)
    hole_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= FRONT_CENTER_SPUR_LOCAL_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= FRONT_CENTER_SPUR_LOCAL_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= FRONT_CENTER_SPUR_LOCAL_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= FRONT_CENTER_SPUR_LOCAL_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= FRONT_CENTER_SPUR_LOCAL_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= FRONT_CENTER_SPUR_LOCAL_Z_RANGE_MM[1]
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(hole_boundary_edges)
    if len(hole_loop) != EXPECTED_FRONT_CENTER_SPUR_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_CENTER_SPUR_HOLE_VERTEX_COUNT} front-center spur hole vertices, "
            f"found {len(hole_loop)}."
        )

    rebuilt_triangles = triangulate_boundary_loop_projected(hole_loop, dims=(0, 2))
    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after front-center spur repair, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "holeLoopVertexCount": len(hole_loop),
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
        "spurVertexProductMm": vector_to_mm_list(spur_vertex),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
    }


def repair_positive_x_cap_loft(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    apex_vertex = find_unique_shell_vertex_in_ranges(
        shell_triangles,
        x_range_mm=POSITIVE_X_CAP_APEX_X_RANGE_MM,
        y_range_mm=POSITIVE_X_CAP_APEX_Y_RANGE_MM,
        z_range_mm=POSITIVE_X_CAP_APEX_Z_RANGE_MM,
    )
    apex_key = tuple(round(float(value), 9) for value in apex_vertex)

    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        rounded_points = [tuple(round(float(value), 9) for value in point) for point in triangle]
        if apex_key in rounded_points:
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_POSITIVE_X_CAP_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_CAP_TRIANGLE_COUNT} triangles touching the positive-X cap apex, "
            f"found {len(triangle_indices)}."
        )

    target_indices = set(triangle_indices)
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_region)
    hole_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= POSITIVE_X_CAP_LOCAL_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= POSITIVE_X_CAP_LOCAL_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= POSITIVE_X_CAP_LOCAL_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= POSITIVE_X_CAP_LOCAL_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= POSITIVE_X_CAP_LOCAL_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= POSITIVE_X_CAP_LOCAL_Z_RANGE_MM[1]
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(hole_boundary_edges)
    if len(hole_loop) != EXPECTED_POSITIVE_X_CAP_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_CAP_HOLE_VERTEX_COUNT} positive-X cap hole vertices, "
            f"found {len(hole_loop)}."
        )

    chain_a = [point.copy() for point in hole_loop[:4]]
    chain_b = [hole_loop[0].copy()] + [point.copy() for point in reversed(hole_loop[4:])]
    reference_center = np.mean(np.stack([point for triangle in shell_triangles for point in triangle], axis=0), axis=0)
    rebuilt_triangles = loft_open_polylines(chain_a, chain_b, reference_center)
    if len(rebuilt_triangles) != EXPECTED_POSITIVE_X_CAP_REBUILT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_X_CAP_REBUILT_TRIANGLE_COUNT} rebuilt positive-X cap triangles, "
            f"found {len(rebuilt_triangles)}."
        )

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive-X cap loft repair, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "holeLoopVertexCount": len(hole_loop),
        "chainAPointCount": len(chain_a),
        "chainBPointCount": len(chain_b),
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
        "apexVertexProductMm": vector_to_mm_list(apex_vertex),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
    }


def repair_center_cap_alignment_strip(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]

    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0
        if (
            min(xs_mm) >= CENTER_CAP_ALIGNMENT_X_RANGE_MM[0]
            and max(xs_mm) <= CENTER_CAP_ALIGNMENT_X_RANGE_MM[1]
            and min(ys_mm) >= CENTER_CAP_ALIGNMENT_Y_RANGE_MM[0]
            and max(ys_mm) <= CENTER_CAP_ALIGNMENT_Y_RANGE_MM[1]
            and min(zs_mm) >= CENTER_CAP_ALIGNMENT_Z_RANGE_MM[0]
            and max(zs_mm) <= CENTER_CAP_ALIGNMENT_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_CENTER_CAP_ALIGNMENT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_CENTER_CAP_ALIGNMENT_TRIANGLE_COUNT} center-cap alignment triangles, "
            f"found {len(triangle_indices)}."
        )

    target_indices = set(triangle_indices)
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    boundary_edges = build_boundary_edges(shell_without_region)
    hole_boundary_edges = [
        edge
        for edge in boundary_edges
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= CENTER_CAP_ALIGNMENT_LOCAL_EDGE_X_RANGE_MM[0]
            and max(edge[0][0], edge[1][0]) * 1000.0 <= CENTER_CAP_ALIGNMENT_LOCAL_EDGE_X_RANGE_MM[1]
            and min(edge[0][1], edge[1][1]) * 1000.0 >= CENTER_CAP_ALIGNMENT_LOCAL_EDGE_Y_RANGE_MM[0]
            and max(edge[0][1], edge[1][1]) * 1000.0 <= CENTER_CAP_ALIGNMENT_LOCAL_EDGE_Y_RANGE_MM[1]
            and min(edge[0][2], edge[1][2]) * 1000.0 >= CENTER_CAP_ALIGNMENT_LOCAL_EDGE_Z_RANGE_MM[0]
            and max(edge[0][2], edge[1][2]) * 1000.0 <= CENTER_CAP_ALIGNMENT_LOCAL_EDGE_Z_RANGE_MM[1]
        )
    ]
    hole_loop = ordered_boundary_loop_from_edges(hole_boundary_edges)
    if len(hole_loop) != EXPECTED_CENTER_CAP_ALIGNMENT_HOLE_VERTEX_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_CENTER_CAP_ALIGNMENT_HOLE_VERTEX_COUNT} center-cap alignment hole vertices, "
            f"found {len(hole_loop)}."
        )

    chain_a = [point.copy() for point in hole_loop[:6]]
    chain_b = [point.copy() for point in reversed(hole_loop[6:])]
    reference_center = np.mean(np.stack([point for triangle in shell_triangles for point in triangle], axis=0), axis=0)
    rebuilt_triangles = loft_open_polylines(chain_a, chain_b, reference_center)
    if len(rebuilt_triangles) != EXPECTED_CENTER_CAP_ALIGNMENT_REBUILT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_CENTER_CAP_ALIGNMENT_REBUILT_TRIANGLE_COUNT} rebuilt center-cap alignment triangles, "
            f"found {len(rebuilt_triangles)}."
        )

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after center-cap alignment repair, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "holeLoopVertexCount": len(hole_loop),
        "chainAPointCount": len(chain_a),
        "chainBPointCount": len(chain_b),
        "boundaryEdgeCountAfterRepair": len(final_boundary_edges),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "selectionRangesProductMm": {
            "x": list(CENTER_CAP_ALIGNMENT_X_RANGE_MM),
            "y": list(CENTER_CAP_ALIGNMENT_Y_RANGE_MM),
            "z": list(CENTER_CAP_ALIGNMENT_Z_RANGE_MM),
        },
    }


def select_front_fill_artifact_triangles(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        center_mm = points.mean(axis=0) * 1000.0
        area_mm2 = triangle_area_mm2(triangle)
        if (
            FRONT_FILL_ARTIFACT_CENTER_X_RANGE_MM[0] <= float(center_mm[0]) <= FRONT_FILL_ARTIFACT_CENTER_X_RANGE_MM[1]
            and FRONT_FILL_ARTIFACT_CENTER_Y_RANGE_MM[0] <= float(center_mm[1]) <= FRONT_FILL_ARTIFACT_CENTER_Y_RANGE_MM[1]
            and FRONT_FILL_ARTIFACT_CENTER_Z_RANGE_MM[0] <= float(center_mm[2]) <= FRONT_FILL_ARTIFACT_CENTER_Z_RANGE_MM[1]
            and area_mm2 >= FRONT_FILL_ARTIFACT_AREA_MM2_MIN
        ):
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_FRONT_FILL_ARTIFACT_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_FILL_ARTIFACT_TRIANGLE_COUNT} front fill artifact triangles, "
            f"found {len(triangle_indices)}."
        )

    selected_triangles = [shell_triangles[index] for index in triangle_indices]
    selected_points = [point for triangle in selected_triangles for point in triangle]
    mins, maxs = compute_bbox(selected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionCenterRangesMm": {
            "x": list(FRONT_FILL_ARTIFACT_CENTER_X_RANGE_MM),
            "y": list(FRONT_FILL_ARTIFACT_CENTER_Y_RANGE_MM),
            "z": list(FRONT_FILL_ARTIFACT_CENTER_Z_RANGE_MM),
        },
        "areaMm2Min": FRONT_FILL_ARTIFACT_AREA_MM2_MIN,
    }


def append_product_triangles_to_shell(
    gltf: dict,
    bin_chunk: bytearray,
    product_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> int:
    if not product_triangles:
        return 0

    primitive, positions, normals = read_shell_primitive_rows(gltf, bin_chunk)
    named_node_product_matrices = build_named_node_product_matrices(gltf)
    shell_product_matrix = named_node_product_matrices["Case_Base_Shell"]
    product_to_shell_matrix = np.linalg.inv(shell_product_matrix)

    for product_triangle in product_triangles:
        local_triangle: list[np.ndarray] = []
        for product_point in product_triangle:
            local = np.array(
                [float(product_point[0]), float(product_point[1]), float(product_point[2]), 1.0],
                dtype=float,
            )
            shell_local = product_to_shell_matrix @ local
            local_triangle.append(shell_local[:3] / max(float(shell_local[3]), 1e-12))

        local_normal = triangle_normal(tuple(local_triangle))
        if np.allclose(local_normal, 0.0):
            raise ValueError("Encountered degenerate bridge triangle while appending shell geometry.")

        for local_point in local_triangle:
            positions.append([float(local_point[0]), float(local_point[1]), float(local_point[2])])
            normals.append([float(local_normal[0]), float(local_normal[1]), float(local_normal[2])])

    replace_nonindexed_primitive_rows(gltf, bin_chunk, primitive, positions, normals)
    return len(product_triangles)


def replace_shell_with_product_triangles(
    gltf: dict,
    bin_chunk: bytearray,
    product_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> int:
    primitive, _, _ = read_shell_primitive_rows(gltf, bin_chunk)
    named_node_product_matrices = build_named_node_product_matrices(gltf)
    shell_product_matrix = named_node_product_matrices["Case_Base_Shell"]
    product_to_shell_matrix = np.linalg.inv(shell_product_matrix)
    positions: list[list[float]] = []
    normals: list[list[float]] = []

    for product_triangle in product_triangles:
        local_triangle: list[np.ndarray] = []
        for product_point in product_triangle:
            local = np.array(
                [float(product_point[0]), float(product_point[1]), float(product_point[2]), 1.0],
                dtype=float,
            )
            shell_local = product_to_shell_matrix @ local
            local_triangle.append(shell_local[:3] / max(float(shell_local[3]), 1e-12))

        local_normal = triangle_normal(tuple(local_triangle))
        if np.allclose(local_normal, 0.0):
            raise ValueError("Encountered degenerate triangle while replacing shell geometry.")

        for local_point in local_triangle:
            positions.append([float(local_point[0]), float(local_point[1]), float(local_point[2])])
            normals.append([float(local_normal[0]), float(local_normal[1]), float(local_normal[2])])

    replace_nonindexed_primitive_rows(gltf, bin_chunk, primitive, positions, normals)
    return len(product_triangles)


def classify_positive_lip_chain_point(point: np.ndarray) -> str | None:
    point_mm = point * 1000.0
    y_mm = float(point_mm[1])
    z_mm = float(point_mm[2])

    if abs(y_mm + 0.456) <= 0.03 and abs(z_mm - 16.2) <= 0.05:
        return "bottom16"
    if abs(y_mm + 0.456) <= 0.03 and abs(z_mm - 17.0) <= 0.05:
        return "outer17"
    if abs(y_mm - 9.25) <= 0.03 and 15.3 <= z_mm <= 15.6:
        return "mid15"
    if y_mm >= 9.29 and 16.1 <= z_mm <= 16.36:
        return "upper16"
    return None


def collect_positive_lip_symmetry_chains(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    *,
    side_sign: int,
) -> dict[str, object]:
    chain_points: dict[str, dict[tuple[float, float, float], np.ndarray]] = defaultdict(dict)
    triangle_indices: list[int] = []
    collected_points: list[np.ndarray] = []

    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0

        if side_sign < 0:
            if min(xs_mm) < -POSITIVE_LIP_SYMMETRY_X_MAX_MM or max(xs_mm) > 0.001:
                continue
        else:
            if min(xs_mm) < -0.001 or max(xs_mm) > POSITIVE_LIP_SYMMETRY_X_MAX_MM:
                continue

        if (
            min(ys_mm) < POSITIVE_LIP_SYMMETRY_Y_RANGE_MM[0]
            or max(ys_mm) > POSITIVE_LIP_SYMMETRY_Y_RANGE_MM[1]
            or min(zs_mm) < POSITIVE_LIP_SYMMETRY_Z_RANGE_MM[0]
            or max(zs_mm) > POSITIVE_LIP_SYMMETRY_Z_RANGE_MM[1]
        ):
            continue

        triangle_indices.append(triangle_index)
        for point in triangle:
            x_mm = float(point[0]) * 1000.0
            if side_sign < 0 and x_mm > 0.001:
                continue
            if side_sign > 0 and x_mm < -0.001:
                continue

            chain_name = classify_positive_lip_chain_point(point)
            if chain_name is None:
                continue

            key = point_key(point)
            chain_points[chain_name][key] = point.copy()
            collected_points.append(point)

    ordered_chains: dict[str, list[np.ndarray]] = {}
    expected_chain_names = ("bottom16", "outer17", "mid15", "upper16")
    for chain_name in expected_chain_names:
        ordered_points = sorted(
            chain_points[chain_name].values(),
            key=lambda point: abs(float(point[0])),
        )
        if len(ordered_points) != EXPECTED_POSITIVE_LIP_CHAIN_POINT_COUNT:
            raise ValueError(
                f"Expected {EXPECTED_POSITIVE_LIP_CHAIN_POINT_COUNT} points in {chain_name} for side {side_sign}, "
                f"found {len(ordered_points)}."
            )
        ordered_chains[chain_name] = ordered_points

    mins, maxs = compute_bbox(collected_points)
    return {
        "sideSign": side_sign,
        "triangleIndices": sorted(set(triangle_indices)),
        "triangleCount": len(set(triangle_indices)),
        "chains": ordered_chains,
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
    }


def build_positive_lip_symmetry_point_map(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> tuple[dict[tuple[float, float, float], np.ndarray], dict[str, object]]:
    left_side = collect_positive_lip_symmetry_chains(shell_triangles, side_sign=-1)
    right_side = collect_positive_lip_symmetry_chains(shell_triangles, side_sign=1)

    remap: dict[tuple[float, float, float], np.ndarray] = {}
    moved_points: list[dict[str, object]] = []
    chain_names = ("bottom16", "outer17", "mid15", "upper16")
    for chain_name in chain_names:
        left_chain = left_side["chains"][chain_name]
        right_chain = right_side["chains"][chain_name]
        if len(left_chain) != len(right_chain):
            raise ValueError(
                f"Positive lip symmetry chain length mismatch for {chain_name}: "
                f"{len(left_chain)} vs {len(right_chain)}."
            )

        for index, (left_point, right_point) in enumerate(zip(left_chain, right_chain)):
            replacement = np.array(
                [abs(float(left_point[0])), float(left_point[1]), float(left_point[2])],
                dtype=float,
            )
            remap[point_key(right_point)] = replacement
            if not np.allclose(right_point, replacement, atol=1e-9):
                moved_points.append(
                    {
                        "chain": chain_name,
                        "index": index,
                        "fromProductMm": vector_to_mm_list(right_point),
                        "toProductMm": vector_to_mm_list(replacement),
                    }
                )

    return remap, {
        "leftRegion": {
            "triangleCount": int(left_side["triangleCount"]),
            "triangleIndices": list(left_side["triangleIndices"]),
            "bboxMinProductMm": list(left_side["bboxMinProductMm"]),
            "bboxMaxProductMm": list(left_side["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(left_side["bboxSizeProductMm"]),
        },
        "rightRegion": {
            "triangleCount": int(right_side["triangleCount"]),
            "triangleIndices": list(right_side["triangleIndices"]),
            "bboxMinProductMm": list(right_side["bboxMinProductMm"]),
            "bboxMaxProductMm": list(right_side["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(right_side["bboxSizeProductMm"]),
        },
        "chainPointCount": EXPECTED_POSITIVE_LIP_CHAIN_POINT_COUNT,
        "pointRemapCount": len(remap),
        "movedPointCount": len(moved_points),
        "movedPoints": moved_points,
    }


def enforce_positive_lip_symmetry(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    left_side = collect_positive_lip_symmetry_chains(shell_triangles, side_sign=-1)
    right_side = collect_positive_lip_symmetry_chains(shell_triangles, side_sign=1)

    left_triangle_indices = set(int(index) for index in left_side["triangleIndices"])
    right_triangle_indices = set(int(index) for index in right_side["triangleIndices"])
    left_triangles = [shell_triangles[index] for index in sorted(left_triangle_indices)]
    shell_without_right_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in right_triangle_indices
    ]

    point_remap: dict[tuple[float, float, float], np.ndarray] = {}
    moved_points: list[dict[str, object]] = []
    chain_names = ("bottom16", "outer17", "mid15", "upper16")
    for chain_name in chain_names:
        left_chain = left_side["chains"][chain_name]
        right_chain = right_side["chains"][chain_name]
        if len(left_chain) != len(right_chain):
            raise ValueError(
                f"Positive lip symmetry chain length mismatch for {chain_name}: "
                f"{len(left_chain)} vs {len(right_chain)}."
            )

        for index, (left_point, right_point) in enumerate(zip(left_chain, right_chain)):
            point_remap[point_key(left_point)] = right_point.copy()
            moved_points.append(
                {
                    "chain": chain_name,
                    "index": index,
                    "fromLeftProductMm": vector_to_mm_list(left_point),
                    "toRightProductMm": vector_to_mm_list(right_point),
                }
            )

    reference_center = np.mean(
        np.stack([point for chain in right_side["chains"].values() for point in chain], axis=0),
        axis=0,
    )
    rebuilt_right_region: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for triangle in left_triangles:
        mapped_triangle = tuple(point_remap[point_key(point)].copy() for point in triangle)
        rebuilt_right_region.append(orient_triangle_away_from_center(mapped_triangle, reference_center))

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_right_region + rebuilt_right_region)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive lip topology rebuild, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_right_region for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "leftRegion": {
            "triangleCount": int(left_side["triangleCount"]),
            "triangleIndices": list(left_side["triangleIndices"]),
            "bboxMinProductMm": list(left_side["bboxMinProductMm"]),
            "bboxMaxProductMm": list(left_side["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(left_side["bboxSizeProductMm"]),
        },
        "rightRegionRemoved": {
            "triangleCount": int(right_side["triangleCount"]),
            "triangleIndices": list(right_side["triangleIndices"]),
            "bboxMinProductMm": list(right_side["bboxMinProductMm"]),
            "bboxMaxProductMm": list(right_side["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(right_side["bboxSizeProductMm"]),
        },
        "rebuiltRightRegionTriangleCount": len(rebuilt_right_region),
        "chainPointCount": EXPECTED_POSITIVE_LIP_CHAIN_POINT_COUNT,
        "pointRemapCount": len(point_remap),
        "referenceCenterProductMm": vector_to_mm_list(reference_center),
        "rebuiltRegionBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltRegionBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltRegionBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "mappedChains": moved_points,
        "finalBoundaryEdgeCount": len(final_boundary_edges),
    }


def select_positive_lip_center_rebuild_region(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    collected_points: list[np.ndarray] = []
    chain_points: dict[str, dict[tuple[float, float, float], np.ndarray]] = defaultdict(dict)

    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0

        if (
            min(xs_mm) < POSITIVE_LIP_CENTER_REBUILD_X_RANGE_MM[0]
            or max(xs_mm) > POSITIVE_LIP_CENTER_REBUILD_X_RANGE_MM[1]
            or min(ys_mm) < POSITIVE_LIP_CENTER_REBUILD_Y_RANGE_MM[0]
            or max(ys_mm) > POSITIVE_LIP_CENTER_REBUILD_Y_RANGE_MM[1]
            or min(zs_mm) < POSITIVE_LIP_CENTER_REBUILD_Z_RANGE_MM[0]
            or max(zs_mm) > POSITIVE_LIP_CENTER_REBUILD_Z_RANGE_MM[1]
        ):
            continue

        triangle_indices.append(triangle_index)
        collected_points.extend(triangle)
        for point in triangle:
            x_mm = float(point[0]) * 1000.0
            if not (POSITIVE_LIP_CENTER_REBUILD_X_RANGE_MM[0] <= x_mm <= POSITIVE_LIP_CENTER_REBUILD_X_RANGE_MM[1]):
                continue
            chain_name = classify_positive_lip_chain_point(point)
            if chain_name is None:
                continue
            chain_points[chain_name][point_key(point)] = point.copy()

    if len(triangle_indices) != EXPECTED_POSITIVE_LIP_CENTER_REBUILD_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_LIP_CENTER_REBUILD_TRIANGLE_COUNT} positive lip center triangles, "
            f"found {len(triangle_indices)}."
        )

    expected_chain_names = ("outer17", "upper16", "mid15", "bottom16")
    ordered_chains: dict[str, list[np.ndarray]] = {}
    for chain_name in expected_chain_names:
        ordered_points = sorted(chain_points[chain_name].values(), key=lambda point: float(point[0]))
        if len(ordered_points) != EXPECTED_POSITIVE_LIP_CENTER_REBUILD_CHAIN_POINT_COUNT:
            raise ValueError(
                f"Expected {EXPECTED_POSITIVE_LIP_CENTER_REBUILD_CHAIN_POINT_COUNT} points in {chain_name} for "
                f"positive lip center rebuild, found {len(ordered_points)}."
            )
        ordered_chains[chain_name] = ordered_points

    mins, maxs = compute_bbox(collected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "chains": ordered_chains,
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionRangesProductMm": {
            "x": list(POSITIVE_LIP_CENTER_REBUILD_X_RANGE_MM),
            "y": list(POSITIVE_LIP_CENTER_REBUILD_Y_RANGE_MM),
            "z": list(POSITIVE_LIP_CENTER_REBUILD_Z_RANGE_MM),
        },
    }


def rebuild_positive_lip_center_strip(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    rebuild_region = select_positive_lip_center_rebuild_region(shell_triangles)
    target_indices = set(int(index) for index in rebuild_region["triangleIndices"])
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    chains = rebuild_region["chains"]
    reference_center = np.mean(
        np.stack([point for chain in chains.values() for point in chain], axis=0),
        axis=0,
    )
    rebuilt_triangles = (
        build_uniform_strip_between_chains(chains["outer17"], chains["upper16"], reference_center)
        + build_uniform_strip_between_chains(chains["upper16"], chains["mid15"], reference_center)
        + build_uniform_strip_between_chains(chains["bottom16"], chains["mid15"], reference_center)
    )
    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)

    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive lip center rebuild, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "boundaryEdgeCountAfterRebuild": len(final_boundary_edges),
        "region": {
            "triangleCount": int(rebuild_region["triangleCount"]),
            "triangleIndices": list(rebuild_region["triangleIndices"]),
            "bboxMinProductMm": list(rebuild_region["bboxMinProductMm"]),
            "bboxMaxProductMm": list(rebuild_region["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(rebuild_region["bboxSizeProductMm"]),
            "selectionRangesProductMm": dict(rebuild_region["selectionRangesProductMm"]),
        },
        "chainXCoordinatesProductMm": {
            name: [round(float(point[0]) * 1000.0, 3) for point in chains[name]]
            for name in ("outer17", "upper16", "mid15", "bottom16")
        },
    }


def select_positive_lip_upper_strip_region(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    collected_points: list[np.ndarray] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0
        if (
            min(xs_mm) >= POSITIVE_LIP_UPPER_STRIP_REBUILD_X_RANGE_MM[0]
            and max(xs_mm) <= POSITIVE_LIP_UPPER_STRIP_REBUILD_X_RANGE_MM[1]
            and min(ys_mm) >= POSITIVE_LIP_UPPER_STRIP_REBUILD_Y_RANGE_MM[0]
            and max(ys_mm) <= POSITIVE_LIP_UPPER_STRIP_REBUILD_Y_RANGE_MM[1]
            and min(zs_mm) >= POSITIVE_LIP_UPPER_STRIP_REBUILD_Z_RANGE_MM[0]
            and max(zs_mm) <= POSITIVE_LIP_UPPER_STRIP_REBUILD_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)
            collected_points.extend(triangle)

    if len(triangle_indices) != EXPECTED_POSITIVE_LIP_UPPER_STRIP_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_POSITIVE_LIP_UPPER_STRIP_TRIANGLE_COUNT} positive lip upper-strip triangles, "
            f"found {len(triangle_indices)}."
        )

    mins, maxs = compute_bbox(collected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionRangesProductMm": {
            "x": list(POSITIVE_LIP_UPPER_STRIP_REBUILD_X_RANGE_MM),
            "y": list(POSITIVE_LIP_UPPER_STRIP_REBUILD_Y_RANGE_MM),
            "z": list(POSITIVE_LIP_UPPER_STRIP_REBUILD_Z_RANGE_MM),
        },
    }


def rebuild_positive_lip_upper_strip(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    rebuild_region = select_positive_lip_upper_strip_region(shell_triangles)
    target_indices = set(int(index) for index in rebuild_region["triangleIndices"])
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    right_side = collect_positive_lip_symmetry_chains(shell_triangles, side_sign=1)
    upper_chain = right_side["chains"]["upper16"]
    mid_chain = right_side["chains"]["mid15"]
    reference_center = np.mean(np.stack(upper_chain + mid_chain, axis=0), axis=0)
    rebuilt_triangles = build_uniform_strip_between_chains(upper_chain, mid_chain, reference_center)
    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)

    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after positive lip upper-strip rebuild, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "boundaryEdgeCountAfterRebuild": len(final_boundary_edges),
        "region": {
            "triangleCount": int(rebuild_region["triangleCount"]),
            "triangleIndices": list(rebuild_region["triangleIndices"]),
            "bboxMinProductMm": list(rebuild_region["bboxMinProductMm"]),
            "bboxMaxProductMm": list(rebuild_region["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(rebuild_region["bboxSizeProductMm"]),
            "selectionRangesProductMm": dict(rebuild_region["selectionRangesProductMm"]),
        },
        "chainPointCount": len(upper_chain),
    }


def select_negative_front_center_transition_region(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    collected_points: list[np.ndarray] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        xs_mm = points[:, 0] * 1000.0
        ys_mm = points[:, 1] * 1000.0
        zs_mm = points[:, 2] * 1000.0
        if (
            min(xs_mm) >= NEGATIVE_FRONT_CENTER_TRANSITION_X_RANGE_MM[0]
            and max(xs_mm) <= NEGATIVE_FRONT_CENTER_TRANSITION_X_RANGE_MM[1]
            and min(ys_mm) >= NEGATIVE_FRONT_CENTER_TRANSITION_Y_RANGE_MM[0]
            and max(ys_mm) <= NEGATIVE_FRONT_CENTER_TRANSITION_Y_RANGE_MM[1]
            and min(zs_mm) >= NEGATIVE_FRONT_CENTER_TRANSITION_Z_RANGE_MM[0]
            and max(zs_mm) <= NEGATIVE_FRONT_CENTER_TRANSITION_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)
            collected_points.extend(triangle)

    if len(triangle_indices) != EXPECTED_NEGATIVE_FRONT_CENTER_TRANSITION_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_FRONT_CENTER_TRANSITION_TRIANGLE_COUNT} negative-front center triangles, "
            f"found {len(triangle_indices)}."
        )

    mins, maxs = compute_bbox(collected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionRangesProductMm": {
            "x": list(NEGATIVE_FRONT_CENTER_TRANSITION_X_RANGE_MM),
            "y": list(NEGATIVE_FRONT_CENTER_TRANSITION_Y_RANGE_MM),
            "z": list(NEGATIVE_FRONT_CENTER_TRANSITION_Z_RANGE_MM),
        },
    }


def rebuild_negative_front_center_transition(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    rebuild_region = select_negative_front_center_transition_region(shell_triangles)
    target_indices = set(int(index) for index in rebuild_region["triangleIndices"])
    shell_without_region = [
        triangle for triangle_index, triangle in enumerate(shell_triangles) if triangle_index not in target_indices
    ]

    hole_boundary_edges = [
        edge
        for edge in build_boundary_edges(shell_without_region)
        if (
            min(edge[0][0], edge[1][0]) * 1000.0 >= NEGATIVE_FRONT_CENTER_TRANSITION_X_RANGE_MM[0] - 0.5
            and max(edge[0][0], edge[1][0]) * 1000.0 <= NEGATIVE_FRONT_CENTER_TRANSITION_X_RANGE_MM[1] + 0.5
            and min(edge[0][1], edge[1][1]) * 1000.0 >= NEGATIVE_FRONT_CENTER_TRANSITION_Y_RANGE_MM[0] - 0.1
            and max(edge[0][1], edge[1][1]) * 1000.0 <= NEGATIVE_FRONT_CENTER_TRANSITION_Y_RANGE_MM[1] + 0.1
            and min(edge[0][2], edge[1][2]) * 1000.0 >= NEGATIVE_FRONT_CENTER_TRANSITION_Z_RANGE_MM[0] - 0.1
            and max(edge[0][2], edge[1][2]) * 1000.0 <= NEGATIVE_FRONT_CENTER_TRANSITION_Z_RANGE_MM[1] + 0.1
        )
    ]
    if len(hole_boundary_edges) != EXPECTED_NEGATIVE_FRONT_CENTER_TRANSITION_HOLE_EDGE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_NEGATIVE_FRONT_CENTER_TRANSITION_HOLE_EDGE_COUNT} local hole edges for "
            f"negative-front center rebuild, found {len(hole_boundary_edges)}."
        )

    loop_points = ordered_boundary_loop_from_edges(hole_boundary_edges)
    fan_apex = np.array(NEGATIVE_FRONT_CENTER_TRANSITION_FAN_APEX_PRODUCT_MM, dtype=float) / 1000.0
    reference_center = np.mean(np.stack(loop_points, axis=0), axis=0)
    rebuilt_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
    for index in range(len(loop_points)):
        triangle = orient_triangle_away_from_center(
            (
                fan_apex.copy(),
                loop_points[index].copy(),
                loop_points[(index + 1) % len(loop_points)].copy(),
            ),
            reference_center,
        )
        area_vector = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
        if float(np.linalg.norm(area_vector)) <= 1e-12:
            continue
        rebuilt_triangles.append(triangle)

    replace_shell_with_product_triangles(gltf, bin_chunk, shell_without_region + rebuilt_triangles)
    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if final_boundary_edges:
        raise ValueError(
            f"Expected closed shell after negative-front center rebuild, found {len(final_boundary_edges)} boundary edges."
        )

    rebuilt_points = [point for triangle in rebuilt_triangles for point in triangle]
    rebuilt_mins, rebuilt_maxs = compute_bbox(rebuilt_points)
    return {
        "removedTriangleCount": len(target_indices),
        "removedTriangleIndices": sorted(target_indices),
        "rebuiltTriangleCount": len(rebuilt_triangles),
        "rebuiltBboxMinProductMm": vector_to_mm_list(rebuilt_mins),
        "rebuiltBboxMaxProductMm": vector_to_mm_list(rebuilt_maxs),
        "rebuiltBboxSizeProductMm": vector_to_mm_list(rebuilt_maxs - rebuilt_mins),
        "boundaryEdgeCountAfterRebuild": len(final_boundary_edges),
        "fanApexProductMm": list(NEGATIVE_FRONT_CENTER_TRANSITION_FAN_APEX_PRODUCT_MM),
        "holeLoopPointCount": len(loop_points),
        "holeLoopProductMm": [vector_to_mm_list(point) for point in loop_points],
        "region": {
            "triangleCount": int(rebuild_region["triangleCount"]),
            "triangleIndices": list(rebuild_region["triangleIndices"]),
            "bboxMinProductMm": list(rebuild_region["bboxMinProductMm"]),
            "bboxMaxProductMm": list(rebuild_region["bboxMaxProductMm"]),
            "bboxSizeProductMm": list(rebuild_region["bboxSizeProductMm"]),
            "selectionRangesProductMm": dict(rebuild_region["selectionRangesProductMm"]),
        },
    }


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


def select_front_window_blocker_component(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    adjacency = build_triangle_vertex_adjacency(shell_triangles)
    seed_indices: list[int] = []
    allowed_indices: set[int] = set()

    for triangle_index, triangle in enumerate(shell_triangles):
        xs_mm = [float(point[0]) * 1000.0 for point in triangle]
        ys_mm = [float(point[1]) * 1000.0 for point in triangle]
        zs_mm = [float(point[2]) * 1000.0 for point in triangle]
        normal = triangle_normal(triangle)

        if (
            min(xs_mm) >= FRONT_BLOCKER_ALLOWED_X_RANGE_MM[0]
            and max(xs_mm) <= FRONT_BLOCKER_ALLOWED_X_RANGE_MM[1]
            and min(ys_mm) >= FRONT_BLOCKER_ALLOWED_Y_RANGE_MM[0]
            and max(ys_mm) <= FRONT_BLOCKER_ALLOWED_Y_RANGE_MM[1]
            and min(zs_mm) >= FRONT_BLOCKER_ALLOWED_Z_RANGE_MM[0]
            and max(zs_mm) <= FRONT_BLOCKER_ALLOWED_Z_RANGE_MM[1]
        ):
            allowed_indices.add(triangle_index)

        if (
            min(xs_mm) >= FRONT_BLOCKER_SEED_X_RANGE_MM[0]
            and max(xs_mm) <= FRONT_BLOCKER_SEED_X_RANGE_MM[1]
            and min(ys_mm) >= FRONT_BLOCKER_SEED_Y_RANGE_MM[0]
            and max(ys_mm) <= FRONT_BLOCKER_SEED_Y_RANGE_MM[1]
            and min(zs_mm) >= FRONT_BLOCKER_SEED_Z_RANGE_MM[0]
            and max(zs_mm) <= FRONT_BLOCKER_SEED_Z_RANGE_MM[1]
            and abs(float(normal[1])) <= FRONT_BLOCKER_NORMAL_Y_ABS_MAX
            and abs(float(normal[2])) >= FRONT_BLOCKER_NORMAL_Z_ABS_MIN
        ):
            seed_indices.append(triangle_index)

    component_indices: set[int] = set(seed_indices)
    queue = deque(seed_indices)
    while queue:
        current_index = queue.popleft()
        for neighbor_index in adjacency[current_index]:
            if neighbor_index in component_indices or neighbor_index not in allowed_indices:
                continue
            component_indices.add(neighbor_index)
            queue.append(neighbor_index)

    sorted_indices = sorted(component_indices)
    if len(sorted_indices) != EXPECTED_FRONT_BLOCKER_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_BLOCKER_TRIANGLE_COUNT} front blocker triangles, "
            f"found {len(sorted_indices)}."
        )

    component_triangles = [shell_triangles[index] for index in sorted_indices]
    component_points = [point for triangle in component_triangles for point in triangle]
    mins, maxs = compute_bbox(component_points)
    normals = [triangle_normal(triangle) for triangle in component_triangles]
    average_normal = np.mean(np.stack(normals, axis=0), axis=0)
    return {
        "triangleIndices": sorted_indices,
        "triangleCount": len(sorted_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "averageNormal": [round(float(value), 4) for value in average_normal],
        "seedRangesMm": {
            "x": list(FRONT_BLOCKER_SEED_X_RANGE_MM),
            "y": list(FRONT_BLOCKER_SEED_Y_RANGE_MM),
            "z": list(FRONT_BLOCKER_SEED_Z_RANGE_MM),
        },
        "allowedRangesMm": {
            "x": list(FRONT_BLOCKER_ALLOWED_X_RANGE_MM),
            "y": list(FRONT_BLOCKER_ALLOWED_Y_RANGE_MM),
            "z": list(FRONT_BLOCKER_ALLOWED_Z_RANGE_MM),
        },
    }


def select_remaining_front_face_triangles(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        center_mm = points.mean(axis=0) * 1000.0
        normal = triangle_normal(triangle)
        edge_lengths_mm = [
            float(np.linalg.norm(points[(edge_index + 1) % 3] - points[edge_index])) * 1000.0
            for edge_index in range(3)
        ]
        aspect_ratio = max(edge_lengths_mm) / max(min(edge_lengths_mm), 1e-9)

        if (
            REMAINING_FRONT_FACE_CENTER_X_RANGE_MM[0] <= float(center_mm[0]) <= REMAINING_FRONT_FACE_CENTER_X_RANGE_MM[1]
            and REMAINING_FRONT_FACE_CENTER_Y_RANGE_MM[0] <= float(center_mm[1]) <= REMAINING_FRONT_FACE_CENTER_Y_RANGE_MM[1]
            and REMAINING_FRONT_FACE_CENTER_Z_RANGE_MM[0] <= float(center_mm[2]) <= REMAINING_FRONT_FACE_CENTER_Z_RANGE_MM[1]
            and abs(float(normal[2])) >= REMAINING_FRONT_FACE_NORMAL_Z_ABS_MIN
            and aspect_ratio >= REMAINING_FRONT_FACE_ASPECT_MIN
        ):
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_REMAINING_FRONT_FACE_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_REMAINING_FRONT_FACE_TRIANGLE_COUNT} remaining front-face triangles, "
            f"found {len(triangle_indices)}."
        )

    selected_triangles = [shell_triangles[index] for index in triangle_indices]
    selected_points = [point for triangle in selected_triangles for point in triangle]
    mins, maxs = compute_bbox(selected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionCenterRangesMm": {
            "x": list(REMAINING_FRONT_FACE_CENTER_X_RANGE_MM),
            "y": list(REMAINING_FRONT_FACE_CENTER_Y_RANGE_MM),
            "z": list(REMAINING_FRONT_FACE_CENTER_Z_RANGE_MM),
        },
        "normalZAbsMin": REMAINING_FRONT_FACE_NORMAL_Z_ABS_MIN,
        "aspectRatioMin": REMAINING_FRONT_FACE_ASPECT_MIN,
    }


def select_remaining_sidewall_triangles(
    shell_triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
) -> dict[str, object]:
    triangle_indices: list[int] = []
    for triangle_index, triangle in enumerate(shell_triangles):
        points = np.stack(triangle, axis=0)
        center_mm = points.mean(axis=0) * 1000.0
        normal = triangle_normal(triangle)
        area_mm2 = triangle_area_mm2(triangle)

        if (
            REMAINING_SIDEWALL_CENTER_X_RANGE_MM[0] <= float(center_mm[0]) <= REMAINING_SIDEWALL_CENTER_X_RANGE_MM[1]
            and REMAINING_SIDEWALL_CENTER_Y_RANGE_MM[0] <= float(center_mm[1]) <= REMAINING_SIDEWALL_CENTER_Y_RANGE_MM[1]
            and REMAINING_SIDEWALL_CENTER_Z_RANGE_MM[0] <= float(center_mm[2]) <= REMAINING_SIDEWALL_CENTER_Z_RANGE_MM[1]
            and float(normal[0]) >= REMAINING_SIDEWALL_NORMAL_X_MIN
            and area_mm2 >= REMAINING_SIDEWALL_AREA_MM2_MIN
        ):
            triangle_indices.append(triangle_index)

    if len(triangle_indices) != EXPECTED_REMAINING_SIDEWALL_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_REMAINING_SIDEWALL_TRIANGLE_COUNT} remaining sidewall triangles, "
            f"found {len(triangle_indices)}."
        )

    selected_triangles = [shell_triangles[index] for index in triangle_indices]
    selected_points = [point for triangle in selected_triangles for point in triangle]
    mins, maxs = compute_bbox(selected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinProductMm": vector_to_mm_list(mins),
        "bboxMaxProductMm": vector_to_mm_list(maxs),
        "bboxSizeProductMm": vector_to_mm_list(maxs - mins),
        "selectionCenterRangesMm": {
            "x": list(REMAINING_SIDEWALL_CENTER_X_RANGE_MM),
            "y": list(REMAINING_SIDEWALL_CENTER_Y_RANGE_MM),
            "z": list(REMAINING_SIDEWALL_CENTER_Z_RANGE_MM),
        },
        "normalXMin": REMAINING_SIDEWALL_NORMAL_X_MIN,
        "areaMm2Min": REMAINING_SIDEWALL_AREA_MM2_MIN,
    }


def select_front_window_sloped_residual_triangles(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    _, positions, _ = read_shell_primitive_rows(gltf, bin_chunk)
    triangle_indices: list[int] = []
    selected_points: list[np.ndarray] = []

    for triangle_index in range(len(positions) // 3):
        points = np.array(positions[triangle_index * 3 : triangle_index * 3 + 3], dtype=float)
        center_mm = points.mean(axis=0) * 1000.0
        if (
            FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_X_RANGE_MM[0]
            <= float(center_mm[0])
            <= FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_X_RANGE_MM[1]
            and FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Y_RANGE_MM[0]
            <= float(center_mm[1])
            <= FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Y_RANGE_MM[1]
            and FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Z_RANGE_MM[0]
            <= float(center_mm[2])
            <= FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Z_RANGE_MM[1]
        ):
            triangle_indices.append(triangle_index)
            selected_points.extend(points)

    if len(triangle_indices) != EXPECTED_FRONT_WINDOW_SLOPED_RESIDUAL_TRIANGLE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_FRONT_WINDOW_SLOPED_RESIDUAL_TRIANGLE_COUNT} sloped residual triangles, "
            f"found {len(triangle_indices)}."
        )

    mins, maxs = compute_bbox(selected_points)
    return {
        "triangleIndices": triangle_indices,
        "triangleCount": len(triangle_indices),
        "bboxMinShellLocalMm": vector_to_mm_list(mins),
        "bboxMaxShellLocalMm": vector_to_mm_list(maxs),
        "bboxSizeShellLocalMm": vector_to_mm_list(maxs - mins),
        "selectionCenterRangesShellLocalMm": {
            "x": list(FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_X_RANGE_MM),
            "y": list(FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Y_RANGE_MM),
            "z": list(FRONT_WINDOW_SLOPED_RESIDUAL_LOCAL_Z_RANGE_MM),
        },
    }


def rebuild_front_window_shell(
    gltf: dict,
    bin_chunk: bytearray,
) -> dict[str, object]:
    part_geometries = build_part_geometries(gltf, bin_chunk)
    shell_triangles = part_geometries["Case_Base_Shell"]["triangles"]
    rim_reference = extract_front_window_reference_rim_chains(shell_triangles)
    blocker_component = select_front_window_blocker_component(shell_triangles)
    blocker_indices = set(int(index) for index in blocker_component["triangleIndices"])
    blocker_removed_count, after_blocker_triangle_count = remove_triangle_indices_from_shell(
        gltf,
        bin_chunk,
        blocker_indices,
    )

    part_geometries = build_part_geometries(gltf, bin_chunk)
    shell_triangles = part_geometries["Case_Base_Shell"]["triangles"]
    front_face_component = select_remaining_front_face_triangles(shell_triangles)
    front_face_indices = set(int(index) for index in front_face_component["triangleIndices"])
    front_face_removed_count, after_front_face_triangle_count = remove_triangle_indices_from_shell(
        gltf,
        bin_chunk,
        front_face_indices,
    )

    part_geometries = build_part_geometries(gltf, bin_chunk)
    shell_triangles = part_geometries["Case_Base_Shell"]["triangles"]
    sidewall_component = select_remaining_sidewall_triangles(shell_triangles)
    sidewall_indices = set(int(index) for index in sidewall_component["triangleIndices"])
    sidewall_removed_count, after_sidewall_triangle_count = remove_triangle_indices_from_shell(
        gltf,
        bin_chunk,
        sidewall_indices,
    )

    sloped_residual_component = select_front_window_sloped_residual_triangles(gltf, bin_chunk)
    sloped_residual_indices = set(int(index) for index in sloped_residual_component["triangleIndices"])
    sloped_residual_removed_count, after_sloped_residual_triangle_count = remove_triangle_indices_from_shell(
        gltf,
        bin_chunk,
        sloped_residual_indices,
    )

    front_window_corner_cap_removal = remove_front_window_corner_cap_triangle(
        gltf,
        bin_chunk,
        rim_reference,
    )
    front_window_corner_ramp_contact_point, front_window_corner_ramp_contact_debug = (
        extract_front_window_corner_ramp_contact_point(gltf, bin_chunk)
    )

    part_geometries = build_part_geometries(gltf, bin_chunk)
    shell_triangles = part_geometries["Case_Base_Shell"]["triangles"]
    boundary_loop = ordered_boundary_loop(shell_triangles)
    fill_triangles, fill_patch_debug = build_structured_front_window_patch(
        boundary_loop,
        rim_reference,
        corner_apex_override=front_window_corner_ramp_contact_point,
    )
    final_product_triangles = shell_triangles + fill_triangles
    replace_shell_with_product_triangles(gltf, bin_chunk, final_product_triangles)
    positive_x_front_strip_rebuild = rebuild_positive_x_opening_strip_component(
        gltf,
        bin_chunk,
        z_positive=False,
    )
    positive_x_front_center_seam_repair = repair_positive_x_front_center_seam(
        gltf,
        bin_chunk,
    )
    front_center_spur_repair = repair_front_center_spur_node(
        gltf,
        bin_chunk,
    )
    positive_x_cap_loft_repair = repair_positive_x_cap_loft(
        gltf,
        bin_chunk,
    )
    center_cap_alignment_repair = repair_center_cap_alignment_strip(
        gltf,
        bin_chunk,
    )
    positive_x_front_center_tilt_finalize = finalize_positive_x_front_center_strip_tilt(
        gltf,
        bin_chunk,
    )
    negative_x_front_strip_tilt_finalize = finalize_negative_x_front_strip_tilt(
        gltf,
        bin_chunk,
    )
    front_edge_uniform_rebuild = rebuild_front_edge_uniform_strip(
        gltf,
        bin_chunk,
    )
    negative_x_pairing_repair = repair_negative_x_front_strip_pairing(
        gltf,
        bin_chunk,
    )
    negative_x_endpoint_anchor_repair = repair_negative_x_front_strip_endpoint_anchor(
        gltf,
        bin_chunk,
    )
    positive_x_corner_thickness_regularization = regularize_positive_x_corner_strip_thickness(
        gltf,
        bin_chunk,
    )
    negative_x_corner_line_style_repair = repair_negative_x_front_corner_line_style(
        gltf,
        bin_chunk,
    )
    positive_x_back_strip_rebuild = {
        "skipped": True,
        "reason": "Leave the positive-Z / back-side opening strip untouched.",
    }
    positive_lip_symmetry = {
        "skipped": True,
        "reason": "Superseded by full positive-X opening strip rebuild.",
    }
    positive_lip_center_rebuild = {
        "skipped": True,
        "reason": "Superseded by full positive-X opening strip rebuild.",
    }
    positive_lip_upper_strip_rebuild = {
        "skipped": True,
        "reason": "Superseded by full positive-X opening strip rebuild.",
    }
    negative_front_center_rebuild = {
        "skipped": True,
        "reason": "Superseded by full positive-X opening strip rebuild.",
    }

    final_shell_triangles = build_part_geometries(gltf, bin_chunk)["Case_Base_Shell"]["triangles"]
    final_boundary_edges = build_boundary_edges(final_shell_triangles)
    if len(final_boundary_edges) not in (0, *EXPECTED_NEGATIVE_X_CORNER_STYLE_OPEN_BOUNDARY_EDGE_COUNTS):
        raise ValueError(
            f"Expected either a closed shell or the reserved negative-X corner opening, found {len(final_boundary_edges)} boundary edges."
        )

    fill_points = [point for triangle in fill_triangles for point in triangle]
    fill_mins, fill_maxs = compute_bbox(fill_points)
    return {
        "node": "Case_Base_Shell",
        "operation": "delete_front_blocker_remove_sloped_residuals_remove_corner_cap_rebuild_front_window_rebuild_positive_x_front_opening_strip_repair_front_center_seam_remove_center_spur_node_loft_positive_x_cap_and_align_center_cap_strip",
        "blockerRemovedTriangleCount": blocker_removed_count,
        "afterBlockerTriangleCount": after_blocker_triangle_count,
        "frontFaceRemovedTriangleCount": front_face_removed_count,
        "afterFrontFaceTriangleCount": after_front_face_triangle_count,
        "sidewallRemovedTriangleCount": sidewall_removed_count,
        "afterSidewallTriangleCount": after_sidewall_triangle_count,
        "slopedResidualRemovedTriangleCount": sloped_residual_removed_count,
        "afterSlopedResidualTriangleCount": after_sloped_residual_triangle_count,
        "fillPatchTriangleCount": len(fill_triangles),
        "finalTriangleCount": len(final_shell_triangles),
        "boundaryVertexCountBeforeFill": len(boundary_loop),
        "boundaryEdgeCountAfterFill": len(final_boundary_edges),
        "reservedNegativeXCornerOpening": len(final_boundary_edges) in EXPECTED_NEGATIVE_X_CORNER_STYLE_OPEN_BOUNDARY_EDGE_COUNTS,
        "blockerComponent": blocker_component,
        "frontFaceComponent": front_face_component,
        "sidewallComponent": sidewall_component,
        "slopedResidualComponent": sloped_residual_component,
        "frontWindowCornerCapRemoval": front_window_corner_cap_removal,
        "frontWindowCornerRampContact": front_window_corner_ramp_contact_debug,
        "rimReference": serialize_front_window_reference_rim(rim_reference),
        "fillPatchDebug": fill_patch_debug,
        "positiveXFrontStripRebuild": positive_x_front_strip_rebuild,
        "positiveXFrontCenterSeamRepair": positive_x_front_center_seam_repair,
        "frontCenterSpurRepair": front_center_spur_repair,
        "positiveXCapLoftRepair": positive_x_cap_loft_repair,
        "centerCapAlignmentRepair": center_cap_alignment_repair,
        "positiveXFrontCenterTiltFinalize": positive_x_front_center_tilt_finalize,
        "negativeXFrontStripTiltFinalize": negative_x_front_strip_tilt_finalize,
        "frontEdgeUniformRebuild": front_edge_uniform_rebuild,
        "negativeXFrontStripPairingRepair": negative_x_pairing_repair,
        "negativeXFrontStripEndpointAnchorRepair": negative_x_endpoint_anchor_repair,
        "positiveXCornerThicknessRegularization": positive_x_corner_thickness_regularization,
        "negativeXFrontCornerLineStyleRepair": negative_x_corner_line_style_repair,
        "positiveXBackStripRebuild": positive_x_back_strip_rebuild,
        "positiveLipSymmetry": positive_lip_symmetry,
        "positiveLipCenterRebuild": positive_lip_center_rebuild,
        "positiveLipUpperStripRebuild": positive_lip_upper_strip_rebuild,
        "negativeFrontCenterRebuild": negative_front_center_rebuild,
        "fillPatchBboxMinProductMm": vector_to_mm_list(fill_mins),
        "fillPatchBboxMaxProductMm": vector_to_mm_list(fill_maxs),
        "fillPatchBboxSizeProductMm": vector_to_mm_list(fill_maxs - fill_mins),
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
    rebuild_change_log = rebuild_front_window_shell(gltf, bin_chunk)
    part_geometries = build_part_geometries(gltf, bin_chunk)
    candidate_summary = analyze_shell_candidate_components(part_geometries["Case_Base_Shell"]["triangles"])
    render_six_view_sheet(
        part_geometries,
        candidate_summary,
        sheet_path,
        label="V5 Phase 2 Front Window Rebuild",
    )
    return {
        "phase": 2,
        "name": PHASE_NAMES[2],
        "geometryModified": True,
        "diagnosticSheetPath": str(sheet_path),
        "rebuildChangeLog": rebuild_change_log,
        "postRebuildCandidateSummary": candidate_summary,
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
    phase1_sheet_path = default_sheet_path(1) if args.phase == 1 else Path("/tmp/qihang_product_pearl_phase1_six_views.png")

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
