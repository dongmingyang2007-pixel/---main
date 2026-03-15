"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { useDeferredIframeSrc } from "@/lib/useDeferredIframeSrc";
import { gsap } from "@/lib/gsap-register";
import { apiPost, uploadToPresignedUrl } from "@/lib/api";
import { EARBUD_BUILD_TIER, EARBUD_SPEC } from "@/lib/qihang-earbud-spec";
import { DemoInferResponse, DemoPresignResponse } from "@/lib/types";
import {
  KNOWN_VIEWER_COMMANDS,
  QIHANG_VIEWER_SOURCE,
  QIHANG_WEB_SOURCE,
  VIEWER_MESSAGE_CAPTURE_EVENT,
  VIEWER_MESSAGE_COMMAND,
  VIEWER_MESSAGE_GET_STATE,
  VIEWER_MESSAGE_READY,
  VIEWER_MESSAGE_SCREEN_ACTION,
  VIEWER_MESSAGE_SET_STATE,
  VIEWER_MESSAGE_STATE,
  VIEWER_DEMO_SRC_BASE,
  appendParentOrigin,
  type ViewerCaseMode,
  type ViewerColorway,
  type ViewerCaptureEventName,
  type ViewerCommand,
  type ViewerConnectionPhase,
  type ViewerEarbudBuildTier,
  type ViewerMode,
  type ViewerPivotSide,
  type ViewerPivotState,
  type ViewerState,
} from "@/lib/qihang-viewer-contract";

type DemoTask = "vqa" | "ocr";

const INITIAL_VIEWER_STATE: ViewerState = {
  isOpen: false,
  camDetached: false,
  earbudsOut: false,
  dreamOn: false,
  xrayOn: false,
  autoSpin: false,
  exploded: false,
  nightOn: false,
  mode: "offline",
  layer: 1,
  colorway: "pearl",
  pivotSwingSide: "left",
  pivotAngleDeg: 0,
  pivotState: "closed",
  pivotOpenElapsedMs: 0,
  pivotShellMinClearanceMm: 0,
  pivotRearCornerMinClearanceMm: 0,
  pivotNotchPeakOverCapMm: 0,
  pivotSpikeViolationCount: 0,
  pivotClipGuardActive: false,
  pivotAxisCount: 1,
  pivotLayout: "tail_pivot_fixed_pin_lid_keyslot_v5",
  pivotInspectActive: false,
  pivotExplodeActive: false,
  pivotPlugInserted: false,
  pivotPlugAnimating: false,
  pivotPlugReady: false,
  pivotPlugSlideT: 0,
  pivotPlugDragActive: false,
  pivotModuleCount: 5,
  pivotInspectMinClearanceMm: 0,
  pivotClearanceSampleStepDeg: 0,
  pivotClearanceSampleCount: 0,
  closedLateralJitterMm: 0,
  earbudBuildTier: EARBUD_BUILD_TIER,
  earbudFitClearanceMm: 0,
  earbudFitMeasurementValid: false,
  earbudContactEngagedL: false,
  earbudContactEngagedR: false,
  earbudContactMeasurementValidL: false,
  earbudContactMeasurementValidR: false,
  earbudAncLayout: EARBUD_SPEC.ancLayout,
  earbudModuleOverlapCount: 0,
  caseMode: "office_mode",
  privacyLockHw: false,
  cameraPowerHw: false,
  captureIndicatorHw: false,
  pocketGuardActive: false,
  captureBlockedReason: "",
  captureLastEvent: "",
  captureToUploadMs: 0,
  uploadToAiMs: 0,
  aiToTtsMs: 0,
  e2eMs: 0,
  mechRevision: "-",
  printProfile: "general",
  earbudSpecRevision: "-",
  earbudSpecSourceHash: "fallback",
  statusText: "等待模型状态",
};

function clampLayer(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(1, Math.round(value)));
}

function sanitizeMode(value: unknown, fallback: ViewerMode): ViewerMode {
  if (value === "offline" || value === "online" || value === "hybrid") {
    return value;
  }
  return fallback;
}

function sanitizeColorway(value: unknown, fallback: ViewerColorway): ViewerColorway {
  if (value === "pearl" || value === "graphite" || value === "glacier") {
    return value;
  }
  return fallback;
}

function sanitizePivotSide(value: unknown, fallback: ViewerPivotSide): ViewerPivotSide {
  if (value === "left" || value === "right") {
    return value;
  }
  return fallback;
}

function sanitizePivotState(value: unknown, fallback: ViewerPivotState): ViewerPivotState {
  if (value === "closed" || value === "opening" || value === "overcenter" || value === "open" || value === "closing") {
    return value;
  }
  return fallback;
}

function sanitizeEarbudBuildTier(value: unknown, fallback: ViewerEarbudBuildTier): ViewerEarbudBuildTier {
  if (value === "display" || value === "prototype" || value === "engineering") {
    return value;
  }
  return fallback;
}

function sanitizeCaseMode(value: unknown, fallback: ViewerCaseMode): ViewerCaseMode {
  if (value === "commute_mode" || value === "office_mode" || value === "silent_privacy_mode") {
    return value;
  }
  return fallback;
}

function sanitizeCaptureEventName(
  value: unknown,
  fallback: ViewerCaptureEventName | "",
): ViewerCaptureEventName | "" {
  if (value === "capture_start" || value === "capture_blocked" || value === "capture_uploaded" || value === "ai_response_ready") {
    return value;
  }
  return fallback;
}

function sanitizeViewerState(raw: unknown, fallback: ViewerState): ViewerState {
  if (!raw || typeof raw !== "object") {
    return { ...fallback };
  }
  const payload = raw as Record<string, unknown>;
  const nextNight = typeof payload.nightOn === "boolean"
    ? payload.nightOn
    : typeof payload.night_mode === "boolean"
      ? payload.night_mode
      : fallback.nightOn;
  return {
    isOpen: typeof payload.isOpen === "boolean" ? payload.isOpen : fallback.isOpen,
    camDetached: typeof payload.camDetached === "boolean" ? payload.camDetached : fallback.camDetached,
    earbudsOut: typeof payload.earbudsOut === "boolean" ? payload.earbudsOut : fallback.earbudsOut,
    dreamOn: typeof payload.dreamOn === "boolean" ? payload.dreamOn : fallback.dreamOn,
    xrayOn: typeof payload.xrayOn === "boolean" ? payload.xrayOn : fallback.xrayOn,
    autoSpin: typeof payload.autoSpin === "boolean" ? payload.autoSpin : fallback.autoSpin,
    exploded: typeof payload.exploded === "boolean" ? payload.exploded : fallback.exploded,
    nightOn: nextNight,
    mode: sanitizeMode(payload.mode, fallback.mode),
    layer: typeof payload.layer === "number" ? clampLayer(payload.layer) : fallback.layer,
    colorway: sanitizeColorway(payload.colorway, fallback.colorway),
    pivotSwingSide: sanitizePivotSide(
      payload.pivot_swing_side ?? payload.pivotSwingSide,
      fallback.pivotSwingSide,
    ),
    pivotAngleDeg:
      typeof payload.pivot_angle_deg === "number"
        ? payload.pivot_angle_deg
        : typeof payload.pivotAngleDeg === "number"
          ? payload.pivotAngleDeg
          : fallback.pivotAngleDeg,
    pivotState: sanitizePivotState(
      payload.pivot_state ?? payload.pivotState,
      fallback.pivotState,
    ),
    pivotOpenElapsedMs:
      typeof payload.pivot_open_elapsed_ms === "number"
        ? payload.pivot_open_elapsed_ms
        : typeof payload.pivotOpenElapsedMs === "number"
          ? payload.pivotOpenElapsedMs
          : fallback.pivotOpenElapsedMs,
    pivotShellMinClearanceMm:
      typeof payload.pivot_shell_min_clearance_mm === "number"
        ? payload.pivot_shell_min_clearance_mm
        : typeof payload.pivotShellMinClearanceMm === "number"
          ? payload.pivotShellMinClearanceMm
          : fallback.pivotShellMinClearanceMm,
    pivotRearCornerMinClearanceMm:
      typeof payload.pivot_rear_corner_min_clearance_mm === "number"
        ? payload.pivot_rear_corner_min_clearance_mm
        : typeof payload.pivotRearCornerMinClearanceMm === "number"
          ? payload.pivotRearCornerMinClearanceMm
          : fallback.pivotRearCornerMinClearanceMm,
    pivotNotchPeakOverCapMm:
      typeof payload.pivot_notch_peak_over_cap_mm === "number"
        ? payload.pivot_notch_peak_over_cap_mm
        : typeof payload.pivotNotchPeakOverCapMm === "number"
          ? payload.pivotNotchPeakOverCapMm
          : fallback.pivotNotchPeakOverCapMm,
    pivotSpikeViolationCount:
      typeof payload.pivot_spike_violation_count === "number"
        ? payload.pivot_spike_violation_count
        : typeof payload.pivotSpikeViolationCount === "number"
          ? payload.pivotSpikeViolationCount
          : fallback.pivotSpikeViolationCount,
    pivotClipGuardActive:
      typeof payload.pivot_clip_guard_active === "boolean"
        ? payload.pivot_clip_guard_active
        : typeof payload.pivotClipGuardActive === "boolean"
          ? payload.pivotClipGuardActive
          : fallback.pivotClipGuardActive,
    pivotAxisCount:
      typeof payload.pivot_axis_count === "number"
        ? payload.pivot_axis_count
        : typeof payload.pivotAxisCount === "number"
          ? payload.pivotAxisCount
          : fallback.pivotAxisCount,
    pivotLayout:
      typeof payload.pivot_layout === "string"
        ? payload.pivot_layout
        : typeof payload.pivotLayout === "string"
          ? payload.pivotLayout
          : fallback.pivotLayout,
    pivotInspectActive:
      typeof payload.pivot_inspect_active === "boolean"
        ? payload.pivot_inspect_active
        : typeof payload.pivotInspectActive === "boolean"
          ? payload.pivotInspectActive
          : fallback.pivotInspectActive,
    pivotExplodeActive:
      typeof payload.pivot_explode_active === "boolean"
        ? payload.pivot_explode_active
        : typeof payload.pivotExplodeActive === "boolean"
          ? payload.pivotExplodeActive
          : fallback.pivotExplodeActive,
    pivotPlugInserted:
      typeof payload.pivot_plug_inserted === "boolean"
        ? payload.pivot_plug_inserted
        : typeof payload.pivotPlugInserted === "boolean"
          ? payload.pivotPlugInserted
          : fallback.pivotPlugInserted,
    pivotPlugAnimating:
      typeof payload.pivot_plug_animating === "boolean"
        ? payload.pivot_plug_animating
        : typeof payload.pivotPlugAnimating === "boolean"
          ? payload.pivotPlugAnimating
          : fallback.pivotPlugAnimating,
    pivotPlugReady:
      typeof payload.pivot_plug_ready === "boolean"
        ? payload.pivot_plug_ready
        : typeof payload.pivotPlugReady === "boolean"
          ? payload.pivotPlugReady
          : fallback.pivotPlugReady,
    pivotPlugSlideT:
      typeof payload.pivot_plug_slide_t === "number"
        ? payload.pivot_plug_slide_t
        : typeof payload.pivotPlugSlideT === "number"
          ? payload.pivotPlugSlideT
          : fallback.pivotPlugSlideT,
    pivotPlugDragActive:
      typeof payload.pivot_plug_drag_active === "boolean"
        ? payload.pivot_plug_drag_active
        : typeof payload.pivotPlugDragActive === "boolean"
          ? payload.pivotPlugDragActive
          : fallback.pivotPlugDragActive,
    pivotModuleCount:
      typeof payload.pivot_module_count === "number"
        ? payload.pivot_module_count
        : typeof payload.pivotModuleCount === "number"
          ? payload.pivotModuleCount
          : fallback.pivotModuleCount,
    pivotInspectMinClearanceMm:
      typeof payload.pivot_inspect_min_clearance_mm === "number"
        ? payload.pivot_inspect_min_clearance_mm
        : typeof payload.pivotInspectMinClearanceMm === "number"
          ? payload.pivotInspectMinClearanceMm
          : fallback.pivotInspectMinClearanceMm,
    pivotClearanceSampleStepDeg:
      typeof payload.pivot_clearance_sample_step_deg === "number"
        ? payload.pivot_clearance_sample_step_deg
        : typeof payload.pivotClearanceSampleStepDeg === "number"
          ? payload.pivotClearanceSampleStepDeg
          : fallback.pivotClearanceSampleStepDeg,
    pivotClearanceSampleCount:
      typeof payload.pivot_clearance_sample_count === "number"
        ? payload.pivot_clearance_sample_count
        : typeof payload.pivotClearanceSampleCount === "number"
          ? payload.pivotClearanceSampleCount
          : fallback.pivotClearanceSampleCount,
    closedLateralJitterMm:
      typeof payload.closed_lateral_jitter_mm === "number"
        ? payload.closed_lateral_jitter_mm
        : typeof payload.closedLateralJitterMm === "number"
          ? payload.closedLateralJitterMm
          : fallback.closedLateralJitterMm,
    earbudBuildTier: sanitizeEarbudBuildTier(
      payload.earbud_build_tier ?? payload.earbudBuildTier,
      fallback.earbudBuildTier,
    ),
    earbudFitClearanceMm:
      typeof payload.earbud_fit_clearance_mm === "number"
        ? payload.earbud_fit_clearance_mm
        : typeof payload.earbudFitClearanceMm === "number"
          ? payload.earbudFitClearanceMm
          : fallback.earbudFitClearanceMm,
    earbudFitMeasurementValid:
      typeof payload.earbud_fit_measurement_valid === "boolean"
        ? payload.earbud_fit_measurement_valid
        : typeof payload.earbudFitMeasurementValid === "boolean"
          ? payload.earbudFitMeasurementValid
          : fallback.earbudFitMeasurementValid,
    earbudContactEngagedL:
      typeof payload.earbud_contact_engaged_l === "boolean"
        ? payload.earbud_contact_engaged_l
        : typeof payload.earbudContactEngagedL === "boolean"
          ? payload.earbudContactEngagedL
          : fallback.earbudContactEngagedL,
    earbudContactEngagedR:
      typeof payload.earbud_contact_engaged_r === "boolean"
        ? payload.earbud_contact_engaged_r
        : typeof payload.earbudContactEngagedR === "boolean"
          ? payload.earbudContactEngagedR
          : fallback.earbudContactEngagedR,
    earbudContactMeasurementValidL:
      typeof payload.earbud_contact_measurement_valid_l === "boolean"
        ? payload.earbud_contact_measurement_valid_l
        : typeof payload.earbudContactMeasurementValidL === "boolean"
          ? payload.earbudContactMeasurementValidL
          : fallback.earbudContactMeasurementValidL,
    earbudContactMeasurementValidR:
      typeof payload.earbud_contact_measurement_valid_r === "boolean"
        ? payload.earbud_contact_measurement_valid_r
        : typeof payload.earbudContactMeasurementValidR === "boolean"
          ? payload.earbudContactMeasurementValidR
          : fallback.earbudContactMeasurementValidR,
    earbudAncLayout:
      typeof payload.earbud_anc_layout === "string"
        ? payload.earbud_anc_layout
        : typeof payload.earbudAncLayout === "string"
          ? payload.earbudAncLayout
          : fallback.earbudAncLayout,
    earbudModuleOverlapCount:
      typeof payload.earbud_module_overlap_count === "number"
        ? payload.earbud_module_overlap_count
        : typeof payload.earbudModuleOverlapCount === "number"
          ? payload.earbudModuleOverlapCount
          : fallback.earbudModuleOverlapCount,
    caseMode: sanitizeCaseMode(
      payload.case_mode ?? payload.caseMode,
      fallback.caseMode,
    ),
    privacyLockHw:
      typeof payload.privacy_lock_hw === "boolean"
        ? payload.privacy_lock_hw
        : typeof payload.privacyLockHw === "boolean"
          ? payload.privacyLockHw
          : fallback.privacyLockHw,
    cameraPowerHw:
      typeof payload.camera_power_hw === "boolean"
        ? payload.camera_power_hw
        : typeof payload.cameraPowerHw === "boolean"
          ? payload.cameraPowerHw
          : fallback.cameraPowerHw,
    captureIndicatorHw:
      typeof payload.capture_indicator_hw === "boolean"
        ? payload.capture_indicator_hw
        : typeof payload.captureIndicatorHw === "boolean"
          ? payload.captureIndicatorHw
          : fallback.captureIndicatorHw,
    pocketGuardActive:
      typeof payload.pocket_guard_active === "boolean"
        ? payload.pocket_guard_active
        : typeof payload.pocketGuardActive === "boolean"
          ? payload.pocketGuardActive
          : fallback.pocketGuardActive,
    captureBlockedReason:
      typeof payload.capture_blocked_reason === "string"
        ? payload.capture_blocked_reason
        : typeof payload.captureBlockedReason === "string"
          ? payload.captureBlockedReason
          : fallback.captureBlockedReason,
    captureLastEvent: sanitizeCaptureEventName(
      payload.capture_last_event ?? payload.captureLastEvent,
      fallback.captureLastEvent,
    ),
    captureToUploadMs:
      typeof payload.capture_to_upload_ms === "number"
        ? payload.capture_to_upload_ms
        : typeof payload.captureToUploadMs === "number"
          ? payload.captureToUploadMs
          : fallback.captureToUploadMs,
    uploadToAiMs:
      typeof payload.upload_to_ai_ms === "number"
        ? payload.upload_to_ai_ms
        : typeof payload.uploadToAiMs === "number"
          ? payload.uploadToAiMs
          : fallback.uploadToAiMs,
    aiToTtsMs:
      typeof payload.ai_to_tts_ms === "number"
        ? payload.ai_to_tts_ms
        : typeof payload.aiToTtsMs === "number"
          ? payload.aiToTtsMs
          : fallback.aiToTtsMs,
    e2eMs:
      typeof payload.e2e_ms === "number"
        ? payload.e2e_ms
        : typeof payload.e2eMs === "number"
          ? payload.e2eMs
          : fallback.e2eMs,
    mechRevision:
      typeof payload.mech_revision === "string"
        ? payload.mech_revision
        : typeof payload.mechRevision === "string"
          ? payload.mechRevision
          : fallback.mechRevision,
    printProfile:
      typeof payload.print_profile === "string"
        ? payload.print_profile
        : typeof payload.printProfile === "string"
          ? payload.printProfile
          : fallback.printProfile,
    earbudSpecRevision:
      typeof payload.earbud_spec_revision === "string"
        ? payload.earbud_spec_revision
        : typeof payload.earbudSpecRevision === "string"
          ? payload.earbudSpecRevision
          : fallback.earbudSpecRevision,
    earbudSpecSourceHash:
      typeof payload.earbud_spec_source_hash === "string"
        ? payload.earbud_spec_source_hash
        : typeof payload.earbudSpecSourceHash === "string"
          ? payload.earbudSpecSourceHash
          : fallback.earbudSpecSourceHash,
    statusText:
      typeof payload.status_text === "string"
        ? payload.status_text
        : typeof payload.statusText === "string"
          ? payload.statusText
          : fallback.statusText,
  };
}

function buildPrompt(task: DemoTask): string {
  return task === "ocr" ? "请识别图中的文字并给出结果" : "请描述图中主要内容";
}

function summarizeResult(result: DemoInferResponse): string {
  if (result.ui_cards?.case_display_text) return result.ui_cards.case_display_text;
  if (result.outputs?.text) return result.outputs.text;
  return "推理完成";
}

function summarizeByCaseMode(summary: string, caseMode: ViewerCaseMode): string {
  if (caseMode !== "office_mode") return summary;
  const normalized = summary.trim();
  if (!normalized) return "办公模式：摘要已更新";
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 24)}…`;
}

function modeFromIcons(icons: string[]): "offline" | "online" | "hybrid" {
  const hasCloud = icons.includes("cloud");
  const hasPrivacy = icons.includes("privacy_on");
  if (hasCloud && hasPrivacy) return "hybrid";
  if (hasCloud) return "online";
  return "offline";
}

function commandBtn(enabled: boolean, active = false): string {
  const base = "min-h-[44px] rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium transition-colors";
  if (!enabled) {
    return `${base} border-[var(--border)] bg-[var(--bg-raised)] text-[var(--text-secondary)] cursor-not-allowed`;
  }
  if (active) {
    return `${base} border-[var(--brand-v2)] bg-[var(--brand-v2)] text-white shadow-[0_0_0_3px_var(--brand-soft)]`;
  }
  return `${base} border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] hover:border-[var(--brand-v2)] hover:text-[var(--brand-v2)]`;
}

export default function DemoPage() {
  const td = useTranslations("demo");
  const sectionRef = useRef<HTMLElement>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showViewerHint, setShowViewerHint] = useState(true);
  const [viewerReady, setViewerReady] = useState(false);
  const [availableCommands, setAvailableCommands] = useState<ViewerCommand[]>([]);
  const [connectionPhase, setConnectionPhase] = useState<ViewerConnectionPhase>("connecting");
  const [viewerSrc, setViewerSrc] = useState(VIEWER_DEMO_SRC_BASE);
  const deferredViewerSrc = useDeferredIframeSrc(viewerSrc, true);
  const [handshakeAttempts, setHandshakeAttempts] = useState(0);
  const [viewerState, setViewerState] = useState<ViewerState>(INITIAL_VIEWER_STATE);
  const [task, setTask] = useState<DemoTask>("vqa");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DemoInferResponse | null>(null);
  const [statusMessage, setStatusMessage] = useState("可用右侧按钮操作，也可直接点模型触控屏");
  const handshakeIntervalRef = useRef<number | null>(null);
  const handshakeTimeoutRef = useRef<number | null>(null);
  const handshakeAttemptRef = useRef(0);
  const viewerReadyRef = useRef(false);

  useEffect(() => {
    setViewerSrc(appendParentOrigin(VIEWER_DEMO_SRC_BASE, window.location.origin));
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from(el.querySelector(".demo-hero"), { opacity: 0, y: 20, duration: 0.6 });
    tl.from(el.querySelector(".demo-controls"), { opacity: 0, y: 20, duration: 0.5 }, "<0.12");
    tl.from(el.querySelector(".demo-viewer"), { opacity: 0, y: 30, duration: 0.6 }, "<0.12");
    return () => { tl.kill(); };
  }, []);

  const clearHandshakeTimers = useCallback(() => {
    if (handshakeIntervalRef.current !== null) {
      window.clearInterval(handshakeIntervalRef.current);
      handshakeIntervalRef.current = null;
    }
    if (handshakeTimeoutRef.current !== null) {
      window.clearTimeout(handshakeTimeoutRef.current);
      handshakeTimeoutRef.current = null;
    }
  }, []);

  const postToViewer = useCallback((type: string, payload?: unknown): boolean => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) {
      return false;
    }
    targetWindow.postMessage(
      {
        source: QIHANG_WEB_SOURCE,
        type,
        payload,
      },
      "*",
    );
    return true;
  }, []);

  const postCaptureEvent = useCallback(
    (name: ViewerCaptureEventName, extra?: Record<string, unknown>) => {
      const payload = { name, ...extra };
      postToViewer(VIEWER_MESSAGE_CAPTURE_EVENT, payload);
      // Keep telemetry/state fields in sync even if capture-event listeners are not yet ready.
      postToViewer(VIEWER_MESSAGE_SET_STATE, { capture_event: payload });
    },
    [postToViewer],
  );

  const startHandshake = useCallback(
    (reason: string) => {
      clearHandshakeTimers();
      viewerReadyRef.current = false;
      setViewerReady(false);
      setConnectionPhase("connecting");
      setAvailableCommands([]);
      setHandshakeAttempts(0);
      handshakeAttemptRef.current = 0;

      const tick = () => {
        if (viewerReadyRef.current) return;
        if (handshakeAttemptRef.current >= 20) {
          clearHandshakeTimers();
          return;
        }
        handshakeAttemptRef.current += 1;
        setHandshakeAttempts(handshakeAttemptRef.current);
        postToViewer(VIEWER_MESSAGE_GET_STATE, {
          reason,
          attempt: handshakeAttemptRef.current,
        });
      };

      tick();
      handshakeIntervalRef.current = window.setInterval(tick, 400);
      handshakeTimeoutRef.current = window.setTimeout(() => {
        if (!viewerReadyRef.current) {
          setConnectionPhase("timeout");
        }
      }, 8000);
    },
    [clearHandshakeTimers, postToViewer],
  );

  const commandSupported = useCallback(
    (name: ViewerCommand): boolean => availableCommands.includes(name),
    [availableCommands],
  );

  const sendViewerCommand = useCallback(
    (name: ViewerCommand) => {
      if (!commandSupported(name)) return;
      postToViewer(VIEWER_MESSAGE_COMMAND, { name });
    },
    [postToViewer, commandSupported],
  );

  const patchViewerState = useCallback(
    (patch: Record<string, unknown>) => {
      postToViewer(VIEWER_MESSAGE_SET_STATE, patch);
    },
    [postToViewer],
  );

  const canSyncViewerState = viewerReady || connectionPhase === "degraded";
  const pushViewerState = useCallback(() => {
    if (!canSyncViewerState) return;

    const payload: Record<string, unknown> = {
      task,
      demoHasImage: Boolean(file),
      demoBusy: busy,
      demoMessage: statusMessage,
      case_mode: viewerState.caseMode,
    };

    if (result) {
      payload.mode = modeFromIcons(result.ui_cards?.status_icons || []);
      payload.layer = task === "ocr" ? 2 : 3;
    }

    postToViewer(VIEWER_MESSAGE_SET_STATE, payload);
  }, [canSyncViewerState, task, file, busy, statusMessage, result, postToViewer, viewerState.caseMode]);

  useEffect(() => {
    pushViewerState();
  }, [pushViewerState]);

  const runInference = useCallback(async () => {
    if (busy) return;
    if (!file) {
      setStatusMessage("请先在触控屏点击 PICK IMG 选择图片");
      postCaptureEvent("capture_blocked", { reason: "image_not_ready" });
      return;
    }

    const captureStartMs = performance.now();
    postCaptureEvent("capture_start", {
      trigger: "app_run_infer",
      task,
      case_mode: viewerState.caseMode,
      sent_at: new Date().toISOString(),
    });

    setBusy(true);
    try {
      setStatusMessage("正在申请上传地址...");
      const presign = await apiPost<DemoPresignResponse>("/api/v1/demo/presign", {
        filename: file.name,
        media_type: file.type || "application/octet-stream",
        size_bytes: file.size,
      });

      setStatusMessage("正在上传图片...");
      const putRes = await uploadToPresignedUrl(
        presign.put_url,
        {
          method: "PUT",
          headers: presign.headers,
          body: file,
        },
        { authenticated: false },
      );
      if (!putRes.ok) {
        throw new Error(`图片上传失败(${putRes.status})`);
      }
      const afterUploadMs = performance.now();
      const captureToUploadMs = afterUploadMs - captureStartMs;
      postCaptureEvent("capture_uploaded", {
        task,
        capture_to_upload_ms: Number(captureToUploadMs.toFixed(1)),
      });

      setStatusMessage("正在请求推理...");
      const data = await apiPost<DemoInferResponse>("/api/v1/demo/infer", {
        request_id: presign.request_id,
        task,
        prompt: buildPrompt(task),
        locale: "zh-CN",
      });
      const afterInferMs = performance.now();
      const uploadToAiMs = afterInferMs - afterUploadMs;
      const aiToTtsMs = viewerState.caseMode === "office_mode" ? 100 : 180;
      const e2eMs = afterInferMs - captureStartMs + aiToTtsMs;

      setResult(data);
      const summary = summarizeByCaseMode(summarizeResult(data), viewerState.caseMode);
      setStatusMessage(`${summary} · request_id=${data.request_id}`);
      postCaptureEvent("ai_response_ready", {
        task,
        request_id: data.request_id,
        upload_to_ai_ms: Number(uploadToAiMs.toFixed(1)),
        ai_to_tts_ms: Number(aiToTtsMs.toFixed(1)),
        e2e_ms: Number(e2eMs.toFixed(1)),
        tts_mode: viewerState.caseMode === "office_mode" ? "keywords_only" : "normal",
      });
    } catch (err) {
      const fallbackText = "云端超时，已回退本地简化描述";
      setStatusMessage(err instanceof Error ? err.message : fallbackText);
      postCaptureEvent("capture_blocked", {
        reason: "cloud_timeout_fallback_local",
        detail: err instanceof Error ? err.message : "inference_failed",
      });
      postCaptureEvent("ai_response_ready", {
        degraded: true,
        ai_to_tts_ms: 80,
        e2e_ms: Number((performance.now() - captureStartMs + 80).toFixed(1)),
        summary: "本地回退：请重试或切换网络",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, file, postCaptureEvent, task, viewerState.caseMode]);

  useEffect(() => {
    if (!deferredViewerSrc) return;

    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow) {
        return;
      }
      if (event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as
        | {
            source?: string;
            type?: string;
            payload?: Record<string, unknown>;
          }
        | undefined;
      if (!data || data.source !== QIHANG_VIEWER_SOURCE) {
        return;
      }

      if (data.type === VIEWER_MESSAGE_READY) {
        const payload = data.payload || {};
        const commands = Array.isArray(payload.commands)
          ? (payload.commands.filter(
              (item): item is ViewerCommand =>
                typeof item === "string" &&
                KNOWN_VIEWER_COMMANDS.includes(item as ViewerCommand),
            ) as ViewerCommand[])
          : [];
        setAvailableCommands(commands.length > 0 ? commands : [...KNOWN_VIEWER_COMMANDS]);
        if (payload.state) {
          setViewerState((prev) => sanitizeViewerState(payload.state, prev));
        }
        viewerReadyRef.current = true;
        setViewerReady(true);
        setConnectionPhase("connected");
        clearHandshakeTimers();
        postToViewer(VIEWER_MESSAGE_GET_STATE, { reason: "ready-ack" });
        return;
      }

      if (data.type === VIEWER_MESSAGE_STATE) {
        setViewerState((prev) => sanitizeViewerState(data.payload, prev));
        if (!viewerReadyRef.current) {
          setConnectionPhase((prev) => (prev === "timeout" ? "timeout" : "degraded"));
          setAvailableCommands((prev) => (prev.length > 0 ? prev : [...KNOWN_VIEWER_COMMANDS]));
        }
        return;
      }

      if (data.type === VIEWER_MESSAGE_CAPTURE_EVENT) {
        const name = typeof data.payload?.name === "string" ? data.payload.name : "";
        if (name === "capture_start") {
          setStatusMessage("采集已触发，正在处理...");
        } else if (name === "capture_uploaded") {
          const ms = typeof data.payload?.capture_to_upload_ms === "number"
            ? data.payload.capture_to_upload_ms.toFixed(1)
            : "-";
          setStatusMessage(`上传完成（${ms}ms）`);
        } else if (name === "capture_blocked") {
          const reason = typeof data.payload?.reason === "string" ? data.payload.reason : "unknown";
          setStatusMessage(`采集被拦截：${reason}`);
        } else if (name === "ai_response_ready") {
          const e2e = typeof data.payload?.e2e_ms === "number" ? data.payload.e2e_ms.toFixed(1) : "-";
          setStatusMessage((prev) => `${prev} · E2E=${e2e}ms`);
        }
        return;
      }

      if (data.type !== VIEWER_MESSAGE_SCREEN_ACTION) {
        return;
      }

      const action = typeof data.payload?.action === "string" ? data.payload.action : "";

      if (action === "toggle-task") {
        const next = data.payload?.task;
        if (next === "vqa" || next === "ocr") {
          setTask(next);
          setStatusMessage(`任务已切换到 ${next.toUpperCase()}`);
          return;
        }
        setTask((prev) => {
          const switched: DemoTask = prev === "vqa" ? "ocr" : "vqa";
          setStatusMessage(`任务已切换到 ${switched.toUpperCase()}`);
          return switched;
        });
      }

      if (action === "pick-file") {
        fileInputRef.current?.click();
      }

      if (action === "run-infer") {
        void runInference();
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      clearHandshakeTimers();
      window.removeEventListener("message", onMessage);
      viewerReadyRef.current = false;
    };
  }, [clearHandshakeTimers, deferredViewerSrc, runInference, postToViewer, startHandshake]);

  // Pre-release WebGL resources when navigation is about to happen.
  // Without this, Chrome blocks the main thread while synchronously tearing
  // down the GPU context during React unmount, causing a multi-second stall.
  useEffect(() => {
    const onSuspend = () => {
      clearHandshakeTimers();
      viewerReadyRef.current = false;
      setViewerReady(false);
      const frame = iframeRef.current;
      if (frame) {
        frame.src = "about:blank";
      }
    };
    window.addEventListener("qihang:viewer-suspend", onSuspend);
    return () => {
      window.removeEventListener("qihang:viewer-suspend", onSuspend);
    };
  }, [clearHandshakeTimers]);

  const retryViewerConnection = useCallback(() => {
    startHandshake("manual-retry");
  }, [startHandshake]);

  const connectionMeta = useMemo(() => {
    if (connectionPhase === "connected") {
      return { label: "已连接", tone: "bg-[#e7f7ef] text-[#17653c]" };
    }
    if (connectionPhase === "degraded") {
      return { label: "降级连接", tone: "bg-[#fff7e8] text-[#8a5a18]" };
    }
    if (connectionPhase === "timeout") {
      return { label: "连接超时", tone: "bg-[#ffecec] text-[#8f1d1d]" };
    }
    return { label: "连接中", tone: "bg-[#fff4e5] text-[#8a5a18]" };
  }, [connectionPhase]);

  const commandUnavailableReason = useMemo(() => {
    if (availableCommands.length > 0) return "";
    if (connectionPhase === "timeout") return td("advanced.connectionTimeout");
    if (connectionPhase === "connecting") return "模型握手中，命令暂不可用。";
    return "等待命令列表回传。";
  }, [availableCommands.length, connectionPhase, td]);
  const pivotPlugActionLabel = viewerState.pivotPlugAnimating
    ? "封帽移动中"
    : viewerState.pivotPlugReady
      ? td("pivot.retract")
      : td("pivot.align");
  const pivotPlugStatusLabel = viewerState.pivotPlugInserted
    ? td("pivot.inserted")
    : viewerState.pivotPlugReady
      ? td("pivot.readyPercent", { percent: Math.round(viewerState.pivotPlugSlideT * 100) })
      : td("pivot.external");
  const canRunInference = Boolean(file) && !busy;
  const inferenceSummary = result
    ? summarizeResult(result)
    : busy
      ? td("result.loading")
      : td("result.empty");
  const diagnosticItems = [
    [td("diag.connection"), connectionMeta.label],
    [td("diag.handshake"), `${handshakeAttempts}/20`],
    [td("diag.availableCommands"), td("diag.commandCount", { count: availableCommands.length })],
    [td("diag.mechRevision"), viewerState.mechRevision],
    [td("diag.printProfile"), viewerState.printProfile],
    [td("diag.earbudSpec"), viewerState.earbudSpecRevision],
    [td("diag.privacySlider"), viewerState.privacyLockHw ? td("diag.privacyLock") : td("diag.privacyUnlock")],
    [td("diag.captureEvent"), `${viewerState.captureLastEvent || td("diag.none")}${viewerState.captureBlockedReason ? ` (${viewerState.captureBlockedReason})` : ""}`],
    [
      td("diag.latencyBreakdown"),
      `upload ${viewerState.captureToUploadMs.toFixed(1)} / ai ${viewerState.uploadToAiMs.toFixed(1)} / tts ${viewerState.aiToTtsMs.toFixed(1)}`,
    ],
    [
      td("diag.earbudFit"),
      `${viewerState.earbudFitClearanceMm.toFixed(3)}mm · ${viewerState.earbudFitMeasurementValid ? td("diag.fitValid") : td("diag.fitInvalid")}`,
    ],
    [td("diag.pivotStatus"), `${viewerState.pivotState} · ${viewerState.pivotAngleDeg.toFixed(1)}°`],
    [td("diag.pivotLayout"), `${viewerState.pivotLayout} / ${viewerState.pivotSwingSide}`],
  ] as [string, string][];

  const selectClass = "mt-1 block w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--brand-v2)] focus:outline-none";

  return (
    <section ref={sectionRef} className="mx-auto max-w-6xl px-6 pb-24 pt-8">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        aria-label={td("control.upload")}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0] || null;
          setFile(picked);
          if (picked) {
            setStatusMessage(td("status.imageSelected", { name: picked.name }));
            patchViewerState({ demoHasImage: true, demoMessage: td("status.imageReady", { name: picked.name }) });
          } else {
            setStatusMessage(td("status.noImage"));
            patchViewerState({ demoHasImage: false, demoMessage: td("status.noImageSelected") });
          }
        }}
      />

      {/* ── Hero ── */}
      <div className="demo-hero text-center">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          {td("hero.eyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-[var(--text-primary)] sm:text-4xl">
          {td("hero.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[var(--text-secondary)]">
          {td("hero.body")}
        </p>
      </div>

      {/* ── Controls ── */}
      <div className="demo-controls mt-8 flex flex-wrap items-center justify-center gap-3">
        {/* 任务模式切换 */}
        <div className="inline-flex gap-1 rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-surface)] p-1" role="tablist" aria-label={td("task.selectLabel")}>
          <button
            type="button"
            className={`min-h-[44px] rounded-[var(--radius-full)] px-5 py-2 text-sm font-medium transition-colors ${task === "vqa" ? "bg-[var(--text-primary)] text-[var(--bg-base)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            aria-pressed={task === "vqa"}
            onClick={() => setTask("vqa")}
          >
            {td("task.vqa")}
          </button>
          <button
            type="button"
            className={`min-h-[44px] rounded-[var(--radius-full)] px-5 py-2 text-sm font-medium transition-colors ${task === "ocr" ? "bg-[var(--text-primary)] text-[var(--bg-base)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
            aria-pressed={task === "ocr"}
            onClick={() => setTask("ocr")}
          >
            {td("task.ocr")}
          </button>
        </div>

        {/* 分隔线 */}
        <span className="hidden h-6 w-px bg-[var(--border)] sm:block" aria-hidden="true" />

        {/* 操作按钮 */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="min-h-[44px] rounded-[var(--radius-full)] border border-[var(--border)] bg-[var(--bg-base)] px-5 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-surface)]"
          >
            {td("control.upload")}
          </button>
          <button
            type="button"
            onClick={() => { void runInference(); }}
            disabled={!canRunInference}
            className={`min-h-[44px] rounded-[var(--radius-full)] px-5 py-2 text-sm font-medium transition-transform ${canRunInference ? "bg-[var(--brand-v2)] text-white hover:scale-[1.02] active:scale-[0.98]" : "bg-[var(--bg-raised)] text-[var(--text-secondary)] cursor-not-allowed"}`}
          >
            {busy ? td("control.inferring") : td("control.startInference")}
          </button>
          {connectionPhase === "timeout" && (
            <button
              type="button"
              onClick={retryViewerConnection}
              className="min-h-[44px] rounded-[var(--radius-full)] border border-[var(--error)] px-4 py-2 text-sm font-medium text-[var(--error)] transition-colors hover:bg-red-50"
            >
              {td("control.reconnect")}
            </button>
          )}
        </div>

        {/* 分隔线 */}
        <span className="hidden h-6 w-px bg-[var(--border)] sm:block" aria-hidden="true" />

        {/* 状态指示器 */}
        <span className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-full)] px-3 py-1 text-xs font-medium ${connectionMeta.tone}`}>
          <span className={`inline-block h-2 w-2 rounded-full ${connectionPhase === "connected" ? "bg-[var(--success-v2)]" : connectionPhase === "timeout" ? "bg-[var(--error)]" : "bg-[var(--warning-v2)]"}`} />
          {connectionMeta.label}
        </span>
      </div>

      {/* ── Status message ── */}
      <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">{statusMessage}</p>

      {/* ── 3D Viewer ── */}
      <div
        className="demo-viewer relative mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-black"
        onMouseEnter={() => showViewerHint && setShowViewerHint(false)}
        onTouchStart={() => showViewerHint && setShowViewerHint(false)}
      >
        {deferredViewerSrc ? (
          <iframe
            ref={iframeRef}
            src={deferredViewerSrc}
            title={td("viewer.title")}
            className="demo-iframe block w-full"
            loading="lazy"
            onLoad={() => {
              startHandshake("iframe-load");
              setTimeout(() => setShowViewerHint(false), 4000);
            }}
          />
        ) : null}

        {/* 交互引导覆层 */}
        {showViewerHint && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity duration-700">
            <div className="flex flex-col items-center gap-3 text-white/90">
              {/* 拖拽图标 */}
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-80">
                <path d="M14 4.1 12 6l-2-1.9" /><path d="M12 2v4" />
                <path d="m4.1 10-1.9 2 1.9 2" /><path d="M2 12h4" />
                <path d="m19.9 10 1.9 2-1.9 2" /><path d="M22 12h-4" />
                <path d="m10 19.9 2 1.9 2-1.9" /><path d="M12 22v-4" />
              </svg>
              <span className="text-sm font-medium">{td("viewer.hint.drag")}</span>
              <span className="text-xs opacity-70">{td("viewer.hint.scroll")}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Result card ── */}
      {(result || busy) && (
        <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">{td("response.kicker")}</p>
              <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">{inferenceSummary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-[var(--radius-full)] bg-[var(--bg-raised)] px-3 py-1 text-xs text-[var(--text-secondary)]">{viewerState.caseMode}</span>
              <span className="inline-flex items-center rounded-[var(--radius-full)] bg-[var(--bg-raised)] px-3 py-1 text-xs text-[var(--text-secondary)]">{file ? file.name : td("response.waitingImage")}</span>
              {result && <span className="inline-flex items-center rounded-[var(--radius-full)] bg-[var(--brand-soft)] px-3 py-1 text-xs font-medium text-[var(--brand-v2)]">{result.latency_ms}ms</span>}
            </div>
          </div>
        </div>
      )}

      {/* ── Advanced Controls (collapsed) ── */}
      <details className="mt-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
        <summary className="cursor-pointer select-none px-6 py-5">
          <h2 className="inline text-base font-semibold text-[var(--text-primary)]">
            <span className="mr-3 text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">{td("advanced.kicker")}</span>
            {td("advanced.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{td("advanced.summary")}</p>
        </summary>

        <div className="space-y-6 border-t border-[var(--border)] px-6 py-6">
          {commandUnavailableReason && <p className="text-sm text-[var(--warning-v2)]">{commandUnavailableReason}</p>}

          {/* Structure */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{td("advanced.structure")}</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{td("advanced.structureDesc")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button className={commandBtn(commandSupported("toggle-open"), viewerState.isOpen)} disabled={!commandSupported("toggle-open")} onClick={() => sendViewerCommand("toggle-open")}>{viewerState.isOpen ? td("advanced.closeLid") : td("advanced.openLid")}</button>
              <button className={commandBtn(commandSupported("toggle-camera"), viewerState.camDetached)} disabled={!commandSupported("toggle-camera")} onClick={() => sendViewerCommand("toggle-camera")}>{viewerState.camDetached ? td("advanced.attachCam") : td("advanced.detachCam")}</button>
              <button className={commandBtn(commandSupported("toggle-earbuds"), viewerState.earbudsOut)} disabled={!commandSupported("toggle-earbuds")} onClick={() => sendViewerCommand("toggle-earbuds")}>{viewerState.earbudsOut ? td("advanced.earbudsIn") : td("advanced.earbudsOut")}</button>
              <button className={commandBtn(commandSupported("toggle-dream"), viewerState.dreamOn)} disabled={!commandSupported("toggle-dream")} onClick={() => sendViewerCommand("toggle-dream")}>{viewerState.dreamOn ? td("advanced.dreamOn") : td("advanced.dreamOff")}</button>
              <button className={commandBtn(commandSupported("toggle-spin"), viewerState.autoSpin)} disabled={!commandSupported("toggle-spin")} onClick={() => sendViewerCommand("toggle-spin")}>{viewerState.autoSpin ? td("advanced.spinOn") : td("advanced.spinOff")}</button>
              <button className={commandBtn(commandSupported("toggle-explode"), viewerState.exploded)} disabled={!commandSupported("toggle-explode")} onClick={() => sendViewerCommand("toggle-explode")}>{viewerState.exploded ? td("advanced.explodedOn") : td("advanced.explodedOff")}</button>
              <button className={commandBtn(commandSupported("toggle-xray"), viewerState.xrayOn)} disabled={!commandSupported("toggle-xray")} onClick={() => sendViewerCommand("toggle-xray")}>{viewerState.xrayOn ? td("advanced.xrayOn") : td("advanced.xrayOff")}</button>
              <button className={commandBtn(commandSupported("toggle-night"), viewerState.nightOn)} disabled={!commandSupported("toggle-night")} onClick={() => sendViewerCommand("toggle-night")}>{viewerState.nightOn ? td("advanced.nightOn") : td("advanced.nightOff")}</button>
            </div>
          </div>

          {/* Views */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{td("advanced.viewSection")}</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{td("advanced.viewSectionDesc")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button className={commandBtn(commandSupported("reset-view"))} disabled={!commandSupported("reset-view")} onClick={() => sendViewerCommand("reset-view")}>{td("advanced.resetView")}</button>
              <button className={commandBtn(commandSupported("focus-front-view"))} disabled={!commandSupported("focus-front-view")} onClick={() => sendViewerCommand("focus-front-view")}>{td("advanced.frontView")}</button>
              <button className={commandBtn(commandSupported("focus-rear-view"))} disabled={!commandSupported("focus-rear-view")} onClick={() => sendViewerCommand("focus-rear-view")}>{td("advanced.rearView")}</button>
              <button className={commandBtn(commandSupported("focus-pivot-view"))} disabled={!commandSupported("focus-pivot-view")} onClick={() => sendViewerCommand("focus-pivot-view")}>{td("advanced.pivotView")}</button>
              <button className={commandBtn(commandSupported("focus-pivot-front-view"))} disabled={!commandSupported("focus-pivot-front-view")} onClick={() => sendViewerCommand("focus-pivot-front-view")}>{td("advanced.pivotFrontView")}</button>
              <button className={commandBtn(commandSupported("focus-pivot-rear-view"))} disabled={!commandSupported("focus-pivot-rear-view")} onClick={() => sendViewerCommand("focus-pivot-rear-view")}>{td("advanced.pivotRearView")}</button>
              <button className={commandBtn(commandSupported("focus-pivot-rear-corner-view"))} disabled={!commandSupported("focus-pivot-rear-corner-view")} onClick={() => sendViewerCommand("focus-pivot-rear-corner-view")}>{td("advanced.rearCornerView")}</button>
              <button className={commandBtn(commandSupported("focus-pivot-xray-view"))} disabled={!commandSupported("focus-pivot-xray-view")} onClick={() => sendViewerCommand("focus-pivot-xray-view")}>{td("advanced.pivotXrayView")}</button>
              <button className={commandBtn(commandSupported("focus-pivot-inspect-view"))} disabled={!commandSupported("focus-pivot-inspect-view")} onClick={() => sendViewerCommand("focus-pivot-inspect-view")}>{td("advanced.inspectFocus")}</button>
              <button className={commandBtn(commandSupported("focus-ear-left-view"))} disabled={!commandSupported("focus-ear-left-view")} onClick={() => sendViewerCommand("focus-ear-left-view")}>{td("advanced.earLeftView")}</button>
              <button className={commandBtn(commandSupported("focus-ear-right-view"))} disabled={!commandSupported("focus-ear-right-view")} onClick={() => sendViewerCommand("focus-ear-right-view")}>{td("advanced.earRightView")}</button>
              <button className={commandBtn(commandSupported("focus-ear-dock-view"))} disabled={!commandSupported("focus-ear-dock-view")} onClick={() => sendViewerCommand("focus-ear-dock-view")}>{td("advanced.earDockView")}</button>
              <button className={commandBtn(commandSupported("toggle-earbud-xray"), viewerState.xrayOn)} disabled={!commandSupported("toggle-earbud-xray")} onClick={() => sendViewerCommand("toggle-earbud-xray")}>{td("advanced.earbudXray")}</button>
              <button className={commandBtn(commandSupported("toggle-pivot-inspect"), viewerState.pivotInspectActive)} disabled={!commandSupported("toggle-pivot-inspect")} onClick={() => sendViewerCommand("toggle-pivot-inspect")}>{viewerState.pivotInspectActive ? td("advanced.pivotInspectOn") : td("advanced.pivotInspectOff")}</button>
              <button className={commandBtn(commandSupported("toggle-pivot-explode"), viewerState.pivotExplodeActive)} disabled={!commandSupported("toggle-pivot-explode")} onClick={() => sendViewerCommand("toggle-pivot-explode")}>{viewerState.pivotExplodeActive ? td("advanced.pivotExplodeOn") : td("advanced.pivotExplodeOff")}</button>
            </div>
          </div>

          {/* Modes */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{td("advanced.modeSection")}</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{td("advanced.modeSectionDesc")}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block text-xs text-[var(--text-secondary)]">
                {td("advanced.modeLabel")}
                <select className={selectClass} value={viewerState.mode} onChange={(e) => patchViewerState({ mode: e.target.value as ViewerMode })}>
                  <option value="offline">{td("status.offline")}</option>
                  <option value="online">{td("status.online")}</option>
                  <option value="hybrid">{td("status.hybrid")}</option>
                </select>
              </label>
              <label className="block text-xs text-[var(--text-secondary)]">
                {td("advanced.caseModeLabel")}
                <select className={selectClass} value={viewerState.caseMode} onChange={(e) => patchViewerState({ case_mode: e.target.value as ViewerCaseMode })}>
                  <option value="commute_mode">{td("caseMode.commute")}</option>
                  <option value="office_mode">{td("caseMode.office")}</option>
                  <option value="silent_privacy_mode">{td("caseMode.silentPrivacy")}</option>
                </select>
              </label>
              <label className="block text-xs text-[var(--text-secondary)]">
                {td("advanced.layerLabel")}
                <select className={selectClass} value={viewerState.layer} onChange={(e) => patchViewerState({ layer: clampLayer(Number(e.target.value)) })}>
                  <option value={1}>L1</option>
                  <option value={2}>L2</option>
                  <option value={3}>L3</option>
                  <option value={4}>L4</option>
                </select>
              </label>
              <label className="block text-xs text-[var(--text-secondary)]">
                {td("advanced.colorwayLabel")}
                <select className={selectClass} value={viewerState.colorway} onChange={(e) => patchViewerState({ colorway: e.target.value as ViewerColorway })}>
                  <option value="pearl">{td("colorway.pearl")}</option>
                  <option value="graphite">{td("colorway.graphite")}</option>
                  <option value="glacier">{td("colorway.glacier")}</option>
                </select>
              </label>
              <label className="block text-xs text-[var(--text-secondary)]">
                {td("advanced.pivotSideLabel")}
                <select className={selectClass} value={viewerState.pivotSwingSide} onChange={(e) => patchViewerState({ pivot_swing_side: e.target.value as ViewerPivotSide })}>
                  <option value="left">{td("side.left")}</option>
                  <option value="right">{td("side.right")}</option>
                </select>
              </label>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button className={commandBtn(true, viewerState.privacyLockHw)} onClick={() => patchViewerState({ privacy_lock_hw: !viewerState.privacyLockHw })}>{viewerState.privacyLockHw ? td("advanced.privacyOff") : td("advanced.privacyOn")}</button>
              <button className={commandBtn(true, viewerState.caseMode === "silent_privacy_mode")} onClick={() => patchViewerState({ case_mode: viewerState.caseMode === "silent_privacy_mode" ? "office_mode" : "silent_privacy_mode" })}>{viewerState.caseMode === "silent_privacy_mode" ? td("advanced.silentPrivacyOn") : td("advanced.silentPrivacyOff")}</button>
            </div>
          </div>

          {/* Export */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">{td("advanced.exportSection")}</h3>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{td("advanced.exportSectionDesc")}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button className={commandBtn(canSyncViewerState, viewerState.pivotPlugReady || viewerState.pivotPlugInserted)} disabled={!canSyncViewerState} onClick={() => patchViewerState(viewerState.pivotPlugReady || viewerState.pivotPlugInserted ? { pivot_plug_ready: false } : { pivot_plug_ready: true })}>{pivotPlugActionLabel}</button>
              <button className={commandBtn(commandSupported("toggle-task"))} disabled={!commandSupported("toggle-task")} onClick={() => sendViewerCommand("toggle-task")}>{td("advanced.taskToggle")}</button>
              <button className={commandBtn(commandSupported("cycle-mode"))} disabled={!commandSupported("cycle-mode")} onClick={() => sendViewerCommand("cycle-mode")}>{td("advanced.cycleMode")}</button>
              <button className={commandBtn(commandSupported("cycle-layer"))} disabled={!commandSupported("cycle-layer")} onClick={() => sendViewerCommand("cycle-layer")}>{td("advanced.cycleLayer")}</button>
              <button className={commandBtn(commandSupported("export-glb"))} disabled={!commandSupported("export-glb")} onClick={() => sendViewerCommand("export-glb")}>{td("advanced.exportGlb")}</button>
              <button className={commandBtn(commandSupported("export-stl-pack"))} disabled={!commandSupported("export-stl-pack")} onClick={() => sendViewerCommand("export-stl-pack")}>{td("advanced.exportStl")}</button>
            </div>
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3">
              <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
                <span>{td("advanced.capSliderLabel")}</span>
                <span>{Math.round(viewerState.pivotPlugSlideT * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                aria-label={td("advanced.capSliderLabel")}
                value={Math.round(viewerState.pivotPlugSlideT * 100)}
                disabled={!canSyncViewerState || !viewerState.pivotPlugReady || viewerState.pivotPlugAnimating}
                onChange={(event) => patchViewerState({ pivot_plug_slide_t: Number(event.target.value) / 100 })}
                className="mt-2 w-full accent-[var(--brand-v2)] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{td("advanced.capSliderHint")}</p>
            </div>
          </div>
        </div>
      </details>

      {/* ── Diagnostics (collapsed) ── */}
      <details className="mt-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)]">
        <summary className="cursor-pointer select-none px-6 py-5">
          <h2 className="inline text-base font-semibold text-[var(--text-primary)]">
            <span className="mr-3 text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">{td("diag.kicker")}</span>
            {td("diag.title")}
          </h2>
        </summary>

        <div className="border-t border-[var(--border)] px-6 py-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{td("diag.caseMode")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{viewerState.caseMode}</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{td("diag.pivotPlug")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{pivotPlugStatusLabel}</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{td("diag.latency")}</div>
              <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{viewerState.e2eMs.toFixed(1)}ms</div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] p-4">
              <div className="text-xs text-[var(--text-secondary)]">{td("diag.model")}</div>
              <div className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">{viewerState.statusText}</div>
            </div>
          </div>

          <div className="mt-4 space-y-1">
            {diagnosticItems.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm odd:bg-[var(--bg-raised)]">
                <span className="text-[var(--text-secondary)]">{label}</span>
                <span className="font-medium text-[var(--text-primary)]">{value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm odd:bg-[var(--bg-raised)]">
              <span className="text-[var(--text-secondary)]">{td("diag.selectedImage")}</span>
              <span className="font-medium text-[var(--text-primary)]">{file ? file.name : td("metric.noImage")}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm odd:bg-[var(--bg-raised)]">
              <span className="text-[var(--text-secondary)]">{td("diag.pocketGuard")}</span>
              <span className="font-medium text-[var(--text-primary)]">{viewerState.pocketGuardActive ? td("diag.pocketActive") : td("diag.pocketInactive")}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm odd:bg-[var(--bg-raised)]">
              <span className="text-[var(--text-secondary)]">{td("diag.contact")}</span>
              <span className="font-medium text-[var(--text-primary)]">L {viewerState.earbudContactEngagedL ? "YES" : "NO"} / R {viewerState.earbudContactEngagedR ? "YES" : "NO"}</span>
            </div>
            <div className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm odd:bg-[var(--bg-raised)]">
              <span className="text-[var(--text-secondary)]">{td("diag.lateralJitter")}</span>
              <span className="font-medium text-[var(--text-primary)]">{viewerState.closedLateralJitterMm.toFixed(3)}mm</span>
            </div>
          </div>
        </div>
      </details>
    </section>
  );
}
