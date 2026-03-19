import { PageTransition } from "@/components/console/PageTransition";

export default function DiscoverPage() {
  return (
    <PageTransition>
      <div className="p-6">
        <h1 className="text-xl font-bold">发现</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">记忆包和模型市场将在 Plan 3 中实现。</p>
      </div>
    </PageTransition>
  );
}
