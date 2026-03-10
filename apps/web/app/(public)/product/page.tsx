import { headers } from "next/headers";

import { AssetPlaceholder } from "@/components/AssetPlaceholder";
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
      scrollNote="继续向下滑动，产品舞台会从外形进入结构、佩戴和工程视角。"
      viewerEnabled
      viewerParentOrigin={origin}
      viewerTitle="QIHANG Product Story"
    >
      <section className="story-band">
        <div className="home-story-eyebrow">Future Footage</div>
        <h2 className="home-story-band-title">缺失素材先占位，但位置和用途已经明确。</h2>
        <p className="home-story-band-summary">
          后续优先补入产品实拍、佩戴场景和工程预览短片，替换掉当前的舞台占位说明。
        </p>
        <div className="story-band-grid">
          <AssetPlaceholder
            eyebrow="产品实拍"
            title="主镜头短片"
            summary="建议 8-12 秒，纯净背景，展示拿起、开合、放回的连续动作。"
            specs={["4K / 16:9", "稳定移动镜头", "白底或深灰背景"]}
          />
          <AssetPlaceholder
            eyebrow="佩戴场景"
            title="触发与退出"
            summary="展示胸前相机进入工作状态、退出状态，以及用户如何明确触发。"
            specs={["真实穿戴", "显式触发动作", "状态灯可见"]}
          />
          <AssetPlaceholder
            eyebrow="工程预览"
            title="结构与制造"
            summary="补入转轴微距、材质细节、结构分解或制造状态相关素材。"
            specs={["微距镜头", "结构分解", "制造状态"]}
            tone="dark"
          />
        </div>
      </section>

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Next Step</div>
        <h2 className="home-story-band-title">先看完产品，再决定要不要进入工作流。</h2>
        <p className="home-story-band-summary">
          公开站负责把对象感和边界感讲清，真正的上传、训练和发布入口依然留在 Demo 和控制台。
        </p>
        <div className="home-story-actions">
          <PublicDocumentLink href="/demo" className="home-story-button is-primary">
            进入 Demo
          </PublicDocumentLink>
          <PublicDocumentLink href="/how-it-works" className="home-story-button">
            查看工作原理
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
