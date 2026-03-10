import { JobStatus } from "@/lib/types";

const colorMap: Record<JobStatus, { tone: string; label: string }> = {
  pending: { tone: "bg-[rgba(202,138,4,0.12)] text-[var(--warning)]", label: "待执行" },
  running: { tone: "bg-[rgba(17,115,255,0.12)] text-[var(--brand-strong)]", label: "运行中" },
  succeeded: { tone: "bg-[rgba(15,154,119,0.12)] text-[var(--success)]", label: "已完成" },
  failed: { tone: "bg-[rgba(209,58,93,0.12)] text-[var(--danger)]", label: "失败" },
  canceled: { tone: "bg-[rgba(9,17,31,0.08)] text-[var(--muted)]", label: "已取消" },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const entry = colorMap[status] || colorMap.pending;
  return (
    <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${entry.tone}`}>
      {entry.label}
    </span>
  );
}
