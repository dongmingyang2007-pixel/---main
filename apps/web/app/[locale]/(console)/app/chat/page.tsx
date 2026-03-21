"use client";

import { Suspense, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import {
  ConversationSidebar,
  type ConversationSidebarHandle,
} from "./ConversationSidebar";

function ChatPageContent() {
  const t = useTranslations("console-chat");
  const searchParams = useSearchParams();
  const requestedProjectId = searchParams.get("project_id") || "";
  const requestedConvId = searchParams.get("conv") || "";

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const sidebarRef = useRef<ConversationSidebarHandle | null>(null);

  const handleSelectConversation = useCallback((id: string | null) => {
    setActiveConversationId(id);
  }, []);

  const handleProjectChange = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
  }, []);

  const handleConversationActivity = useCallback(
    (payload: { conversationId: string; previewText: string }) => {
      sidebarRef.current?.handleConversationActivity(payload);
    },
    [],
  );

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-4">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <div className="chat-page-layout">
            <ConversationSidebar
              activeConversationId={activeConversationId}
              onSelectConversation={handleSelectConversation}
              onProjectChange={handleProjectChange}
              requestedProjectId={requestedProjectId}
              requestedConvId={requestedConvId}
              handleRef={sidebarRef}
            />

            <div className="chat-main">
              <ChatInterface
                conversationId={activeConversationId}
                projectId={selectedProjectId}
                onConversationActivity={handleConversationActivity}
              />
            </div>
          </div>
        </div>
      </PageTransition>
    </PanelLayout>
  );
}

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <PanelLayout>
          <PageTransition>
            <div className="p-6">
              <div className="console-empty">...</div>
            </div>
          </PageTransition>
        </PanelLayout>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
