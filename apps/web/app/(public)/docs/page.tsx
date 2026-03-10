import { AssetPlaceholder } from "@/components/AssetPlaceholder";
import { ContentRail } from "@/components/ContentRail";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { DOCS_PATH_RAIL, DOCS_STORY_SCENES } from "@/lib/public-story-content";

export default function DocsPage() {
  return (
    <PublicStoryExperience
      scenes={DOCS_STORY_SCENES}
      actions={[
        { href: "/how-it-works", label: "看工作流" },
        { href: "/updates", label: "看更新", variant: "secondary" },
      ]}
      scrollNote="公开页的文档入口先给路径，不急着在首屏堆出新的文字墙。"
    >
      <ContentRail
        eyebrow="Reading Order"
        title="把阅读顺序讲清，比堆入口更重要。"
        summary="先看产品，再看工作流，最后看部署与安全，让用户不在文档里迷路。"
        items={DOCS_PATH_RAIL}
      />

      <section className="story-band">
        <div className="home-story-eyebrow">Future Assets</div>
        <h2 className="home-story-band-title">文档页后续还需要这些辅助素材。</h2>
        <div className="story-band-grid">
          <AssetPlaceholder
            eyebrow="阅读地图"
            title="产品阅读路径"
            summary="帮助用户先理解对象、模式与体验入口。"
            specs={["产品说明图", "模式切换", "体验入口"]}
          />
          <AssetPlaceholder
            eyebrow="流程图"
            title="工作流阅读路径"
            summary="解释数据、训练、评测和发布的关系，不把系统切成散页。"
            specs={["数据线", "训练线", "发布线"]}
          />
          <AssetPlaceholder
            eyebrow="安全拓扑"
            title="部署与安全路径"
            summary="解释签名访问、私有存储与默认边界。"
            specs={["Signed URLs", "Storage", "Security Defaults"]}
            tone="dark"
          />
        </div>
      </section>

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Open</div>
        <h2 className="home-story-band-title">路径清楚之后，再进入真正的系统页面。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/how-it-works" className="home-story-button is-primary">
            查看工作流
          </PublicDocumentLink>
          <PublicDocumentLink href="/app" className="home-story-button">
            打开控制台
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
