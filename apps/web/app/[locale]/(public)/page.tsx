import { getTranslations } from "next-intl/server";
import { HeroScene } from "@/components/public/HeroScene";
import { HighlightsScene } from "@/components/public/HighlightsScene";
import { EcosystemPreview } from "@/components/public/EcosystemPreview";
import { CraftScene } from "@/components/public/CraftScene";
import { CTAScene } from "@/components/public/CTAScene";

export async function generateMetadata() {
  const t = await getTranslations("home");
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    alternates: {
      languages: {
        zh: "/",
        en: "/en",
      },
    },
  };
}

export default async function HomePage() {
  const t = await getTranslations("home");

  return (
    <div>
      <HeroScene
        eyebrow={t("hero.eyebrow")}
        title={t("hero.title")}
        body={t("hero.body")}
        imageAlt={t("hero.imageAlt")}
      />
      <HighlightsScene
        eyebrow={t("highlights.eyebrow")}
        title={t("highlights.title")}
        details={[0, 1, 2].map((i) => ({
          label: t(`highlights.detail${i}.label`),
          body: t(`highlights.detail${i}.body`),
        }))}
      />
      <EcosystemPreview
        eyebrow={t("ecosystem.eyebrow")}
        title={t("ecosystem.title")}
        body={t("ecosystem.body")}
        details={[0, 1, 2].map((i) => ({
          label: t(`ecosystem.detail${i}.label`),
          body: t(`ecosystem.detail${i}.body`),
        }))}
        learnMoreLabel={t("ecosystem.learnMore")}
        imageAlt={t("ecosystem.imageAlt")}
      />
      <CraftScene
        eyebrow={t("craft.eyebrow")}
        title={t("craft.title")}
        body={t("craft.body")}
      />
      <CTAScene
        title={t("cta.title")}
        body={t("cta.body")}
        demoLabel={t("cta.demo")}
        productLabel={t("cta.product")}
      />
    </div>
  );
}
