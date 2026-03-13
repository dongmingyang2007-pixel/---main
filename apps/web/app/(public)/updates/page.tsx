import { ContentRail } from "@/components/ContentRail";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { UPDATE_TIMELINE_RAIL, UPDATES_STORY_SCENES } from "@/lib/public-story-content";

export default function UpdatesPage() {
  return (
    <PublicStoryExperience
      scenes={UPDATES_STORY_SCENES}
      actions={[
        { href: "/", label: "返回首页" },
        { href: "/product", label: "查看产品", variant: "secondary" },
      ]}
      scrollNote="向下滑动，查看更新详情"
    >
      <ContentRail
        eyebrow="Timeline"
        title="更新记录"
        summary="产品、体验和安全方面的重要变更。"
        items={UPDATE_TIMELINE_RAIL}
        variant="timeline"
      />

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Explore</div>
        <h2 className="home-story-band-title">查看最新的产品体验。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/product" className="home-story-button is-primary">
            产品页
          </PublicDocumentLink>
          <PublicDocumentLink href="/demo" className="home-story-button">
            Demo
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
