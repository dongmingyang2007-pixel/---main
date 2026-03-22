"use client";

import { Suspense, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";

import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";

function ChatPageContent() {
  const searchParams = useSearchParams();
  // URL params kept for future sidebar integration
  const _requestedProjectId = searchParams.get("project_id") || "";
  const _requestedConvId = searchParams.get("conv") || "";

  const [activeConversationId] = useState<string | null>(null);
  const [selectedProjectId] = useState<string>("");

  const handleConversationActivity = useCallback(
    (_payload: { conversationId: string; previewText: string }) => {
      // Will be wired to sidebar when conversation list is re-added
    },
    [],
  );

  return (
    <PageTransition>
      <div className="chat-page" style={{ height: "calc(100vh - 48px - 28px)", display: "flex", flexDirection: "column" }}>
        <ChatInterface
          conversationId={activeConversationId}
          projectId={selectedProjectId}
          onConversationActivity={handleConversationActivity}
        />
      </div>
    </PageTransition>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <PageTransition>
          <div className="p-6">
            <div className="console-empty">...</div>
          </div>
        </PageTransition>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
