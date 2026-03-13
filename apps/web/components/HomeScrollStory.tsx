"use client";

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";

import { MagneticButton } from "@/components/MagneticButton";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { TextReveal } from "@/components/TextReveal";
import { useDeferredIframeSrc } from "@/lib/useDeferredIframeSrc";
import { useParallax } from "@/lib/useParallax";
import { useScrollReveal } from "@/lib/useScrollReveal";
import {
  QIHANG_VIEWER_SOURCE,
  QIHANG_WEB_SOURCE,
  VIEWER_MESSAGE_GET_STATE,
  VIEWER_MESSAGE_READY,
  VIEWER_MESSAGE_SET_STATE,
  VIEWER_MESSAGE_STATE,
  VIEWER_STORY_SRC_BASE,
  appendParentOrigin,
  type ViewerCaseMode,
  type ViewerColorway,
  type ViewerMode,
} from "@/lib/qihang-viewer-contract";

type StoryDetail = {
  label: string;
  body: string;
};

type StoryScene = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  details: StoryDetail[];
  stageLabel: string;
  stageSummary: string;
  stageTags: string[];
  assetSlots: string[];
  tone: "pearl" | "midnight" | "glacier" | "obsidian";
};

const STORY_SCENES: StoryScene[] = [
  {
    id: "intro",
    eyebrow: "QIHANG / Environment AI",
    title: "看见周围，理解周围。",
    summary:
      "一枚随身佩戴的 AI 设备——看见你所处的环境，即时给出反馈。无需掏出手机，无需打开应用。",
    details: [
      { label: "随身佩戴", body: "胸前相机 + 圆盘盒 + 无线耳机，三件一体。" },
      { label: "即时反馈", body: "拍下画面，几秒内通过耳机收到 AI 语音回答。" },
      { label: "隐私可控", body: "你决定何时开始、何时停止，状态灯始终可见。" },
    ],
    stageLabel: "QIHANG",
    stageSummary: "环境 AI，从佩戴开始。",
    stageTags: ["可佩戴", "AI 视觉", "即时反馈"],
    assetSlots: ["产品主镜头", "盒体近景", "开场短动画"],
    tone: "pearl",
  },
  {
    id: "hardware",
    eyebrow: "Hardware",
    title: "一个盒子，收纳一切。",
    summary:
      "圆盘盒通过磁吸转轴开合。耳机嵌入盒内充电，相机通过磁吸挂扣佩戴在胸前。",
    details: [
      { label: "圆盘盒", body: "触控表面 + 状态反馈 + 耳机收纳，随身携带。" },
      { label: "转轴开合", body: "112° 磁吸铰链，单手即可打开取用。" },
      { label: "胸前相机", body: "8g 超轻模块，磁吸挂扣固定，随时摘戴。" },
    ],
    stageLabel: "产品结构",
    stageSummary: "开合之间，一切就位。",
    stageTags: ["圆盘盒", "转轴", "磁吸"],
    assetSlots: ["转轴微距镜头", "佩戴场景", "材质细节"],
    tone: "midnight",
  },
  {
    id: "modes",
    eyebrow: "Intelligence Modes",
    title: "三种模式，无缝切换。",
    summary:
      "离线模式在本地完成基础识别；混合模式按需接入云端增强；在线模式释放全部 AI 能力。",
    details: [
      { label: "Offline", body: "无网络时仍可工作，本地模型即时响应。" },
      { label: "Hybrid", body: "自动判断是否需要云端，用户无感切换。" },
      { label: "Online", body: "完整模型能力，复杂场景深度理解。" },
    ],
    stageLabel: "智能模式",
    stageSummary: "从离线到在线，能力逐级释放。",
    stageTags: ["Offline", "Hybrid", "Online"],
    assetSlots: ["模式切换短片", "状态灯录制", "系统联动录屏"],
    tone: "glacier",
  },
  {
    id: "privacy",
    eyebrow: "Privacy",
    title: "你的边界，设备尊重。",
    summary:
      "没有后台默默采集。按下才开始，松开就停止。状态灯、操作日志、数据审计——全程透明。",
    details: [
      { label: "显式触发", body: "物理按键启动采集，LED 灯亮起确认。" },
      { label: "全程可见", body: "设备状态、数据流向、推理结果实时显示。" },
      { label: "可审计", body: "所有采集和推理记录可回溯、可删除。" },
    ],
    stageLabel: "隐私设计",
    stageSummary: "透明、可控、可追溯。",
    stageTags: ["物理触发", "状态灯", "数据审计"],
    assetSlots: ["隐私模式示意", "触发动作实拍", "审计界面录屏"],
    tone: "obsidian",
  },
];

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function sameProgressArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => Math.abs(value - b[index]) < 0.01);
}

function sceneModeFromProgress(progress: number): ViewerMode {
  if (progress > 0.72) return "online";
  if (progress > 0.34) return "hybrid";
  return "offline";
}

function sceneColorwayFromProgress(modeProgress: number, privacyProgress: number): ViewerColorway {
  if (privacyProgress > 0.56) return "graphite";
  if (modeProgress > 0.52) return "glacier";
  return "pearl";
}

function sceneCaseModeFromProgress(modeProgress: number, privacyProgress: number): ViewerCaseMode {
  if (privacyProgress > 0.44) return "silent_privacy_mode";
  if (modeProgress > 0.38) return "commute_mode";
  return "office_mode";
}

function buildViewerPatch(progresses: number[], activeScene: StoryScene): Record<string, unknown> {
  const introProgress = clamp(progresses[0] ?? 0);
  const hardwareProgress = clamp(progresses[1] ?? 0);
  const modeProgress = clamp(progresses[2] ?? 0);
  const privacyProgress = clamp(progresses[3] ?? 0);
  const openProgress = clamp((hardwareProgress - 0.12) / 0.74);
  const mode = sceneModeFromProgress(modeProgress);
  const colorway = sceneColorwayFromProgress(modeProgress, privacyProgress);
  const caseMode = sceneCaseModeFromProgress(modeProgress, privacyProgress);
  const pivotAngleDeg = Math.round(openProgress * 112);

  return {
    autoSpin: introProgress < 0.5 && hardwareProgress < 0.2,
    isOpen: openProgress > 0.12,
    pivotAngleDeg,
    pivotState: openProgress > 0.92 ? "open" : openProgress > 0.18 ? "opening" : "closed",
    camDetached: hardwareProgress > 0.22,
    earbudsOut: openProgress > 0.58,
    mode,
    layer: modeProgress > 0.76 ? 3 : modeProgress > 0.34 ? 2 : 1,
    colorway,
    caseMode,
    dreamOn: modeProgress > 0.62,
    nightOn: privacyProgress > 0.3,
    xrayOn: privacyProgress > 0.74,
    pivotInspectActive: privacyProgress > 0.54,
    pivotExplodeActive: privacyProgress > 0.84,
    captureIndicatorHw: privacyProgress > 0.54,
    privacyLockHw: privacyProgress > 0.48,
    cameraPowerHw: privacyProgress < 0.46,
    pocketGuardActive: privacyProgress > 0.68,
    statusText: activeScene.stageLabel,
  };
}

const HomeStoryNarrative = memo(function HomeStoryNarrative({
  sceneRefs,
}: {
  sceneRefs: MutableRefObject<Array<HTMLElement | null>>;
}) {
  return (
    <div className="home-story-copy-column">
      {STORY_SCENES.map((scene, index) => (
        <section
          key={scene.id}
          ref={(node) => {
            sceneRefs.current[index] = node;
          }}
          className={`home-story-section ${index === 0 ? "is-opening" : ""}`}
        >
          <div className="home-story-section-index" data-reveal data-reveal-delay="1">
            {String(index + 1).padStart(2, "0")}
          </div>
          <div className="home-story-section-body">
            <div className="home-story-eyebrow" data-reveal>{scene.eyebrow}</div>
            {index === 0 ? (
              <>
                <TextReveal
                  text={scene.title}
                  tag="h1"
                  className="home-story-title gradient-text"
                  staggerMs={38}
                />
                <p className="home-story-summary is-opening" data-reveal data-reveal-delay="2">
                  {scene.summary}
                </p>
                <div className="home-story-actions" data-reveal data-reveal-delay="3">
                  <MagneticButton href="/demo" className="home-story-button is-primary" strength={0.18}>
                    进入 Demo
                  </MagneticButton>
                  <MagneticButton href="/product" className="home-story-button" strength={0.18}>
                    查看产品页
                  </MagneticButton>
                </div>
                <p className="home-story-scroll-note" data-reveal="fade" data-reveal-delay="5">
                  向下滑动，探索更多
                </p>
              </>
            ) : (
              <>
                <h2 className="home-story-title" data-reveal data-reveal-delay="1">
                  {scene.title}
                </h2>
                <p className="home-story-summary" data-reveal data-reveal-delay="2">
                  {scene.summary}
                </p>
              </>
            )}

            <div className="home-story-detail-list">
              {scene.details.map((detail, detailIndex) => (
                <div
                  key={detail.label}
                  className="home-story-detail"
                  data-reveal
                  data-reveal-delay={String(detailIndex + 3)}
                >
                  <span>{detail.label}</span>
                  <p>{detail.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <section className="home-workflow-band" data-parallax>
        <div className="home-story-eyebrow" data-reveal>Workflow</div>
        <h2 className="home-story-band-title" data-reveal data-reveal-delay="1">
          从体验到部署，一条线完成。
        </h2>
        <p className="home-story-band-summary" data-reveal data-reveal-delay="2">
          在线试用产品 → 上传你的数据 → 训练专属模型 → 一键发布上线。
        </p>
        <div className="home-workflow-rail" aria-label="Workflow rail">
          <span data-reveal data-reveal-delay="3">Demo</span>
          <span data-reveal data-reveal-delay="4">Dataset</span>
          <span data-reveal data-reveal-delay="5">Train</span>
          <span data-reveal data-reveal-delay="6">Release</span>
        </div>
        <div className="home-story-actions" data-reveal data-reveal-delay="7">
          <PublicDocumentLink href="/how-it-works" className="home-story-button">
            了解工作流
          </PublicDocumentLink>
          <PublicDocumentLink href="/pricing" className="home-story-button">
            查看方案
          </PublicDocumentLink>
        </div>
      </section>

      <section className="home-final-band" data-parallax>
        <div className="home-story-eyebrow" data-reveal>Get Started</div>
        <h2 className="home-story-band-title gradient-text-light" data-reveal data-reveal-delay="1">
          现在就试试。
        </h2>
        <p className="home-story-band-summary" data-reveal data-reveal-delay="2">
          打开 Demo，用你自己的照片体验环境 AI 的实时反馈。
        </p>
        <div className="home-story-actions" data-reveal data-reveal-delay="3">
          <MagneticButton href="/demo" className="home-story-button is-primary" strength={0.2}>
            进入 Demo
          </MagneticButton>
          <MagneticButton href="/contact" className="home-story-button" strength={0.2}>
            联系我们
          </MagneticButton>
        </div>
      </section>
    </div>
  );
});

export function HomeScrollStory({ viewerParentOrigin }: { viewerParentOrigin: string | null }) {
  const sceneRefs = useRef<Array<HTMLElement | null>>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const handshakeIntervalRef = useRef<number | null>(null);
  const handshakeTimeoutRef = useRef<number | null>(null);
  const latestPatchRef = useRef<Record<string, unknown>>({});
  const lastPatchSignatureRef = useRef("");
  const viewerReadyRef = useRef(false);
  const [sceneProgress, setSceneProgress] = useState<number[]>(() => STORY_SCENES.map(() => 0));
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [viewerSrc] = useState(() =>
    viewerParentOrigin ? appendParentOrigin(VIEWER_STORY_SRC_BASE, viewerParentOrigin) : VIEWER_STORY_SRC_BASE,
  );
  const deferredViewerSrc = useDeferredIframeSrc(viewerSrc, true);
  const [viewerConnected, setViewerConnected] = useState(false);
  const [viewerStatus, setViewerStatus] = useState("准备产品舞台...");
  const pageRef = useRef<HTMLDivElement>(null);
  useScrollReveal(pageRef);
  useParallax(pageRef);

  const activeScene = STORY_SCENES[activeSceneIndex] ?? STORY_SCENES[0];
  const activeProgress = sceneProgress[activeSceneIndex] ?? 0;
  const timelineProgress = clamp((activeSceneIndex + activeProgress) / STORY_SCENES.length);

  const stageStyle = {
    "--story-progress": timelineProgress.toFixed(3),
    "--scene-progress": activeProgress.toFixed(3),
  } as CSSProperties;

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

  const suspendViewer = useCallback(() => {
    clearHandshakeTimers();
    viewerReadyRef.current = false;
    setViewerConnected(false);
    const frame = iframeRef.current;
    if (frame && frame.src !== "about:blank") {
      frame.src = "about:blank";
    }
  }, [clearHandshakeTimers]);

  const postToViewer = useCallback((type: string, payload?: unknown): boolean => {
    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow) return false;
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

  const startHandshake = useCallback((reason: string) => {
    clearHandshakeTimers();
    viewerReadyRef.current = false;
    setViewerConnected(false);
    setViewerStatus("同步产品舞台...");

    let attempts = 0;
    const tick = () => {
      attempts += 1;
      if (attempts > 16) {
        clearHandshakeTimers();
        setViewerStatus("模型加载较慢，继续显示占位舞台。");
        return;
      }
      postToViewer(VIEWER_MESSAGE_GET_STATE, { reason, attempt: attempts });
    };

    tick();
    handshakeIntervalRef.current = window.setInterval(tick, 450);
    handshakeTimeoutRef.current = window.setTimeout(() => {
      if (!viewerReadyRef.current) {
        setViewerStatus("模型尚未返回，先保留舞台占位。");
      }
    }, 7200);
  }, [clearHandshakeTimers, postToViewer]);

  useEffect(() => {
    let frame = 0;

    // Cache element geometry — only update on resize, not every scroll frame.
    // This avoids calling getBoundingClientRect() per scene per frame (layout thrashing in Chrome).
    let cachedOffsets: Array<{ top: number; height: number } | null> = [];
    let cachedVH = window.innerHeight;

    const refreshGeometry = () => {
      cachedVH = window.innerHeight;
      const scrollY = window.scrollY;
      cachedOffsets = STORY_SCENES.map((_, index) => {
        const node = sceneRefs.current[index];
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { top: rect.top + scrollY, height: rect.height };
      });
    };

    const measure = () => {
      const scrollY = window.scrollY;
      const vh = cachedVH;

      const nextProgress = cachedOffsets.map((cached) => {
        if (!cached) return 0;
        const rectTop = cached.top - scrollY;
        const distance = vh + cached.height;
        return Math.round(clamp((vh - rectTop) / distance) * 50) / 50;
      });

      let nextActiveSceneIndex = 0;
      let bestWeight = -1;
      cachedOffsets.forEach((cached, index) => {
        if (!cached) return;
        const rectTop = cached.top - scrollY;
        const centerOffset = Math.abs(rectTop + cached.height / 2 - vh * 0.48);
        const weight = 1 - Math.min(centerOffset / (vh * 0.9), 1);
        if (weight > bestWeight) {
          bestWeight = weight;
          nextActiveSceneIndex = index;
        }
      });

      startTransition(() => {
        setSceneProgress((previous) => (sameProgressArray(previous, nextProgress) ? previous : nextProgress));
        setActiveSceneIndex((previous) => (previous === nextActiveSceneIndex ? previous : nextActiveSceneIndex));
      });
    };

    const requestMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const onResize = () => {
      refreshGeometry();
      requestMeasure();
    };

    refreshGeometry();
    requestMeasure();
    window.addEventListener("scroll", requestMeasure, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", requestMeasure);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!deferredViewerSrc) return;

    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow || event.source !== frameWindow || event.origin !== window.location.origin) {
        return;
      }

      const data = event.data as
        | {
            source?: string;
            type?: string;
            payload?: unknown;
          }
        | undefined;
      if (!data || data.source !== QIHANG_VIEWER_SOURCE) {
        return;
      }

      if (data.type === VIEWER_MESSAGE_READY || data.type === VIEWER_MESSAGE_STATE) {
        viewerReadyRef.current = true;
        setViewerConnected(true);
        setViewerStatus("产品舞台已联动");
        clearHandshakeTimers();
        postToViewer(VIEWER_MESSAGE_SET_STATE, latestPatchRef.current);
      }
    };

    window.addEventListener("message", onMessage);
    const frame = iframeRef.current;

    return () => {
      clearHandshakeTimers();
      window.removeEventListener("message", onMessage);
      viewerReadyRef.current = false;
      if (frame) {
        frame.src = "about:blank";
      }
    };
  }, [clearHandshakeTimers, deferredViewerSrc, postToViewer]);

  useEffect(() => {
    if (!deferredViewerSrc) return;

    const onViewerSuspend = () => {
      suspendViewer();
    };

    window.addEventListener("qihang:viewer-suspend", onViewerSuspend);
    return () => {
      window.removeEventListener("qihang:viewer-suspend", onViewerSuspend);
    };
  }, [deferredViewerSrc, suspendViewer]);

  const viewerPatch = useMemo(() => buildViewerPatch(sceneProgress, activeScene), [sceneProgress, activeScene]);

  useEffect(() => {
    latestPatchRef.current = viewerPatch;
    const nextSignature = JSON.stringify(viewerPatch);
    if (nextSignature === lastPatchSignatureRef.current) return;
    lastPatchSignatureRef.current = nextSignature;

    const targetWindow = iframeRef.current?.contentWindow;
    if (!targetWindow || !viewerReadyRef.current) return;

    targetWindow.postMessage(
      {
        source: QIHANG_WEB_SOURCE,
        type: VIEWER_MESSAGE_SET_STATE,
        payload: viewerPatch,
      },
      "*",
    );
  }, [viewerPatch]);

  return (
    <div className="home-story-page" ref={pageRef}>
      <div className="home-story-grid">
        <div className="home-story-stage-column">
          <div className={`home-story-stage tone-${activeScene.tone}`} style={stageStyle}>
            <div className="home-stage-topline">
              <div>
                <span className="home-stage-counter">{String(activeSceneIndex + 1).padStart(2, "0")}</span>
                <span className="home-stage-divider" />
                <span className="home-stage-caption">{activeScene.eyebrow}</span>
              </div>
              <span className="home-stage-status">{viewerStatus}</span>
            </div>

            <div className="home-stage-shell">
              <div className="home-stage-atmosphere" aria-hidden="true" />
              <div className="home-stage-orbit home-stage-orbit-a" aria-hidden="true" />
              <div className="home-stage-orbit home-stage-orbit-b" aria-hidden="true" />
              <div className="home-stage-placeholder home-stage-placeholder-top">{activeScene.assetSlots[0]}</div>
              <div className="home-stage-placeholder home-stage-placeholder-bottom">{activeScene.assetSlots[1]}</div>
              <div className="home-stage-placeholder home-stage-placeholder-side">{activeScene.assetSlots[2]}</div>

              {deferredViewerSrc ? (
                <iframe
                  ref={iframeRef}
                  src={deferredViewerSrc}
                  title="QIHANG Story Viewer"
                  className="home-story-iframe"
                  loading="lazy"
                  onLoad={() => {
                    viewerReadyRef.current = false;
                    setViewerConnected(false);
                    setViewerStatus("产品舞台载入中...");
                    startHandshake("home-story-iframe-load");
                  }}
                />
              ) : null}

              {!viewerConnected && deferredViewerSrc ? <div className="home-stage-loader">产品舞台加载中</div> : null}
            </div>

            <div className="home-stage-copy">
              <div>
                <p className="home-stage-label">{activeScene.stageLabel}</p>
                <p className="home-stage-summary">{activeScene.stageSummary}</p>
              </div>
              <div className="home-stage-tags" aria-label="Scene tags">
                {activeScene.stageTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>

            <div className="home-stage-timeline" aria-hidden="true">
              <div className="home-stage-timeline-track">
                <span className="home-stage-timeline-fill" />
              </div>
              <div className="home-stage-timeline-labels">
                {STORY_SCENES.map((scene, index) => (
                  <span key={scene.id} className={index === activeSceneIndex ? "is-active" : undefined}>
                    {scene.id}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <HomeStoryNarrative sceneRefs={sceneRefs} />
      </div>
    </div>
  );
}
