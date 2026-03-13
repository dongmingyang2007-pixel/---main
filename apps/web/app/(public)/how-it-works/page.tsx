import { ContentRail } from "@/components/ContentRail";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { WORKFLOW_RAIL, WORKFLOW_STORY_SCENES } from "@/lib/public-story-content";

export default function HowItWorksPage() {
  return (
    <PublicStoryExperience
      scenes={WORKFLOW_STORY_SCENES}
      actions={[
        { href: "/demo", label: "打开 Demo" },
        { href: "/pricing", label: "查看方案", variant: "secondary" },
      ]}
      scrollNote="向下滑动，了解完整工作流"
    >
      <ContentRail
        eyebrow="Workflow"
        title="四步完成从体验到上线。"
        summary="Demo → 数据 → 训练 → 发布，一条连续的产品化路径。"
        items={WORKFLOW_RAIL}
      />

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Get Started</div>
        <h2 className="home-story-band-title">现在就开始。</h2>
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
