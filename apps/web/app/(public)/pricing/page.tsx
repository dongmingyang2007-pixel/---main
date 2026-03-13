import { ContentRail } from "@/components/ContentRail";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { PRICING_COMPARE_RAIL, PRICING_STORY_SCENES } from "@/lib/public-story-content";

export default function PricingPage() {
  return (
    <PublicStoryExperience
      scenes={PRICING_STORY_SCENES}
      actions={[
        { href: "/demo", label: "免费体验" },
        { href: "/contact", label: "申请内测", variant: "secondary" },
      ]}
      scrollNote="向下滑动，了解每个方案"
    >
      <ContentRail
        eyebrow="Plans"
        title="三个方案，按需选择。"
        summary="从免费体验到团队协作，按你的阶段升级。"
        items={PRICING_COMPARE_RAIL}
        variant="plans"
      />

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Get Started</div>
        <h2 className="home-story-band-title">先免费试试。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/demo" className="home-story-button is-primary">
            打开 Demo
          </PublicDocumentLink>
          <PublicDocumentLink href="/contact" className="home-story-button">
            申请 Studio
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
