import { JobStatus } from "@/lib/types";

const colorMap: Record<JobStatus, { tone: string; label: string }> = {
  pending: { tone: "bg-[rgba(251,191,36,0.12)] text-[var(--warning-v2)]", label: "待执行" },
  running: { tone: "bg-[rgba(15,118,255,0.12)] text-[var(--brand-v2)]", label: "运行中" },
  succeeded: { tone: "bg-[rgba(74,222,128,0.12)] text-[var(--success-v2)]", label: "已完成" },
  failed: { tone: "bg-[rgba(248,113,113,0.12)] text-[var(--error)]", label: "失败" },
  canceled: { tone: "bg-[var(--bg-raised)] text-[var(--text-secondary)]", label: "已取消" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const entry = colorMap[status] || colorMap.pending;
  return (
    <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${entry.tone}`}>
      {entry.label}
    </span>
  );
}
