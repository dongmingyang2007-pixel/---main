import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("error");

  return (
    <div className="site-container py-10">
      <section className="public-hero glass-panel">
        <div className="public-hero-copy">
          <div className="site-kicker mx-auto w-fit">{t("notFound.kicker")}</div>
          <h1 className="site-title">{t("notFound.title")}</h1>
          <p className="site-lead mx-auto">
            {t("notFound.body")}
          </p>
          <div className="site-actions justify-center">
            <Link className="site-button" href="/">
              {t("notFound.home")}
            </Link>
            <Link className="site-button-secondary" href="/demo">
              {t("notFound.demo")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
