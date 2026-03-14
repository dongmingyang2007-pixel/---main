"use client";

import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { MagneticButton } from "@/components/MagneticButton";
import { WorkbenchHero } from "@/components/WorkbenchHero";
import { apiPost, persistWorkspaceId } from "@/lib/api";
import { useScrollReveal } from "@/lib/useScrollReveal";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const shellRef = useRef<HTMLDivElement>(null);
  useScrollReveal(shellRef);
  const t = useTranslations("auth");

  return (
    <div className="auth-shell" ref={shellRef}>
      <div className="auth-card">
        <WorkbenchHero
          eyebrow={t("login.eyebrow")}
          title={t("login.heroTitle")}
          summary={t("login.heroSummary")}
          statusLabel={t("login.studioAccess")}
          points={[
            { label: t("login.point0.label"), detail: t("login.point0.detail") },
            { label: t("login.point1.label"), detail: t("login.point1.detail") },
            { label: t("login.point2.label"), detail: t("login.point2.detail") },
          ]}
        />

        <section className="auth-panel">
          <div data-reveal>
            <div className="console-kicker">{t("login.kicker")}</div>
            <h2 className="display-face mt-3 text-4xl">{t("login.title")}</h2>
            <p className="auth-helper mt-3">{t("login.helper")}</p>
          </div>
          <form
            className="space-y-4"
            data-reveal
            data-reveal-delay="2"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const auth = await apiPost<{ workspace: { id: string } }>("/api/v1/auth/login", { email, password });
                persistWorkspaceId(auth.workspace.id);
                router.push("/app");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : t("login.error"));
              }
            }}
          >
            <div>
              <label className="console-label" htmlFor="login-email">{t("login.email.label")}</label>
              <input
                id="login-email"
                type="email"
                required
                className="console-input"
                placeholder={t("login.email.placeholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="console-label" htmlFor="login-password">{t("login.password.label")}</label>
              <input
                id="login-password"
                type="password"
                required
                className="console-input"
                placeholder={t("login.password.placeholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <MagneticButton className="console-button w-full" strength={0.15}>
              {t("login.submit")}
            </MagneticButton>
            {error ? <div className="console-inline-notice is-error">{error}</div> : null}
          </form>
          <div className="auth-helper" data-reveal="fade" data-reveal-delay="4">
            {t("login.noAccount")}{" "}
            <Link href="/register" className="console-link">
              {t("login.register")}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
