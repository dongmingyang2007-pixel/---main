export type ViewerMode = "offline" | "online" | "hybrid";
export type ViewerColorway = "pearl" | "graphite" | "glacier";
export type ViewerPivotState = "closed" | "opening" | "overcenter" | "open" | "closing";
export type ViewerPivotSide = "left" | "right";
export type ViewerEarbudBuildTier = "display" | "prototype" | "engineering";
export type ViewerCaseMode = "commute_mode" | "office_mode" | "silent_privacy_mode";
export type ViewerCaptureEventName =
  | "capture_start"
  | "capture_blocked"
  | "capture_uploaded"
  | "ai_response_ready";

export type ViewerCommand =
  | "open"
  | "close"
  | "toggle-open"
  | "toggle-camera"
  | "toggle-earbuds"
  | "toggle-dream"
  | "toggle-spin"
  | "toggle-explode"
  | "toggle-xray"
  | "toggle-night"
  | "cycle-mode"
  | "cycle-layer"
  | "toggle-task"
  | "reset-view"
  | "focus-front-view"
  | "focus-rear-view"
  | "focus-pivot-view"
  | "focus-pivot-front-view"
  | "focus-pivot-rear-view"
  | "focus-pivot-rear-corner-view"
  | "focus-pivot-xray-view"
  | "focus-pivot-inspect-view"
  | "focus-ear-left-view"
  | "focus-ear-right-view"
  | "focus-ear-dock-view"
  | "toggle-pivot-inspect"
  | "toggle-pivot-explode"
  | "toggle-pivot-plug"
  | "toggle-earbud-xray"
  | "export-glb"
  | "export-stl-pack";

export const KNOWN_VIEWER_COMMANDS: ViewerCommand[] = [
  "open",
  "close",
  "toggle-open",
  "toggle-camera",
  "toggle-earbuds",
  "toggle-dream",
  "toggle-spin",
  "toggle-explode",
  "toggle-xray",
  "toggle-night",
  "cycle-mode",
  "cycle-layer",
  "toggle-task",
  "reset-view",
  "focus-front-view",
  "focus-rear-view",
  "focus-pivot-view",
  "focus-pivot-front-view",
  "focus-pivot-rear-view",
  "focus-pivot-rear-corner-view",
  "focus-pivot-xray-view",
  "focus-pivot-inspect-view",
  "focus-ear-left-view",
  "focus-ear-right-view",
  "focus-ear-dock-view",
  "toggle-pivot-inspect",
  "toggle-pivot-explode",
  "toggle-pivot-plug",
  "toggle-earbud-xray",
  "export-glb",
  "export-stl-pack",
];

export type ViewerState = {
  isOpen: boolean;
  camDetached: boolean;
  earbudsOut: boolean;
  dreamOn: boolean;
  autoSpin: boolean;
  exploded: boolean;
  xrayOn: boolean;
  nightOn: boolean;
  mode: ViewerMode;
  layer: number;
  colorway: ViewerColorway;
  pivotSwingSide: ViewerPivotSide;
  pivotAngleDeg: number;
  pivotState: ViewerPivotState;
  pivotOpenElapsedMs: number;
  pivotShellMinClearanceMm: number;
  pivotRearCornerMinClearanceMm: number;
  pivotNotchPeakOverCapMm: number;
  pivotSpikeViolationCount: number;
  pivotClipGuardActive: boolean;
  pivotAxisCount: number;
  pivotLayout: string;
  pivotInspectActive: boolean;
  pivotExplodeActive: boolean;
  pivotPlugInserted: boolean;
  pivotPlugAnimating: boolean;
  pivotPlugReady: boolean;
  pivotPlugSlideT: number;
  pivotPlugDragActive: boolean;
  pivotModuleCount: number;
  pivotInspectMinClearanceMm: number;
  pivotClearanceSampleStepDeg: number;
  pivotClearanceSampleCount: number;
  closedLateralJitterMm: number;
  earbudBuildTier: ViewerEarbudBuildTier;
  earbudFitClearanceMm: number;
  earbudFitMeasurementValid: boolean;
  earbudContactEngagedL: boolean;
  earbudContactEngagedR: boolean;
  earbudContactMeasurementValidL: boolean;
  earbudContactMeasurementValidR: boolean;
  earbudAncLayout: string;
  earbudModuleOverlapCount: number;
  caseMode: ViewerCaseMode;
  privacyLockHw: boolean;
  cameraPowerHw: boolean;
  captureIndicatorHw: boolean;
  pocketGuardActive: boolean;
  captureBlockedReason: string;
  captureLastEvent: ViewerCaptureEventName | "";
  captureToUploadMs: number;
  uploadToAiMs: number;
  aiToTtsMs: number;
  e2eMs: number;
  mechRevision: string;
  printProfile: string;
  earbudSpecRevision: string;
  earbudSpecSourceHash: string;
  statusText: string;
};

export type ViewerConnectionPhase = "connecting" | "connected" | "degraded" | "timeout";

export const VIEWER_PROTOCOL_VERSION = "2026-03-bridge-v1";
export const QIHANG_WEB_SOURCE = "qihang-web";
export const QIHANG_VIEWER_SOURCE = "qihang-viewer";

export const VIEWER_MESSAGE_READY = "qihang:model:ready";
export const VIEWER_MESSAGE_STATE = "qihang:model:state";
export const VIEWER_MESSAGE_SCREEN_ACTION = "qihang:model:screen-action";
export const VIEWER_MESSAGE_GET_STATE = "qihang:model:get-state";
export const VIEWER_MESSAGE_SET_STATE = "qihang:model:set-state";
export const VIEWER_MESSAGE_COMMAND = "qihang:model:command";
export const VIEWER_MESSAGE_CAPTURE_EVENT = "qihang:model:capture-event";

export const VIEWER_REVISION = "20260308-tail-pivot-v51-device-scale";
export const VIEWER_SRC_BASE = `/product-viewer.html?embedded=1&note=0&print_profile=general&v=${VIEWER_REVISION}`;
export const VIEWER_STORY_SRC_BASE = `${VIEWER_SRC_BASE}&surface=story`;
export const VIEWER_DEMO_SRC_BASE = `${VIEWER_SRC_BASE}&surface=demo`;

export function appendParentOrigin(viewerSrc: string, origin: string): string {
  const delimiter = viewerSrc.includes("?") ? "&" : "?";
  return `${viewerSrc}${delimiter}parent_origin=${encodeURIComponent(origin)}`;
}
