import type { ViewerState } from "@/lib/qihang-viewer-contract";

export interface ProductSceneData {
  id: string;
  viewerPatch: Partial<ViewerState>;
  assetSlots: string[];
  tone: string;
}

export const PRODUCT_SCENES: ProductSceneData[] = [
  {
    id: "surface",
    tone: "pearl",
    assetSlots: ["产品主镜头", "材质近景", "状态切换短片"],
    viewerPatch: {
      isOpen: false,
      camDetached: false,
      earbudsOut: false,
      mode: "offline",
      colorway: "pearl",
      caseMode: "office_mode",
      xrayOn: false,
      nightOn: false,
      pivotInspectActive: false,
    },
  },
  {
    id: "geometry",
    tone: "midnight",
    assetSlots: ["转轴微距", "开盖动作", "结构示意"],
    viewerPatch: {
      isOpen: true,
      pivotAngleDeg: 88,
      pivotState: "opening",
      earbudsOut: true,
      camDetached: false,
      mode: "offline",
      colorway: "pearl",
      caseMode: "commute_mode",
    },
  },
  {
    id: "wear",
    tone: "glacier",
    assetSlots: ["佩戴场景", "触发动作", "结果联动画面"],
    viewerPatch: {
      isOpen: true,
      camDetached: true,
      earbudsOut: true,
      mode: "hybrid",
      colorway: "glacier",
      caseMode: "commute_mode",
      dreamOn: true,
    },
  },
  {
    id: "engineering",
    tone: "obsidian",
    assetSlots: ["爆炸视图", "材质说明", "制造状态录屏"],
    viewerPatch: {
      isOpen: true,
      camDetached: true,
      earbudsOut: true,
      mode: "online",
      colorway: "graphite",
      caseMode: "office_mode",
      xrayOn: true,
      pivotInspectActive: true,
      pivotExplodeActive: true,
      nightOn: true,
    },
  },
];
