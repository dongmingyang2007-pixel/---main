import { ContentRail } from "@/components/ContentRail";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { DOCS_PATH_RAIL, DOCS_STORY_SCENES } from "@/lib/public-story-content";

export default function DocsPage() {
  return (
    <PublicStoryExperience
      scenes={DOCS_STORY_SCENES}
      actions={[
        { href: "/how-it-works", label: "了解工作流" },
        { href: "/updates", label: "查看更新", variant: "secondary" },
      ]}
      scrollNote="向下滑动，浏览文档分类"
    >
      <ContentRail
        eyebrow="Documentation"
        title="按主题浏览文档。"
        summary="快速开始 → 产品指南 → 工作流 → 安全合规。"
        items={DOCS_PATH_RAIL}
      />

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Get Started</div>
        <h2 className="home-story-band-title">从工作流开始了解系统。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/how-it-works" className="home-story-button is-primary">
            了解工作流
          </PublicDocumentLink>
          <PublicDocumentLink href="/app" className="home-story-button">
            打开控制台
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
