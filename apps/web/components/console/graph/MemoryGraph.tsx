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
  canPrimaryParentChildren,
  type MemoryNode,
  type MemoryEdge,
  getGraphNodeDisplayType,
  getMemoryCategoryPath,
  getMemoryCategoryLabel,
  getMemoryCategoryPrefixes,
  getMemoryKind,
  getMemoryNodeRole,
  getMemoryRetrievalCount,
  isFactMemoryNode,
  isAssistantRootMemoryNode,
  isFileMemoryNode,
  isStructureMemoryNode,
  isPinnedMemoryNode,
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

interface TreeLayoutTarget {
  x: number;
  y: number;
  angle: number;
  depth: number;
}

type GraphSelectionMode = "parent" | "children" | "related" | null;

interface MemoryGraphProps {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  assistantName?: string;
  renderMode?: "workbench" | "orbit";
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
const GRAPH_TOP_LEVEL_TARGET_ID = "__graph_top_level__";
const COLORS = {
  permanent: "#c8734a",
  temporary: "#4a8ac8",
  core: "#dd8a62",
  structure: "#d59863",
  theme: "#c46e58",
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
  const role = getMemoryNodeRole(node);
  if (role === "summary") return MEMORY_NODE_RADIUS + 4;
  if (role === "theme") return MEMORY_NODE_RADIUS + 2;
  if (role === "structure") return MEMORY_NODE_RADIUS - 1;
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
  if (getMemoryNodeRole(node) === "structure") {
    return getMemoryCategoryLabel(node) || node.content;
  }
  const content = node.content.trim();
  if (content) {
    return content.length > 12
      ? content.slice(0, 12) + "..."
      : content;
  }
  const categoryLabel = getMemoryCategoryLabel(node);
  if (categoryLabel) {
    return categoryLabel;
  }
  if (node.category) return node.category;
  return node.id.slice(0, 8);
}

function getMemoryNodeColor(node: MemoryNode, maxRetrievalCount: number): string {
  const kind = getMemoryKind(node);
  const role = getMemoryNodeRole(node);
  const baseColor = (() => {
    if (node.type === "temporary") {
      return COLORS.temporary;
    }
    if (role === "summary") {
      return COLORS.summary;
    }
    if (role === "structure") {
      return COLORS.structure;
    }
    if (role === "theme") {
      return COLORS.theme;
    }
    if (isPinnedMemoryNode(node)) {
      return COLORS.core;
    }
    if (kind === "profile" || kind === "preference" || kind === "goal") {
      return COLORS.core;
    }
    return COLORS.permanent;
  })();

  const retrievalCount = getMemoryRetrievalCount(node);
  if (retrievalCount > 0 && maxRetrievalCount > 0) {
    const normalized = Math.log(retrievalCount + 1) / Math.log(maxRetrievalCount + 1);
    const targetColor =
      node.type === "temporary"
        ? "#215e99"
        : role === "summary"
          ? "#8a6715"
          : role === "structure"
            ? "#b1713d"
            : role === "theme"
              ? "#a94b38"
          : isPinnedMemoryNode(node) || kind === "profile" || kind === "preference" || kind === "goal"
            ? "#b85d39"
            : "#a32020";
    const intensity =
      node.type === "temporary"
        ? 0.22 + normalized * 0.44
        : 0.18 + normalized * 0.68;
    return d3.interpolateRgb(baseColor, targetColor)(Math.min(0.88, intensity));
  }
  return baseColor;
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

function getGraphParentId(
  node: Pick<MemoryNode, "parent_memory_id" | "metadata_json">,
  nodeById?: Map<string, Pick<MemoryNode, "id">>,
): string | null {
  const graphParentId =
    typeof node.metadata_json?.graph_parent_memory_id === "string" &&
    node.metadata_json.graph_parent_memory_id
      ? node.metadata_json.graph_parent_memory_id
      : null;
  if (graphParentId && (!nodeById || nodeById.has(graphParentId))) {
    return graphParentId;
  }
  return node.parent_memory_id ?? null;
}

function isStructuralTreeEdgePair(
  nodeById: Map<string, Pick<MemoryNode, "id" | "parent_memory_id" | "metadata_json">>,
  sourceId: string,
  targetId: string,
  centerNodeId: string,
): boolean {
  if (sourceId === targetId) {
    return false;
  }
  const source = nodeById.get(sourceId);
  const target = nodeById.get(targetId);
  if (!source || !target) {
    return false;
  }
  if (getGraphParentId(target, nodeById) === sourceId) {
    return target.id !== centerNodeId;
  }
  if (getGraphParentId(source, nodeById) === targetId) {
    return source.id !== centerNodeId;
  }
  return false;
}

function isCenterStructuralTreeEdgePair(
  nodeById: Map<string, Pick<MemoryNode, "id" | "parent_memory_id" | "metadata_json">>,
  sourceId: string,
  targetId: string,
  centerNodeId: string,
): boolean {
  return (
    isStructuralTreeEdgePair(nodeById, sourceId, targetId, centerNodeId) &&
    (sourceId === centerNodeId || targetId === centerNodeId)
  );
}

function canGraphRepositionNode(node: Pick<MemoryNode, "id" | "metadata_json" | "category">, centerNodeId: string): boolean {
  return (
    node.id !== centerNodeId &&
    getGraphNodeDisplayType(node as MemoryNode) !== "file" &&
    getMemoryNodeRole(node as MemoryNode) !== "structure"
  );
}

function sortTreeChildren(left: SimNode, right: SimNode): number {
  const roleWeight = (node: SimNode) => {
    const role = getMemoryNodeRole(node);
    if (role === "structure") return 4;
    if (role === "theme") return 3;
    if (role === "summary") return 2;
    return 1;
  };
  const roleBias = roleWeight(right) - roleWeight(left);
  if (roleBias !== 0) {
    return roleBias;
  }
  return getStableNodeSortKey(left).localeCompare(getStableNodeSortKey(right));
}

function getTreeNodeDistance(node: SimNode, depth: number, centerNodeId: string): number {
  if (node.id === centerNodeId) {
    return 0;
  }
  if (depth <= 1) {
    return CENTER_LINK_DISTANCE + 18;
  }
  const role = getMemoryNodeRole(node);
  if (role === "structure") {
    return PARENT_LINK_DISTANCE + 4;
  }
  if (role === "summary") {
    return PARENT_LINK_DISTANCE + 14;
  }
  if (role === "theme") {
    return PARENT_LINK_DISTANCE + 18;
  }
  return PARENT_LINK_DISTANCE + 22;
}

function getChildAngle(
  parentTarget: TreeLayoutTarget,
  index: number,
  siblingCount: number,
): number {
  if (siblingCount <= 1) {
    return parentTarget.angle;
  }
  const spread =
    parentTarget.depth <= 1
      ? Math.min(1.18, 0.52 + siblingCount * 0.16)
      : Math.min(0.82, 0.34 + siblingCount * 0.11);
  const normalizedIndex = siblingCount <= 1
    ? 0
    : (index - (siblingCount - 1) / 2) / ((siblingCount - 1) / 2 || 1);
  return parentTarget.angle + normalizedIndex * (spread / 2);
}

function buildTreeLayoutTargets(nodes: SimNode[], centerNodeId: string): Map<string, TreeLayoutTarget> {
  const targets = new Map<string, TreeLayoutTarget>();
  targets.set(centerNodeId, { x: 0, y: 0, angle: -Math.PI / 2, depth: 0 });

  const treeNodes = nodes.filter((node) => !isFileMemoryNode(node));
  const nodeById = new Map(treeNodes.map((node) => [node.id, node]));
  const childrenByParent = new Map<string, SimNode[]>();

  treeNodes.forEach((node) => {
    if (node.id === centerNodeId) {
      return;
    }
    const graphParentId = getGraphParentId(node, nodeById);
    const parentId = graphParentId && nodeById.has(graphParentId) ? graphParentId : centerNodeId;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(parentId, siblings);
  });

  childrenByParent.forEach((siblings) => siblings.sort(sortTreeChildren));

  const rootChildren = childrenByParent.get(centerNodeId) ?? [];
  const rootStep = rootChildren.length > 0 ? (Math.PI * 2) / rootChildren.length : 0;

  const assignNodeTarget = (
    node: SimNode,
    parentTarget: TreeLayoutTarget,
    angle: number,
  ) => {
    const hasStoredPosition =
      typeof node.position_x === "number" && typeof node.position_y === "number";
    const target = hasStoredPosition
      ? {
          x: node.position_x as number,
          y: node.position_y as number,
        }
      : {
          x: parentTarget.x + Math.cos(angle) * getTreeNodeDistance(node, parentTarget.depth + 1, centerNodeId),
          y: parentTarget.y + Math.sin(angle) * getTreeNodeDistance(node, parentTarget.depth + 1, centerNodeId),
        };
    const resolvedAngle = hasStoredPosition
      ? Math.atan2(target.y - parentTarget.y, target.x - parentTarget.x) || angle
      : angle;
    const nextTarget: TreeLayoutTarget = {
      x: target.x,
      y: target.y,
      angle: resolvedAngle,
      depth: parentTarget.depth + 1,
    };
    targets.set(node.id, nextTarget);

    const children = childrenByParent.get(node.id) ?? [];
    children.forEach((child, index) => {
      assignNodeTarget(
        child,
        nextTarget,
        getChildAngle(nextTarget, index, children.length),
      );
    });
  };

  rootChildren.forEach((child, index) => {
    const baseAngle = rootChildren.length <= 1
      ? -Math.PI / 2
      : -Math.PI / 2 + index * rootStep;
    assignNodeTarget(
      child,
      targets.get(centerNodeId)!,
      baseAngle,
    );
  });

  return targets;
}

function createTreeScaffoldForce(centerNodeId: string): d3.Force<SimNode, SimLink> {
  let layoutTargets = new Map<string, TreeLayoutTarget>();
  let simulationNodes: SimNode[] = [];

  const force = ((alpha: number) => {
    simulationNodes.forEach((node) => {
      if (node.id === centerNodeId || isFileMemoryNode(node) || node.fx != null || node.fy != null) {
        return;
      }
      const target = layoutTargets.get(node.id);
      if (!target) {
        return;
      }
      const spring =
        typeof node.position_x === "number" && typeof node.position_y === "number"
          ? 0.05
          : getMemoryNodeRole(node) === "structure"
            ? 0.22
            : 0.14;
      node.vx = (node.vx ?? 0) + (target.x - node.x) * spring * alpha;
      node.vy = (node.vy ?? 0) + (target.y - node.y) * spring * alpha;
    });
  }) as d3.Force<SimNode, SimLink>;

  force.initialize = (nodes) => {
    simulationNodes = nodes as SimNode[];
    layoutTargets = buildTreeLayoutTargets(simulationNodes, centerNodeId);
  };

  return force;
}

/* ── Component ─────────────────────────────────── */

export default function MemoryGraph(props: MemoryGraphProps) {
  const t = useTranslations("console-assistants");
  const {
    nodes,
    edges,
    assistantName,
    renderMode = "workbench",
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
  const isOrbitMode = renderMode === "orbit";
  /* refs */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const transformRef = useRef(d3.zoomIdentity);
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const animFrameRef = useRef<number>(0);
  const connectStartRef = useRef<SimNode | null>(null);
  const connectModeRef = useRef<"parent" | "manual" | null>(null);
  const connectPointerRef = useRef<{ x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);
  const editModeRef = useRef<GraphSelectionMode>(null);
  const selectedNodeRef = useRef<MemoryNode | null>(null);
  const selectableNodeIdsRef = useRef<Set<string>>(new Set());

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
  const [editMode, setEditMode] = useState<GraphSelectionMode>(null);
  const [editSelectionIds, setEditSelectionIds] = useState<string[]>([]);
  const [editPending, setEditPending] = useState(false);

  const modal = useModal();

  const searchQuery = externalSearchQuery ?? localSearch;
  const addMemoryTitle = t("graph.addMemory");
  const centerNodeLabel = assistantName?.trim() || t("graph.centerNodeLabel");
  const centerNodeShortLabel = getCenterNodeMonogram(
    assistantName?.trim() || t("graph.centerNodeShort"),
  );
  const addMemoryPrompt = t("graph.addMemoryPrompt");
  const confirmDeleteMessage = t("graph.confirmDelete");

  useEffect(() => {
    setFiltersCollapsed(renderMode === "orbit");
  }, [renderMode]);

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

  useEffect(() => {
    if (!selectedNode && editMode) {
      setEditMode(null);
      setEditSelectionIds([]);
    }
  }, [editMode, selectedNode]);

  useEffect(() => {
    if (editMode !== "children" || !selectedNode) {
      return;
    }
    if (!canPrimaryParentChildren(selectedNode)) {
      setEditMode(null);
      setEditSelectionIds([]);
    }
  }, [editMode, selectedNode]);

  useEffect(() => {
    editModeRef.current = editMode;
  }, [editMode]);

  useEffect(() => {
    selectedNodeRef.current = selectedNode;
  }, [selectedNode]);

  /* ── Derive sim data ────────────────────────── */

  const { simNodes, simLinks, centerNodeId } = useMemo(() => {
    const rootNode = nodes.find((node) => isAssistantRootMemoryNode(node)) ?? null;
    const seedNode =
      nodes.find((node) => isFactMemoryNode(node)) ?? rootNode ?? nodes[0] ?? null;
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

    const provisionalNonFileNodes: SimNode[] = nodes
      .filter((node) => !isFileMemoryNode(node))
      .map((node) => {
        const isRoot = isAssistantRootMemoryNode(node);
        return {
          ...node,
          x: isRoot ? 0 : (node.position_x ?? 0),
          y: isRoot ? 0 : (node.position_y ?? 0),
          fx: isRoot ? 0 : null,
          fy: isRoot ? 0 : null,
        };
      });
    const treeTargets = buildTreeLayoutTargets(
      assistantNode ? [assistantNode, ...provisionalNonFileNodes] : provisionalNonFileNodes,
      cId,
    );
    const nonFileNodes: SimNode[] = provisionalNonFileNodes.map((node) => {
      const isRoot = isAssistantRootMemoryNode(node);
      const target = treeTargets.get(node.id);
      return {
        ...node,
        x: isRoot ? 0 : (node.position_x ?? target?.x ?? (Math.random() - 0.5) * 320),
        y: isRoot ? 0 : (node.position_y ?? target?.y ?? (Math.random() - 0.5) * 320),
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
    const simNodeById = new Map(sn.map((node) => [node.id, node] as const));
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

    const structuralEdgeKeys = new Set(
      sl
        .filter((link) =>
          isStructuralTreeEdgePair(
            simNodeById,
            String(link.source),
            String(link.target),
            cId,
          ),
        )
        .map((link) => buildEdgeKey(String(link.source), String(link.target))),
    );

    nodes
      .filter(
        (node) =>
          !isFileMemoryNode(node) &&
          !isAssistantRootMemoryNode(node) &&
          Boolean(getGraphParentId(node, simNodeById)) &&
          getGraphParentId(node, simNodeById) !== cId &&
          nodeIdSet.has(getGraphParentId(node, simNodeById) || ""),
      )
      .forEach((node) => {
        const parentId = getGraphParentId(node, simNodeById);
        if (!parentId) {
          return;
        }
        const edgeKey = buildEdgeKey(parentId, node.id);
        if (structuralEdgeKeys.has(edgeKey)) {
          return;
        }
        sl.unshift({
          source: parentId,
          target: node.id,
          id: `parent:${parentId}:${node.id}`,
          edge_type: "parent",
          strength: 0.46,
        });
        structuralEdgeKeys.add(edgeKey);
      });

    nodes
      .filter(
        (node) =>
          !isFileMemoryNode(node) &&
          !isAssistantRootMemoryNode(node) &&
          (getGraphParentId(node, simNodeById) === cId ||
            (rootNode === null && !getGraphParentId(node, simNodeById))),
      )
      .forEach((node) => {
        const edgeKey = buildEdgeKey(cId, node.id);
        if (structuralEdgeKeys.has(edgeKey)) {
          return;
        }
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

  const currentChildIds = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return nodes
      .filter(
        (candidate) =>
          !isFileMemoryNode(candidate) &&
          !isAssistantRootMemoryNode(candidate) &&
          candidate.parent_memory_id === selectedNode.id,
      )
      .map((candidate) => candidate.id);
  }, [nodes, selectedNode]);

  const currentManualEdges = useMemo(() => {
    if (!selectedNode) {
      return [];
    }
    return edges.filter(
      (edge) =>
        edge.edge_type === "manual" &&
        (edge.source_memory_id === selectedNode.id || edge.target_memory_id === selectedNode.id),
    );
  }, [edges, selectedNode]);

  const currentManualRelatedIds = useMemo(
    () =>
      currentManualEdges.map((edge) =>
        edge.source_memory_id === selectedNode?.id ? edge.target_memory_id : edge.source_memory_id,
      ),
    [currentManualEdges, selectedNode?.id],
  );

  const currentAncestorIds = useMemo(() => {
    if (!selectedNode) {
      return new Set<string>();
    }
    const ids = new Set<string>();
    const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
    let current = selectedNode;
    while (current.parent_memory_id && nodeById.has(current.parent_memory_id)) {
      ids.add(current.parent_memory_id);
      current = nodeById.get(current.parent_memory_id)!;
    }
    return ids;
  }, [nodes, selectedNode]);

  const selectableNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedNode || !editMode) {
      return ids;
    }
    if (editMode === "parent") {
      ids.add(centerNodeId);
      const blockedIds = new Set<string>([selectedNode.id]);
      const queue = [selectedNode.id];
      while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId) {
          continue;
        }
        nodes.forEach((candidate) => {
          if (candidate.parent_memory_id !== currentId || blockedIds.has(candidate.id)) {
            return;
          }
          blockedIds.add(candidate.id);
          queue.push(candidate.id);
        });
      }
      nodes.forEach((candidate) => {
        if (
          isFileMemoryNode(candidate) ||
          isAssistantRootMemoryNode(candidate) ||
          candidate.id === selectedNode.id ||
          blockedIds.has(candidate.id) ||
          !canPrimaryParentChildren(candidate)
        ) {
          return;
        }
        ids.add(candidate.id);
      });
      return ids;
    }

    nodes.forEach((candidate) => {
      if (isFileMemoryNode(candidate) || isAssistantRootMemoryNode(candidate) || candidate.id === selectedNode.id) {
        return;
      }
      if (editMode === "children" && currentAncestorIds.has(candidate.id)) {
        return;
      }
      ids.add(candidate.id);
    });
    return ids;
  }, [centerNodeId, currentAncestorIds, editMode, nodes, selectedNode]);

  const editSelectionSet = useMemo(() => new Set(editSelectionIds), [editSelectionIds]);

  useEffect(() => {
    selectableNodeIdsRef.current = selectableNodeIds;
  }, [selectableNodeIds]);

  const expandStructuralSelectionIds = useCallback(
    (selectionIds: string[], mode: Extract<GraphSelectionMode, "children" | "related">) => {
      const expandedIds = new Set<string>();
      const nodeById = new Map(nodes.map((candidate) => [candidate.id, candidate] as const));

      selectionIds.forEach((selectionId) => {
        const targetNode = nodeById.get(selectionId);
        if (!targetNode) {
          return;
        }
        if (!isStructureMemoryNode(targetNode)) {
          expandedIds.add(selectionId);
          return;
        }
        const categoryPath = getMemoryCategoryPath(targetNode);
        if (!categoryPath) {
          return;
        }
        nodes.forEach((candidate) => {
          if (
            candidate.id === selectedNode?.id ||
            isFileMemoryNode(candidate) ||
            isAssistantRootMemoryNode(candidate) ||
            isStructureMemoryNode(candidate)
          ) {
            return;
          }
          if (!getMemoryCategoryPrefixes(candidate).includes(categoryPath)) {
            return;
          }
          if (mode === "children" && currentAncestorIds.has(candidate.id)) {
            return;
          }
          expandedIds.add(candidate.id);
        });
      });

      return [...expandedIds];
    },
    [currentAncestorIds, nodes, selectedNode?.id],
  );

  const beginEditMode = useCallback(
    (mode: Exclude<GraphSelectionMode, null>) => {
      if (!selectedNode) {
        return;
      }
      setEditMode(mode);
      if (mode === "parent") {
        const currentGraphParentId = getGraphParentId(
          selectedNode,
          new Map(nodes.map((node) => [node.id, node] as const)),
        );
        setEditSelectionIds([
          currentGraphParentId && currentGraphParentId !== centerNodeId
            ? currentGraphParentId
            : GRAPH_TOP_LEVEL_TARGET_ID,
        ]);
        return;
      }
      if (mode === "children") {
        if (!canPrimaryParentChildren(selectedNode)) {
          return;
        }
        setEditSelectionIds(currentChildIds);
        return;
      }
      setEditSelectionIds(currentManualRelatedIds);
    },
    [centerNodeId, currentChildIds, currentManualRelatedIds, nodes, selectedNode],
  );

  const cancelEditMode = useCallback(() => {
    setEditMode(null);
    setEditSelectionIds([]);
  }, []);

  const clearEditSelection = useCallback(() => {
    if (editMode === "parent") {
      setEditSelectionIds([GRAPH_TOP_LEVEL_TARGET_ID]);
      return;
    }
    setEditSelectionIds([]);
  }, [editMode]);

  const applyEditMode = useCallback(async () => {
    if (!selectedNode || !editMode || editPending) {
      return;
    }
    setEditPending(true);
    try {
      if (editMode === "parent") {
        const nextParentId = editSelectionIds[0];
        if (!nextParentId || nextParentId === GRAPH_TOP_LEVEL_TARGET_ID) {
          await onUpdateMemory(selectedNode.id, { parent_memory_id: null });
        } else {
          const nextParentNode = nodes.find((candidate) => candidate.id === nextParentId) ?? null;
          if (nextParentNode && isStructureMemoryNode(nextParentNode)) {
            await onUpdateMemory(selectedNode.id, {
              category: getMemoryCategoryPath(nextParentNode),
              parent_memory_id: null,
            });
          } else {
            await onUpdateMemory(selectedNode.id, { parent_memory_id: nextParentId });
          }
        }
      } else if (editMode === "children") {
        if (!canPrimaryParentChildren(selectedNode)) {
          await modal.alert(t("graph.leafNodeChildrenUnsupported"));
          return;
        }
        const nextChildIds = new Set(expandStructuralSelectionIds(editSelectionIds, "children"));
        const currentChildIdSet = new Set(currentChildIds);
        for (const currentChildId of currentChildIds) {
          if (nextChildIds.has(currentChildId)) {
            continue;
          }
          await onUpdateMemory(currentChildId, { parent_memory_id: null });
        }
        for (const childId of nextChildIds) {
          if (currentChildIdSet.has(childId)) {
            continue;
          }
          await onUpdateMemory(childId, { parent_memory_id: selectedNode.id });
        }
      } else if (editMode === "related") {
        const nextRelatedIds = new Set(expandStructuralSelectionIds(editSelectionIds, "related"));
        const currentEdgeByRelatedId = new Map(
          currentManualEdges.map((edge) => [
            edge.source_memory_id === selectedNode.id ? edge.target_memory_id : edge.source_memory_id,
            edge.id,
          ]),
        );
        for (const edge of currentManualEdges) {
          const otherId =
            edge.source_memory_id === selectedNode.id ? edge.target_memory_id : edge.source_memory_id;
          if (nextRelatedIds.has(otherId)) {
            continue;
          }
          await onDeleteEdge(edge.id);
        }
        for (const relatedId of nextRelatedIds) {
          if (currentEdgeByRelatedId.has(relatedId)) {
            continue;
          }
          await onCreateEdge(selectedNode.id, relatedId);
        }
      }
      setEditMode(null);
      setEditSelectionIds([]);
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : t("graph.applySelectionFailed");
      await modal.alert(message);
    } finally {
      setEditPending(false);
    }
  }, [
    currentChildIds,
    currentManualEdges,
    editMode,
    editPending,
    editSelectionIds,
    expandStructuralSelectionIds,
    modal,
    onCreateEdge,
    onDeleteEdge,
    onUpdateMemory,
    nodes,
    selectedNode,
    t,
  ]);

  /* ── Filtering ──────────────────────────────── */

  const activeTypes = externalFilters?.types ?? filterState.types;
  const activeCategories = externalFilters?.categories ?? filterState.categories;
  const activeSources = externalFilters?.sources ?? filterState.sources;
  const activeTimeRange = externalFilters?.timeRange ?? filterState.timeRange;

  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>();
    const nodeById = new Map(simNodes.map((node) => [node.id, node]));
    const categoryNodeIdByPath = new Map<string, string>();
    simNodes.forEach((node) => {
      if (!isStructureMemoryNode(node)) {
        return;
      }
      const prefixes = getMemoryCategoryPrefixes(node);
      const categoryPath = prefixes[prefixes.length - 1];
      if (categoryPath) {
        categoryNodeIdByPath.set(categoryPath, node.id);
      }
    });
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
      if (
        activeCategories.length > 0 &&
        !activeCategories.some((categoryPath) => getMemoryCategoryPrefixes(n).includes(categoryPath))
      ) {
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
    const matchedIds = Array.from(ids);
    matchedIds.forEach((nodeId) => {
      let current = nodeById.get(nodeId);
      while (current) {
        const graphParentId = getGraphParentId(current, nodeById);
        if (!graphParentId || !nodeById.has(graphParentId)) {
          break;
        }
        ids.add(graphParentId);
        current = nodeById.get(graphParentId);
      }
      const node = nodeById.get(nodeId);
      if (!node || isStructureMemoryNode(node)) {
        return;
      }
      getMemoryCategoryPrefixes(node).forEach((prefix) => {
        const categoryNodeId = categoryNodeIdByPath.get(prefix);
        if (categoryNodeId) {
          ids.add(categoryNodeId);
        }
      });
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
        n.category.toLowerCase().includes(q) ||
        getMemoryCategoryPrefixes(n).some((value) => value.toLowerCase().includes(q))
      ) {
        ids.add(n.id);
      }
    });
    return ids;
  }, [centerNodeId, searchQuery, simNodes]);

  const searchMatchIds = semanticMatchIds ?? localSearchMatchIds;
  const simNodeById = useMemo(
    () => new Map(simNodes.map((node) => [node.id, node] as const)),
    [simNodes],
  );
  const maxRetrievalCount = useMemo(
    () =>
      Math.max(
        0,
        ...simNodes
          .filter((node) => isFactMemoryNode(node))
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
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const hasSearch = searchMatchIds !== null;
    const isEditActive = Boolean(editMode && selectedNode);
    const activeNodeId = selectedNode?.id || null;
    const centerNode = simNodeById.get(centerNodeId) ?? null;

    if (isOrbitMode && centerNode) {
      const orbitBands = [220, 360, 520];
      orbitBands.forEach((band, index) => {
        ctx.beginPath();
        ctx.ellipse(
          centerNode.x,
          centerNode.y,
          band,
          band * 0.72,
          0,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle =
          index === 0
            ? "rgba(222, 181, 142, 0.26)"
            : index === 1
              ? "rgba(144, 139, 255, 0.14)"
              : "rgba(214, 196, 244, 0.12)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      simNodes.forEach((node) => {
        if (
          node.id === centerNodeId ||
          !visibleNodeIds.has(node.id) ||
          isFileMemoryNode(node)
        ) {
          return;
        }
        const isRootBranch =
          !getGraphParentId(node, simNodeById) || getGraphParentId(node, simNodeById) === centerNodeId;
        if (!isRootBranch) {
          return;
        }
        const halo = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 84);
        halo.addColorStop(0, "rgba(235, 173, 132, 0.18)");
        halo.addColorStop(0.45, "rgba(235, 173, 132, 0.08)");
        halo.addColorStop(1, "rgba(235, 173, 132, 0)");
        ctx.beginPath();
        ctx.arc(node.x, node.y, 84, 0, Math.PI * 2);
        ctx.fillStyle = halo;
        ctx.fill();
      });
    }

    /* ── Draw edges ── */
    simLinks.forEach((link) => {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (!visibleNodeIds.has(src.id) || !visibleNodeIds.has(tgt.id)) return;

      const isFileEdge = link.edge_type === "file";
      const isSummaryEdge = link.edge_type === "summary";
      const isManualRelatedEdge = link.edge_type === "manual";
      const isSystemRelatedEdge = link.edge_type === "related";
      const isLateralEdge = isManualRelatedEdge || isSystemRelatedEdge;
      const isStructuralEdge = isStructuralTreeEdgePair(
        simNodeById,
        src.id,
        tgt.id,
        centerNodeId,
      );
      const isCenterEdge =
        link.edge_type === "center" ||
        isCenterStructuralTreeEdgePair(simNodeById, src.id, tgt.id, centerNodeId);
      const isParentEdge =
        link.edge_type === "parent" || (isStructuralEdge && !isCenterEdge);
      const lineWidth = isFileEdge
        ? 1
        : isCenterEdge
          ? isOrbitMode ? 2.1 : 1.75
          : isParentEdge
            ? isOrbitMode ? 1.55 : 1.3
            : isManualRelatedEdge
              ? isOrbitMode ? 1.95 : 1.7
              : isSystemRelatedEdge
                ? isOrbitMode ? 1.65 : 1.4
                : isSummaryEdge
                  ? isOrbitMode ? 1.45 : 1.2
                  : 0.85 + link.strength * 1.2;
      const edgeTouchesActiveNode = Boolean(activeNodeId && (src.id === activeNodeId || tgt.id === activeNodeId));
      const edgeTouchesSelection =
        edgeTouchesActiveNode ||
        editSelectionSet.has(src.id) ||
        editSelectionSet.has(tgt.id) ||
        (editSelectionSet.has(GRAPH_TOP_LEVEL_TARGET_ID) &&
          (src.id === centerNodeId || tgt.id === centerNodeId));

      if (isFileEdge) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(138, 122, 106, 0.45)";
      } else if (isParentEdge) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([]);
        ctx.strokeStyle = isOrbitMode ? "rgba(209, 132, 91, 0.5)" : "rgba(200, 115, 74, 0.34)";
      } else if (isSummaryEdge) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([]);
        ctx.strokeStyle = isOrbitMode ? "rgba(191, 155, 63, 0.58)" : "rgba(182, 138, 47, 0.45)";
      } else if (isSystemRelatedEdge) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = isOrbitMode ? "rgba(91, 118, 255, 0.66)" : "rgba(89, 102, 241, 0.52)";
      } else if (isManualRelatedEdge) {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([10, 6]);
        ctx.strokeStyle = isOrbitMode ? "rgba(89, 111, 255, 0.9)" : "rgba(79, 93, 232, 0.82)";
      } else if (isCenterEdge) {
        const glowGradient = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
        glowGradient.addColorStop(0, "rgba(255, 236, 221, 0.4)");
        glowGradient.addColorStop(1, "rgba(200, 115, 74, 0.16)");
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([]);
        ctx.strokeStyle = glowGradient;
        ctx.lineWidth = lineWidth + 2.6;
        if (hasSearch) {
          const srcMatch = searchMatchIds.has(src.id);
          const tgtMatch = searchMatchIds.has(tgt.id);
          if (!srcMatch && !tgtMatch) {
            ctx.globalAlpha = 0.12;
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;

        const centerGradient = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y);
        centerGradient.addColorStop(0, "rgba(242, 214, 188, 0.9)");
        centerGradient.addColorStop(0.55, "rgba(210, 142, 95, 0.62)");
        centerGradient.addColorStop(1, "rgba(200, 115, 74, 0.26)");
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.strokeStyle = centerGradient;
      } else {
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "rgba(200, 115, 74, 0.22)";
      }
      ctx.lineWidth = lineWidth;

      if (isEditActive) {
        if (!edgeTouchesSelection) {
          ctx.globalAlpha = 0.08;
        } else if (isLateralEdge) {
          ctx.globalAlpha = 0.72;
        } else {
          ctx.globalAlpha = 0.56;
        }
      }

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
      if (connectModeRef.current === "parent") {
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(200, 115, 74, 0.82)";
      } else {
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(74, 138, 200, 0.75)";
      }
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }

      /* ── Draw nodes ── */
    simNodes.forEach((node) => {
      if (!visibleNodeIds.has(node.id)) return;

      const isCenter = node.id === centerNodeId;
      const isSearched = hasSearch && searchMatchIds.has(node.id);
      const isEditSelected =
        isEditActive &&
        ((node.id === centerNodeId && editSelectionSet.has(GRAPH_TOP_LEVEL_TARGET_ID)) ||
          editSelectionSet.has(node.id));
      const isEditAnchor = Boolean(isEditActive && activeNodeId === node.id);
      const isEditSelectable = Boolean(isEditActive && selectableNodeIds.has(node.id));
      const isFaded =
        (hasSearch && !isSearched && !isCenter) ||
        (isEditActive && !isEditAnchor && !isEditSelected && !isEditSelectable);

      if (isFaded) ctx.globalAlpha = 0.3;

      if (isSearched || isEditSelected || isEditAnchor) {
        ctx.save();
        ctx.shadowColor = isEditAnchor
          ? "rgba(255, 146, 90, 0.92)"
          : isEditSelected
            ? "rgba(99, 102, 241, 0.9)"
            : isCenter
              ? COLORS.centerGradStart
              : getMemoryNodeColor(node, maxRetrievalCount);
        ctx.shadowBlur = isEditAnchor ? 24 : 18;
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

        if (isOrbitMode) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, CENTER_NODE_RADIUS + 14, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(232, 185, 140, 0.28)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        if (isEditSelectable || isEditSelected || isEditAnchor) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, CENTER_NODE_RADIUS + 9, 0, Math.PI * 2);
          ctx.strokeStyle = isEditAnchor
            ? "rgba(255, 255, 255, 0.96)"
            : isEditSelected
              ? "rgba(99, 102, 241, 0.82)"
              : "rgba(99, 102, 241, 0.34)";
          ctx.lineWidth = isEditAnchor ? 2.4 : 1.8;
          ctx.stroke();
        }

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
        if (isOrbitMode) {
          ctx.beginPath();
          ctx.ellipse(
            node.x,
            node.y + radius * 0.95,
            Math.max(5, radius * 0.92),
            Math.max(3, radius * 0.32),
            0,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = "rgba(73, 48, 30, 0.12)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        if (isOrbitMode) {
          const fillGradient = ctx.createRadialGradient(
            node.x - radius * 0.35,
            node.y - radius * 0.45,
            Math.max(1, radius * 0.15),
            node.x,
            node.y,
            radius,
          );
          fillGradient.addColorStop(0, d3.interpolateRgb(color, "#fff4eb")(0.34));
          fillGradient.addColorStop(0.58, color);
          fillGradient.addColorStop(1, d3.interpolateRgb(color, "#6a3921")(0.18));
          ctx.fillStyle = fillGradient;
        } else {
          ctx.fillStyle = color;
        }
        ctx.fill();

        if (node.type === "temporary") {
          ctx.setLineDash([4, 3]);
        }
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = getMemoryNodeRole(node) === "summary" ? 2.4 : 1.5;
        ctx.stroke();
        ctx.setLineDash([]);

        if (isEditSelectable && !isEditSelected && !isEditAnchor) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 7, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(99, 102, 241, 0.34)";
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        if (isEditSelected || isEditAnchor) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, radius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = isEditAnchor ? "rgba(255, 255, 255, 0.96)" : "rgba(99, 102, 241, 0.82)";
          ctx.lineWidth = isEditAnchor ? 2.2 : 1.8;
          ctx.stroke();
        }

        if (getMemoryNodeRole(node) === "summary") {
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

      if (isSearched || isEditSelected || isEditAnchor) {
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
        : isOrbitMode
          ? "rgba(49, 30, 20, 0.92)"
          : "#2a2018";
      ctx.font = isOrbitMode ? "600 11.5px sans-serif" : "11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(label, node.x, labelY);

      ctx.globalAlpha = 1;
    });

    ctx.restore();
  }, [
    centerNodeId,
    centerNodeLabel,
    centerNodeShortLabel,
    editMode,
    editSelectionSet,
    isOrbitMode,
    maxRetrievalCount,
    searchMatchIds,
    selectableNodeIds,
    selectedNode,
    simNodeById,
    simLinks,
    simNodes,
    visibleNodeIds,
  ]);

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
            const sourceId =
              typeof link.source === "object" ? link.source.id : String(link.source);
            const targetId =
              typeof link.target === "object" ? link.target.id : String(link.target);
            const isStructuralCenterEdge =
              link.edge_type === "center" ||
              isCenterStructuralTreeEdgePair(simNodeById, sourceId, targetId, centerNodeId);
            const isStructuralParentEdge =
              link.edge_type === "parent" ||
              (isStructuralTreeEdgePair(simNodeById, sourceId, targetId, centerNodeId) &&
                !isStructuralCenterEdge);
            if (link.edge_type === "file") {
              return FILE_LINK_DISTANCE;
            }
            if (isStructuralParentEdge) {
              return isOrbitMode ? PARENT_LINK_DISTANCE + 10 : PARENT_LINK_DISTANCE;
            }
            if (isStructuralCenterEdge) {
              return isOrbitMode ? CENTER_LINK_DISTANCE + 6 : CENTER_LINK_DISTANCE - 16;
            }
            if (link.edge_type === "related") {
              return isOrbitMode ? 148 : 134;
            }
            if (link.edge_type === "manual") {
              return isOrbitMode ? 140 : 126;
            }
            return 100;
          })
          .strength((link) => {
            const sourceId =
              typeof link.source === "object" ? link.source.id : String(link.source);
            const targetId =
              typeof link.target === "object" ? link.target.id : String(link.target);
            const isStructuralCenterEdge =
              link.edge_type === "center" ||
              isCenterStructuralTreeEdgePair(simNodeById, sourceId, targetId, centerNodeId);
            const isStructuralParentEdge =
              link.edge_type === "parent" ||
              (isStructuralTreeEdgePair(simNodeById, sourceId, targetId, centerNodeId) &&
                !isStructuralCenterEdge);
            if (link.edge_type === "file") {
              return 0.9;
            }
            if (isStructuralParentEdge) {
              return isOrbitMode ? 0.42 : 0.48;
            }
            if (isStructuralCenterEdge) {
              return Math.max(isOrbitMode ? 0.12 : 0.14, link.strength * (isOrbitMode ? 0.18 : 0.22));
            }
            if (link.edge_type === "related") {
              return Math.max(isOrbitMode ? 0.1 : 0.12, link.strength * (isOrbitMode ? 0.16 : 0.18));
            }
            if (link.edge_type === "manual") {
              return Math.max(0.16, link.strength * (isOrbitMode ? 0.22 : 0.26));
            }
            return Math.max(0.18, link.strength * 0.3);
          })
      )
      .force(
        "charge",
        d3.forceManyBody<SimNode>().strength((node) => {
          if (node.id === centerNodeId) {
            return isOrbitMode ? -280 : -220;
          }
          if (isFileMemoryNode(node)) {
            return -12;
          }
          return getMemoryNodeRole(node) === "structure"
            ? (isOrbitMode ? -178 : -140)
            : getMemoryNodeRole(node) === "theme"
              ? (isOrbitMode ? -188 : -150)
              : (isOrbitMode ? -196 : -160);
        }),
      )
      .force("collide", d3.forceCollide<SimNode>((d) => nodeRadius(d, d.id === centerNodeId) + 8))
      .force("treeScaffold", createTreeScaffoldForce(centerNodeId))
      .force("fileAttachment", createFileAttachmentForce(centerNodeId))
      .alphaDecay(isOrbitMode ? 0.018 : 0.02)
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
      if (!node || !canGraphRepositionNode(node, centerNodeId)) return;
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
      if (editModeRef.current && selectedNodeRef.current) {
        if (
          node &&
          (
            selectableNodeIdsRef.current.has(node.id) ||
            (editModeRef.current === "parent" && node.id === centerNodeId)
          )
        ) {
          suppressClickRef.current = true;
        }
        return;
      }
      if ((e.shiftKey || e.altKey) && node && canGraphRepositionNode(node, centerNodeId)) {
        const t = transformRef.current;
        connectStartRef.current = node;
        connectModeRef.current = e.altKey ? "manual" : "parent";
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
      if (node && canGraphRepositionNode(node, centerNodeId)) {
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
      if (editModeRef.current) {
        return;
      }
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
      if (editModeRef.current && selectedNodeRef.current) {
        return;
      }
      if (connectStartRef.current) {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const sourceNode = connectStartRef.current;
        const connectMode = connectModeRef.current;
        const targetNode = hitTestDirect(mx, my);
        connectStartRef.current = null;
        connectModeRef.current = null;
        connectPointerRef.current = null;
        if (connectMode === "parent") {
          if (targetNode?.id === centerNodeId) {
            onUpdateMemory(sourceNode.id, { parent_memory_id: null }).catch(() => {});
          } else if (
            targetNode &&
            sourceNode.id !== targetNode.id &&
            !isFileMemoryNode(targetNode) &&
            canPrimaryParentChildren(targetNode)
          ) {
            onUpdateMemory(sourceNode.id, { parent_memory_id: targetNode.id }).catch(() => {});
          } else if (targetNode && !isFileMemoryNode(targetNode)) {
            void modal.alert(t("graph.invalidParentTarget"));
          }
        } else if (
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
        if (!editMode || !selectedNode) {
          return;
        }
      }
      // Only handle clicks on blank canvas (not on nodes which are handled via drag flow)
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const node = hitTestDirect(mx, my);
      if (editModeRef.current && selectedNodeRef.current) {
        if (!node) {
          return;
        }
        if (editModeRef.current === "parent" && node.id === centerNodeId) {
          setEditSelectionIds([GRAPH_TOP_LEVEL_TARGET_ID]);
          return;
        }
        if (!selectableNodeIdsRef.current.has(node.id)) {
          return;
        }
        if (editModeRef.current === "parent") {
          setEditSelectionIds([node.id]);
          return;
        }
        setEditSelectionIds((current) =>
          current.includes(node.id)
            ? current.filter((candidateId) => candidateId !== node.id)
            : [...current, node.id],
        );
        return;
      }
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
      if (editModeRef.current) {
        return;
      }
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
  }, [
    centerNodeId,
    isOrbitMode,
    onCenterNodeClick,
    onCreateEdge,
    onNodeSelect,
    onUpdateMemory,
    openCreateMemoryDialog,
    simLinks,
    simNodeById,
    simNodes,
  ]);

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
          getGraphNodeDisplayType(node) === "memory",
      ).length,
    [nodes, searchMatchIds, visibleNodeIds],
  );
  const branchCount = useMemo(() => {
    const branchIds = new Set<string>();
    nodes.forEach((node) => {
      if (
        !visibleNodeIds.has(node.id) ||
        (searchMatchIds !== null && !searchMatchIds.has(node.id)) ||
        isFileMemoryNode(node) ||
        node.id === centerNodeId
      ) {
        return;
      }
      const parentId = node.parent_memory_id;
      if (!parentId || parentId === centerNodeId) {
        branchIds.add(node.id);
      }
    });
    return branchIds.size;
  }, [centerNodeId, nodes, searchMatchIds, visibleNodeIds]);
  const relatedCount = useMemo(
    () =>
      simLinks.filter((link) => {
        const source = link.source as SimNode;
        const target = link.target as SimNode;
        return (
          visibleNodeIds.has(source.id) &&
          visibleNodeIds.has(target.id) &&
          (!searchMatchIds || (searchMatchIds.has(source.id) || searchMatchIds.has(target.id))) &&
          (link.edge_type === "manual" || link.edge_type === "related")
        );
      }).length,
    [searchMatchIds, simLinks, visibleNodeIds],
  );
  const temporaryCount = useMemo(
    () =>
      nodes.filter(
        (node) =>
          visibleNodeIds.has(node.id) &&
          (!searchMatchIds || searchMatchIds.has(node.id)) &&
          !isFileMemoryNode(node) &&
          node.type === "temporary",
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
    <div className={`graph-container graph-container--${renderMode}`}>
      <GraphFilters
        nodes={nodes}
        activeFilters={filterState}
        onFilterChange={setFilterState}
        collapsed={filtersCollapsed}
        onToggleCollapsed={() => setFiltersCollapsed((value) => !value)}
      />

      <div className={`graph-main graph-main--${renderMode}`}>
        <div className="graph-atmosphere" aria-hidden="true">
          <span className="graph-atmosphere-orb is-primary" />
          <span className="graph-atmosphere-orb is-secondary" />
          <span className="graph-atmosphere-grid" />
        </div>
        <div className={`graph-mode-hud graph-mode-hud--${renderMode}`}>
          <span className="graph-mode-hud-kicker">
            {isOrbitMode ? t("graph.modeOrbit") : t("graph.modeWorkbench")}
          </span>
        </div>

        <canvas
          ref={canvasRef}
          className="graph-canvas"
        />

        {selectedNode && editMode ? (
          <div className="graph-edit-banner">
            <div className="graph-edit-banner-copy">
              <span className="graph-edit-banner-kicker">
                {editMode === "parent"
                  ? t("graph.selectionParentTitle")
                  : editMode === "children"
                    ? t("graph.selectionChildrenTitle")
                    : t("graph.selectionRelatedTitle")}
              </span>
              <p className="graph-edit-banner-text">
                {editMode === "parent"
                  ? t("graph.selectionParentDescription")
                  : editMode === "children"
                    ? t("graph.selectionChildrenDescription")
                    : t("graph.selectionRelatedDescription")}
              </p>
            </div>
            <div className="graph-edit-banner-actions">
              <button
                type="button"
                className="graph-controls-btn"
                onClick={clearEditSelection}
                disabled={editPending}
              >
                {t("graph.clearSelection")}
              </button>
              <button
                type="button"
                className="graph-controls-btn"
                onClick={cancelEditMode}
                disabled={editPending}
              >
                {t("graph.cancel")}
              </button>
              <button
                type="button"
                className="graph-controls-btn is-add"
                onClick={() => void applyEditMode()}
                disabled={editPending}
              >
                {editPending ? t("graph.applyingSelection") : t("graph.applySelection")}
              </button>
            </div>
          </div>
        ) : null}

        <GraphControls
          nodeCount={memoryCount}
          fileCount={fileCount}
          branchCount={branchCount}
          relatedCount={relatedCount}
          temporaryCount={temporaryCount}
          renderMode={renderMode}
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
            cancelEditMode();
            setSelectedNode(null);
            onNodeSelect(null);
          }}
          onFocusNode={(node) => {
            cancelEditMode();
            setSelectedNode(node);
            onNodeSelect(node);
          }}
          onUpdate={onUpdateMemory}
          onDelete={onDeleteMemory}
          onPromote={onPromoteMemory}
          onDeleteEdge={onDeleteEdge}
          onAttachFile={onAttachFile}
          onDetachFile={onDetachFile}
          editMode={editMode}
          editSelectionIds={editSelectionIds}
          editPending={editPending}
          topLevelSelectionId={GRAPH_TOP_LEVEL_TARGET_ID}
          onBeginEditMode={beginEditMode}
          onCancelEditMode={cancelEditMode}
          onClearEditModeSelection={clearEditSelection}
          onApplyEditMode={applyEditMode}
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
