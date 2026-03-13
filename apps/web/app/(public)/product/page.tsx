import { headers } from "next/headers";

import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { PRODUCT_STORY_SCENES } from "@/lib/public-story-content";
import { resolveRequestOrigin } from "@/lib/request-origin";

export default async function ProductPage() {
  const origin = resolveRequestOrigin(await headers());

  return (
    <PublicStoryExperience
      scenes={PRODUCT_STORY_SCENES}
      actions={[
        { href: "/demo", label: "进入 Demo" },
        { href: "/contact", label: "联系团队", variant: "secondary" },
      ]}
      scrollNote="向下滑动，探索更多"
      viewerEnabled
      viewerParentOrigin={origin}
      viewerTitle="QIHANG Product Story"
    >
      <section className="story-band is-final">
        <div className="home-story-eyebrow">Next Step</div>
        <h2 className="home-story-band-title">在线体验产品能力。</h2>
        <div className="home-story-actions">
          <PublicDocumentLink href="/demo" className="home-story-button is-primary">
            进入 Demo
          </PublicDocumentLink>
          <PublicDocumentLink href="/how-it-works" className="home-story-button">
            了解工作流
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
