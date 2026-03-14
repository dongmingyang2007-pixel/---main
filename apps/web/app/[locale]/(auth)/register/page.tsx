"use client";

import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { WorkbenchHero } from "@/components/WorkbenchHero";
import { apiPost, persistWorkspaceId } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const t = useTranslations("auth");

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <WorkbenchHero
          eyebrow={t("register.eyebrow")}
          title={t("register.heroTitle")}
          summary={t("register.heroSummary")}
          statusLabel={t("register.studioAccess")}
          points={[
            { label: t("register.point0.label"), detail: t("register.point0.detail") },
            { label: t("register.point1.label"), detail: t("register.point1.detail") },
            { label: t("register.point2.label"), detail: t("register.point2.detail") },
          ]}
        />

        <section className="auth-panel">
          <div>
            <div className="console-kicker">{t("register.kicker")}</div>
            <h2 className="display-face mt-3 text-4xl">{t("register.title")}</h2>
            <p className="auth-helper mt-3">{t("register.helper")}</p>
          </div>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const auth = await apiPost<{ workspace: { id: string } }>("/api/v1/auth/register", {
                  email,
                  password,
                  display_name: displayName,
                });
                persistWorkspaceId(auth.workspace.id);
                router.push("/app");
                router.refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : t("register.error"));
              }
            }}
          >
            <div>
              <label className="console-label" htmlFor="register-display-name">{t("register.displayName.label")}</label>
              <input
                id="register-display-name"
                required
                className="console-input"
                placeholder={t("register.displayName.placeholder")}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label className="console-label" htmlFor="register-email">{t("register.email.label")}</label>
              <input
                id="register-email"
                type="email"
                required
                className="console-input"
                placeholder={t("register.email.placeholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="console-label" htmlFor="register-password">{t("register.password.label")}</label>
              <input
                id="register-password"
                type="password"
                required
                className="console-input"
                placeholder={t("register.password.placeholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="console-button w-full">{t("register.submit")}</button>
            {error ? <div className="console-inline-notice is-error">{error}</div> : null}
          </form>
          <div className="auth-helper">
            {t("register.hasAccount")}{" "}
            <Link href="/login" className="console-link">
              {t("register.login")}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
