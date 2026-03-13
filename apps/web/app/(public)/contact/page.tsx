import { PublicDocumentLink } from "@/components/PublicDocumentLink";
import { PublicStoryExperience } from "@/components/PublicStoryExperience";
import { CONTACT_STORY_SCENES } from "@/lib/public-story-content";

export default function ContactPage() {
  return (
    <PublicStoryExperience
      scenes={CONTACT_STORY_SCENES}
      actions={[
        { href: "mailto:hello@qihang.ai", label: "发送邮件" },
        { href: "/demo", label: "先看 Demo", variant: "secondary" },
      ]}
      scrollNote="向下滑动，了解适合讨论的话题"
    >
      <section className="story-band is-final">
        <div className="home-story-eyebrow">Email</div>
        <h2 className="home-story-band-title">hello@qihang.ai</h2>
        <p className="home-story-band-summary">48 小时内回复。安全问题请在标题标注 Security。</p>
        <div className="home-story-actions">
          <PublicDocumentLink href="mailto:hello@qihang.ai" className="home-story-button is-primary">
            发送邮件
          </PublicDocumentLink>
          <PublicDocumentLink href="/demo" className="home-story-button">
            先看 Demo
          </PublicDocumentLink>
        </div>
      </section>
    </PublicStoryExperience>
  );
}
