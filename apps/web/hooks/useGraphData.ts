"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { getApiHttpBaseUrl } from "@/lib/env";

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
  metadata_json: Record<string, unknown>;
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

export function isOrdinaryMemoryNode(node: MemoryNode): boolean {
  return !isFileMemoryNode(node) && !isAssistantRootMemoryNode(node);
}

export interface MemoryEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  edge_type: "auto" | "manual";
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
      (node.metadata_json as Record<string, unknown> | undefined) ||
      previous?.metadata_json ||
      {},
    created_at: node.created_at || previous?.created_at || now,
    updated_at: node.updated_at || previous?.updated_at || node.created_at || now,
  };
}

export function useGraphData(projectId: string, conversationId?: string) {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  const fetchGraph = useCallback(async () => {
    if (!projectId) {
      setData({ nodes: [], edges: [] });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ project_id: projectId });
      if (conversationId) params.set("conversation_id", conversationId);
      const result = await apiGet<GraphData>(`/api/v1/memory?${params}`);
      setData(result);
    } catch {
      // show empty graph on error
      setData({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, [projectId, conversationId]);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

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
            ...prev,
            nodes: prev.nodes.some((node) => node.id === newNode.id)
              ? prev.nodes.map((node) =>
                  node.id === newNode.id
                    ? normalizeStreamNode(newNode, { projectId, previous: node })
                    : node,
                )
              : [...prev.nodes, normalizeStreamNode(newNode, { projectId })],
          }));
        } catch { /* ignore parse errors */ }
      });

      eventSource.addEventListener("memory_promoted", (event) => {
        try {
          const { id } = JSON.parse(event.data);
          setData((prev) => ({
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === id
                ? { ...n, type: "permanent" as const, updated_at: new Date().toISOString() }
                : n
            ),
          }));
        } catch { /* ignore parse errors */ }
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
  }, [conversationId, loading, projectId]);

  const createMemory = async (content: string, category?: string) => {
    const node = await apiPost<MemoryNode>("/api/v1/memory", {
      project_id: projectId, content, category: category || "",
    });
    setData((prev) => ({ ...prev, nodes: [...prev.nodes, node] }));
    return node;
  };

  const updateMemory = async (id: string, updates: Partial<MemoryNode>) => {
    const updated = await apiPatch<MemoryNode>(`/api/v1/memory/${id}`, updates);
    setData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updated } : n)),
    }));
  };

  const deleteMemory = async (id: string) => {
    await apiDelete(`/api/v1/memory/${id}`);
    setData((prev) => ({
      nodes: prev.nodes.filter((n) => n.id !== id),
      edges: prev.edges.filter((e) => e.source_memory_id !== id && e.target_memory_id !== id),
    }));
  };

  const promoteMemory = async (id: string) => {
    const updated = await apiPost<MemoryNode>(`/api/v1/memory/${id}/promote`);
    setData((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updated } : n)),
    }));
  };

  const createEdge = async (sourceId: string, targetId: string) => {
    const edge = await apiPost<MemoryEdge>("/api/v1/memory/edges", {
      source_memory_id: sourceId, target_memory_id: targetId,
    });
    setData((prev) => ({ ...prev, edges: [...prev.edges, edge] }));
  };

  const deleteEdge = async (id: string) => {
    await apiDelete(`/api/v1/memory/edges/${id}`);
    setData((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== id),
    }));
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
