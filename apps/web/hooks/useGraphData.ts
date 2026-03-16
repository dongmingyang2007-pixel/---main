"use client";

import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

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

interface GraphData {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
}

export function useGraphData(projectId: string, conversationId?: string) {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  const fetchGraph = useCallback(async () => {
    try {
      const params = new URLSearchParams({ project_id: projectId });
      if (conversationId) params.set("conversation_id", conversationId);
      const result = await apiGet<GraphData>(`/api/v1/memory?${params}`);
      setData(result);
    } catch {
      // show empty graph on error
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
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";
      eventSource = new EventSource(
        `${apiBase}/api/v1/memory/${projectId}/stream`,
        { withCredentials: true }
      );

      eventSource.addEventListener("new_memory", (event) => {
        try {
          const newNode = JSON.parse(event.data);
          setData((prev) => ({
            ...prev,
            nodes: [...prev.nodes, newNode as MemoryNode],
          }));
        } catch { /* ignore parse errors */ }
      });

      eventSource.addEventListener("memory_promoted", (event) => {
        try {
          const { id } = JSON.parse(event.data);
          setData((prev) => ({
            ...prev,
            nodes: prev.nodes.map((n) =>
              n.id === id ? { ...n, type: "permanent" as const } : n
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
  }, [projectId, loading]);

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

  return {
    data, loading, refetch: fetchGraph,
    createMemory, updateMemory, deleteMemory, promoteMemory,
    createEdge, deleteEdge,
  };
}
