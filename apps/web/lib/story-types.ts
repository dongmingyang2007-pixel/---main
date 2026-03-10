export type StoryAction = {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
};

export type StoryDetail = {
  label: string;
  body: string;
};

export type StoryTone = "pearl" | "midnight" | "glacier" | "obsidian";

export type StorySceneContent = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  details: StoryDetail[];
  stageLabel: string;
  stageSummary: string;
  stageTags: string[];
  assetSlots: string[];
  tone: StoryTone;
  viewerPatch?: Record<string, unknown>;
};

export type RailItem = {
  label: string;
  title?: string;
  body?: string;
  meta?: string;
};
