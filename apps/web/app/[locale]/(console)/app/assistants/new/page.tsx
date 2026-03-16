"use client";

import { PageTransition } from "@/components/console/PageTransition";
import { PanelLayout } from "@/components/console/PanelLayout";
import { WizardShell } from "@/components/console/wizard/WizardShell";

export default function NewAssistantPage() {
  return (
    <PanelLayout>
      <PageTransition>
        <WizardShell />
      </PageTransition>
    </PanelLayout>
  );
}
