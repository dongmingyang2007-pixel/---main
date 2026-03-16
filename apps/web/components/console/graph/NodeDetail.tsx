"use client";

import { useState } from "react";
import type { MemoryNode } from "@/hooks/useGraphData";
import { useDeveloperMode } from "@/lib/developer-mode";

interface NodeDetailProps {
  node: MemoryNode;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<MemoryNode>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onPromote: (id: string) => Promise<void>;
}

export default function NodeDetail({
  node,
  onClose,
  onUpdate,
  onDelete,
  onPromote,
}: NodeDetailProps) {
  const { isDeveloperMode } = useDeveloperMode();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(node.content);
  const [editCategory, setEditCategory] = useState(node.category);

  const handleSave = async () => {
    await onUpdate(node.id, {
      content: editContent,
      category: editCategory,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditContent(node.content);
    setEditCategory(node.category);
    setEditing(false);
  };

  const handleDelete = async () => {
    if (window.confirm("确定要删除这条记忆吗？")) {
      await onDelete(node.id);
      onClose();
    }
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
        <span className="graph-detail-title">记忆详情</span>
        <button className="graph-detail-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="graph-detail-body">
        {editing ? (
          <>
            <label className="graph-detail-label">内容</label>
            <textarea
              className="graph-detail-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={6}
            />
            <label className="graph-detail-label">分类</label>
            <input
              className="graph-detail-input"
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value)}
            />
            <div className="graph-detail-actions">
              <button className="graph-detail-btn is-primary" onClick={handleSave}>
                保存
              </button>
              <button className="graph-detail-btn" onClick={handleCancel}>
                取消
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
                {node.type === "permanent" ? "永久" : "临时"}
              </span>
            </div>

            {node.source_conversation_id && (
              <div className="graph-detail-meta">
                <span className="graph-detail-label">来源对话</span>
                <span className="graph-detail-value">
                  {node.source_conversation_id.slice(0, 8)}...
                </span>
              </div>
            )}

            <div className="graph-detail-meta">
              <span className="graph-detail-label">创建时间</span>
              <span className="graph-detail-value">
                {formatDate(node.created_at)}
              </span>
            </div>

            <div className="graph-detail-meta">
              <span className="graph-detail-label">更新时间</span>
              <span className="graph-detail-value">
                {formatDate(node.updated_at)}
              </span>
            </div>

            <div className="graph-detail-actions">
              <button
                className="graph-detail-btn is-primary"
                onClick={() => setEditing(true)}
              >
                编辑
              </button>
              {node.type === "temporary" && (
                <button
                  className="graph-detail-btn is-promote"
                  onClick={() => onPromote(node.id)}
                >
                  设为永久
                </button>
              )}
              <button className="graph-detail-btn is-danger" onClick={handleDelete}>
                删除
              </button>
            </div>

            {isDeveloperMode && (
              <div className="graph-detail-devmode">
                <div className="graph-detail-label">开发者信息</div>
                <div className="graph-detail-devmode-id">ID: {node.id}</div>
                <pre className="graph-detail-devmode-json">
                  {JSON.stringify(node, null, 2)}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
