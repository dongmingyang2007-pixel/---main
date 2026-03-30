"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import {
  canPrimaryParentChildren,
  type MemoryNode,
  getGraphNodeDisplayType,
  getMemoryCategoryLabel,
  getMemoryCategorySegments,
  getMemoryKind,
  getMemoryLastUsedAt,
  getMemoryLastUsedSource,
  getMemoryNodeRole,
  getMemoryParentBinding,
  getMemoryRetrievalCount,
  getMemorySalience,
  getSummarySourceCount,
  isAssistantRootMemoryNode,
  isPinnedMemoryNode,
  isSyntheticGraphNode,
} from "@/hooks/useGraphData";
import { useDeveloperMode } from "@/lib/developer-mode";
import { useModal } from "@/components/ui/modal-dialog";

type GraphSelectionMode = "parent" | "children" | "related" | null;

interface MemoryDetailEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  edge_type: "auto" | "manual" | "related" | "summary" | "file" | "center";
  strength: number;
  created_at: string;
}

interface MemoryDetailFile {
  id: string;
  memory_id: string;
  data_item_id: string;
  filename?: string | null;
  media_type?: string | null;
  created_at: string;
}

interface MemoryDetailData extends MemoryNode {
  edges: MemoryDetailEdge[];
  files: MemoryDetailFile[];
}

interface MemoryFileCandidate {
  id: string;
  dataset_id: string;
  filename: string;
  media_type: string;
  created_at: string;
}

interface NodeDetailProps {
  node: MemoryNode;
  allNodes: MemoryNode[];
  onClose: () => void;
  onFocusNode: (node: MemoryNode) => void;
  onUpdate: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
  onDeleteEdge: (id: string) => Promise<void>;
  onAttachFile: (memoryId: string, dataItemId: string) => Promise<void>;
  onDetachFile: (memoryFileId: string) => Promise<void>;
  editMode: GraphSelectionMode;
  editSelectionIds: string[];
  editPending: boolean;
  topLevelSelectionId: string;
  onBeginEditMode: (mode: Exclude<GraphSelectionMode, null>) => void;
  onCancelEditMode: () => void;
  onClearEditModeSelection: () => void;
  onApplyEditMode: () => Promise<void>;
}

function isFileNode(node: MemoryNode): boolean {
  return node.category === "file" || node.category === "文件" || node.metadata_json?.node_kind === "file";
}

function formatMemoryKindLabel(kind: string | null, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    profile: t("graph.kindProfile"),
    preference: t("graph.kindPreference"),
    goal: t("graph.kindGoal"),
    episodic: t("graph.kindEpisodic"),
    fact: t("graph.kindFact"),
    summary: t("graph.kindSummary"),
  };
  if (!kind) {
    return t("graph.kindUnknown");
  }
  return labels[kind] || kind;
}

function formatMemoryRoleLabel(
  role: ReturnType<typeof getMemoryNodeRole>,
  t: (key: string) => string,
): string {
  const labels: Record<NonNullable<ReturnType<typeof getMemoryNodeRole>>, string> = {
    fact: t("graph.roleFact"),
    structure: t("graph.roleStructure"),
    theme: t("graph.roleTheme"),
    summary: t("graph.roleSummary"),
  };
  if (!role) {
    return t("graph.memoryNode");
  }
  return labels[role];
}

function formatEdgeTypeLabel(edgeType: MemoryDetailEdge["edge_type"], t: (key: string) => string): string {
  const labels: Record<MemoryDetailEdge["edge_type"], string> = {
    auto: t("graph.autoEdge"),
    manual: t("graph.manualEdge"),
    related: t("graph.relatedEdge"),
    summary: t("graph.summaryEdge"),
    file: t("graph.fileEdge"),
    center: t("graph.centerEdge"),
  };
  return labels[edgeType] || edgeType;
}

function formatNodeLabel(node: MemoryNode): string {
  const text = node.content.trim();
  if (text) {
    return text.length > 28 ? `${text.slice(0, 28)}...` : text;
  }
  const categoryLabel = getMemoryCategoryLabel(node);
  if (categoryLabel) {
    return categoryLabel;
  }
  return node.id.slice(0, 8);
}

function getSelectionModeTitle(
  mode: Exclude<GraphSelectionMode, null>,
  t: (key: string) => string,
): string {
  const map: Record<Exclude<GraphSelectionMode, null>, string> = {
    parent: t("graph.selectionParentTitle"),
    children: t("graph.selectionChildrenTitle"),
    related: t("graph.selectionRelatedTitle"),
  };
  return map[mode];
}

function getSelectionModeDescription(
  mode: Exclude<GraphSelectionMode, null>,
  t: (key: string) => string,
): string {
  const map: Record<Exclude<GraphSelectionMode, null>, string> = {
    parent: t("graph.selectionParentDescription"),
    children: t("graph.selectionChildrenDescription"),
    related: t("graph.selectionRelatedDescription"),
  };
  return map[mode];
}

export default function NodeDetail({
  node,
  allNodes,
  onClose,
  onFocusNode,
  onUpdate,
  onDelete,
  onPromote,
  onDeleteEdge,
  onAttachFile,
  onDetachFile,
  editMode,
  editSelectionIds,
  editPending,
  topLevelSelectionId,
  onBeginEditMode,
  onCancelEditMode,
  onClearEditModeSelection,
  onApplyEditMode,
}: NodeDetailProps) {
  const t = useTranslations("console-assistants");
  const { isDeveloperMode } = useDeveloperMode();
  const modal = useModal();
  const fileNode = getGraphNodeDisplayType(node) === "file";
  const memoryRole = getMemoryNodeRole(node);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(node.content);
  const [editCategory, setEditCategory] = useState(node.category);
  const [detail, setDetail] = useState<MemoryDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(!fileNode);
  const [availableFiles, setAvailableFiles] = useState<MemoryFileCandidate[]>([]);
  const [loadingAvailableFiles, setLoadingAvailableFiles] = useState(!fileNode);
  const [selectedFileId, setSelectedFileId] = useState("");
  const detailRequestSeqRef = useRef(0);
  const detailAbortControllerRef = useRef<AbortController | null>(null);
  const availableFilesRequestSeqRef = useRef(0);
  const availableFilesAbortControllerRef = useRef<AbortController | null>(null);

  const fileMetadata = (node.metadata_json || {}) as Record<string, unknown>;
  const memoryKind = getMemoryKind(node);
  const retrievalCount = getMemoryRetrievalCount(node);
  const salience = getMemorySalience(node);
  const lastUsedAt = getMemoryLastUsedAt(node);
  const lastUsedSource = getMemoryLastUsedSource(node);
  const summarySourceCount = getSummarySourceCount(node);
  const summaryNode = memoryRole === "summary";
  const structureNode = memoryRole === "structure";
  const themeNode = memoryRole === "theme";
  const syntheticGraphNode = isSyntheticGraphNode(node);
  const pinned = isPinnedMemoryNode(node);
  const categorySegments = getMemoryCategorySegments(node);
  const canOwnChildren = canPrimaryParentChildren(node) && !syntheticGraphNode;
  const canEditMemory = !fileNode && !syntheticGraphNode && !structureNode;
  const canManageStructure = !fileNode && !syntheticGraphNode;
  const canManageFiles = !fileNode && !syntheticGraphNode && !structureNode;
  const parentBinding = getMemoryParentBinding(node);
  const visibility =
    typeof node.metadata_json?.visibility === "string"
      ? node.metadata_json.visibility
      : "public";

  const resolveNodeById = useCallback(
    (nodeId: string) => allNodes.find((candidate) => candidate.id === nodeId) ?? null,
    [allNodes],
  );

  const currentParentNode = useMemo(() => {
    if (!node.parent_memory_id) {
      return null;
    }
    return resolveNodeById(node.parent_memory_id);
  }, [node.parent_memory_id, resolveNodeById]);
  const graphParentNode = useMemo(() => {
    const graphParentId =
      typeof node.metadata_json?.graph_parent_memory_id === "string" &&
      node.metadata_json.graph_parent_memory_id
        ? node.metadata_json.graph_parent_memory_id
        : null;
    if (!graphParentId) {
      return null;
    }
    return resolveNodeById(graphParentId);
  }, [node.metadata_json?.graph_parent_memory_id, resolveNodeById]);
  const displayedParentNode = graphParentNode ?? currentParentNode;
  const currentParentIsTopLevel =
    !displayedParentNode || isAssistantRootMemoryNode(displayedParentNode);

  const connectedEdges = useMemo(() => detail?.edges ?? [], [detail?.edges]);
  const attachedFiles = useMemo(() => detail?.files ?? [], [detail?.files]);
  const linkedMemory = useMemo(
    () => (fileNode && node.parent_memory_id ? resolveNodeById(node.parent_memory_id) : null),
    [fileNode, node.parent_memory_id, resolveNodeById],
  );
  const childNodes = useMemo(
    () => {
      const candidates = allNodes.filter(
        (candidate) => !isFileNode(candidate) && candidate.id !== node.id,
      );
      const branchChildren = candidates.filter((candidate) => {
        const graphParentId =
          typeof candidate.metadata_json?.graph_parent_memory_id === "string" &&
          candidate.metadata_json.graph_parent_memory_id
            ? candidate.metadata_json.graph_parent_memory_id
            : null;
        return graphParentId === node.id || candidate.parent_memory_id === node.id;
      });
      return branchChildren.sort((left, right) =>
        formatNodeLabel(left).localeCompare(formatNodeLabel(right), "zh-CN"),
      );
    },
    [allNodes, node.id],
  );
  const manualEdges = useMemo(
    () => connectedEdges.filter((edge) => edge.edge_type === "manual"),
    [connectedEdges],
  );
  const systemRelatedEdges = useMemo(
    () => connectedEdges.filter((edge) => edge.edge_type === "related"),
    [connectedEdges],
  );

  const nodeHeading = fileNode
    ? String(fileMetadata.filename || node.content || t("graph.untitledFile"))
    : formatNodeLabel(node);
  const nodeTone = fileNode
    ? t("graph.fileNode")
    : t("graph.memoryNode");
  const nodeDescriptor = currentParentIsTopLevel
    ? t("graph.parentTopLevel")
    : displayedParentNode
      ? `${t("graph.parentNode")} · ${formatNodeLabel(displayedParentNode)}`
      : t("graph.parentUnavailable");
  const selectionPreviewItems = useMemo(() => {
    if (!editMode) {
      return [];
    }
    if (editMode === "parent") {
      const firstSelection = editSelectionIds[0];
      if (!firstSelection || firstSelection === topLevelSelectionId) {
        return [t("graph.parentTopLevel")];
      }
      const parentNode = resolveNodeById(firstSelection);
      return [parentNode ? formatNodeLabel(parentNode) : firstSelection];
    }
    return editSelectionIds
      .map((nodeId) => resolveNodeById(nodeId))
      .filter((candidate): candidate is MemoryNode => Boolean(candidate))
      .map((candidate) => formatNodeLabel(candidate));
  }, [editMode, editSelectionIds, resolveNodeById, t, topLevelSelectionId]);
  const selectionCountLabel = useMemo(() => {
    if (!editMode) {
      return "";
    }
    if (editMode === "parent") {
      return selectionPreviewItems[0] || t("graph.parentTopLevel");
    }
    return t("graph.selectionCount", { count: selectionPreviewItems.length });
  }, [editMode, selectionPreviewItems, t]);

  useEffect(() => {
    setEditContent(node.content);
    setEditCategory(node.category);
    setEditing(false);
  }, [node.category, node.content, node.id]);

  const loadDetail = useCallback(async () => {
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    if (fileNode || syntheticGraphNode) {
      detailRequestSeqRef.current += 1;
      setDetail(null);
      setLoadingDetail(false);
      return;
    }
    const requestSeq = ++detailRequestSeqRef.current;
    const controller = new AbortController();
    detailAbortControllerRef.current = controller;
    setLoadingDetail(true);
    try {
      const result = await apiGet<MemoryDetailData>(`/api/v1/memory/${node.id}`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || detailRequestSeqRef.current !== requestSeq) {
        return;
      }
      setDetail(result);
    } catch (error) {
      if (
        controller.signal.aborted ||
        detailRequestSeqRef.current !== requestSeq ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      setDetail(null);
    } finally {
      if (detailAbortControllerRef.current === controller) {
        detailAbortControllerRef.current = null;
      }
      if (detailRequestSeqRef.current === requestSeq) {
        setLoadingDetail(false);
      }
    }
  }, [fileNode, node.id, syntheticGraphNode]);

  const loadAvailableFiles = useCallback(async () => {
    availableFilesAbortControllerRef.current?.abort();
    availableFilesAbortControllerRef.current = null;
    if (fileNode || syntheticGraphNode) {
      availableFilesRequestSeqRef.current += 1;
      setAvailableFiles([]);
      setSelectedFileId("");
      setLoadingAvailableFiles(false);
      return;
    }
    const requestSeq = ++availableFilesRequestSeqRef.current;
    const controller = new AbortController();
    availableFilesAbortControllerRef.current = controller;
    setLoadingAvailableFiles(true);
    try {
      const result = await apiGet<MemoryFileCandidate[]>(`/api/v1/memory/${node.id}/available-files`, {
        signal: controller.signal,
      });
      if (controller.signal.aborted || availableFilesRequestSeqRef.current !== requestSeq) {
        return;
      }
      const files = Array.isArray(result) ? result : [];
      setAvailableFiles(files);
      setSelectedFileId((current) =>
        current && files.some((file) => file.id === current) ? current : (files[0]?.id || ""),
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        availableFilesRequestSeqRef.current !== requestSeq ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return;
      }
      setAvailableFiles([]);
      setSelectedFileId("");
    } finally {
      if (availableFilesAbortControllerRef.current === controller) {
        availableFilesAbortControllerRef.current = null;
      }
      if (availableFilesRequestSeqRef.current === requestSeq) {
        setLoadingAvailableFiles(false);
      }
    }
  }, [fileNode, node.id, syntheticGraphNode]);

  useEffect(
    () => () => {
      detailAbortControllerRef.current?.abort();
      availableFilesAbortControllerRef.current?.abort();
    },
    [node.id],
  );

  useEffect(() => {
    if (fileNode || syntheticGraphNode) {
      setDetail(null);
      setLoadingDetail(false);
      setAvailableFiles([]);
      setSelectedFileId("");
      setLoadingAvailableFiles(false);
      return;
    }
    void loadDetail();
    void loadAvailableFiles();
  }, [allNodes, fileNode, loadAvailableFiles, loadDetail, syntheticGraphNode]);

  const handleSave = async () => {
    await onUpdate(node.id, {
      content: editContent,
      category: editCategory,
    });
    await loadDetail();
    setEditing(false);
  };

  const handleCancel = () => {
    setEditContent(node.content);
    setEditCategory(node.category);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (await modal.confirm(t("graph.confirmDelete"))) {
      await onDelete(node.id);
      onClose();
    }
  };

  const handleDeleteEdge = async (edgeId: string) => {
    if (!(await modal.confirm(t("graph.confirmDisconnect")))) {
      return;
    }
    await onDeleteEdge(edgeId);
    setDetail((prev) =>
      prev
        ? { ...prev, edges: prev.edges.filter((edge) => edge.id !== edgeId) }
        : prev,
    );
  };

  const handleAttachFile = async () => {
    if (!selectedFileId) {
      return;
    }
    await onAttachFile(node.id, selectedFileId);
    await loadDetail();
    await loadAvailableFiles();
  };

  const handleDetachFile = async (memoryFileId: string) => {
    if (!(await modal.confirm(t("graph.confirmDetachFile")))) {
      return;
    }
    await onDetachFile(memoryFileId);
    await loadDetail();
    await loadAvailableFiles();
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString("zh-CN");
    } catch {
      return dateStr;
    }
  };

  const renderRelationList = (
    relationEdges: MemoryDetailEdge[],
    emptyLabel: string,
    variant: "system" | "manual",
  ) => {
    if (loadingDetail) {
      return <div className="graph-detail-empty">{t("graph.loading")}</div>;
    }
    if (relationEdges.length === 0) {
      return <div className="graph-detail-empty">{emptyLabel}</div>;
    }
    return (
      <div className="graph-detail-relation-list">
        {relationEdges.map((edge) => {
          const otherNodeId =
            edge.source_memory_id === node.id
              ? edge.target_memory_id
              : edge.source_memory_id;
          const relatedNode = resolveNodeById(otherNodeId);
          return (
            <div key={edge.id} className={`graph-detail-related-item is-${variant}`}>
              <div className="graph-detail-related-copy">
                {relatedNode ? (
                  <button
                    type="button"
                    className="graph-detail-link-button"
                    onClick={() => onFocusNode(relatedNode)}
                  >
                    {formatNodeLabel(relatedNode)}
                  </button>
                ) : (
                  <span>{otherNodeId.slice(0, 8)}</span>
                )}
                <span className="graph-detail-related-meta">
                  {formatEdgeTypeLabel(edge.edge_type, t)}
                  {typeof edge.strength === "number"
                    ? ` · ${Math.round(edge.strength * 100)}%`
                    : ""}
                </span>
              </div>
              <button
                type="button"
                className="graph-detail-btn"
                onClick={() => void handleDeleteEdge(edge.id)}
              >
                {variant === "system" ? t("graph.disconnectAndIgnore") : t("graph.disconnect")}
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="graph-detail">
      <div className="graph-detail-header">
        <span className="graph-detail-title">{fileNode ? t("graph.fileDetail") : t("graph.nodeDetail")}</span>
        <button className="graph-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="graph-detail-body">
        {editing && canEditMemory ? (
          <>
            <label className="graph-detail-label">{t("graph.contentLabel")}</label>
            <textarea
              className="graph-detail-textarea"
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              rows={6}
            />
            <label className="graph-detail-label">{t("graph.category")}</label>
            <input
              className="graph-detail-input"
              value={editCategory}
              onChange={(event) => setEditCategory(event.target.value)}
            />
            <div className="graph-detail-actions">
              <button className="graph-detail-btn is-primary" onClick={handleSave}>
                {t("graph.save")}
              </button>
              <button className="graph-detail-btn" onClick={handleCancel}>
                {t("graph.cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <section className="graph-detail-hero">
              <div className="graph-detail-kicker-row">
                <span className="graph-detail-kicker">{nodeTone}</span>
                {!fileNode ? (
                  <span
                    className={`graph-detail-badge ${
                      node.type === "permanent" ? "is-permanent" : "is-temporary"
                    }`}
                  >
                    {node.type === "permanent" ? t("graph.permanent") : t("graph.temporary")}
                  </span>
                ) : null}
              </div>
              <div className="graph-detail-heading-row">
                <span
                  className={`graph-detail-dot ${
                    fileNode
                      ? "is-file"
                      : structureNode
                        ? "is-structural"
                        : themeNode
                          ? "is-memory"
                        : summaryNode
                          ? "is-summary"
                          : node.type === "temporary"
                            ? "is-temporary"
                            : "is-memory"
                  }`}
                />
                <div className="graph-detail-heading-stack">
                  <h3 className="graph-detail-heading">{nodeHeading}</h3>
                  <p className="graph-detail-subtitle">{nodeDescriptor}</p>
                </div>
              </div>
              <div className="graph-detail-content graph-detail-content-hero">
                {fileNode
                  ? String(fileMetadata.filename || node.content || t("graph.untitledFile"))
                  : node.content}
              </div>
              <div className="graph-detail-badges">
                {categorySegments.map((segment) => (
                  <span key={segment} className="graph-detail-badge is-category">
                    {segment}
                  </span>
                ))}
                {!fileNode ? (
                  <span className="graph-detail-badge is-neutral">
                    {formatMemoryRoleLabel(memoryRole, t)}
                  </span>
                ) : null}
                {!fileNode && !summaryNode ? (
                  <span className="graph-detail-badge is-neutral">
                    {formatMemoryKindLabel(memoryKind, t)}
                  </span>
                ) : null}
                {summaryNode ? (
                  <span className="graph-detail-badge is-summary">{formatMemoryRoleLabel(memoryRole, t)}</span>
                ) : null}
                {pinned ? (
                  <span className="graph-detail-badge is-pinned">{t("graph.pinned")}</span>
                ) : null}
                {fileNode ? (
                  <span className="graph-detail-badge is-neutral">{t("graph.attachment")}</span>
                ) : null}
              </div>
            </section>

            {fileNode ? (
              <section className="graph-detail-section">
                <div className="graph-detail-section-header">
                  <span className="graph-detail-section-title">{t("graph.quickOverview")}</span>
                </div>
                {typeof fileMetadata.media_type === "string" && fileMetadata.media_type ? (
                  <div className="graph-detail-meta">
                    <span className="graph-detail-label">{t("graph.fileType")}</span>
                    <span className="graph-detail-value">{fileMetadata.media_type}</span>
                  </div>
                ) : null}
                {linkedMemory ? (
                  <div className="graph-detail-meta">
                    <span className="graph-detail-label">{t("graph.linkedMemory")}</span>
                    <button
                      type="button"
                      className="graph-detail-link-button"
                      onClick={() => onFocusNode(linkedMemory)}
                    >
                      {formatNodeLabel(linkedMemory)}
                    </button>
                  </div>
                ) : null}
                {typeof fileMetadata.data_item_id === "string" && fileMetadata.data_item_id ? (
                  <div className="graph-detail-meta">
                    <span className="graph-detail-label">{t("graph.dataItem")}</span>
                    <span className="graph-detail-value">{fileMetadata.data_item_id}</span>
                  </div>
                ) : null}
                <div className="graph-detail-meta">
                  <span className="graph-detail-label">{t("graph.createdAt")}</span>
                  <span className="graph-detail-value">{formatDate(node.created_at)}</span>
                </div>
              </section>
            ) : (
              <>
                <section className="graph-detail-section">
                  <div className="graph-detail-section-header">
                    <span className="graph-detail-section-title">{t("graph.quickOverview")}</span>
                    <span className="graph-detail-section-note">
                      {loadingDetail
                        ? t("graph.loading")
                        : t("graph.relatedSummary", { edges: connectedEdges.length, files: attachedFiles.length })}
                    </span>
                  </div>
                  <div className="graph-detail-metric-grid">
                    <div className="graph-detail-metric-card">
                      <span className="graph-detail-label">{t("graph.salience")}</span>
                      <span className="graph-detail-value">
                        {salience !== null ? `${Math.round(salience * 100)}%` : "—"}
                      </span>
                    </div>
                    <div className="graph-detail-metric-card">
                      <span className="graph-detail-label">{t("graph.retrievalCount")}</span>
                      <span className="graph-detail-value">{retrievalCount}</span>
                    </div>
                    <div className="graph-detail-metric-card">
                      <span className="graph-detail-label">{t("graph.visibility")}</span>
                      <span className="graph-detail-value">
                        {visibility === "private" ? t("graph.visibilityPrivate") : t("graph.visibilityPublic")}
                      </span>
                    </div>
                    <div className="graph-detail-metric-card">
                      <span className="graph-detail-label">{t("graph.lastUsedAt")}</span>
                      <span className="graph-detail-value">
                        {lastUsedAt ? formatDate(lastUsedAt) : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="graph-detail-meta-grid">
                    <div className="graph-detail-meta">
                      <span className="graph-detail-label">{t("graph.createdAt")}</span>
                      <span className="graph-detail-value">{formatDate(node.created_at)}</span>
                    </div>
                    <div className="graph-detail-meta">
                      <span className="graph-detail-label">{t("graph.updatedAt")}</span>
                      <span className="graph-detail-value">{formatDate(node.updated_at)}</span>
                    </div>
                    {node.source_conversation_id ? (
                      <div className="graph-detail-meta">
                        <span className="graph-detail-label">{t("graph.source")}</span>
                        <span className="graph-detail-value">
                          {node.source_conversation_id.slice(0, 8)}...
                        </span>
                      </div>
                    ) : null}
                    {lastUsedSource ? (
                      <div className="graph-detail-meta">
                        <span className="graph-detail-label">{t("graph.lastUsedSource")}</span>
                        <span className="graph-detail-value">{lastUsedSource}</span>
                      </div>
                    ) : null}
                    {summaryNode ? (
                      <div className="graph-detail-meta">
                        <span className="graph-detail-label">{t("graph.summarySources")}</span>
                        <span className="graph-detail-value">
                          {t("graph.summarySourcesCount", { count: summarySourceCount })}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </section>

                <section className="graph-detail-section">
                  <div className="graph-detail-section-header">
                    <span className="graph-detail-section-title">{t("graph.structure")}</span>
                    <span className="graph-detail-section-note">{t("graph.connectionHintVisual")}</span>
                  </div>
                  <div className="graph-detail-structure-grid">
                    <div className="graph-detail-structure-card">
                      <span className="graph-detail-label">{t("graph.parentNode")}</span>
                      {displayedParentNode && !isAssistantRootMemoryNode(displayedParentNode) ? (
                        <button
                          type="button"
                          className="graph-detail-link-button"
                          onClick={() => onFocusNode(displayedParentNode)}
                        >
                          {formatNodeLabel(displayedParentNode)}
                        </button>
                      ) : (
                        <span className="graph-detail-value">{t("graph.parentTopLevel")}</span>
                      )}
                    </div>
                    <div className="graph-detail-structure-card">
                      <span className="graph-detail-label">{t("graph.parentBindingMode")}</span>
                      <span className="graph-detail-value">
                        {parentBinding === "manual"
                          ? t("graph.parentBindingManual")
                          : t("graph.parentBindingAuto")}
                      </span>
                    </div>
                    <div className="graph-detail-structure-card">
                      <span className="graph-detail-label">{t("graph.children")}</span>
                      <span className="graph-detail-value">
                        {t("graph.selectionCount", { count: childNodes.length })}
                      </span>
                    </div>
                    <div className="graph-detail-structure-card">
                      <span className="graph-detail-label">{t("graph.manualConnections")}</span>
                      <span className="graph-detail-value">
                        {t("graph.selectionCount", { count: manualEdges.length })}
                      </span>
                    </div>
                  </div>

                  {canManageStructure ? (
                    <>
                      <div className="graph-detail-mode-grid">
                        <button
                          type="button"
                          className={`graph-detail-mode-btn${editMode === "parent" ? " is-active" : ""}`}
                          onClick={() => onBeginEditMode("parent")}
                        >
                          {t("graph.selectParent")}
                        </button>
                        {canOwnChildren ? (
                          <button
                            type="button"
                            className={`graph-detail-mode-btn${editMode === "children" ? " is-active" : ""}`}
                            onClick={() => onBeginEditMode("children")}
                          >
                            {t("graph.selectChildren")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className={`graph-detail-mode-btn${editMode === "related" ? " is-active" : ""}`}
                          onClick={() => onBeginEditMode("related")}
                        >
                          {t("graph.selectRelated")}
                        </button>
                      </div>

                      {editMode ? (
                        <div className="graph-detail-edit-surface">
                          <div className="graph-detail-edit-header">
                            <div className="graph-detail-edit-copy">
                              <span className="graph-detail-edit-kicker">
                                {getSelectionModeTitle(editMode, t)}
                              </span>
                              <p className="graph-detail-edit-description">
                                {getSelectionModeDescription(editMode, t)}
                              </p>
                            </div>
                            <span className="graph-detail-badge is-neutral">
                              {selectionCountLabel}
                            </span>
                          </div>
                          {selectionPreviewItems.length > 0 ? (
                            <div className="graph-detail-chip-list">
                              {selectionPreviewItems.map((label, index) => (
                                <span key={`${label}-${index}`} className="graph-detail-chip is-static">
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <div className="graph-detail-empty">
                              {editMode === "parent"
                                ? t("graph.selectionParentEmpty")
                                : t("graph.selectionEmpty")}
                            </div>
                          )}
                          <div className="graph-detail-inline-actions">
                            <button
                              type="button"
                              className="graph-detail-btn"
                              onClick={onClearEditModeSelection}
                              disabled={editPending}
                            >
                              {t("graph.clearSelection")}
                            </button>
                            <button
                              type="button"
                              className="graph-detail-btn"
                              onClick={onCancelEditMode}
                              disabled={editPending}
                            >
                              {t("graph.cancel")}
                            </button>
                            <button
                              type="button"
                              className="graph-detail-btn is-primary"
                              onClick={() => void onApplyEditMode()}
                              disabled={editPending}
                            >
                              {editPending ? t("graph.applyingSelection") : t("graph.applySelection")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="graph-detail-caption">
                          {structureNode
                            ? t("graph.structureNodeHint")
                            : canOwnChildren
                              ? t("graph.parentHintVisual")
                              : t("graph.leafNodePrimaryHint")}
                        </div>
                      )}
                    </>
                  ) : null}

                  <div className="graph-detail-subsection">
                    <span className="graph-detail-subsection-title">{t("graph.children")}</span>
                    {childNodes.length > 0 ? (
                      <div className="graph-detail-chip-list">
                        {childNodes.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            className="graph-detail-chip"
                            onClick={() => onFocusNode(child)}
                          >
                            {formatNodeLabel(child)}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="graph-detail-empty">{t("graph.noChildren")}</div>
                    )}
                  </div>
                </section>

                <section className="graph-detail-section">
                  <div className="graph-detail-section-header">
                    <span className="graph-detail-section-title">{t("graph.relatedInfo")}</span>
                    <span className="graph-detail-section-note">{t("graph.relatedAutoHint")}</span>
                  </div>

                  <div className="graph-detail-subsection">
                    <span className="graph-detail-subsection-title">{t("graph.systemConnections")}</span>
                    {renderRelationList(systemRelatedEdges, t("graph.noSystemConnections"), "system")}
                  </div>

                  <div className="graph-detail-subsection">
                    <span className="graph-detail-subsection-title">{t("graph.manualConnections")}</span>
                    {renderRelationList(manualEdges, t("graph.noManualConnections"), "manual")}
                  </div>
                </section>

                {canManageFiles ? (
                  <section className="graph-detail-section">
                    <div className="graph-detail-section-header">
                      <span className="graph-detail-section-title">{t("graph.relatedFiles")}</span>
                    </div>
                    {loadingAvailableFiles ? (
                      <div className="graph-detail-empty">{t("graph.loadingFiles")}</div>
                    ) : availableFiles.length > 0 ? (
                      <div className="graph-detail-inline-actions">
                        <select
                          className="graph-detail-select"
                          value={selectedFileId}
                          onChange={(event) => setSelectedFileId(event.target.value)}
                        >
                          {availableFiles.map((file) => (
                            <option key={file.id} value={file.id}>
                              {file.filename}
                            </option>
                          ))}
                        </select>
                        <button type="button" className="graph-detail-btn" onClick={() => void handleAttachFile()}>
                          {t("graph.attachFileButton")}
                        </button>
                      </div>
                    ) : (
                      <div className="graph-detail-empty">{t("graph.noAttachableFiles")}</div>
                    )}
                    {!loadingDetail && attachedFiles.length > 0 ? (
                      <div className="graph-detail-relation-list">
                        {attachedFiles.map((file) => (
                          <div key={file.id} className="graph-detail-related-item">
                            <div className="graph-detail-related-copy">
                              <span>{file.filename || file.data_item_id}</span>
                              <span className="graph-detail-related-meta">
                                {file.media_type ? file.media_type : file.data_item_id}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="graph-detail-btn"
                              onClick={() => void handleDetachFile(file.id)}
                            >
                              {t("graph.detachFile")}
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="graph-detail-section">
                  <div className="graph-detail-actions">
                    {canEditMemory ? (
                      <button
                        className="graph-detail-btn is-primary"
                        onClick={() => setEditing(true)}
                      >
                        {t("graph.edit")}
                      </button>
                    ) : null}
                    {node.type === "temporary" ? (
                      <button
                        className="graph-detail-btn is-promote"
                        onClick={async () => {
                          await onPromote(node.id);
                          await loadDetail();
                        }}
                      >
                        {t("graph.promote")}
                      </button>
                    ) : null}
                    {canEditMemory ? (
                      <button className="graph-detail-btn is-danger" onClick={handleDelete}>
                        {t("graph.delete")}
                      </button>
                    ) : null}
                  </div>
                </section>
              </>
            )}

            {isDeveloperMode && (
              <div className="graph-detail-devmode">
                <div className="graph-detail-label">{t("graph.developerInfo")}</div>
                <div className="graph-detail-devmode-id">ID: {node.id}</div>
                <pre className="graph-detail-devmode-json">
                  {JSON.stringify(detail || node, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
