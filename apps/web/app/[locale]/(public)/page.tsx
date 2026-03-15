import { getTranslations, setRequestLocale } from "next-intl/server";
import { HeroScene } from "@/components/public/HeroScene";
import { HighlightsScene } from "@/components/public/HighlightsScene";
import { EcosystemPreview } from "@/components/public/EcosystemPreview";
import { CraftScene } from "@/components/public/CraftScene";
import { CTAScene } from "@/components/public/CTAScene";
import { routing } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const localeKey = locale as (typeof routing.locales)[number];
  setRequestLocale(localeKey);
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

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const localeKey = locale as (typeof routing.locales)[number];
  setRequestLocale(localeKey);
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
        imageAlt1={t("craft.imageAlt1")}
        imageAlt2={t("craft.imageAlt2")}
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
