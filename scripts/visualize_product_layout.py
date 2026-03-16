"""Render a full-product verification sheet for layout QA."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import matplotlib.collections as mc
import matplotlib.pyplot as plt
import numpy as np

from make_qihang_pearl_v3 import parse_glb, read_accessor_rows, read_accessor_scalars


AXIS_LABELS = ("X", "Y", "Z")


@dataclass(frozen=True)
class PartSpec:
    label: str
    node_name: str
    color: str
    include_subtree: bool = True


PART_SPECS = (
    PartSpec("Base Shell", "Case_Base_Shell", "#4b5563", include_subtree=False),
    PartSpec("Lid Shell", "Case_Lid_Shell", "#9ca3af", include_subtree=False),
    PartSpec("Earbud L", "Earbud_Left", "#2563eb"),
    PartSpec("Earbud R", "Earbud_Right", "#0f766e"),
    PartSpec("Camera", "Brooch_Camera", "#b45309"),
    PartSpec("Pivot Pin", "Pivot_Pin_Printable", "#dc2626", include_subtree=False),
)


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


def read_triangles_for_mesh(gltf: dict, bin_chunk: bytearray, mesh_index: int, world_matrix: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, np.ndarray]]:
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


def project_point(point: np.ndarray, dims: tuple[int, int]) -> tuple[float, float]:
    return (float(point[dims[0]] * 1000.0), float(point[dims[1]] * 1000.0))


def segments_from_triangles(
    triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]],
    dims: tuple[int, int],
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for p0, p1, p2 in triangles:
        projected = [project_point(point, dims) for point in (p0, p1, p2)]
        xs = [point[0] for point in projected]
        ys = [point[1] for point in projected]
        if xlim and (max(xs) < xlim[0] or min(xs) > xlim[1]):
            continue
        if ylim and (max(ys) < ylim[0] or min(ys) > ylim[1]):
            continue
        segments.extend(((projected[0], projected[1]), (projected[1], projected[2]), (projected[2], projected[0])))
    return segments


def compute_bbox(points: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    stacked = np.stack(points, axis=0)
    return stacked.min(axis=0), stacked.max(axis=0)


def bbox_segments(bbox: tuple[np.ndarray, np.ndarray], dims: tuple[int, int]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    mins, maxs = bbox
    corners = []
    for x_value in (mins[0], maxs[0]):
        for y_value in (mins[1], maxs[1]):
            for z_value in (mins[2], maxs[2]):
                corners.append(np.array([x_value, y_value, z_value], dtype=float))

    edges = (
        (0, 1), (0, 2), (0, 4),
        (1, 3), (1, 5),
        (2, 3), (2, 6),
        (3, 7),
        (4, 5), (4, 6),
        (5, 7),
        (6, 7),
    )
    return [(project_point(corners[start], dims), project_point(corners[end], dims)) for start, end in edges]


def format_mm_point(point: np.ndarray) -> str:
    return f"({point[0] * 1000:.1f}, {point[1] * 1000:.1f}, {point[2] * 1000:.1f}) mm"


def draw_part_wireframes(
    ax: plt.Axes,
    part_geometries: dict[str, dict[str, object]],
    dims: tuple[int, int],
    title: str,
    xlim: tuple[float, float] | None = None,
    ylim: tuple[float, float] | None = None,
) -> None:
    all_segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for geometry in part_geometries.values():
        segments = segments_from_triangles(geometry["triangles"], dims, xlim=xlim, ylim=ylim)
        all_segments.extend(segments)
        if segments:
            ax.add_collection(
                mc.LineCollection(
                    segments,
                    linewidths=0.15,
                    colors=geometry["color"],
                    alpha=0.45,
                )
            )

    if xlim:
        ax.set_xlim(xlim)
    elif all_segments:
        xs = [point[0] for segment in all_segments for point in segment]
        ax.set_xlim(min(xs), max(xs))

    if ylim:
        ax.set_ylim(ylim)
    elif all_segments:
        ys = [point[1] for segment in all_segments for point in segment]
        ax.set_ylim(min(ys), max(ys))

    ax.set_aspect("equal")
    ax.grid(True, alpha=0.15)
    ax.set_title(title, fontsize=10)
    ax.set_xlabel(f"{AXIS_LABELS[dims[0]]} (mm)")
    ax.set_ylabel(f"{AXIS_LABELS[dims[1]]} (mm)")


def draw_layout_panel(
    ax: plt.Axes,
    part_geometries: dict[str, dict[str, object]],
    dims: tuple[int, int],
    markers: dict[str, np.ndarray],
    title: str,
) -> None:
    base_geometry = part_geometries["Case_Base_Shell"]
    base_segments = segments_from_triangles(base_geometry["triangles"], dims)
    ax.add_collection(mc.LineCollection(base_segments, linewidths=0.15, colors=base_geometry["color"], alpha=0.35))

    for part_name in ("Earbud_Left", "Earbud_Right", "Brooch_Camera"):
        geometry = part_geometries[part_name]
        bbox_lines = bbox_segments(geometry["bbox"], dims)
        ax.add_collection(mc.LineCollection(bbox_lines, linewidths=1.0, colors=geometry["color"], alpha=0.95))
        center_point = geometry["center"]
        projected_center = project_point(center_point, dims)
        ax.scatter([projected_center[0]], [projected_center[1]], s=28, c=geometry["color"], zorder=4)
        ax.text(projected_center[0] + 1.2, projected_center[1] + 1.2, geometry["label"], fontsize=8, color=geometry["color"])

    for marker_name, point in markers.items():
        projected = project_point(point, dims)
        ax.scatter(
            [projected[0]],
            [projected[1]],
            s=24,
            c="#111827",
            marker="x",
            linewidths=1.1,
            zorder=5,
        )
        ax.text(projected[0] + 0.9, projected[1] - 1.4, marker_name, fontsize=8, color="#111827")

    x_values = []
    y_values = []
    for geometry in (part_geometries["Case_Base_Shell"], part_geometries["Earbud_Left"], part_geometries["Earbud_Right"], part_geometries["Brooch_Camera"]):
        mins, maxs = geometry["bbox"]
        x_values.extend((mins[dims[0]] * 1000.0, maxs[dims[0]] * 1000.0))
        y_values.extend((mins[dims[1]] * 1000.0, maxs[dims[1]] * 1000.0))
    for point in markers.values():
        x_values.append(point[dims[0]] * 1000.0)
        y_values.append(point[dims[1]] * 1000.0)

    x_margin = max((max(x_values) - min(x_values)) * 0.06, 2.5)
    y_margin = max((max(y_values) - min(y_values)) * 0.08, 2.5)
    ax.set_xlim(min(x_values) - x_margin, max(x_values) + x_margin)
    ax.set_ylim(min(y_values) - y_margin, max(y_values) + y_margin)
    ax.set_aspect("equal")
    ax.grid(True, alpha=0.15)
    ax.set_title(title, fontsize=10)
    ax.set_xlabel(f"{AXIS_LABELS[dims[0]]} (mm)")
    ax.set_ylabel(f"{AXIS_LABELS[dims[1]]} (mm)")


def draw_metrics_panel(ax: plt.Axes, part_geometries: dict[str, dict[str, object]], markers: dict[str, np.ndarray]) -> None:
    ax.axis("off")

    base_bbox = part_geometries["Case_Base_Shell"]["bbox"]
    lid_bbox = part_geometries["Case_Lid_Shell"]["bbox"]

    def bbox_size_mm(bbox: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
        mins, maxs = bbox
        return (maxs - mins) * 1000.0

    base_size = bbox_size_mm(base_bbox)
    lid_size = bbox_size_mm(lid_bbox)
    pivot_to_hole = np.linalg.norm(markers["Lid Hole"] - markers["Pivot Pin"]) * 1000.0
    ear_spacing = abs(part_geometries["Earbud_Right"]["center"][0] - part_geometries["Earbud_Left"]["center"][0]) * 1000.0
    camera_forward_offset = (part_geometries["Brooch_Camera"]["center"][2] - markers["Pivot Pin"][2]) * 1000.0

    lines = [
        "Product Layout QA",
        "",
        "Shell BBoxes",
        f"Base shell: {base_size[0]:.1f} x {base_size[1]:.1f} x {base_size[2]:.1f} mm",
        f"Lid shell:  {lid_size[0]:.1f} x {lid_size[1]:.1f} x {lid_size[2]:.1f} mm",
        "",
        "Key Anchors",
        f"Pivot pin:    {format_mm_point(markers['Pivot Pin'])}",
        f"Lid hole:     {format_mm_point(markers['Lid Hole'])}",
        f"Dock well L:  {format_mm_point(markers['Dock L'])}",
        f"Dock well R:  {format_mm_point(markers['Dock R'])}",
        "",
        "Key Centers",
        f"Earbud L:     {format_mm_point(part_geometries['Earbud_Left']['center'])}",
        f"Earbud R:     {format_mm_point(part_geometries['Earbud_Right']['center'])}",
        f"Camera:       {format_mm_point(part_geometries['Brooch_Camera']['center'])}",
        "",
        "Quick Metrics",
        f"Pivot -> lid hole delta: {pivot_to_hole:.2f} mm",
        f"Earbud center spacing:   {ear_spacing:.2f} mm",
        f"Camera Z from pivot:     {camera_forward_offset:.2f} mm",
        "",
        "Axes",
        "X = width, Y = height, Z = length",
    ]
    ax.text(0.02, 0.98, "\n".join(lines), va="top", ha="left", fontsize=9, family="monospace")


def main() -> None:
    parser = argparse.ArgumentParser(description="Render a full-product verification sheet.")
    parser.add_argument("--glb", type=Path, default=Path("apps/web/public/qihang_product_pearl_V3.glb"))
    parser.add_argument("--output", type=Path, default=Path("output/debug_v3/product_layout_qa.png"))
    parser.add_argument("--label", type=str, default="V3 Product Layout")
    args = parser.parse_args()

    gltf, bin_chunk = parse_glb(args.glb)
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

    def get_node_origin(node_name: str) -> np.ndarray:
        node_index = node_lookup[node_name]
        product_local = product_inverse @ get_world_matrix(node_index) @ np.array([0.0, 0.0, 0.0, 1.0], dtype=float)
        return product_local[:3] / max(product_local[3], 1e-12)

    part_geometries: dict[str, dict[str, object]] = {}
    for spec in PART_SPECS:
        root_index = node_lookup[spec.node_name]
        node_indices = collect_subtree_node_indices(gltf, root_index) if spec.include_subtree else [root_index]

        triangles: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []
        points: list[np.ndarray] = []
        for node_index in node_indices:
            node = gltf["nodes"][node_index]
            mesh_index = node.get("mesh")
            if mesh_index is None:
                continue
            node_triangles = read_triangles_for_mesh(gltf, bin_chunk, mesh_index, product_inverse @ get_world_matrix(node_index))
            triangles.extend(node_triangles)
            for triangle in node_triangles:
                points.extend(triangle)

        if not points:
            continue

        bbox = compute_bbox(points)
        mins, maxs = bbox
        part_geometries[spec.node_name] = {
            "label": spec.label,
            "color": spec.color,
            "triangles": triangles,
            "bbox": bbox,
            "center": (mins + maxs) * 0.5,
        }

    markers = {
        "Pivot Pin": get_node_origin("Pivot_Pin_Printable"),
        "Lid Hole": get_node_origin("Lid_Pivot_Hole_Center"),
        "Dock L": get_node_origin("DockWell_L"),
        "Dock R": get_node_origin("DockWell_R"),
    }

    fig, axes = plt.subplots(2, 3, figsize=(18, 12))
    fig.suptitle(args.label, fontsize=15, fontweight="bold")

    draw_part_wireframes(axes[0][0], part_geometries, dims=(0, 2), title="Top View (X vs Z)")
    draw_part_wireframes(axes[0][1], part_geometries, dims=(2, 1), title="Side View (Z vs Y)")
    draw_part_wireframes(axes[0][2], part_geometries, dims=(0, 1), title="Front View (X vs Y)")
    draw_layout_panel(axes[1][0], part_geometries, dims=(0, 2), markers=markers, title="Base Layout + Anchors")
    draw_layout_panel(axes[1][1], part_geometries, dims=(2, 1), markers=markers, title="Length/Height Layout")
    draw_metrics_panel(axes[1][2], part_geometries, markers)

    fig.tight_layout(rect=(0.0, 0.0, 1.0, 0.97))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, dpi=180)
    plt.close(fig)

    print(f"Saved: {args.output}")
    for name, geometry in part_geometries.items():
        mins, maxs = geometry["bbox"]
        size_mm = (maxs - mins) * 1000.0
        print(f"{name}: bbox_mm=({size_mm[0]:.2f}, {size_mm[1]:.2f}, {size_mm[2]:.2f}) center={format_mm_point(geometry['center'])}")


if __name__ == "__main__":
    main()
