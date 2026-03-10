#!/usr/bin/env python3
"""
Build a LV3-style twin-earbud GLB with locked geometry constraints.

Outputs:
1) output/models/earbuds_lv3_style_v2.glb
2) apps/web/public/earbuds_lv3_style.glb (overwrite)
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
import trimesh
from trimesh.creation import capsule, cylinder, icosphere
from trimesh.transformations import rotation_matrix


# Locked dimensions (meters)
D_FACE = 0.0092
T_FACE = 0.0020
W_ARC = 0.0126
H_ARC = 0.0094
R_NOZZLE = 0.00145
L_NOZZLE = 0.0036
A_NOZZLE_MIN_DEG = 20.0
A_NOZZLE_MAX_DEG = 28.0
O_NOZZLE = 0.62 * (D_FACE / 2.0)
O_NOZZLE_MIN = 0.55 * (D_FACE / 2.0)
O_NOZZLE_MAX = 0.70 * (D_FACE / 2.0)
BUTTON_TOTAL_LENGTH = 0.0022

RATIO_MIN = 0.70
RATIO_MAX = 0.75
TRANSITION_MAX_DIST = 0.0003

NOZZLE_DIR_BASE = np.array([0.36, -0.24, 0.90], dtype=float)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT_MODEL = ROOT / "output" / "models" / "earbuds_lv3_style_v2.glb"
PUBLIC_MODEL = ROOT / "apps" / "web" / "public" / "earbuds_lv3_style.glb"


@dataclass
class EarBuildResult:
    parts: list[trimesh.Trimesh]
    face_parts: list[trimesh.Trimesh]
    arc_parts: list[trimesh.Trimesh]
    nozzle_parts: list[trimesh.Trimesh]
    face_bezel: trimesh.Trimesh
    transition_blend: trimesh.Trimesh
    first_arc_node: trimesh.Trimesh
    nozzle_dir: np.ndarray
    nozzle_anchor: np.ndarray


def set_color(mesh: trimesh.Trimesh, rgba: tuple[int, int, int, int]) -> trimesh.Trimesh:
    mesh.visual.face_colors = np.tile(np.array(rgba, dtype=np.uint8), (len(mesh.faces), 1))
    return mesh


def rotate_xyz(mesh: trimesh.Trimesh, rx: float = 0.0, ry: float = 0.0, rz: float = 0.0) -> None:
    if abs(rx) > 1e-12:
        mesh.apply_transform(rotation_matrix(rx, [1, 0, 0]))
    if abs(ry) > 1e-12:
        mesh.apply_transform(rotation_matrix(ry, [0, 1, 0]))
    if abs(rz) > 1e-12:
        mesh.apply_transform(rotation_matrix(rz, [0, 0, 1]))


def translate(mesh: trimesh.Trimesh, xyz: Iterable[float]) -> None:
    mesh.apply_translation(np.array(list(xyz), dtype=float))


def align_z_to_vector(mesh: trimesh.Trimesh, direction: np.ndarray) -> None:
    d = np.array(direction, dtype=float)
    norm = np.linalg.norm(d)
    if norm <= 1e-12:
        raise ValueError("Direction must be non-zero.")
    d /= norm
    mat = trimesh.geometry.align_vectors([0, 0, 1], d)
    if mat is not None:
        mesh.apply_transform(mat)


def capsule_total_length(radius: float, total_length: float, count: tuple[int, int]) -> trimesh.Trimesh:
    shaft = max(total_length - (2.0 * radius), 1e-6)
    return capsule(radius=radius, height=shaft, count=count)


def merge_bounds(meshes: Iterable[trimesh.Trimesh]) -> np.ndarray:
    mins = []
    maxs = []
    for mesh in meshes:
        mins.append(mesh.bounds[0])
        maxs.append(mesh.bounds[1])
    mins_a = np.min(np.array(mins), axis=0)
    maxs_a = np.max(np.array(maxs), axis=0)
    return np.stack([mins_a, maxs_a], axis=0)


def transform_meshes(meshes: Iterable[trimesh.Trimesh], rx: float, ry: float, rz: float, t: np.ndarray) -> None:
    for mesh in meshes:
        rotate_xyz(mesh, rx=rx, ry=ry, rz=rz)
        translate(mesh, t)


def min_sampled_distance(mesh_a: trimesh.Trimesh, mesh_b: trimesh.Trimesh, samples: int = 420) -> float:
    va = mesh_a.vertices
    vb = mesh_b.vertices
    if len(va) > samples:
        idx = np.linspace(0, len(va) - 1, samples, dtype=int)
        va = va[idx]
    if len(vb) > samples:
        idx = np.linspace(0, len(vb) - 1, samples, dtype=int)
        vb = vb[idx]
    diff = va[:, None, :] - vb[None, :, :]
    d = np.sqrt(np.sum(diff * diff, axis=2))
    return float(d.min())


def aabb_overlap_volume(mesh_a: trimesh.Trimesh, mesh_b: trimesh.Trimesh) -> float:
    a_min, a_max = mesh_a.bounds
    b_min, b_max = mesh_b.bounds
    overlap_min = np.maximum(a_min, b_min)
    overlap_max = np.minimum(a_max, b_max)
    extent = np.maximum(0.0, overlap_max - overlap_min)
    return float(np.prod(extent))


def build_single_ear(side: int = 1) -> EarBuildResult:
    if side not in (-1, 1):
        raise ValueError("side must be -1 or 1")

    parts: list[trimesh.Trimesh] = []
    face_parts: list[trimesh.Trimesh] = []
    arc_parts: list[trimesh.Trimesh] = []
    nozzle_parts: list[trimesh.Trimesh] = []

    # Front cylindrical face (3-layer stack)
    r_face = D_FACE * 0.5
    h_bezel = T_FACE * 0.56
    h_inner = T_FACE * 0.34
    h_ring = T_FACE * 0.10

    face_bezel = cylinder(radius=r_face, height=h_bezel, sections=128)
    translate(face_bezel, [0, 0, h_bezel * 0.5])
    set_color(face_bezel, (191, 191, 191, 255))
    parts.append(face_bezel)
    face_parts.append(face_bezel)

    inner_face = cylinder(radius=r_face * 0.88, height=h_inner, sections=112)
    translate(inner_face, [0, 0, h_bezel + (h_inner * 0.5)])
    set_color(inner_face, (138, 138, 138, 255))
    parts.append(inner_face)
    face_parts.append(inner_face)

    thin_ring = cylinder(radius=r_face * 0.95, height=h_ring, sections=112)
    translate(thin_ring, [0, 0, h_bezel - (h_ring * 0.35)])
    set_color(thin_ring, (204, 204, 204, 255))
    parts.append(thin_ring)
    face_parts.append(thin_ring)

    # Top-side volume button
    button = capsule_total_length(radius=0.00034, total_length=BUTTON_TOTAL_LENGTH, count=(12, 18))
    rotate_xyz(button, rx=0.22, ry=-0.12 * side, rz=-0.62 * side)
    translate(button, [side * (r_face * 0.30), r_face * 0.34, h_bezel + h_inner + 0.0001])
    set_color(button, (170, 170, 170, 255))
    parts.append(button)
    face_parts.append(button)

    # Transition blend: ensures continuous connection from disk to arc body
    transition_blend = capsule(radius=0.00235, height=0.0026, count=[12, 20])
    blend_start = np.array([side * (r_face * 0.40), 0.00002, 0.00060], dtype=float)
    blend_end = np.array([side * 0.0031, -0.00100, -0.00255], dtype=float)
    blend_dir = blend_end - blend_start
    align_z_to_vector(transition_blend, blend_dir)
    translate(transition_blend, (blend_start + blend_end) * 0.5)
    set_color(transition_blend, (179, 179, 179, 255))
    parts.append(transition_blend)
    arc_parts.append(transition_blend)

    # Arc body (4 control nodes + connecting capsules)
    ctrl = np.array(
        [
            [side * 0.0028, -0.00090, -0.0027],
            [side * 0.0042, -0.0018, -0.0047],
            [side * 0.0054, -0.0030, -0.0068],
            [side * 0.0062, -0.0041, -0.0085],
        ],
        dtype=float,
    )
    node_r = [0.0029, 0.0027, 0.0024, 0.0022]
    node_scale = np.array([1.05, 0.78, 0.94], dtype=float)

    arc_nodes: list[trimesh.Trimesh] = []
    for p, r in zip(ctrl, node_r):
        node = icosphere(subdivisions=3, radius=r)
        node.vertices *= node_scale
        translate(node, p)
        set_color(node, (176, 176, 176, 255))
        parts.append(node)
        arc_parts.append(node)
        arc_nodes.append(node)

    for i in range(len(ctrl) - 1):
        a = ctrl[i]
        b = ctrl[i + 1]
        d = b - a
        dist = np.linalg.norm(d)
        r_seg = min(node_r[i], node_r[i + 1]) * 0.84
        h_seg = max(dist - (2.0 * r_seg), 1e-6)
        seg = capsule(radius=r_seg, height=h_seg, count=[12, 18])
        seg.vertices *= np.array([1.06, 0.80, 0.96], dtype=float)
        align_z_to_vector(seg, d)
        translate(seg, (a + b) * 0.5)
        set_color(seg, (174, 174, 174, 255))
        parts.append(seg)
        arc_parts.append(seg)

    # Scale arc body to locked width/height
    arc_bounds = merge_bounds(arc_parts)
    arc_size = arc_bounds[1] - arc_bounds[0]
    sx = W_ARC / max(arc_size[0], 1e-9)
    sy = H_ARC / max(arc_size[1], 1e-9)
    sz = (sx + sy) * 0.5
    arc_scale = np.array([sx, sy, sz], dtype=float)
    for m in arc_parts:
        m.vertices *= arc_scale

    # Side-anchored, slightly angled nozzle
    anchor_dir_xy = np.array([0.90 * side, -0.435, 0.0], dtype=float)
    anchor_dir_xy /= np.linalg.norm(anchor_dir_xy[:2])
    nozzle_anchor = (anchor_dir_xy * O_NOZZLE) + np.array([0.0, 0.0, -0.00135], dtype=float)

    nozzle_dir = NOZZLE_DIR_BASE.copy()
    nozzle_dir[0] *= side
    nozzle_dir /= np.linalg.norm(nozzle_dir)

    nozzle = cylinder(radius=R_NOZZLE, height=L_NOZZLE, sections=72)
    align_z_to_vector(nozzle, nozzle_dir)
    translate(nozzle, nozzle_anchor + nozzle_dir * (L_NOZZLE * 0.5))
    set_color(nozzle, (52, 52, 52, 255))
    parts.append(nozzle)
    nozzle_parts.append(nozzle)

    tip_core = capsule_total_length(radius=0.0020, total_length=0.0030, count=(12, 18))
    align_z_to_vector(tip_core, nozzle_dir)
    translate(tip_core, nozzle_anchor + nozzle_dir * (L_NOZZLE + 0.00135))
    set_color(tip_core, (29, 29, 29, 255))
    parts.append(tip_core)
    nozzle_parts.append(tip_core)

    tip_lip = cylinder(radius=0.00235, height=0.0009, sections=64)
    align_z_to_vector(tip_lip, nozzle_dir)
    translate(tip_lip, nozzle_anchor + nozzle_dir * (L_NOZZLE + 0.0029))
    set_color(tip_lip, (36, 36, 36, 255))
    parts.append(tip_lip)
    nozzle_parts.append(tip_lip)

    # Neck blend between arc and nozzle base
    neck = capsule(radius=0.0017, height=0.0021, count=[12, 16])
    neck_start = ctrl[2] * np.array([sx, sy, sz])
    neck_end = nozzle_anchor - nozzle_dir * 0.0011
    neck_dir = neck_end - neck_start
    align_z_to_vector(neck, neck_dir)
    translate(neck, (neck_start + neck_end) * 0.5)
    set_color(neck, (112, 112, 112, 255))
    parts.append(neck)
    arc_parts.append(neck)
    nozzle_parts.append(neck)

    return EarBuildResult(
        parts=parts,
        face_parts=face_parts,
        arc_parts=arc_parts,
        nozzle_parts=nozzle_parts,
        face_bezel=face_bezel,
        transition_blend=transition_blend,
        first_arc_node=arc_nodes[0],
        nozzle_dir=nozzle_dir,
        nozzle_anchor=nozzle_anchor,
    )


def validate_geometry_metrics(right: EarBuildResult) -> dict[str, float]:
    face_bounds = right.face_bezel.bounds
    d_face_actual = float(face_bounds[1][0] - face_bounds[0][0])

    arc_bounds = merge_bounds(right.arc_parts)
    arc_size = arc_bounds[1] - arc_bounds[0]
    w_arc_actual = float(arc_size[0])
    h_arc_actual = float(arc_size[1])

    ratio = d_face_actual / w_arc_actual
    angle = math.degrees(math.acos(float(np.clip(np.dot(right.nozzle_dir, np.array([0.0, 0.0, 1.0])), -1.0, 1.0))))
    offset = float(np.linalg.norm(right.nozzle_anchor[:2]))

    d1 = min_sampled_distance(right.face_bezel, right.transition_blend)
    d2 = min_sampled_distance(right.transition_blend, right.first_arc_node)
    transition_dist = min(d1, d2)
    transition_overlap = max(
        aabb_overlap_volume(right.face_bezel, right.transition_blend),
        aabb_overlap_volume(right.transition_blend, right.first_arc_node),
    )

    checks = {
        "d_face_actual": d_face_actual,
        "w_arc_actual": w_arc_actual,
        "h_arc_actual": h_arc_actual,
        "d_face_over_w_arc": ratio,
        "nozzle_angle_deg": angle,
        "nozzle_anchor_offset": offset,
        "transition_min_dist": transition_dist,
        "transition_overlap_aabb": transition_overlap,
    }

    if not (RATIO_MIN <= ratio <= RATIO_MAX):
        raise ValueError(f"D_face/W_arc out of range: {ratio:.6f}")
    if not (A_NOZZLE_MIN_DEG <= angle <= A_NOZZLE_MAX_DEG):
        raise ValueError(f"Nozzle angle out of range: {angle:.6f} deg")
    if not (O_NOZZLE_MIN <= offset <= O_NOZZLE_MAX):
        raise ValueError(f"Nozzle anchor offset out of range: {offset:.6f}")
    if transition_dist >= TRANSITION_MAX_DIST:
        raise ValueError(f"Transition min distance too large: {transition_dist:.6f}")
    if transition_overlap <= 0.0:
        raise ValueError("Transition overlap check failed (AABB overlap <= 0)")

    return checks


def build_scene() -> tuple[trimesh.Scene, dict[str, float]]:
    right = build_single_ear(side=1)
    left = build_single_ear(side=-1)

    # Pair composition
    transform_meshes(
        right.parts,
        rx=0.04,
        ry=-0.11,
        rz=-0.09,
        t=np.array([0.0100, -0.0002, 0.0003], dtype=float),
    )
    transform_meshes(
        left.parts,
        rx=-0.05,
        ry=0.14,
        rz=0.10,
        t=np.array([-0.0100, 0.0002, 0.0009], dtype=float),
    )

    scene = trimesh.Scene()
    for i, mesh in enumerate(right.parts):
        name = f"ear_right_{i:02d}"
        scene.add_geometry(mesh, geom_name=name, node_name=name)
    for i, mesh in enumerate(left.parts):
        name = f"ear_left_{i:02d}"
        scene.add_geometry(mesh, geom_name=name, node_name=name)

    # Grounding and centering
    bounds = scene.bounds
    center_x = (bounds[0][0] + bounds[1][0]) * 0.5
    center_y = (bounds[0][1] + bounds[1][1]) * 0.5
    shift = np.array([-center_x, -center_y, -bounds[0][2]], dtype=float)
    for mesh in scene.geometry.values():
        mesh.apply_translation(shift)

    # Run validation on unplaced-right ear to guarantee locked dimensions
    metrics = validate_geometry_metrics(build_single_ear(side=1))
    return scene, metrics


def export_models(scene: trimesh.Scene) -> tuple[Path, Path]:
    OUTPUT_MODEL.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_MODEL.parent.mkdir(parents=True, exist_ok=True)

    blob = scene.export(file_type="glb")
    OUTPUT_MODEL.write_bytes(blob)
    PUBLIC_MODEL.write_bytes(blob)
    return OUTPUT_MODEL, PUBLIC_MODEL


def verify_outputs() -> None:
    for path in (OUTPUT_MODEL, PUBLIC_MODEL):
        loaded = trimesh.load(path, force="scene")
        if not isinstance(loaded, trimesh.Scene):
            raise ValueError(f"Loaded artifact is not a scene: {path}")
        if len(loaded.geometry) == 0:
            raise ValueError(f"No geometry found in exported file: {path}")


def main() -> None:
    scene, metrics = build_scene()
    out_path, pub_path = export_models(scene)
    verify_outputs()

    print("Saved:")
    print(f"  {out_path}")
    print(f"  {pub_path}")
    print("Metrics:")
    for key in (
        "d_face_actual",
        "w_arc_actual",
        "h_arc_actual",
        "d_face_over_w_arc",
        "nozzle_angle_deg",
        "nozzle_anchor_offset",
        "transition_min_dist",
        "transition_overlap_aabb",
    ):
        print(f"  {key}: {metrics[key]:.6f}")
    print(f"Public bytes: {PUBLIC_MODEL.stat().st_size}")


if __name__ == "__main__":
    main()
