"""Render lid shell wireframe from multiple angles for QA inspection."""
from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib.collections as mc
import numpy as np


GLB_HEADER_STRUCT = struct.Struct("<4sII")
GLB_CHUNK_HEADER_STRUCT = struct.Struct("<I4s")
COMPONENT_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
COMPONENT_BYTE_SIZES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENT_STRUCT_FORMATS = {5120: "b", 5121: "B", 5122: "h", 5123: "H", 5125: "I", 5126: "f"}


def parse_glb(path: Path):
    raw = path.read_bytes()
    magic, version, total_length = GLB_HEADER_STRUCT.unpack_from(raw, 0)
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
    return gltf, bin_chunk


def read_accessor_rows(gltf, bin_chunk, accessor_index):
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    component_count = COMPONENT_COUNTS[accessor["type"]]
    component_size = COMPONENT_BYTE_SIZES[accessor["componentType"]]
    stride = view.get("byteStride", component_count * component_size)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    fmt = "<" + (COMPONENT_STRUCT_FORMATS[accessor["componentType"]] * component_count)
    rows = []
    for i in range(count):
        rows.append(list(struct.unpack_from(fmt, bin_chunk, offset + i * stride)))
    return rows


def read_accessor_scalars(gltf, bin_chunk, accessor_index):
    accessor = gltf["accessors"][accessor_index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    component_size = COMPONENT_BYTE_SIZES[accessor["componentType"]]
    stride = view.get("byteStride", component_size)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    count = accessor["count"]
    fmt = "<" + COMPONENT_STRUCT_FORMATS[accessor["componentType"]]
    values = []
    for i in range(count):
        (v,) = struct.unpack_from(fmt, bin_chunk, offset + i * stride)
        values.append(int(v))
    return values


def get_lid_triangles(gltf, bin_chunk):
    """Extract lid shell triangles in world space."""
    node_lookup = {n.get("name"): n for n in gltf["nodes"] if n.get("name")}
    shell_node = node_lookup["Case_Lid_Shell"]
    prim = gltf["meshes"][shell_node["mesh"]]["primitives"][0]
    positions = read_accessor_rows(gltf, bin_chunk, prim["attributes"]["POSITION"])

    scale = shell_node.get("scale", [1, 1, 1])
    translation = shell_node.get("translation", [0, 0, 0])
    sx, sy, sz = float(scale[0]), float(scale[1]), float(scale[2])
    tx, ty, tz = float(translation[0]), float(translation[1]), float(translation[2])

    world_pos = []
    for r in positions:
        world_pos.append((r[0] * sx + tx, r[1] * sy + ty, r[2] * sz + tz))

    if "indices" in prim:
        indices = read_accessor_scalars(gltf, bin_chunk, prim["indices"])
    else:
        indices = list(range(len(positions)))

    triangles = []
    for i in range(0, len(indices), 3):
        i0, i1, i2 = indices[i], indices[i + 1], indices[i + 2]
        p0, p1, p2 = world_pos[i0], world_pos[i1], world_pos[i2]
        # Skip degenerate triangles
        if p0 == p1 or p1 == p2 or p0 == p2:
            continue
        triangles.append((p0, p1, p2))

    hole_center = tuple(float(v) for v in node_lookup["Lid_Pivot_Hole_Center"]["translation"])
    return triangles, hole_center, world_pos


def draw_wireframe_2d(ax, triangles, project, xlim=None, ylim=None, title="", linewidth=0.15, color="#444"):
    """Draw triangle edges projected to 2D."""
    segments = []
    for p0, p1, p2 in triangles:
        a, b, c = project(p0), project(p1), project(p2)
        if xlim and (
            max(a[0], b[0], c[0]) < xlim[0] or min(a[0], b[0], c[0]) > xlim[1]
        ):
            continue
        if ylim and (
            max(a[1], b[1], c[1]) < ylim[0] or min(a[1], b[1], c[1]) > ylim[1]
        ):
            continue
        segments.extend([(a, b), (b, c), (c, a)])

    lc = mc.LineCollection(segments, linewidths=linewidth, colors=color, alpha=0.6)
    ax.add_collection(lc)
    if xlim:
        ax.set_xlim(xlim)
    else:
        all_x = [s[i][0] for s in segments for i in (0, 1)]
        if all_x:
            ax.set_xlim(min(all_x), max(all_x))
    if ylim:
        ax.set_ylim(ylim)
    else:
        all_y = [s[i][1] for s in segments for i in (0, 1)]
        if all_y:
            ax.set_ylim(min(all_y), max(all_y))
    ax.set_aspect("equal")
    ax.set_title(title, fontsize=9)
    ax.grid(True, alpha=0.15)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", type=Path, default=Path("apps/web/public/qihang_product_pearl_V3.glb"))
    parser.add_argument("--output", type=Path, default=Path("output/debug_v3/lid_wireframe_qa.png"))
    parser.add_argument("--label", type=str, default="")
    args = parser.parse_args()

    gltf, bin_chunk = parse_glb(args.glb)
    triangles, hole_center, world_pos = get_lid_triangles(gltf, bin_chunk)
    hx, hy, hz = hole_center

    print(f"Lid triangles (non-degenerate): {len(triangles)}")
    print(f"Hole center: ({hx:.6f}, {hy:.6f}, {hz:.6f})")

    fig, axes = plt.subplots(2, 3, figsize=(18, 12))
    if args.label:
        fig.suptitle(args.label, fontsize=14, fontweight="bold")

    # 1. Top-down full view (X vs Z)
    draw_wireframe_2d(
        axes[0][0], triangles,
        project=lambda p: (p[0] * 1000, p[2] * 1000),
        title="Top-down Full (X vs Z, mm)",
    )
    axes[0][0].set_xlabel("X (mm)")
    axes[0][0].set_ylabel("Z (mm)")

    # 2. Top-down zoomed on hole (X vs Z)
    draw_wireframe_2d(
        axes[0][1], triangles,
        project=lambda p: ((p[0] - hx) * 1000, (p[2] - hz) * 1000),
        xlim=(-18, 18), ylim=(-18, 18),
        title="Top-down Hole Zoom (mm from center)",
        linewidth=0.3,
    )

    # 3. Top-down tight zoom on hole rim
    draw_wireframe_2d(
        axes[0][2], triangles,
        project=lambda p: ((p[0] - hx) * 1000, (p[2] - hz) * 1000),
        xlim=(-8, 8), ylim=(-8, 8),
        title="Hole Rim Detail (mm from center)",
        linewidth=0.5,
    )

    # 4. Side view (Z vs Y)
    draw_wireframe_2d(
        axes[1][0], triangles,
        project=lambda p: (p[2] * 1000, p[1] * 1000),
        title="Side View (Z vs Y, mm)",
    )
    axes[1][0].set_xlabel("Z (mm)")
    axes[1][0].set_ylabel("Y (mm)")

    # 5. Side view zoomed on hole (forward vs Y relative to hole center)
    draw_wireframe_2d(
        axes[1][1], triangles,
        project=lambda p: ((p[2] - hz) * 1000, p[1] * 1000),
        xlim=(-10, 15), ylim=(-5, 6),
        title="Hole Side Section (mm)",
        linewidth=0.4,
    )

    # 6. Seam detection: highlight triangles with vertex gaps
    # Find edges where two triangles share a visual edge but vertices are offset
    seam_segments = []
    normal_segments = []
    for p0, p1, p2 in triangles:
        # Check if triangle is near the lid top surface (y > 0.003)
        avg_y = (p0[1] + p1[1] + p2[1]) / 3
        if avg_y < 0.002:
            continue
        # Compute triangle area to detect near-degenerate
        ax_v = p1[0] - p0[0]; ay_v = p1[1] - p0[1]; az_v = p1[2] - p0[2]
        bx_v = p2[0] - p0[0]; by_v = p2[1] - p0[1]; bz_v = p2[2] - p0[2]
        cx = ay_v * bz_v - az_v * by_v
        cy = az_v * bx_v - ax_v * bz_v
        cz = ax_v * by_v - ay_v * bx_v
        area = math.sqrt(cx*cx + cy*cy + cz*cz) * 0.5
        # Edge lengths
        edges = [
            math.dist(p0, p1),
            math.dist(p1, p2),
            math.dist(p2, p0),
        ]
        max_edge = max(edges)
        min_edge = min(edges)
        aspect = max_edge / min_edge if min_edge > 1e-10 else 999

        proj = lambda p: ((p[0] - hx) * 1000, (p[2] - hz) * 1000)
        a, b, c = proj(p0), proj(p1), proj(p2)

        if aspect > 15 or area < 1e-12:
            seam_segments.extend([(a, b), (b, c), (c, a)])
        else:
            normal_segments.extend([(a, b), (b, c), (c, a)])

    ax = axes[1][2]
    lc_normal = mc.LineCollection(normal_segments, linewidths=0.12, colors="#999", alpha=0.3)
    ax.add_collection(lc_normal)
    lc_seam = mc.LineCollection(seam_segments, linewidths=0.6, colors="#e53935", alpha=0.8)
    ax.add_collection(lc_seam)
    ax.set_xlim(-18, 18)
    ax.set_ylim(-18, 18)
    ax.set_aspect("equal")
    ax.set_title(f"Sliver Triangles (red, aspect>15): {len(seam_segments)//3}", fontsize=9)
    ax.grid(True, alpha=0.15)

    plt.tight_layout()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.output, dpi=200)
    plt.close(fig)
    print(f"Saved: {args.output}")


if __name__ == "__main__":
    main()
