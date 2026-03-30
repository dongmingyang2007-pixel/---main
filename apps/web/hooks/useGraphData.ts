"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getApiHttpBaseUrl } from "@/lib/env";

export type MemoryKind =
  | "profile"
  | "preference"
  | "goal"
  | "episodic"
  | "fact"
  | "summary";

export type GraphNodeDisplayType = "center" | "memory" | "file";
export type MemoryNodeRole = "fact" | "structure" | "theme" | "summary";

export interface MemoryMetadataJson extends Record<string, unknown> {
  memory_kind?: MemoryKind;
  node_kind?: string;
  concept_source?: string;
  parent_binding?: "auto" | "manual" | string;
  manual_parent_id?: string | null;
  pinned?: boolean;
  salience?: number;
  importance?: number;
  last_used_at?: string;
  last_used_source?: string;
  last_retrieval_score?: number;
  retrieval_count?: number;
  source_count?: number;
  source_memory_ids?: string[];
  summary_group_key?: string;
  visibility?: "public" | "private" | string;
  owner_user_id?: string;
  auto_generated?: boolean;
  promoted_by?: string;
  structural_only?: boolean;
  category_path?: string;
  category_label?: string;
  category_segments?: string[];
  category_prefixes?: string[];
  category_depth?: number;
  synthetic_graph_node?: boolean;
  graph_parent_memory_id?: string | null;
}

export interface MemoryNode {
  id: string;
  workspace_id: string;
  project_id: string;
  content: string;
  category: string;
  type: "permanent" | "temporary";
  source_conversation_id: string | null;
  parent_memory_id: string | null;
  position_x: number | null;
  position_y: number | null;
  metadata_json: MemoryMetadataJson;
  created_at: string;
  updated_at: string;
  // D3 simulation fields (added at runtime)
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export function isFileMemoryNode(node: MemoryNode): boolean {
  return (
    node.category === "file" ||
    node.category === "文件" ||
    node.metadata_json?.node_kind === "file"
  );
}

export function isAssistantRootMemoryNode(node: MemoryNode): boolean {
  return node.metadata_json?.node_kind === "assistant-root";
}

export function getGraphNodeDisplayType(
  node: MemoryNode | MemoryMetadataJson | null | undefined,
): GraphNodeDisplayType {
  const metadata = getMemoryMetadata(node);
  const nodeKind = metadata.node_kind;
  if (nodeKind === "assistant-root" || nodeKind === "assistant-center") {
    return "center";
  }
  if (
    nodeKind === "file" ||
    ("category" in (node || {}) &&
      (node as MemoryNode).category &&
      ((node as MemoryNode).category === "file" || (node as MemoryNode).category === "文件"))
  ) {
    return "file";
  }
  return "memory";
}

export function isConceptMemoryNode(node: MemoryNode | MemoryMetadataJson): boolean {
  return getMemoryMetadata(node).node_kind === "concept";
}

export function isCategoryPathMemoryNode(node: MemoryNode | MemoryMetadataJson): boolean {
  const metadata = getMemoryMetadata(node);
  return metadata.node_kind === "category-path" || metadata.concept_source === "category_path";
}

export function isStructuralOnlyMemoryNode(node: MemoryNode | MemoryMetadataJson): boolean {
  const metadata = getMemoryMetadata(node);
  return metadata.structural_only === true || isCategoryPathMemoryNode(metadata);
}

export function isSyntheticGraphNode(node: MemoryNode | MemoryMetadataJson): boolean {
  return getMemoryMetadata(node).synthetic_graph_node === true;
}

export function getMemoryNodeRole(
  node: MemoryNode | MemoryMetadataJson | null | undefined,
): MemoryNodeRole | null {
  if (getGraphNodeDisplayType(node) !== "memory") {
    return null;
  }
  const metadata = getMemoryMetadata(node);
  if (isCategoryPathMemoryNode(metadata) || metadata.structural_only === true) {
    return "structure";
  }
  if (isConceptMemoryNode(metadata)) {
    return "theme";
  }
  if (isSummaryMemoryNode(metadata)) {
    return "summary";
  }
  return "fact";
}

export function isMemoryDisplayNode(
  node: MemoryNode | MemoryMetadataJson | null | undefined,
): boolean {
  return getGraphNodeDisplayType(node) === "memory";
}

export function isStructureMemoryNode(
  node: MemoryNode | MemoryMetadataJson | null | undefined,
): boolean {
  return getMemoryNodeRole(node) === "structure";
}

export function isThemeMemoryNode(
  node: MemoryNode | MemoryMetadataJson | null | undefined,
): boolean {
  return getMemoryNodeRole(node) === "theme";
}

export function isFactMemoryNode(
  node: MemoryNode | MemoryMetadataJson | null | undefined,
): boolean {
  return getMemoryNodeRole(node) === "fact";
}

export function isOrdinaryMemoryNode(node: MemoryNode): boolean {
  return isFactMemoryNode(node);
}

export function getMemoryMetadata(
  value: MemoryNode | MemoryMetadataJson | null | undefined,
): MemoryMetadataJson {
  if (!value || typeof value !== "object") {
    return {};
  }
  if ("metadata_json" in value && value.metadata_json && typeof value.metadata_json === "object") {
    return value.metadata_json as MemoryMetadataJson;
  }
  return value as MemoryMetadataJson;
}

export function getMemoryKind(node: MemoryNode | MemoryMetadataJson): MemoryKind | null {
  const metadata = getMemoryMetadata(node);
  const kind = metadata.memory_kind;
  return typeof kind === "string" && kind.length > 0 ? kind : null;
}

export function getMemoryParentBinding(node: MemoryNode | MemoryMetadataJson): "auto" | "manual" {
  const value = getMemoryMetadata(node).parent_binding;
  return value === "manual" ? "manual" : "auto";
}

export function hasManualParentBinding(node: MemoryNode | MemoryMetadataJson): boolean {
  return getMemoryParentBinding(node) === "manual";
}

export function isSummaryMemoryNode(node: MemoryNode | MemoryMetadataJson): boolean {
  const metadata = getMemoryMetadata(node);
  return metadata.node_kind === "summary" || metadata.memory_kind === "summary";
}

export function canPrimaryParentChildren(node: MemoryNode | MemoryMetadataJson): boolean {
  const displayType = getGraphNodeDisplayType(node);
  if (displayType === "center") {
    return true;
  }
  if (displayType !== "memory") {
    return false;
  }
  const role = getMemoryNodeRole(node);
  return role === "structure" || role === "theme" || role === "summary";
}

export function isPinnedMemoryNode(node: MemoryNode | MemoryMetadataJson): boolean {
  return getMemoryMetadata(node).pinned === true;
}

export function getMemorySalience(node: MemoryNode | MemoryMetadataJson): number | null {
  const salience = getMemoryMetadata(node).salience;
  return typeof salience === "number" && Number.isFinite(salience) ? salience : null;
}

export function getMemoryRetrievalCount(node: MemoryNode | MemoryMetadataJson): number {
  const count = getMemoryMetadata(node).retrieval_count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

export function getMemoryCategorySegments(node: MemoryNode | MemoryMetadataJson): string[] {
  const metadata = getMemoryMetadata(node);
  const segments = metadata.category_segments;
  if (Array.isArray(segments)) {
    return segments.filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  if ("category" in node && typeof node.category === "string") {
    return node.category.split(".").map((segment) => segment.trim()).filter(Boolean);
  }
  return [];
}

export function getMemoryCategoryPrefixes(node: MemoryNode | MemoryMetadataJson): string[] {
  const metadata = getMemoryMetadata(node);
  const prefixes = metadata.category_prefixes;
  if (Array.isArray(prefixes)) {
    return prefixes.filter((value): value is string => typeof value === "string" && value.length > 0);
  }
  const segments = getMemoryCategorySegments(node);
  const values: string[] = [];
  const parts: string[] = [];
  segments.forEach((segment) => {
    parts.push(segment);
    values.push(parts.join("."));
  });
  return values;
}

export function getMemoryCategoryLabel(node: MemoryNode | MemoryMetadataJson): string {
  const metadata = getMemoryMetadata(node);
  if (typeof metadata.category_label === "string" && metadata.category_label.trim()) {
    return metadata.category_label.trim();
  }
  const segments = getMemoryCategorySegments(node);
  return segments[segments.length - 1] || "";
}

export function getMemoryCategoryPath(node: MemoryNode | MemoryMetadataJson): string {
  const metadata = getMemoryMetadata(node);
  if (typeof metadata.category_path === "string" && metadata.category_path.trim()) {
    return metadata.category_path.trim();
  }
  const prefixes = getMemoryCategoryPrefixes(node);
  return prefixes[prefixes.length - 1] || "";
}

export function getMemoryLastUsedAt(node: MemoryNode | MemoryMetadataJson): string | null {
  const value = getMemoryMetadata(node).last_used_at;
  return typeof value === "string" && value ? value : null;
}

export function getMemoryLastUsedSource(node: MemoryNode | MemoryMetadataJson): string | null {
  const value = getMemoryMetadata(node).last_used_source;
  return typeof value === "string" && value ? value : null;
}

export function getSummarySourceCount(node: MemoryNode | MemoryMetadataJson): number {
  const value = getMemoryMetadata(node).source_count;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export interface MemoryEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  edge_type: "auto" | "manual" | "related" | "summary" | "file" | "center";
  strength: number;
  created_at: string;
  // D3 fields
  source?: string | MemoryNode;
  target?: string | MemoryNode;
}

export interface MemoryFileAttachment {
  id: string;
  memory_id: string;
  data_item_id: string;
  filename?: string | null;
  media_type?: string | null;
  created_at: string;
}

interface GraphData {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

function clearGraphOnlyMetadata(node: MemoryNode): MemoryNode {
  if (!("graph_parent_memory_id" in node.metadata_json)) {
    return node;
  }
  const metadata = { ...node.metadata_json };
  delete metadata.graph_parent_memory_id;
  return {
    ...node,
    metadata_json: metadata,
  };
}

function buildSyntheticCategoryNodeId(projectId: string, categoryPath: string): string {
  return `__graph_category__:${projectId}:${categoryPath}`;
}

function augmentGraphDataWithCategoryBranches(raw: GraphData): GraphData {
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const rawEdges = Array.isArray(raw.edges) ? raw.edges : [];
  const baseNodes = rawNodes
    .filter((node) => !isSyntheticGraphNode(node))
    .map(clearGraphOnlyMetadata);
  const baseEdges = rawEdges.filter((edge) => !edge.id.startsWith("graph-category:"));
  if (baseNodes.length === 0) {
    return { nodes: baseNodes, edges: baseEdges };
  }

  const assistantRootNode = baseNodes.find((node) => isAssistantRootMemoryNode(node)) ?? null;
  const seedNode = assistantRootNode ?? baseNodes[0];
  const baseNodeById = new Map(baseNodes.map((node) => [node.id, node]));
  const fallbackTimestamp =
    baseNodes
      .map((node) => node.updated_at || node.created_at)
      .find((value) => typeof value === "string" && value.length > 0) || new Date().toISOString();

  const categoryNodeByPath = new Map<string, MemoryNode>();
  baseNodes.forEach((node) => {
    if (!isCategoryPathMemoryNode(node)) {
      return;
    }
    const categoryPath = getMemoryCategoryPath(node);
    if (!categoryPath) {
      return;
    }
    categoryNodeByPath.set(categoryPath, node);
  });

  const requiredCategoryPaths = new Set<string>();
  baseNodes.forEach((node) => {
    if (!isOrdinaryMemoryNode(node)) {
      return;
    }
    getMemoryCategoryPrefixes(node).forEach((prefix) => requiredCategoryPaths.add(prefix));
  });

  const syntheticNodes: MemoryNode[] = [];

  const ensureCategoryNode = (categoryPath: string): MemoryNode | null => {
    if (!categoryPath) {
      return null;
    }
    const existing = categoryNodeByPath.get(categoryPath);
    if (existing) {
      return existing;
    }

    const segments = categoryPath
      .split(".")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.length === 0) {
      return null;
    }

    const parentPath = segments.slice(0, -1).join(".");
    const parentNode = parentPath ? ensureCategoryNode(parentPath) : assistantRootNode;
    const syntheticNode: MemoryNode = {
      id: buildSyntheticCategoryNodeId(seedNode.project_id, categoryPath),
      workspace_id: seedNode.workspace_id,
      project_id: seedNode.project_id,
      content: segments[segments.length - 1],
      category: categoryPath,
      type: "permanent",
      source_conversation_id: null,
      parent_memory_id: parentNode?.id ?? null,
      position_x: null,
      position_y: null,
      metadata_json: {
        node_kind: "category-path",
        concept_source: "category_path",
        structural_only: true,
        auto_generated: true,
        synthetic_graph_node: true,
        parent_binding: "auto",
        category_path: categoryPath,
        category_label: segments[segments.length - 1],
        category_segments: segments,
        category_prefixes: segments.map((_, index) => segments.slice(0, index + 1).join(".")),
        category_depth: Math.max(0, segments.length - 1),
      },
      created_at: fallbackTimestamp,
      updated_at: fallbackTimestamp,
    };
    categoryNodeByPath.set(categoryPath, syntheticNode);
    syntheticNodes.push(syntheticNode);
    return syntheticNode;
  };

  [...requiredCategoryPaths]
    .sort(
      (left, right) =>
        left.split(".").length - right.split(".").length || left.localeCompare(right),
    )
    .forEach((categoryPath) => {
      ensureCategoryNode(categoryPath);
    });

  const augmentedNodes = baseNodes.map((node) => {
    const metadata = { ...node.metadata_json };
    let graphParentId: string | null = null;

    if (isCategoryPathMemoryNode(node)) {
      const categoryPath = getMemoryCategoryPath(node);
      const segments = categoryPath
        .split(".")
        .map((segment) => segment.trim())
        .filter(Boolean);
      const parentPath = segments.slice(0, -1).join(".");
      graphParentId = parentPath
        ? categoryNodeByPath.get(parentPath)?.id ?? null
        : assistantRootNode?.id ?? null;
    } else if (isOrdinaryMemoryNode(node)) {
      const actualParent = node.parent_memory_id
        ? baseNodeById.get(node.parent_memory_id) ?? null
        : null;
      const categoryPath = getMemoryCategoryPath(node);
      const categoryNode = categoryPath ? categoryNodeByPath.get(categoryPath) ?? null : null;
      if (!actualParent || isAssistantRootMemoryNode(actualParent)) {
        graphParentId = categoryNode?.id ?? null;
      } else if (isCategoryPathMemoryNode(actualParent)) {
        graphParentId = actualParent.id;
      }
    }

    if (graphParentId) {
      metadata.graph_parent_memory_id = graphParentId;
      return {
        ...node,
        metadata_json: metadata,
      };
    }
    return node;
  });

  return {
    nodes: [...augmentedNodes, ...syntheticNodes],
    edges: baseEdges,
  };
}

interface NormalizeStreamNodeOptions {
  projectId: string;
  previous?: MemoryNode;
}

function normalizeStreamNode(
  node: Partial<MemoryNode>,
  options: NormalizeStreamNodeOptions,
): MemoryNode {
  const { projectId, previous } = options;
  const now = new Date().toISOString();
  return {
    id: node.id || previous?.id || "",
    workspace_id: node.workspace_id || previous?.workspace_id || "",
    project_id: node.project_id || previous?.project_id || projectId,
    content: node.content || previous?.content || "",
    category: node.category || previous?.category || "",
    type: node.type || previous?.type || "temporary",
    source_conversation_id:
      node.source_conversation_id !== undefined
        ? node.source_conversation_id
        : (previous?.source_conversation_id ?? null),
    parent_memory_id:
      node.parent_memory_id !== undefined
        ? node.parent_memory_id
        : (previous?.parent_memory_id ?? null),
    position_x:
      node.position_x !== undefined ? node.position_x : (previous?.position_x ?? null),
    position_y:
      node.position_y !== undefined ? node.position_y : (previous?.position_y ?? null),
    metadata_json:
      (node.metadata_json as MemoryMetadataJson | undefined) ||
      previous?.metadata_json ||
      {},
    created_at: node.created_at || previous?.created_at || now,
    updated_at: node.updated_at || previous?.updated_at || node.created_at || now,
  };
}

interface UseGraphDataOptions {
  conversationId?: string;
  includeTemporary?: boolean;
}

export function useGraphData(projectId: string, options: UseGraphDataOptions = {}) {
  const { conversationId, includeTemporary = false } = options;
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const silentRefreshTimerRef = useRef<number | null>(null);
  const fetchRequestSeqRef = useRef(0);
  const activeFetchControllerRef = useRef<AbortController | null>(null);

  const cancelActiveFetch = useCallback(() => {
    activeFetchControllerRef.current?.abort();
    activeFetchControllerRef.current = null;
  }, []);

  const fetchGraph = useCallback(async (options?: { silent?: boolean }) => {
    if (!projectId) {
      cancelActiveFetch();
      setData({ nodes: [], edges: [] });
      setLoading(false);
      return;
    }
    cancelActiveFetch();
    const requestSeq = ++fetchRequestSeqRef.current;
    const controller = new AbortController();
    activeFetchControllerRef.current = controller;
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const params = new URLSearchParams({ project_id: projectId });
      if (conversationId) params.set("conversation_id", conversationId);
      if (includeTemporary) params.set("include_temporary", "true");
      const result = await apiGet<GraphData>(`/api/v1/memory?${params}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || fetchRequestSeqRef.current !== requestSeq) {
        return;
      }
      setData(augmentGraphDataWithCategoryBranches(result));
    } catch (error) {
      if (
        controller.signal.aborted ||
        fetchRequestSeqRef.current !== requestSeq ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      // show empty graph on error
      setData({ nodes: [], edges: [] });
    } finally {
      if (activeFetchControllerRef.current === controller) {
        activeFetchControllerRef.current = null;
      }
      if (!options?.silent && fetchRequestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [cancelActiveFetch, conversationId, includeTemporary, projectId]);

  const scheduleSilentGraphRefresh = useCallback((delayMs = 180) => {
    if (silentRefreshTimerRef.current !== null) {
      window.clearTimeout(silentRefreshTimerRef.current);
    }
    silentRefreshTimerRef.current = window.setTimeout(() => {
      silentRefreshTimerRef.current = null;
      void fetchGraph({ silent: true });
    }, delayMs);
  }, [fetchGraph]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  useEffect(
    () => () => {
      cancelActiveFetch();
      if (silentRefreshTimerRef.current !== null) {
        window.clearTimeout(silentRefreshTimerRef.current);
        silentRefreshTimerRef.current = null;
      }
    },
    [cancelActiveFetch, fetchGraph],
  );

  // SSE subscription for real-time memory updates
  useEffect(() => {
    if (!projectId || loading) return;

    let eventSource: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      const apiBase = getApiHttpBaseUrl();
      const streamPath = conversationId
        ? `/api/v1/chat/conversations/${conversationId}/memory-stream`
        : `/api/v1/memory/${projectId}/stream`;
      eventSource = new EventSource(`${apiBase}${streamPath}`, { withCredentials: true });

      eventSource.addEventListener("new_memory", (event) => {
        try {
          const newNode = JSON.parse(event.data) as Partial<MemoryNode>;
          if (
            conversationId &&
            newNode.type === "temporary" &&
            newNode.source_conversation_id !== conversationId
          ) {
            return;
          }
          setData((prev) => ({
            ...augmentGraphDataWithCategoryBranches({
              ...prev,
              nodes: prev.nodes.some((node) => node.id === newNode.id)
                ? prev.nodes.map((node) =>
                    node.id === newNode.id
                      ? normalizeStreamNode(newNode, { projectId, previous: node })
                      : node,
                  )
                : [...prev.nodes, normalizeStreamNode(newNode, { projectId })],
            }),
          }));
          scheduleSilentGraphRefresh();
        } catch { /* ignore parse errors */ }
      });

      eventSource.addEventListener("memory_promoted", (event) => {
        try {
          const { id } = JSON.parse(event.data);
          setData((prev) => ({
            ...augmentGraphDataWithCategoryBranches({
              ...prev,
              nodes: prev.nodes.map((n) =>
                n.id === id
                  ? { ...n, type: "permanent" as const, updated_at: new Date().toISOString() }
                  : n
              ),
            }),
          }));
          scheduleSilentGraphRefresh();
        } catch { /* ignore parse errors */ }
      });

      eventSource.addEventListener("graph_changed", () => {
        scheduleSilentGraphRefresh(80);
      });

      eventSource.onerror = () => {
        // Close on error and don't auto-reconnect (avoids 401 spam)
        eventSource?.close();
        eventSource = null;
        // Retry after 30 seconds (in case auth was restored)
        retryTimeout = setTimeout(connect, 30000);
      };
    }

    connect();

    return () => {
      eventSource?.close();
      clearTimeout(retryTimeout);
    };
  }, [conversationId, loading, projectId, scheduleSilentGraphRefresh]);

  const createMemory = async (content: string, category?: string) => {
    const node = await apiPost<MemoryNode>("/api/v1/memory", {
      project_id: projectId, content, category: category || "",
    });
    await fetchGraph();
    return node;
  };

  const updateMemory = async (id: string, updates: Partial<MemoryNode>) => {
    await apiPatch<MemoryNode>(`/api/v1/memory/${id}`, updates);
    await fetchGraph();
  };

  const deleteMemory = async (id: string) => {
    await apiDelete(`/api/v1/memory/${id}`);
    await fetchGraph();
  };

  const promoteMemory = async (id: string) => {
    await apiPost<MemoryNode>(`/api/v1/memory/${id}/promote`);
    await fetchGraph();
  };

  const createEdge = async (sourceId: string, targetId: string) => {
    await apiPost<MemoryEdge>("/api/v1/memory/edges", {
      source_memory_id: sourceId, target_memory_id: targetId,
    });
    await fetchGraph();
  };

  const deleteEdge = async (id: string) => {
    await apiDelete(`/api/v1/memory/edges/${id}`);
    await fetchGraph();
  };

  const attachFileToMemory = async (memoryId: string, dataItemId: string) => {
    const file = await apiPost<MemoryFileAttachment>(`/api/v1/memory/${memoryId}/files`, {
      data_item_id: dataItemId,
    });
    await fetchGraph();
    return file;
  };

  const detachFileFromMemory = async (memoryFileId: string) => {
    await apiDelete(`/api/v1/memory/files/${memoryFileId}`);
    await fetchGraph();
  };

  return {
    data, loading, refetch: fetchGraph,
    createMemory, updateMemory, deleteMemory, promoteMemory,
    createEdge, deleteEdge,
    attachFileToMemory, detachFileFromMemory,
  };
}
