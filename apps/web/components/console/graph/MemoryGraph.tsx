"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useTranslations } from "next-intl";
import * as d3 from "d3";
import {
  type MemoryNode,
  type MemoryEdge,
  getMemoryKind,
  getMemoryRetrievalCount,
  isAssistantRootMemoryNode,
  isFileMemoryNode,
  isPinnedMemoryNode,
  isOrdinaryMemoryNode,
  isSummaryMemoryNode,
} from "@/hooks/useGraphData";
import { apiPost } from "@/lib/api";
import { useModal } from "@/components/ui/modal-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  vx?: number;
  vy?: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  edge_type: string;
  strength: number;
}

interface MemoryGraphProps {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  assistantName?: string;
  onNodeSelect: (node: MemoryNode | null) => void;
  onCenterNodeClick?: () => void;
  onCreateMemory: (content: string, category?: string) => Promise<void>;
  onUpdateMemory: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDeleteMemory: (id: string) => Promise<void>;
  onPromoteMemory: (id: string) => Promise<void>;
  onCreateEdge: (sourceId: string, targetId: string) => Promise<void>;
  onDeleteEdge: (id: string) => Promise<void>;
  onAttachFile: (memoryId: string, dataItemId: string) => Promise<void>;
  onDetachFile: (memoryFileId: string) => Promise<void>;
  searchQuery?: string;
  filters?: Partial<GraphFilterState>;
}

/* ── Constants ─────────────────────────────────── */

const CENTER_NODE_RADIUS = 36;
const MEMORY_NODE_RADIUS = 20;
const FILE_NODE_W = 16;
const FILE_NODE_H = 20;
const ASSISTANT_CENTER_ID = "__assistant_center__";
const FILE_ATTACH_DISTANCE = 42;
const FILE_ATTACH_SPREAD = 24;
const FILE_LINK_DISTANCE = 58;
const PARENT_LINK_DISTANCE = 112;
const CENTER_LINK_DISTANCE = 164;
const COLORS = {
  permanent: "#c8734a",
  temporary: "#4a8ac8",
  core: "#dd8a62",
  summary: "#b68a2f",
  file: "#8a7a6a",
  centerGradStart: "#c8734a",
  centerGradEnd: "#e8925a",
};

/* ── Helpers ───────────────────────────────────── */

function getNodeSourceKinds(node: MemoryNode): string[] {
  if (isFileMemoryNode(node)) {
    return ["file_upload"];
  }
  const metadata = (node.metadata_json || {}) as Record<string, unknown>;
  if (metadata.promoted_by) {
    return ["promoted"];
  }
  if (node.source_conversation_id) {
    return ["conversation"];
  }
  return ["manual"];
}

function nodeRadius(node: MemoryNode, isCenter: boolean): number {
  if (isCenter) return CENTER_NODE_RADIUS;
  if (isFileMemoryNode(node)) return Math.max(FILE_NODE_W, FILE_NODE_H) / 2 + 4;
  if (isSummaryMemoryNode(node)) return MEMORY_NODE_RADIUS + 4;
  if (isPinnedMemoryNode(node)) return MEMORY_NODE_RADIUS + 2;
  return MEMORY_NODE_RADIUS;
}

function getLabel(node: MemoryNode): string {
  if (isFileMemoryNode(node)) {
    const filename =
      typeof node.metadata_json?.filename === "string"
        ? node.metadata_json.filename
        : node.content;
    return filename.length > 16 ? `${filename.slice(0, 16)}...` : filename;
  }
  if (node.category) return node.category;
  return node.content.length > 12
    ? node.content.slice(0, 12) + "..."
    : node.content;
}

function getMemoryNodeColor(node: MemoryNode, maxRetrievalCount: number): string {
  const retrievalCount = getMemoryRetrievalCount(node);
  if (retrievalCount > 0 && maxRetrievalCount > 0) {
    const normalized = Math.log(retrievalCount + 1) / Math.log(maxRetrievalCount + 1);
    return d3.interpolateRgbBasis(["#d9c2af", "#d99167", "#c95a3f", "#a32020"])(
      0.18 + normalized * 0.82,
    );
  }
  if (isSummaryMemoryNode(node)) {
    return COLORS.summary;
  }
  if (isPinnedMemoryNode(node)) {
    return COLORS.core;
  }
  const kind = getMemoryKind(node);
  if (kind === "profile" || kind === "preference" || kind === "goal") {
    return COLORS.core;
  }
  return node.type === "permanent" ? COLORS.permanent : COLORS.temporary;
}

function truncateCenterLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return "AI";
  }
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}...` : trimmed;
}

function getCenterNodeMonogram(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return "AI";
  }
  const compact = trimmed.replace(/\s+/g, "");
  if (/[\u4e00-\u9fff]/.test(compact)) {
    return compact.slice(0, 2);
  }
  return compact.slice(0, 2).toUpperCase();
}

function inferDroppedCategory(
  node: SimNode,
  allNodes: SimNode[],
  centerNodeId: string,
): string | null {
  if (node.id === centerNodeId || isFileMemoryNode(node)) {
    return null;
  }

  const nearbyCategories = allNodes
    .filter(
      (candidate) =>
        candidate.id !== node.id &&
        candidate.id !== centerNodeId &&
        !isFileMemoryNode(candidate) &&
        Boolean(candidate.category.trim()),
    )
    .map((candidate) => ({
      category: candidate.category,
      distance: Math.hypot(candidate.x - node.x, candidate.y - node.y),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 4);

  if (nearbyCategories.length === 0 || nearbyCategories[0].distance > 220) {
    return null;
  }

  const scores = new Map<string, number>();
  nearbyCategories.forEach((candidate) => {
    const weight = 1 / Math.max(candidate.distance, 24);
    scores.set(candidate.category, (scores.get(candidate.category) || 0) + weight);
  });

  return [...scores.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function getStableNodeSortKey(node: Pick<MemoryNode, "id" | "created_at" | "category" | "content">): string {
  return `${node.created_at}|${node.category}|${node.content}|${node.id}`;
}

function getFallbackAngle(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 4096;
  }
  return (hash / 4096) * Math.PI * 2 - Math.PI;
}

function getBranchDirection(
  parentNode: Pick<SimNode, "id" | "x" | "y" | "parent_memory_id">,
  nodeById: Map<string, SimNode>,
  centerNodeId: string,
  seed: string,
): { x: number; y: number } {
  const anchorNode = parentNode.parent_memory_id
    ? nodeById.get(parentNode.parent_memory_id) ?? nodeById.get(centerNodeId)
    : nodeById.get(centerNodeId);
  const dx = parentNode.x - (anchorNode?.x ?? 0);
  const dy = parentNode.y - (anchorNode?.y ?? 0);
  const length = Math.hypot(dx, dy);

  if (length > 1) {
    return {
      x: dx / length,
      y: dy / length,
    };
  }

  const angle = getFallbackAngle(seed);
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function getAttachedFileTarget(
  fileNode: Pick<MemoryNode, "id" | "parent_memory_id">,
  siblingIndex: number,
  siblingCount: number,
  nodeById: Map<string, SimNode>,
  centerNodeId: string,
): { x: number; y: number } | null {
  const parentId = fileNode.parent_memory_id;
  if (!parentId) {
    return null;
  }

  const parentNode = nodeById.get(parentId);
  if (!parentNode) {
    return null;
  }

  const branchDirection = getBranchDirection(parentNode, nodeById, centerNodeId, fileNode.id);
  const tangent = { x: -branchDirection.y, y: branchDirection.x };
  const tangentOffset =
    siblingCount <= 1 ? 0 : (siblingIndex - (siblingCount - 1) / 2) * FILE_ATTACH_SPREAD;
  const radialDistance = nodeRadius(parentNode, parentNode.id === centerNodeId) + FILE_ATTACH_DISTANCE;

  return {
    x: parentNode.x + branchDirection.x * radialDistance + tangent.x * tangentOffset,
    y: parentNode.y + branchDirection.y * radialDistance + tangent.y * tangentOffset,
  };
}

function createFileAttachmentForce(centerNodeId: string): d3.Force<SimNode, SimLink> {
  let nodeById = new Map<string, SimNode>();
  let fileGroups: Array<{ parentId: string; files: SimNode[] }> = [];

  const rebuildCache = (nodes: SimNode[]) => {
    nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groupedFiles = new Map<string, SimNode[]>();

    [...nodes]
      .filter((node) => isFileMemoryNode(node) && Boolean(node.parent_memory_id))
      .sort((left, right) => getStableNodeSortKey(left).localeCompare(getStableNodeSortKey(right)))
      .forEach((node) => {
        const parentId = node.parent_memory_id;
        if (!parentId) {
          return;
        }
        const siblings = groupedFiles.get(parentId) ?? [];
        siblings.push(node);
        groupedFiles.set(parentId, siblings);
      });

    fileGroups = [...groupedFiles.entries()].map(([parentId, files]) => ({ parentId, files }));
  };

  const force = ((alpha: number) => {
    fileGroups.forEach(({ files }) => {
      files.forEach((fileNode, index) => {
        const target = getAttachedFileTarget(
          fileNode,
          index,
          files.length,
          nodeById,
          centerNodeId,
        );
        if (!target) {
          return;
        }

        fileNode.x += (target.x - fileNode.x) * 0.42 * alpha;
        fileNode.y += (target.y - fileNode.y) * 0.42 * alpha;
        fileNode.vx = (fileNode.vx ?? 0) * 0.52 + (target.x - fileNode.x) * 0.08;
        fileNode.vy = (fileNode.vy ?? 0) * 0.52 + (target.y - fileNode.y) * 0.08;
      });
    });
  }) as d3.Force<SimNode, SimLink>;

  force.initialize = (nodes) => {
    rebuildCache(nodes as SimNode[]);
  };

  return force;
}

function buildEdgeKey(sourceId: string, targetId: string): string {
  return sourceId < targetId ? `${sourceId}::${targetId}` : `${targetId}::${sourceId}`;
}

/* ── Component ─────────────────────────────────── */

export default function MemoryGraph(props: MemoryGraphProps) {
  const t = useTranslations("console-assistants");
  const {
    nodes,
    edges,
    assistantName,
    onNodeSelect,
    onCenterNodeClick,
    onCreateMemory,
    onUpdateMemory,
    onDeleteMemory,
    onPromoteMemory,
    onCreateEdge,
    onDeleteEdge,
    onAttachFile,
    onDetachFile,
    searchQuery: externalSearchQuery,
    filters: externalFilters,
  } = props;
  /* refs */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const animFrameRef = useRef<number>(0);
  const connectStartRef = useRef<SimNode | null>(null);
  const connectPointerRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

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
    sources: [],
    timeRange: "all",
  });
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [semanticMatchIds, setSemanticMatchIds] = useState<Set<string> | null>(null);
  const [createMemoryOpen, setCreateMemoryOpen] = useState(false);
  const [createMemoryContent, setCreateMemoryContent] = useState("");
  const [createMemoryCategory, setCreateMemoryCategory] = useState("");
  const [creatingMemory, setCreatingMemory] = useState(false);

  const modal = useModal();

  const searchQuery = externalSearchQuery ?? localSearch;
  const addMemoryTitle = t("graph.addMemory");
  const centerNodeLabel = assistantName?.trim() || t("graph.centerNodeLabel");
  const centerNodeShortLabel = getCenterNodeMonogram(
    assistantName?.trim() || t("graph.centerNodeShort"),
  );
  const addMemoryPrompt = t("graph.addMemoryPrompt");
  const confirmDeleteMessage = t("graph.confirmDelete");

  const openCreateMemoryDialog = useCallback(() => {
    setCreateMemoryContent("");
    setCreateMemoryCategory("");
    setCreateMemoryOpen(true);
  }, []);

  const closeCreateMemoryDialog = useCallback(() => {
    if (creatingMemory) {
      return;
    }
    setCreateMemoryOpen(false);
    setCreateMemoryContent("");
    setCreateMemoryCategory("");
  }, [creatingMemory]);

  const handleCreateMemorySubmit = useCallback(async () => {
    const content = createMemoryContent.trim();
    if (!content || creatingMemory) {
      return;
    }
    setCreatingMemory(true);
    try {
      await onCreateMemory(content, createMemoryCategory.trim() || undefined);
      setCreateMemoryOpen(false);
      setCreateMemoryContent("");
      setCreateMemoryCategory("");
    } finally {
      setCreatingMemory(false);
    }
  }, [createMemoryCategory, createMemoryContent, creatingMemory, onCreateMemory]);

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    const projectId = nodes.find((node) => !isFileMemoryNode(node))?.project_id;

    if (!trimmedQuery || !projectId) {
      setSemanticMatchIds(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void apiPost<Array<{ memory: { id: string } }>>("/api/v1/memory/search", {
        project_id: projectId,
        query: trimmedQuery,
        top_k: 10,
      })
        .then((results) => {
          if (cancelled) return;
          const ids = new Set<string>();
          (Array.isArray(results) ? results : []).forEach((result) => {
            const memoryId = result?.memory?.id;
            if (!memoryId) return;
            ids.add(memoryId);
            nodes.forEach((candidate) => {
              if (candidate.parent_memory_id === memoryId && isFileMemoryNode(candidate)) {
                ids.add(candidate.id);
              }
            });
          });
          setSemanticMatchIds(ids);
        })
        .catch(() => {
          if (!cancelled) {
            setSemanticMatchIds(null);
          }
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [nodes, searchQuery]);

  useEffect(() => {
    if (!selectedNode) {
      return;
    }
    const refreshed = nodes.find((candidate) => candidate.id === selectedNode.id);
    if (!refreshed) {
      setSelectedNode(null);
      onNodeSelect(null);
      return;
    }
    if (refreshed !== selectedNode) {
      setSelectedNode(refreshed);
    }
  }, [nodes, onNodeSelect, selectedNode]);

  /* ── Derive sim data ────────────────────────── */

  const { simNodes, simLinks, centerNodeId } = useMemo(() => {
    const rootNode = nodes.find((node) => isAssistantRootMemoryNode(node)) ?? null;
    const seedNode =
      nodes.find((node) => isOrdinaryMemoryNode(node)) ?? rootNode ?? nodes[0] ?? null;
    const now = new Date().toISOString();
    const cId = rootNode?.id ?? ASSISTANT_CENTER_ID;
    const assistantNode: SimNode | null = rootNode
      ? null
      : {
          id: cId,
          workspace_id: seedNode?.workspace_id ?? "",
          project_id: seedNode?.project_id ?? "",
          content: centerNodeLabel,
          category: "assistant",
          type: "permanent",
          source_conversation_id: null,
          parent_memory_id: null,
          position_x: 0,
          position_y: 0,
          metadata_json: { node_kind: "assistant-center" },
          created_at: seedNode?.created_at ?? now,
          updated_at: seedNode?.updated_at ?? now,
          x: 0,
          y: 0,
          fx: 0,
          fy: 0,
        };

    const nonFileNodes: SimNode[] = nodes
      .filter((node) => !isFileMemoryNode(node))
      .map((node) => {
        const isRoot = isAssistantRootMemoryNode(node);
        return {
          ...node,
          x: isRoot ? 0 : (node.position_x ?? (Math.random() - 0.5) * 400),
          y: isRoot ? 0 : (node.position_y ?? (Math.random() - 0.5) * 400),
          fx: isRoot ? 0 : null,
          fy: isRoot ? 0 : null,
        };
      });

    const seededNodeById = new Map<string, SimNode>(
      (assistantNode ? [assistantNode, ...nonFileNodes] : nonFileNodes).map((node) => [node.id, node]),
    );

    const fileSiblingOrder = new Map<string, { index: number; count: number }>();
    const fileNodesByParent = new Map<string, MemoryNode[]>();
    nodes
      .filter((node) => isFileMemoryNode(node) && Boolean(node.parent_memory_id))
      .sort((left, right) => getStableNodeSortKey(left).localeCompare(getStableNodeSortKey(right)))
      .forEach((node) => {
        const parentId = node.parent_memory_id;
        if (!parentId) {
          return;
        }
        const siblings = fileNodesByParent.get(parentId) ?? [];
        siblings.push(node);
        fileNodesByParent.set(parentId, siblings);
      });

    fileNodesByParent.forEach((siblings) => {
      siblings.forEach((node, index) => {
        fileSiblingOrder.set(node.id, { index, count: siblings.length });
      });
    });

    const fileNodes: SimNode[] = nodes
      .filter((node) => isFileMemoryNode(node))
      .map((node) => {
        const siblingPlacement = fileSiblingOrder.get(node.id);
        const attachedTarget = siblingPlacement
          ? getAttachedFileTarget(
              node,
              siblingPlacement.index,
              siblingPlacement.count,
              seededNodeById,
              cId,
            )
          : null;
        return {
          ...node,
          x: node.position_x ?? attachedTarget?.x ?? (Math.random() - 0.5) * 400,
          y: node.position_y ?? attachedTarget?.y ?? (Math.random() - 0.5) * 400,
          fx: null,
          fy: null,
        };
      });

    const memoryNodes: SimNode[] = [...nonFileNodes, ...fileNodes];

    const sn: SimNode[] = assistantNode ? [assistantNode, ...memoryNodes] : memoryNodes;

    const nodeIdSet = new Set(sn.map((n) => n.id));
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

    const peerEdgeKeys = new Set(
      sl
        .filter((link) => link.edge_type !== "file" && link.edge_type !== "center")
        .map((link) => buildEdgeKey(String(link.source), String(link.target))),
    );
    const peerConnectedNodeIds = new Set<string>();

    nodes
      .filter(
        (node) =>
          !isFileMemoryNode(node) &&
          !isAssistantRootMemoryNode(node) &&
          Boolean(node.parent_memory_id) &&
          node.parent_memory_id !== cId &&
          nodeIdSet.has(node.parent_memory_id || ""),
      )
      .forEach((node) => {
        const parentId = node.parent_memory_id;
        if (!parentId) {
          return;
        }
        const edgeKey = buildEdgeKey(parentId, node.id);
        peerConnectedNodeIds.add(parentId);
        peerConnectedNodeIds.add(node.id);
        if (peerEdgeKeys.has(edgeKey)) {
          return;
        }
        sl.unshift({
          source: parentId,
          target: node.id,
          id: `parent:${parentId}:${node.id}`,
          edge_type: "parent",
          strength: 0.46,
        });
        peerEdgeKeys.add(edgeKey);
      });

    sl.forEach((link) => {
      if (link.edge_type === "file" || link.edge_type === "center") {
        return;
      }
      peerConnectedNodeIds.add(String(link.source));
      peerConnectedNodeIds.add(String(link.target));
    });

    nodes
      .filter(
        (node) =>
          !isFileMemoryNode(node) &&
          !isAssistantRootMemoryNode(node) &&
          !peerConnectedNodeIds.has(node.id) &&
          (node.parent_memory_id === cId || (rootNode === null && !node.parent_memory_id)),
      )
      .forEach((node) => {
        sl.unshift({
          source: cId,
          target: node.id,
          id: `center:${node.id}`,
          edge_type: "center",
          strength: 0.35,
        });
      });

    return { simNodes: sn, simLinks: sl, centerNodeId: cId };
  }, [centerNodeLabel, nodes, edges]);

  /* ── Filtering ──────────────────────────────── */

  const activeTypes = externalFilters?.types ?? filterState.types;
  const activeCategories = externalFilters?.categories ?? filterState.categories;
  const activeSources = externalFilters?.sources ?? filterState.sources;
  const activeTimeRange = externalFilters?.timeRange ?? filterState.timeRange;

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    simNodes.forEach((n) => {
      if (n.id === centerNodeId) {
        ids.add(n.id);
        return;
      }
      // Type filter
      if (activeTypes.length > 0) {
        const nodeType = isFileMemoryNode(n) ? "file" : n.type;
        if (!activeTypes.includes(nodeType)) return;
      }
      // Category filter
      if (activeCategories.length > 0 && !activeCategories.includes(n.category)) {
        return;
      }
      // Source filter
      if (activeSources.length > 0) {
        const nodeSources = getNodeSourceKinds(n);
        if (!nodeSources.some((source) => activeSources.includes(source))) {
          return;
        }
      }
      // Time range filter
      if (activeTimeRange !== "all") {
        const created = new Date(n.created_at).getTime();
        const now = Date.now();
        const msMap = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
        if (now - created > msMap[activeTimeRange]) return;
      }
      ids.add(n.id);
    });
    return ids;
  }, [activeCategories, activeSources, activeTimeRange, activeTypes, centerNodeId, simNodes]);

  const localSearchMatchIds = useMemo(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    const ids = new Set<string>();
    simNodes.forEach((n) => {
      if (n.id === centerNodeId) return;
      if (
        n.content.toLowerCase().includes(q) ||
        n.category.toLowerCase().includes(q)
      ) {
        ids.add(n.id);
      }
    });
    return ids;
  }, [centerNodeId, searchQuery, simNodes]);

  const searchMatchIds = semanticMatchIds ?? localSearchMatchIds;
  const maxRetrievalCount = useMemo(
    () =>
      Math.max(
        0,
        ...simNodes
          .filter((node) => isOrdinaryMemoryNode(node))
          .map((node) => getMemoryRetrievalCount(node)),
      ),
    [simNodes],
  );

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

    const transform = transformRef.current;
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const hasSearch = searchMatchIds !== null;

    /* ── Draw edges ── */
    simLinks.forEach((link) => {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id)) return;

      const isFileEdge = link.edge_type === "file";
      const isCenterEdge = link.edge_type === "center";
      const isParentEdge = link.edge_type === "parent";
      const isSummaryEdge = link.edge_type === "summary";
      const isPermanent =
        !isFileEdge &&
        !isCenterEdge &&
        !isParentEdge &&
        !isSummaryEdge &&
        ((src.type === "permanent" && tgt.type === "permanent") ||
          link.edge_type === "manual");
      const lineWidth = isFileEdge
        ? 1
        : isCenterEdge
          ? 0.65
          : isParentEdge
            ? 1.05
            : 0.7 + link.strength * 1.8;

      ctx.beginPath();
      ctx.moveTo(src.x, src.y);
      ctx.lineTo(tgt.x, tgt.y);

      if (isFileEdge) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(138, 122, 106, 0.45)";
      } else if (isParentEdge) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(200, 115, 74, 0.26)";
      } else if (isSummaryEdge) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(182, 138, 47, 0.45)";
      } else if (isCenterEdge) {
        ctx.setLineDash([3, 6]);
        ctx.strokeStyle = "rgba(138, 122, 106, 0.14)";
      } else if (isPermanent) {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(200, 115, 74, 0.46)";
      } else {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(74, 138, 200, 0.42)";
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

    if (connectStartRef.current && connectPointerRef.current) {
      ctx.beginPath();
      ctx.moveTo(connectStartRef.current.x, connectStartRef.current.y);
      ctx.lineTo(connectPointerRef.current.x, connectPointerRef.current.y);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(200, 115, 74, 0.75)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* ── Draw nodes ── */
    simNodes.forEach((node) => {
      if (!visibleNodeIds.has(node.id)) return;

      const isCenter = node.id === centerNodeId;
      const isSearched = hasSearch && searchMatchIds.has(node.id);
      const isFaded = hasSearch && !isSearched && !isCenter;

      if (isFaded) ctx.globalAlpha = 0.3;

      if (isSearched) {
        ctx.save();
        ctx.shadowColor = isCenter
          ? COLORS.centerGradStart
          : getMemoryNodeColor(node, maxRetrievalCount);
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
        ctx.fillText(centerNodeShortLabel, node.x, node.y);
      } else if (isFileMemoryNode(node)) {
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
        const radius = nodeRadius(node, false);
        const color = getMemoryNodeColor(node, maxRetrievalCount);
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (node.type === "temporary") {
          ctx.setLineDash([4, 3]);
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = isSummaryMemoryNode(node) ? 2.4 : 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        if (isSummaryMemoryNode(node)) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, Math.max(radius - 6, 6), 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 246, 221, 0.95)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (isPinnedMemoryNode(node)) {
          ctx.beginPath();
          ctx.arc(node.x + radius - 3, node.y - radius + 3, 4, 0, Math.PI * 2);
          ctx.fillStyle = "#fff8e6";
          ctx.fill();
        }
      }

      if (isSearched) {
        ctx.restore();
      }

      /* label below node */
      const label = isCenter ? truncateCenterLabel(centerNodeLabel) : getLabel(node);
      const labelY = isCenter
        ? node.y + CENTER_NODE_RADIUS + 14
        : isFileMemoryNode(node)
        ? node.y + FILE_NODE_H / 2 + 12
        : node.y + nodeRadius(node, false) + 14;

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
  }, [centerNodeId, centerNodeLabel, centerNodeShortLabel, maxRetrievalCount, searchMatchIds, simLinks, simNodes, visibleNodeIds]);

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
          .distance((link) => {
            if (link.edge_type === "file") {
              return FILE_LINK_DISTANCE;
            }
            if (link.edge_type === "parent") {
              return PARENT_LINK_DISTANCE;
            }
            if (link.edge_type === "center") {
              return CENTER_LINK_DISTANCE;
            }
            return 100;
          })
          .strength((link) => {
            if (link.edge_type === "file") {
              return 0.9;
            }
            if (link.edge_type === "parent") {
              return 0.48;
            }
            if (link.edge_type === "center") {
              return Math.max(0.05, link.strength * 0.12);
            }
            return Math.max(0.18, link.strength * 0.3);
          })
      )
      .force(
        "charge",
        d3.forceManyBody<SimNode>().strength((node) => {
          if (node.id === centerNodeId) {
            return -260;
          }
          if (isFileMemoryNode(node)) {
            return -12;
          }
          return -200;
        }),
      )
      .force("collide", d3.forceCollide<SimNode>((d) => nodeRadius(d, d.id === centerNodeId) + 8))
      .force("fileAttachment", createFileAttachmentForce(centerNodeId))
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
    // Disable D3's built-in dblclick zoom so our onDblClick handler fires instead
    sel.on("dblclick.zoom", null);

    /* ── Initial transform: center in canvas ── */
    const rect = canvas.getBoundingClientRect();
    const initialTransform = d3.zoomIdentity.translate(rect.width / 2, rect.height / 2);
    sel.call(zoomBehavior.transform, initialTransform);
    transformRef.current = initialTransform;

    /* ── Drag ── */
    let dragNode: SimNode | null = null;

    const dragStarted = (x: number, y: number) => {
      const node = hitTestDirect(x, y);
      if (!node || node.id === centerNodeId || isFileMemoryNode(node)) return;
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
        const inferredCategory = inferDroppedCategory(node, simNodes, centerNodeId);
        onUpdateMemory(node.id, {
          position_x: node.fx,
          position_y: node.fy,
          ...(inferredCategory && inferredCategory !== node.category
            ? { category: inferredCategory }
            : {}),
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
      if (e.shiftKey && node && node.id !== centerNodeId && !isFileMemoryNode(node)) {
        const t = transformRef.current;
        connectStartRef.current = node;
        connectPointerRef.current = {
          x: (mx - t.x) / t.k,
          y: (my - t.y) / t.k,
        };
        suppressClickRef.current = true;
        draw();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (node && node.id !== centerNodeId && !isFileMemoryNode(node)) {
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
      if (connectStartRef.current) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const t = transformRef.current;
        connectPointerRef.current = {
          x: (mx - t.x) / t.k,
          y: (my - t.y) / t.k,
        };
        draw();
        return;
      }
      if (!isDragging) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      dragged(mx, my);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (connectStartRef.current) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const sourceNode = connectStartRef.current;
        const targetNode = hitTestDirect(mx, my);
        connectStartRef.current = null;
        connectPointerRef.current = null;
        if (
          targetNode &&
          sourceNode.id !== targetNode.id &&
          targetNode.id !== centerNodeId &&
          !isFileMemoryNode(targetNode)
        ) {
          onCreateEdge(sourceNode.id, targetNode.id).catch(() => {});
        }
        draw();
        return;
      }
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
          if (node.id === centerNodeId) {
            setSelectedNode(null);
            onNodeSelect(null);
            onCenterNodeClick?.();
            return;
          }
          setSelectedNode(node);
          onNodeSelect(node);
        }
      }
    };

    const onClick = (e: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      // Only handle clicks on blank canvas (not on nodes which are handled via drag flow)
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTestDirect(mx, my);
      if (!node) {
        setSelectedNode(null);
        onNodeSelect(null);
      } else if (node.id === centerNodeId) {
        setSelectedNode(null);
        onNodeSelect(null);
        onCenterNodeClick?.();
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
        openCreateMemoryDialog();
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
        node: node?.id === centerNodeId ? null : node,
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
  }, [centerNodeId, onCenterNodeClick, onCreateEdge, onNodeSelect, onUpdateMemory, openCreateMemoryDialog, simLinks, simNodes]);

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

  useEffect(() => {
    if (!searchMatchIds || searchMatchIds.size === 0) {
      return;
    }
    const canvas = canvasRef.current;
    const zb = zoomBehaviorRef.current;
    if (!canvas || !zb) return;

    const rect = canvas.getBoundingClientRect();
    const matchedNodes = simNodes.filter(
      (node) => visibleNodeIds.has(node.id) && searchMatchIds.has(node.id),
    );
    if (matchedNodes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    matchedNodes.forEach((node) => {
      const r = nodeRadius(node, node.id === centerNodeId) + 24;
      minX = Math.min(minX, node.x - r);
      minY = Math.min(minY, node.y - r);
      maxX = Math.max(maxX, node.x + r);
      maxY = Math.max(maxY, node.y + r);
    });

    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const scale = Math.min(rect.width / bw, rect.height / bh, 2.2) * 0.9;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const t = d3.zoomIdentity
      .translate(rect.width / 2 - cx * scale, rect.height / 2 - cy * scale)
      .scale(scale);

    d3.select(canvas).transition().duration(360).call(zb.transform, t);
  }, [centerNodeId, searchMatchIds, simNodes, visibleNodeIds]);

  /* ── Stats ──────────────────────────────────── */

  const fileCount = useMemo(
    () =>
      nodes.filter(
        (node) =>
          visibleNodeIds.has(node.id) &&
          (!searchMatchIds || searchMatchIds.has(node.id)) &&
          isFileMemoryNode(node),
      ).length,
    [nodes, searchMatchIds, visibleNodeIds],
  );
  const memoryCount = useMemo(
    () =>
      nodes.filter(
        (node) =>
          visibleNodeIds.has(node.id) &&
          (!searchMatchIds || searchMatchIds.has(node.id)) &&
          isOrdinaryMemoryNode(node),
      ).length,
    [nodes, searchMatchIds, visibleNodeIds],
  );

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
        void modal.confirm(confirmDeleteMessage).then((ok) => {
          if (ok) onDeleteMemory(id);
        });
      },
      onAddMemory: () => {
        openCreateMemoryDialog();
      },
    }),
    [confirmDeleteMessage, modal, onDeleteMemory, onNodeSelect, onPromoteMemory, openCreateMemoryDialog]
  );

  /* ── Render ─────────────────────────────────── */

  return (
    <div className="graph-container">
      <GraphFilters
        nodes={nodes}
        activeFilters={filterState}
        onFilterChange={setFilterState}
        collapsed={filtersCollapsed}
        onToggleCollapsed={() => setFiltersCollapsed((value) => !value)}
      />

      <div className="graph-main">
        <canvas
          ref={canvasRef}
          className="graph-canvas"
        />

        <GraphControls
          nodeCount={memoryCount}
          fileCount={fileCount}
          onAdd={openCreateMemoryDialog}
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
          allNodes={nodes}
          onClose={() => {
            setSelectedNode(null);
            onNodeSelect(null);
          }}
          onUpdate={onUpdateMemory}
          onDelete={onDeleteMemory}
          onPromote={onPromoteMemory}
          onDeleteEdge={onDeleteEdge}
          onAttachFile={onAttachFile}
          onDetachFile={onDetachFile}
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

      <Dialog
        open={createMemoryOpen}
        onOpenChange={(open) => {
          if (open) {
            setCreateMemoryOpen(true);
            return;
          }
          closeCreateMemoryDialog();
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{addMemoryTitle}</DialogTitle>
            <p className="text-sm text-muted-foreground">{addMemoryPrompt}</p>
          </DialogHeader>

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateMemorySubmit();
            }}
          >
            <div className="space-y-2">
              <label className="graph-detail-label" htmlFor="memory-create-content">
                {t("graph.contentLabel")}
              </label>
              <textarea
                id="memory-create-content"
                className="graph-detail-textarea"
                value={createMemoryContent}
                onChange={(event) => setCreateMemoryContent(event.target.value)}
                rows={5}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="graph-detail-label" htmlFor="memory-create-category">
                {t("graph.category")}
              </label>
              <input
                id="memory-create-category"
                className="graph-detail-input"
                value={createMemoryCategory}
                onChange={(event) => setCreateMemoryCategory(event.target.value)}
                type="text"
              />
            </div>

            <DialogFooter>
              <button
                type="button"
                className="graph-detail-btn"
                onClick={closeCreateMemoryDialog}
                disabled={creatingMemory}
              >
                {t("graph.cancel")}
              </button>
              <button
                type="submit"
                className="graph-detail-btn is-primary"
                disabled={creatingMemory || createMemoryContent.trim().length === 0}
              >
                {creatingMemory ? "..." : t("graph.save")}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
