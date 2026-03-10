import { AssetPlaceholder } from "@/components/AssetPlaceholder";
import { ContentRail } from "@/components/ContentRail";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { PRICING_COMPARE_RAIL, PRICING_STORY_SCENES } from "@/lib/public-story-content";

export default function PricingPage() {
  return (
    <PublicStoryExperience
      scenes={PRICING_STORY_SCENES}
      actions={[
        { href: "/demo", label: "先体验" },
        { href: "/contact", label: "联系候补", variant: "secondary" },
      ]}
      scrollNote="这页先回答进入路径，再往后才回答完整工作流和团队扩展。"
    >
      <ContentRail
        eyebrow="Path Compare"
        title="路径对比用连续轨道，而不是三张套餐卡。"
        summary="Explore、Studio 和 Team 分别回答体验、完整工作流和团队扩展三个阶段。"
        items={PRICING_COMPARE_RAIL}
        variant="plans"
      />

      <section className="story-band">
        <div className="home-story-eyebrow">素材展位</div>
        <h2 className="home-story-band-title">后续需要这些素材来替换当前的进入路径说明。</h2>
        <div className="story-band-grid">
          <AssetPlaceholder
            eyebrow="对比图"
            title="套餐路径总览"
            summary="用一张清晰对比图说明 Explore、Studio、Team 的进入边界。"
            specs={["横向对比", "3 个层级", "强调进入路径"]}
          />
          <AssetPlaceholder
            eyebrow="录屏"
            title="Studio 工作流片段"
            summary="展示完整工作流为什么值得进入，而不是只给文字说明。"
            specs={["控制台总览", "训练与发布", "审计默认值"]}
          />
          <AssetPlaceholder
            eyebrow="协作说明"
            title="Team 扩展说明"
            summary="展示多人 workspace、额度与权限边界的未来扩展方向。"
            specs={["协作画面", "额度说明", "权限示意"]}
            tone="dark"
          />
        </div>
      </section>

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Start</div>
        <h2 className="home-story-band-title">大多数人应该先体验，再决定是否进入 Studio。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/demo" className="home-story-button is-primary">
            先体验
          </PublicDocumentLink>
          <PublicDocumentLink href="/contact" className="home-story-button">
            进入候补
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
