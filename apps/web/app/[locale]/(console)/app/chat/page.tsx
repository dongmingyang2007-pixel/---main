"use client";

import { Suspense, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";

import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";
import {
  type ConversationSidebarHandle,
} from "./ConversationSidebar";

function ChatPageContent() {
  const searchParams = useSearchParams();
  // URL params kept for future sidebar integration
  const _requestedProjectId = searchParams.get("project_id") || "";
  const _requestedConvId = searchParams.get("conv") || "";

  const [activeConversationId] = useState<string | null>(null);
  const [selectedProjectId] = useState<string>("");
  const sidebarRef = useRef<ConversationSidebarHandle | null>(null);

  const handleConversationActivity = useCallback(
    (payload: { conversationId: string; previewText: string }) => {
      sidebarRef.current?.handleConversationActivity(payload);
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
