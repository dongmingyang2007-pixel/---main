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
        { href: "/docs", label: "看文档路径", variant: "secondary" },
      ]}
      scrollNote="这里只记录真正影响体验、结构和安全边界的变化。"
    >
      <ContentRail
        eyebrow="Timeline"
        title="重要变化不该碎成一堆时间卡。"
        summary="更新页采用连续时间轴，记录真正影响产品感知和系统边界的变化。"
        items={UPDATE_TIMELINE_RAIL}
        variant="timeline"
      />

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Continue</div>
        <h2 className="home-story-band-title">看完更新，再回到产品和工作流页面。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/product" className="home-story-button is-primary">
            查看产品页
          </PublicDocumentLink>
          <PublicDocumentLink href="/how-it-works" className="home-story-button">
            查看工作流
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
