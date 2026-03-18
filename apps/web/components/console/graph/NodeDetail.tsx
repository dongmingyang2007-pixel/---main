"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api";
import type { MemoryNode } from "@/hooks/useGraphData";
import { useDeveloperMode } from "@/lib/developer-mode";
import { useModal } from "@/components/ui/modal-dialog";

interface MemoryDetailEdge {
  id: string;
  source_memory_id: string;
  target_memory_id: string;
  edge_type: "auto" | "manual";
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
  onUpdate: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
  onDeleteEdge: (id: string) => Promise<void>;
  onAttachFile: (memoryId: string, dataItemId: string) => Promise<void>;
  onDetachFile: (memoryFileId: string) => Promise<void>;
}

function isFileNode(node: MemoryNode): boolean {
  return node.category === "file" || node.category === "文件" || node.metadata_json?.node_kind === "file";
}

export default function NodeDetail({
  node,
  allNodes,
  onClose,
  onUpdate,
  onDelete,
  onPromote,
  onDeleteEdge,
  onAttachFile,
  onDetachFile,
}: NodeDetailProps) {
  const t = useTranslations("console-assistants");
  const { isDeveloperMode } = useDeveloperMode();
  const modal = useModal();
  const fileNode = isFileNode(node);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(node.content);
  const [editCategory, setEditCategory] = useState(node.category);
  const [detail, setDetail] = useState<MemoryDetailData | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(!fileNode);
  const [availableFiles, setAvailableFiles] = useState<MemoryFileCandidate[]>([]);
  const [loadingAvailableFiles, setLoadingAvailableFiles] = useState(!fileNode);
  const [selectedFileId, setSelectedFileId] = useState("");
  const fileMetadata = (node.metadata_json || {}) as Record<string, unknown>;

  useEffect(() => {
    setEditContent(node.content);
    setEditCategory(node.category);
    setEditing(false);
  }, [node.category, node.content, node.id]);

  const loadDetail = useCallback(async () => {
    if (fileNode) {
      setDetail(null);
      setLoadingDetail(false);
      return;
    }
    setLoadingDetail(true);
    try {
      const result = await apiGet<MemoryDetailData>(`/api/v1/memory/${node.id}`);
      setDetail(result);
    } catch {
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, [fileNode, node.id]);

  const loadAvailableFiles = useCallback(async () => {
    if (fileNode) {
      setAvailableFiles([]);
      setSelectedFileId("");
      setLoadingAvailableFiles(false);
      return;
    }
    setLoadingAvailableFiles(true);
    try {
      const result = await apiGet<MemoryFileCandidate[]>(`/api/v1/memory/${node.id}/available-files`);
      const files = Array.isArray(result) ? result : [];
      setAvailableFiles(files);
      setSelectedFileId((current) =>
        current && files.some((file) => file.id === current) ? current : (files[0]?.id || ""),
      );
    } catch {
      setAvailableFiles([]);
      setSelectedFileId("");
    } finally {
      setLoadingAvailableFiles(false);
    }
  }, [fileNode, node.id]);

  useEffect(() => {
    if (fileNode) {
      setDetail(null);
      setLoadingDetail(false);
      setAvailableFiles([]);
      setSelectedFileId("");
      setLoadingAvailableFiles(false);
      return;
    }
    void loadDetail();
    void loadAvailableFiles();
  }, [fileNode, loadAvailableFiles, loadDetail]);

  const connectedEdges = detail?.edges ?? [];
  const attachedFiles = detail?.files ?? [];
  const linkedMemory = useMemo(
    () => (fileNode && node.parent_memory_id ? allNodes.find((candidate) => candidate.id === node.parent_memory_id) : null),
    [allNodes, fileNode, node.parent_memory_id],
  );
  const edgeLabels = useMemo(() => {
    const labels = new Map<string, string>();
    allNodes.forEach((candidate) => {
      const text = candidate.content.trim();
      labels.set(
        candidate.id,
        text.length > 24 ? `${text.slice(0, 24)}...` : text || candidate.category || candidate.id,
      );
    });
    return labels;
  }, [allNodes]);

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

  return (
    <div className="graph-detail">
      <div className="graph-detail-header">
        <span className="graph-detail-title">{fileNode ? t("graph.fileDetail") : t("graph.nodeDetail")}</span>
        <button className="graph-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="graph-detail-body">
        {fileNode ? (
          <>
            <div className="graph-detail-content">
              {String(fileMetadata.filename || node.content || t("graph.untitledFile"))}
            </div>

            <div className="graph-detail-badges">
              <span className="graph-detail-badge is-category">{t("graph.fileNode")}</span>
              <span className="graph-detail-badge is-permanent">{t("graph.attachment")}</span>
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
                <span className="graph-detail-value">
                  {linkedMemory.content || linkedMemory.category || linkedMemory.id.slice(0, 8)}
                </span>
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

            {isDeveloperMode && (
              <div className="graph-detail-devmode">
                <div className="graph-detail-label">{t("graph.developerInfo")}</div>
                <div className="graph-detail-devmode-id">ID: {node.id}</div>
                <pre className="graph-detail-devmode-json">
                  {JSON.stringify(node, null, 2)}
                </pre>
              </div>
            )}
          </>
        ) : editing ? (
          <>
            <label className="graph-detail-label">{t("graph.contentLabel")}</label>
            <textarea
              className="graph-detail-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={6}
            />
            <label className="graph-detail-label">{t("graph.category")}</label>
            <input
              className="graph-detail-input"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
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
            <div className="graph-detail-content">{node.content}</div>

            <div className="graph-detail-badges">
              {node.category && (
                <span className="graph-detail-badge is-category">
                  {node.category}
                </span>
              )}
              <span
                className={`graph-detail-badge ${
                  node.type === "permanent" ? "is-permanent" : "is-temporary"
                }`}
              >
                {node.type === "permanent" ? t("graph.permanent") : t("graph.temporary")}
              </span>
            </div>

            {node.source_conversation_id && (
              <div className="graph-detail-meta">
                <span className="graph-detail-label">{t("graph.source")}</span>
                <span className="graph-detail-value">
                  {node.source_conversation_id.slice(0, 8)}...
                </span>
              </div>
            )}

            <div className="graph-detail-meta">
              <span className="graph-detail-label">{t("graph.createdAt")}</span>
              <span className="graph-detail-value">
                {formatDate(node.created_at)}
              </span>
            </div>

            <div className="graph-detail-meta">
              <span className="graph-detail-label">{t("graph.updatedAt")}</span>
              <span className="graph-detail-value">
                {formatDate(node.updated_at)}
              </span>
            </div>

            <div className="graph-detail-actions">
              <button
                className="graph-detail-btn is-primary"
                onClick={() => setEditing(true)}
              >
                {t("graph.edit")}
              </button>
              {node.type === "temporary" && (
                <button
                  className="graph-detail-btn is-promote"
                  onClick={async () => {
                    await onPromote(node.id);
                    await loadDetail();
                  }}
                >
                  {t("graph.promote")}
                </button>
              )}
              <button className="graph-detail-btn is-danger" onClick={handleDelete}>
                {t("graph.delete")}
              </button>
            </div>

            <div className="graph-detail-meta">
              <span className="graph-detail-label">{t("graph.relatedInfo")}</span>
              <span className="graph-detail-value">
                {loadingDetail
                  ? t("graph.loading")
                  : t("graph.relatedSummary", { edges: connectedEdges.length, files: attachedFiles.length })}
              </span>
            </div>

            {!loadingDetail && connectedEdges.length > 0 && (
              <div className="graph-detail-meta">
                <span className="graph-detail-label">{t("graph.relatedNodes")}</span>
                <div className="graph-detail-value">
                  {connectedEdges.map((edge) => {
                    const otherNodeId =
                      edge.source_memory_id === node.id
                        ? edge.target_memory_id
                        : edge.source_memory_id;
                    const relationLabel = edge.edge_type === "manual" ? t("graph.manualEdge") : t("graph.autoEdge");
                    return (
                      <div key={edge.id} className="graph-detail-related-item">
                        <span>
                          {edgeLabels.get(otherNodeId) || otherNodeId.slice(0, 8)} · {relationLabel}
                        </span>
                        <button
                          type="button"
                          className="graph-detail-btn"
                          onClick={() => void handleDeleteEdge(edge.id)}
                        >
                          {t("graph.disconnect")}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="graph-detail-meta">
              <span className="graph-detail-label">{t("graph.attachFile")}</span>
              {loadingAvailableFiles ? (
                <span className="graph-detail-value">{t("graph.loadingFiles")}</span>
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
                <span className="graph-detail-value">{t("graph.noAttachableFiles")}</span>
              )}
            </div>

            {!loadingDetail && attachedFiles.length > 0 && (
              <div className="graph-detail-meta">
                <span className="graph-detail-label">{t("graph.relatedFiles")}</span>
                <div className="graph-detail-value">
                  {attachedFiles.map((file) => (
                    <div key={file.id} className="graph-detail-related-item">
                      <span>
                        {file.filename || file.data_item_id}
                        {file.media_type ? ` · ${file.media_type}` : ""}
                      </span>
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
              </div>
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
