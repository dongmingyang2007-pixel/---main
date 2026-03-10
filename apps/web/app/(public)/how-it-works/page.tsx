import { AssetPlaceholder } from "@/components/AssetPlaceholder";
import { ContentRail } from "@/components/ContentRail";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { WORKFLOW_RAIL, WORKFLOW_STORY_SCENES } from "@/lib/public-story-content";

export default function HowItWorksPage() {
  return (
    <PublicStoryExperience
      scenes={WORKFLOW_STORY_SCENES}
      actions={[
        { href: "/demo", label: "先体验 Demo" },
        { href: "/docs", label: "看文档入口", variant: "secondary" },
      ]}
      scrollNote="向下滑动，这条路径会从体验、整理、训练一路推进到发布。"
    >
      <ContentRail
        eyebrow="One Line"
        title="完整工作流应该看起来像一条轨道。"
        summary="四个动作不是四张孤立的功能卡，而是从体验到发布的一条连续轨迹。"
        items={WORKFLOW_RAIL}
      />

      <section className="story-band">
        <div className="home-story-eyebrow">Footage Needed</div>
        <h2 className="home-story-band-title">这些画面补上之后，工作流页会更像一条影片。</h2>
        <p className="home-story-band-summary">
          当前先用展位块确定镜头与用途，后续替换为录屏和实拍素材。
        </p>
        <div className="story-band-grid">
          <AssetPlaceholder
            eyebrow="录屏"
            title="数据整理流程"
            summary="展示上传、浏览、标签和冻结版本的连续动作。"
            specs={["1440p 录屏", "隐藏敏感数据", "突出版本动作"]}
          />
          <AssetPlaceholder
            eyebrow="录屏"
            title="训练与评测"
            summary="展示训练状态、日志、评测对比和产物流转。"
            specs={["训练状态", "评测差异", "产物回流"]}
          />
          <AssetPlaceholder
            eyebrow="录屏"
            title="发布与回滚"
            summary="展示模型版本登记、alias 切换和回退动作。"
            specs={["版本切换", "回滚入口", "审计记录"]}
            tone="dark"
          />
        </div>
      </section>

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Continue</div>
        <h2 className="home-story-band-title">工作流讲清之后，再去看真正的界面。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/demo" className="home-story-button is-primary">
            进入 Demo
          </PublicDocumentLink>
          <PublicDocumentLink href="/app" className="home-story-button">
            打开控制台
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
