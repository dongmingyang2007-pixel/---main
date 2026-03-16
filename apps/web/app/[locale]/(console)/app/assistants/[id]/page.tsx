"use client";

import { useParams } from "next/navigation";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { CanvasWorkbench } from "@/components/console/canvas/CanvasWorkbench";

export default function AssistantDetailPage() {
  const params = useParams<{ id: string }>();
  const projectId = Array.isArray(params.id) ? params.id[0] : params.id;

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6">
          <CanvasWorkbench assistantId={projectId} />
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
