import { PageTransition } from "@/components/console/PageTransition";

export default function MemoryPage() {
  return (
    <PageTransition>
      <div className="p-6">
        <h1 className="text-xl font-bold">记忆</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">记忆图谱和管理功能将在 Plan 2 中实现。</p>
      </div>
    </PageTransition>
  );
}
