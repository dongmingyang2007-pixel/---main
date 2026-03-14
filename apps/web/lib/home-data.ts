import type { ViewerState } from "@/lib/qihang-viewer-contract";

export interface HomeSceneData {
  id: string;
  viewerPatch?: Partial<ViewerState>;
  tone: "pearl" | "midnight" | "glacier";
}

export const HOME_SCENES: HomeSceneData[] = [
  {
    id: "hero",
    tone: "pearl",
    viewerPatch: { isOpen: false, colorway: "pearl", mode: "offline" },
  },
  {
    id: "highlights",
    tone: "pearl",
    viewerPatch: { isOpen: true, earbudsOut: true, colorway: "pearl" },
  },
  {
    id: "ecosystem",
    tone: "midnight",
    viewerPatch: {
      isOpen: true,
      mode: "online",
      colorway: "pearl",
      nightOn: false,
    },
  },
  {
    id: "craft",
    tone: "glacier",
    viewerPatch: {
      isOpen: true,
      pivotAngleDeg: 88,
      pivotState: "opening",
      colorway: "glacier",
    },
  },
  {
    id: "cta",
    tone: "pearl",
    viewerPatch: { isOpen: false, colorway: "pearl" },
  },
];
