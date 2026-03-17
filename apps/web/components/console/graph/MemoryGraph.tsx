"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import * as d3 from "d3";
import type { MemoryNode, MemoryEdge } from "@/hooks/useGraphData";
import GraphContextMenu from "./GraphContextMenu";
import NodeDetail from "./NodeDetail";
import GraphControls from "./GraphControls";
import GraphFilters, { type GraphFilterState } from "./GraphFilters";

/* ── Types ─────────────────────────────────────── */

interface SimNode extends MemoryNode {
  x: number;
  y: number;
  fx: number | null;
  fy: number | null;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  edge_type: string;
  strength: number;
}

interface MemoryGraphProps {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  onNodeSelect: (node: MemoryNode | null) => void;
  onCreateMemory: (content: string, category?: string) => Promise<void>;
  onUpdateMemory: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onPromoteMemory: (id: string) => Promise<void>;
  onCreateEdge: (sourceId: string, targetId: string) => Promise<void>;
  onDeleteEdge: (id: string) => Promise<void>;
  searchQuery?: string;
  filters?: { types: string[]; categories: string[] };
}

/* ── Constants ─────────────────────────────────── */

const CENTER_NODE_RADIUS = 36;
const MEMORY_NODE_RADIUS = 20;
const FILE_NODE_W = 16;
const FILE_NODE_H = 20;
const COLORS = {
  permanent: "#c8734a",
  temporary: "#4a8ac8",
  file: "#8a7a6a",
  centerGradStart: "#c8734a",
  centerGradEnd: "#e8925a",
};

/* ── Helpers ───────────────────────────────────── */

function isFileNode(node: MemoryNode): boolean {
  return node.category === "file" || node.category === "文件";
}

function nodeRadius(node: MemoryNode, isCenter: boolean): number {
  if (isCenter) return CENTER_NODE_RADIUS;
  if (isFileNode(node)) return Math.max(FILE_NODE_W, FILE_NODE_H) / 2 + 4;
  return MEMORY_NODE_RADIUS;
}

function getLabel(node: MemoryNode): string {
  if (node.category) return node.category;
  return node.content.length > 12
    ? node.content.slice(0, 12) + "..."
    : node.content;
}

/* ── Component ─────────────────────────────────── */

export default function MemoryGraph(props: MemoryGraphProps) {
  const {
    nodes,
    edges,
    onNodeSelect,
    onCreateMemory,
    onUpdateMemory,
    onDeleteMemory,
    onPromoteMemory,
    searchQuery: externalSearchQuery,
    filters: externalFilters,
  } = props;
  /* refs */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const animFrameRef = useRef<number>(0);

  /* state */
  const [selectedNode, setSelectedNode] = useState<MemoryNode | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: MemoryNode | null;
    visible: boolean;
  }>({ x: 0, y: 0, node: null, visible: false });
  const [localSearch, setLocalSearch] = useState("");
  const [filterState, setFilterState] = useState<GraphFilterState>({
    types: [],
    categories: [],
    timeRange: "all",
  });

  const searchQuery = externalSearchQuery ?? localSearch;

  /* ── Derive sim data ────────────────────────── */

  const { simNodes, simLinks, centerNodeId } = useMemo(() => {
    // Determine center node (first permanent, or first node)
    const center =
      nodes.find((n) => n.type === "permanent" && !n.parent_memory_id) ??
      nodes[0] ??
      null;
    const cId = center?.id ?? null;

    const sn: SimNode[] = nodes.map((n) => ({
      ...n,
      x: n.position_x ?? (n.id === cId ? 0 : (Math.random() - 0.5) * 400),
      y: n.position_y ?? (n.id === cId ? 0 : (Math.random() - 0.5) * 400),
      fx: n.id === cId ? 0 : (n.position_x != null ? null : null),
      fy: n.id === cId ? 0 : (n.position_y != null ? null : null),
    }));

    const nodeIdSet = new Set(nodes.map((n) => n.id));
    const sl: SimLink[] = edges
      .filter(
        (e) => nodeIdSet.has(e.source_memory_id) && nodeIdSet.has(e.target_memory_id)
      )
      .map((e) => ({
        source: e.source_memory_id,
        target: e.target_memory_id,
        id: e.id,
        edge_type: e.edge_type,
        strength: e.strength,
      }));

    return { simNodes: sn, simLinks: sl, centerNodeId: cId };
  }, [nodes, edges]);

  /* ── Filtering ──────────────────────────────── */

  const activeTypes = externalFilters?.types ?? filterState.types;
  const activeCategories = externalFilters?.categories ?? filterState.categories;

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    simNodes.forEach((n) => {
      // Type filter
      if (activeTypes.length > 0) {
        const nodeType = isFileNode(n) ? "file" : n.type;
        if (!activeTypes.includes(nodeType)) return;
      }
      // Category filter
      if (activeCategories.length > 0 && !activeCategories.includes(n.category)) {
        return;
      }
      // Time range filter
      if (filterState.timeRange !== "all") {
        const created = new Date(n.created_at).getTime();
        const now = Date.now();
        const msMap = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
        if (now - created > msMap[filterState.timeRange]) return;
      }
      ids.add(n.id);
    });
    return ids;
  }, [simNodes, activeTypes, activeCategories, filterState.timeRange]);

  const searchMatchIds = useMemo(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    const ids = new Set<string>();
    simNodes.forEach((n) => {
      if (
        n.content.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q)
      ) {
        ids.add(n.id);
      }
    });
    return ids;
  }, [simNodes, searchQuery]);

  /* ── Canvas draw ────────────────────────────── */

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const t = transformRef.current;
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    const hasSearch = searchMatchIds !== null;

    /* ── Draw edges ── */
    simLinks.forEach((link) => {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id)) return;

      const isPermanent =
        (src.type === "permanent" && tgt.type === "permanent") ||
        link.edge_type === "manual";
      const lineWidth = 0.5 + link.strength * 1.5;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isPermanent) {
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(200, 115, 74, 0.4)`;
      } else {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = `rgba(74, 138, 200, 0.4)`;
      }
      ctx.lineWidth = lineWidth;

      if (hasSearch) {
        const srcMatch = searchMatchIds.has(src.id);
        const tgtMatch = searchMatchIds.has(tgt.id);
        if (!srcMatch && !tgtMatch) {
          ctx.globalAlpha = 0.15;
        }
      }

      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    /* ── Draw nodes ── */
    simNodes.forEach((node) => {
      if (!visibleNodeIds.has(node.id)) return;

      const isCenter = node.id === centerNodeId;
      const isSearched = hasSearch && searchMatchIds.has(node.id);
      const isFaded = hasSearch && !isSearched;

      if (isFaded) ctx.globalAlpha = 0.3;

      if (isSearched) {
        ctx.save();
        ctx.shadowColor = isCenter
          ? COLORS.centerGradStart
          : node.type === "permanent"
          ? COLORS.permanent
          : COLORS.temporary;
        ctx.shadowBlur = 18;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      if (isCenter) {
        /* center node gradient */
        const grad = ctx.createRadialGradient(
          node.x,
          node.y,
          0,
          node.x,
          node.y,
          CENTER_NODE_RADIUS
        );
        grad.addColorStop(0, COLORS.centerGradEnd);
        grad.addColorStop(1, COLORS.centerGradStart);
        ctx.beginPath();
        ctx.arc(node.x, node.y, CENTER_NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();

        /* center label (inside) */
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("AI", node.x, node.y);
      } else if (isFileNode(node)) {
        /* file node: rounded rect */
        const rx = node.x - FILE_NODE_W / 2;
        const ry = node.y - FILE_NODE_H / 2;
        const cornerR = 3;
        ctx.beginPath();
        ctx.moveTo(rx + cornerR, ry);
        ctx.lineTo(rx + FILE_NODE_W - cornerR, ry);
        ctx.quadraticCurveTo(rx + FILE_NODE_W, ry, rx + FILE_NODE_W, ry + cornerR);
        ctx.lineTo(rx + FILE_NODE_W, ry + FILE_NODE_H - cornerR);
        ctx.quadraticCurveTo(
          rx + FILE_NODE_W,
          ry + FILE_NODE_H,
          rx + FILE_NODE_W - cornerR,
          ry + FILE_NODE_H
        );
        ctx.lineTo(rx + cornerR, ry + FILE_NODE_H);
        ctx.quadraticCurveTo(rx, ry + FILE_NODE_H, rx, ry + FILE_NODE_H - cornerR);
        ctx.lineTo(rx, ry + cornerR);
        ctx.quadraticCurveTo(rx, ry, rx + cornerR, ry);
        ctx.closePath();
        ctx.fillStyle = COLORS.file;
        ctx.fill();
        ctx.strokeStyle = "#b0a090";
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        /* memory node circle */
        const color =
          node.type === "permanent" ? COLORS.permanent : COLORS.temporary;
        ctx.beginPath();
        ctx.arc(node.x, node.y, MEMORY_NODE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (node.type === "temporary") {
          ctx.setLineDash([4, 3]);
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (isSearched) {
        ctx.restore();
      }

      /* label below node */
      const label = getLabel(node);
      const labelY = isCenter
        ? node.y + CENTER_NODE_RADIUS + 14
        : isFileNode(node)
        ? node.y + FILE_NODE_H / 2 + 12
        : node.y + MEMORY_NODE_RADIUS + 14;

      ctx.fillStyle = isFaded
        ? "rgba(42, 32, 24, 0.3)"
        : "var(--text-primary, #2a2018)";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, node.x, labelY);

      ctx.globalAlpha = 1;
    });

    ctx.restore();
  }, [simNodes, simLinks, centerNodeId, visibleNodeIds, searchMatchIds]);

  /* ── Simulation setup ───────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force("center", d3.forceCenter(0, 0).strength(0.05))
      .force(
        "link",
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(100)
          .strength((l) => l.strength * 0.3)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("collide", d3.forceCollide<SimNode>((d) => nodeRadius(d, d.id === centerNodeId) + 8))
      .alphaDecay(0.02)
      .on("tick", () => {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = requestAnimationFrame(draw);
      });

    simRef.current = sim;

    /* ── Zoom ── */
    const zoomBehavior = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event: d3.D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        transformRef.current = event.transform;
        draw();
      });

    zoomBehaviorRef.current = zoomBehavior;

    const sel = d3.select(canvas);
    sel.call(zoomBehavior);

    /* ── Initial transform: center in canvas ── */
    const rect = canvas.getBoundingClientRect();
    const initialTransform = d3.zoomIdentity.translate(rect.width / 2, rect.height / 2);
    sel.call(zoomBehavior.transform, initialTransform);
    transformRef.current = initialTransform;

    /* ── Drag ── */
    let dragNode: SimNode | null = null;

    const dragStarted = (x: number, y: number) => {
      const node = hitTestDirect(x, y);
      if (!node || node.id === centerNodeId) return;
      dragNode = node;
      sim.alphaTarget(0.3).restart();
      node.fx = node.x;
      node.fy = node.y;
    };

    const dragged = (x: number, y: number) => {
      if (!dragNode) return;
      const t = transformRef.current;
      dragNode.fx = (x - t.x) / t.k;
      dragNode.fy = (y - t.y) / t.k;
    };

    const dragEnded = () => {
      if (!dragNode) return;
      sim.alphaTarget(0);
      const node = dragNode;
      // Keep position fixed after drag
      if (node.fx != null && node.fy != null) {
        onUpdateMemory(node.id, {
          position_x: node.fx,
          position_y: node.fy,
        }).catch(() => {});
      }
      node.fx = null;
      node.fy = null;
      dragNode = null;
    };

    function hitTestDirect(mx: number, my: number): SimNode | null {
      const t = transformRef.current;
      const x = (mx - t.x) / t.k;
      const y = (my - t.y) / t.k;
      for (let i = simNodes.length - 1; i >= 0; i--) {
        const n = simNodes[i];
        const isC = n.id === centerNodeId;
        const r = nodeRadius(n, isC);
        const dx = x - n.x;
        const dy = y - n.y;
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return null;
    }

    /* ── Mouse events (directly, not through D3 drag to avoid zoom conflict) ── */
    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // left click only
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTestDirect(mx, my);
      if (node && node.id !== centerNodeId) {
        isDragging = true;
        dragStartPos = { x: e.clientX, y: e.clientY };
        dragStarted(mx, my);
        // Temporarily disable zoom panning so drag works
        sel.on(".zoom", null);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      dragged(mx, my);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }
      isDragging = false;
      dragEnded();
      // Re-enable zoom
      sel.call(zoomBehavior);
      // Restore current transform
      sel.call(zoomBehavior.transform, transformRef.current);

      // Check if this was a click (not a drag)
      const dist = Math.hypot(
        e.clientX - dragStartPos.x,
        e.clientY - dragStartPos.y
      );
      if (dist < 4) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const node = hitTestDirect(mx, my);
        if (node) {
          setSelectedNode(node);
          onNodeSelect(node);
        }
      }
    };

    const onClick = (e: MouseEvent) => {
      // Only handle clicks on blank canvas (not on nodes which are handled via drag flow)
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTestDirect(mx, my);
      if (!node) {
        setSelectedNode(null);
        onNodeSelect(null);
      } else {
        setSelectedNode(node);
        onNodeSelect(node);
      }
    };

    const onDblClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTestDirect(mx, my);
      if (!node) {
        const content = window.prompt("输入新记忆内容:");
        if (content) {
          onCreateMemory(content);
        }
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTestDirect(mx, my);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        node,
        visible: true,
      });
    };

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onContextMenu);

    return () => {
      sim.stop();
      cancelAnimationFrame(animFrameRef.current);
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      sel.on(".zoom", null);
    };
    // We intentionally exclude draw from deps to avoid re-creating the simulation
    // on every render. The draw function is captured by the tick callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simNodes, simLinks, centerNodeId, onNodeSelect, onCreateMemory, onUpdateMemory]);

  /* ── Redraw when filters/search change ─────── */

  useEffect(() => {
    draw();
  }, [draw]);

  /* ── Zoom controls ──────────────────────────── */

  const handleZoomIn = useCallback(() => {
    const canvas = canvasRef.current;
    const zb = zoomBehaviorRef.current;
    if (!canvas || !zb) return;
    const sel = d3.select(canvas);
    sel.transition().duration(300).call(zb.scaleBy, 1.3);
  }, []);

  const handleZoomOut = useCallback(() => {
    const canvas = canvasRef.current;
    const zb = zoomBehaviorRef.current;
    if (!canvas || !zb) return;
    const sel = d3.select(canvas);
    sel.transition().duration(300).call(zb.scaleBy, 0.7);
  }, []);

  const handleFitView = useCallback(() => {
    const canvas = canvasRef.current;
    const zb = zoomBehaviorRef.current;
    if (!canvas || !zb || simNodes.length === 0) return;
    const rect = canvas.getBoundingClientRect();

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    simNodes.forEach((n) => {
      if (!visibleNodeIds.has(n.id)) return;
      const r = nodeRadius(n, n.id === centerNodeId) + 20;
      if (n.x - r < minX) minX = n.x - r;
      if (n.y - r < minY) minY = n.y - r;
      if (n.x + r > maxX) maxX = n.x + r;
      if (n.y + r > maxY) maxY = n.y + r;
    });

    if (!isFinite(minX)) return;

    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const scale = Math.min(rect.width / bw, rect.height / bh) * 0.85;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const t = d3.zoomIdentity
      .translate(rect.width / 2 - cx * scale, rect.height / 2 - cy * scale)
      .scale(scale);

    const sel = d3.select(canvas);
    sel.transition().duration(500).call(zb.transform, t);
  }, [simNodes, centerNodeId, visibleNodeIds]);

  /* ── Stats ──────────────────────────────────── */

  const fileCount = useMemo(
    () => nodes.filter(isFileNode).length,
    [nodes]
  );
  const memoryCount = nodes.length - fileCount;

  /* ── Context menu actions ───────────────────── */

  const contextActions = useMemo(
    () => ({
      onViewDetail: (node: MemoryNode) => {
        setSelectedNode(node);
        onNodeSelect(node);
      },
      onEdit: (node: MemoryNode) => {
        setSelectedNode(node);
        onNodeSelect(node);
      },
      onPromote: (id: string) => {
        onPromoteMemory(id);
      },
      onDelete: (id: string) => {
        if (window.confirm("确定要删除这条记忆吗？")) {
          onDeleteMemory(id);
        }
      },
      onAddMemory: () => {
        const content = window.prompt("输入新记忆内容:");
        if (content) {
          onCreateMemory(content);
        }
      },
    }),
    [onNodeSelect, onPromoteMemory, onDeleteMemory, onCreateMemory]
  );

  /* ── Render ─────────────────────────────────── */

  return (
    <div className="graph-container">
      <GraphFilters
        nodes={nodes}
        activeFilters={filterState}
        onFilterChange={setFilterState}
      />

      <div className="graph-main">
        <canvas
          ref={canvasRef}
          className="graph-canvas"
        />

        <GraphControls
          nodeCount={memoryCount}
          fileCount={fileCount}
          onAdd={() => {
            const content = window.prompt("输入新记忆内容:");
            if (content) onCreateMemory(content);
          }}
          searchQuery={searchQuery}
          onSearchChange={setLocalSearch}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onFitView={handleFitView}
        />
      </div>

      {selectedNode && (
        <NodeDetail
          key={selectedNode.id}
          node={selectedNode}
          onClose={() => {
            setSelectedNode(null);
            onNodeSelect(null);
          }}
          onUpdate={onUpdateMemory}
          onDelete={onDeleteMemory}
          onPromote={onPromoteMemory}
        />
      )}

      <GraphContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        node={contextMenu.node}
        visible={contextMenu.visible}
        onClose={() => setContextMenu((c) => ({ ...c, visible: false }))}
        actions={contextActions}
      />
    </div>
  );
}
