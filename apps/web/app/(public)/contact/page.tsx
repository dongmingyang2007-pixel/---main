import { ContentRail } from "@/components/ContentRail";
import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { CONTACT_STORY_SCENES } from "@/lib/public-story-content";

export default function ContactPage() {
  return (
    <PublicStoryExperience
      scenes={CONTACT_STORY_SCENES}
      actions={[
        { href: "mailto:hello@qihang.ai", label: "发送邮件" },
        { href: "/product", label: "回到产品页", variant: "secondary" },
      ]}
      scrollNote="联系方式页保持克制，直接把沟通入口和适合讨论的话题摆出来。"
    >
      <ContentRail
        eyebrow="Response"
        title="来信时附上这些信息，会让沟通更快进入主题。"
        summary="如果你已经看过产品页和工作流页，来信里直接说明场景、目标和想讨论的问题即可。"
        items={[
          { label: "Scene", title: "你的场景", body: "你想解决的真实使用环境或产品场景。" },
          { label: "Goal", title: "你的目标", body: "你希望验证的设备形态、工作流或合作方向。" },
          { label: "Signal", title: "敏感议题", body: "若涉及安全或隐私，请直接在标题标注 Security / Privacy。" },
        ]}
        variant="timeline"
      />

      <section className="story-band is-final">
        <div className="home-story-eyebrow">Primary Channel</div>
        <h2 className="home-story-band-title">hello@qihang.ai</h2>
        <p className="home-story-band-summary">安全或隐私问题请在标题里标注 Security / Privacy。</p>
        <div className="home-story-actions">
          <PublicDocumentLink href="mailto:hello@qihang.ai" className="home-story-button is-primary">
            直接发邮件
          </PublicDocumentLink>
          <PublicDocumentLink href="/demo" className="home-story-button">
            先看 Demo
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
