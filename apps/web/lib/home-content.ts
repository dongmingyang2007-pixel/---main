import type { ViewerState } from "@/lib/qihang-viewer-contract";

export interface HomeScene {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  details?: { label: string; body: string }[];
  /** Viewer state patch applied at scene start */
  viewerPatch?: Partial<ViewerState>;
  /** Scene tone for background color transitions */
  tone: "pearl" | "midnight" | "glacier";
}

export const HOME_SCENES: HomeScene[] = [
  {
    id: "hero",
    eyebrow: "QIHANG / Environment AI",
    title: "看见周围，\n理解周围。",
    body: "一枚随身佩戴的 AI 设备——看见你所处的环境，即时给出反馈。无需掏出手机，无需打开应用。",
    tone: "pearl",
    viewerPatch: {
      isOpen: false,
      colorway: "pearl",
      mode: "offline",
    },
  },
  {
    id: "highlights",
    eyebrow: "Why QIHANG",
    title: "三个核心能力。",
    body: "",
    details: [
      { label: "随身佩戴", body: "胸前相机 + 圆盘盒 + 无线耳机，三件一体。" },
      { label: "即时反馈", body: "拍下画面，几秒内通过耳机收到 AI 语音回答。" },
      { label: "隐私可控", body: "你决定何时开始、何时停止，状态灯始终可见。" },
    ],
    tone: "pearl",
    viewerPatch: {
      isOpen: true,
      earbudsOut: true,
      colorway: "pearl",
    },
  },
  {
    id: "ecosystem",
    eyebrow: "AI Ecosystem",
    title: "不只是硬件。",
    body: "从数据采集到模型训练，从个性化调优到云端部署——完整的 AI 工作台，让设备越用越聪明。",
    details: [
      { label: "数据工作台", body: "上传、标注、版本管理，一站完成。" },
      { label: "模型训练", body: "一键启动训练任务，实时查看曲线和日志。" },
      { label: "个性化部署", body: "模型发布到设备，离线也能推理。" },
    ],
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
    eyebrow: "Craftsmanship",
    title: "每一处细节。",
    body: "112° 精密阻尼铰链、磁吸分离相机、触感确定的开合——工业设计为日常使用而生。",
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
    eyebrow: "",
    title: "准备好了？",
    body: "体验在线 Demo，或了解完整产品。",
    tone: "pearl",
    viewerPatch: {
      isOpen: false,
      colorway: "pearl",
    },
  },
];
