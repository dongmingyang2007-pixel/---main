"use client";

import { useTranslations } from "next-intl";

import { ChatInterface } from "@/components/console/ChatInterface";
import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";

export default function ChatPage() {
  const t = useTranslations("console-chat");

  return (
    <PanelLayout>
      <PageTransition>
        <div className="p-6 space-y-4">
          <div className="console-page-header">
            <h1 className="console-page-title">{t("title")}</h1>
            <p className="console-page-desc">{t("description")}</p>
          </div>

          <ChatInterface />
        </div>
      </PageTransition>
    </PanelLayout>
  );
}
