"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { MagneticButton } from "@/components/MagneticButton";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { TextReveal } from "@/components/TextReveal";
import { useParallax } from "@/lib/useParallax";
import { useScrollReveal } from "@/lib/useScrollReveal";
import {
  QIHANG_VIEWER_SOURCE,
  QIHANG_WEB_SOURCE,
  VIEWER_MESSAGE_GET_STATE,
  VIEWER_MESSAGE_READY,
  VIEWER_MESSAGE_SET_STATE,
  VIEWER_MESSAGE_STATE,
  VIEWER_SRC_BASE,
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
    title: "让环境 AI 先像产品，再像日常存在。",
    summary:
      "首页不再先解释系统架构，而是让用户先看到一个会被拿起、佩戴、开启与退出的对象。",
    details: [
      { label: "离线优先", body: "基础能力先在本地成立，增强链路只在需要时接入。" },
      { label: "显式触发", body: "采集不是默认背景行为，开始与停止必须可见。" },
      { label: "发布可回退", body: "从体验到版本切换，始终保留收回路径。" },
    ],
    stageLabel: "产品先出现",
    stageSummary: "滚动开始之后，同一个舞台会继续展开结构、模式与边界。",
    stageTags: ["离线优先", "胸前相机", "可回滚"],
    assetSlots: ["产品主镜头", "盒体近景", "开场短动画"],
    tone: "pearl",
  },
  {
    id: "hardware",
    eyebrow: "Hardware Surface",
    title: "开合、分离、佩戴，都应该像一个物体被理解。",
    summary:
      "不是把圆盘盒和胸前相机写成说明书，而是让用户在滚动里看到结构如何自然展开。",
    details: [
      { label: "圆盘盒", body: "把触控、反馈与耳机收在一块稳定的随身表面里。" },
      { label: "转轴开合", body: "通过滚动把开合关系当作镜头，而不是一条功能说明。" },
      { label: "胸前相机", body: "从静止待机到显式启动，过渡应该被一眼读懂。" },
    ],
    stageLabel: "几何关系展开",
    stageSummary: "下滑时盒体打开、耳机抬起、相机进入被感知的状态。",
    stageTags: ["开合", "结构", "佩戴"],
    assetSlots: ["转轴微距镜头", "佩戴场景", "材质细节"],
    tone: "midnight",
  },
  {
    id: "modes",
    eyebrow: "Adaptive Intelligence",
    title: "离线、在线、混合，不该是说明文，而该是场景切换。",
    summary:
      "模式变化不再塞进几个卡片里，而是让同一个产品在滚动中完成气氛、颜色和状态迁移。",
    details: [
      { label: "Offline", body: "在最安静的状态里先给出本地结果和即时反馈。" },
      { label: "Hybrid", body: "需要时再接入增强，不打断用户当前场景。" },
      { label: "Online", body: "把更重的能力放到后段，而不是首屏一上来全盘展开。" },
    ],
    stageLabel: "模式随滚动切换",
    stageSummary: "中段舞台把产品从静止待机推到混合与在线增强。",
    stageTags: ["Offline", "Hybrid", "Online"],
    assetSlots: ["模式切换短片", "状态灯录制", "系统联动录屏"],
    tone: "glacier",
  },
  {
    id: "privacy",
    eyebrow: "Trust Layer",
    title: "在采集之前，先让边界被看见。",
    summary:
      "最后一段收束到显式触发、状态可见与审计闭环，让可信感先于功能堆叠出现。",
    details: [
      { label: "显式触发", body: "不是默认采集，而是清楚知道什么时候开始、什么时候停止。" },
      { label: "状态可见", body: "设备状态、连接状态和推理结果始终保持同屏反馈。" },
      { label: "审计闭环", body: "关键动作可回放、可追溯，不让系统成为黑盒。" },
    ],
    stageLabel: "边界先于能力",
    stageSummary: "末段转入更克制的氛围，把状态反馈和隐私边界作为收束。",
    stageTags: ["隐私锁", "状态灯", "审计"],
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
    viewerParentOrigin ? appendParentOrigin(VIEWER_SRC_BASE, viewerParentOrigin) : VIEWER_SRC_BASE,
  );
  const [viewerConnected, setViewerConnected] = useState(false);
  const [viewerStatus, setViewerStatus] = useState("载入产品舞台...");
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

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      const viewportHeight = window.innerHeight;
      const nextProgress = STORY_SCENES.map((_, index) => {
        const node = sceneRefs.current[index];
        if (!node) return 0;
        const rect = node.getBoundingClientRect();
        const distance = viewportHeight + rect.height;
        return clamp((viewportHeight - rect.top) / distance);
      });

      let nextActiveSceneIndex = 0;
      let bestWeight = -1;
      STORY_SCENES.forEach((_, index) => {
        const node = sceneRefs.current[index];
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const centerOffset = Math.abs(rect.top + rect.height / 2 - viewportHeight * 0.48);
        const weight = 1 - Math.min(centerOffset / (viewportHeight * 0.9), 1);
        if (weight > bestWeight) {
          bestWeight = weight;
          nextActiveSceneIndex = index;
        }
      });

      setSceneProgress((previous) => (sameProgressArray(previous, nextProgress) ? previous : nextProgress));
      setActiveSceneIndex((previous) => (previous === nextActiveSceneIndex ? previous : nextActiveSceneIndex));
    };

    const requestMeasure = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    requestMeasure();
    window.addEventListener("scroll", requestMeasure, { passive: true });
    window.addEventListener("resize", requestMeasure);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      window.removeEventListener("scroll", requestMeasure);
      window.removeEventListener("resize", requestMeasure);
    };
  }, []);

  useEffect(() => {
    const clearTimers = () => {
      if (handshakeIntervalRef.current !== null) {
        window.clearInterval(handshakeIntervalRef.current);
        handshakeIntervalRef.current = null;
      }
      if (handshakeTimeoutRef.current !== null) {
        window.clearTimeout(handshakeTimeoutRef.current);
        handshakeTimeoutRef.current = null;
      }
    };

    const postToViewer = (type: string, payload?: unknown): boolean => {
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
    };

    const startHandshake = (reason: string) => {
      clearTimers();
      viewerReadyRef.current = false;
      setViewerConnected(false);
      setViewerStatus("同步产品舞台...");

      let attempts = 0;
      const tick = () => {
        attempts += 1;
        if (attempts > 16) {
          clearTimers();
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
    };

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
        clearTimers();
        postToViewer(VIEWER_MESSAGE_SET_STATE, latestPatchRef.current);
      }
    };

    window.addEventListener("message", onMessage);
    startHandshake("home-story-init");

    return () => {
      clearTimers();
      window.removeEventListener("message", onMessage);
    };
  }, []);

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

              <iframe
                ref={iframeRef}
                src={viewerSrc}
                title="QIHANG Story Viewer"
                className="home-story-iframe"
                onLoad={() => {
                  viewerReadyRef.current = false;
                  setViewerConnected(false);
                  setViewerStatus("产品舞台载入中...");
                }}
              />

              {!viewerConnected ? <div className="home-stage-loader">产品舞台加载中</div> : null}
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
                      <MagneticButton href="/demo" className="home-story-button is-primary" strength={0.25}>
                        进入 Demo
                      </MagneticButton>
                      <MagneticButton href="/product" className="home-story-button" strength={0.25}>
                        查看产品页
                      </MagneticButton>
                    </div>
                    <p className="home-story-scroll-note" data-reveal="fade" data-reveal-delay="5">
                      向下滑动，产品舞台会持续变化，而不是切成一堆卡片。
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

          <section className="home-film-band" data-parallax>
            <div className="home-story-eyebrow" data-reveal>Future Footage</div>
            <h2 className="home-story-band-title" data-reveal data-reveal-delay="1">
              后续用真实镜头接管这些位置。
            </h2>
            <p className="home-story-band-summary" data-reveal data-reveal-delay="2">
              现在先保留分镜位，后续直接补入产品实拍、佩戴场景和系统联动短片。
            </p>
            <div className="home-film-reel">
              <article className="home-film-frame is-wide" data-reveal="scale" data-reveal-delay="2">
                <div className="home-film-frame-label">产品实拍短片</div>
                <p>建议 8-12 秒，纯净背景，展示拿起、开合、放回的连续动作。</p>
              </article>
              <article className="home-film-frame" data-reveal="scale" data-reveal-delay="3">
                <div className="home-film-frame-label">佩戴与触发场景</div>
                <p>展示胸前相机进入工作状态、退出状态，以及用户如何明确触发。</p>
              </article>
              <article className="home-film-frame is-dark" data-reveal="scale" data-reveal-delay="4">
                <div className="home-film-frame-label">系统联动录屏</div>
                <p>展示离线到增强模式的切换、状态灯反馈和结果返回链路。</p>
              </article>
            </div>
          </section>

          <section className="home-workflow-band" data-parallax>
            <div className="home-story-eyebrow" data-reveal>One Line</div>
            <h2 className="home-story-band-title" data-reveal data-reveal-delay="1">
              产品看完，再进入工作流。
            </h2>
            <p className="home-story-band-summary" data-reveal data-reveal-delay="2">
              Demo、数据、训练和发布仍然存在，但放到故事后半段出现，不和产品主舞台抢首屏。
            </p>
            <div className="home-workflow-rail" aria-label="Workflow rail">
              <span data-reveal data-reveal-delay="3">Demo</span>
              <span data-reveal data-reveal-delay="4">Dataset</span>
              <span data-reveal data-reveal-delay="5">Train</span>
              <span data-reveal data-reveal-delay="6">Release</span>
            </div>
            <div className="home-story-actions" data-reveal data-reveal-delay="7">
              <PublicDocumentLink href="/how-it-works" className="home-story-button">
                查看工作原理
              </PublicDocumentLink>
              <PublicDocumentLink href="/pricing" className="home-story-button">
                查看定价
              </PublicDocumentLink>
            </div>
          </section>

          <section className="home-final-band" data-parallax>
            <div className="home-story-eyebrow" data-reveal>Next Step</div>
            <h2 className="home-story-band-title gradient-text-light" data-reveal data-reveal-delay="1">
              先体验，再决定要不要进入系统。
            </h2>
            <p className="home-story-band-summary" data-reveal data-reveal-delay="2">
              首屏先给产品，后半段再给流程和入口，让整站更接近一部可滚动观看的产品影片。
            </p>
            <div className="home-story-actions" data-reveal data-reveal-delay="3">
              <MagneticButton href="/demo" className="home-story-button is-primary" strength={0.3}>
                进入 Demo
              </MagneticButton>
              <MagneticButton href="/contact" className="home-story-button" strength={0.3}>
                联系团队
              </MagneticButton>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
