"use client";

import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { WorkbenchHero } from "@/components/WorkbenchHero";
import { apiPost, persistWorkspaceId } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Step: "form" = fill info, "code" = enter verification code
  const [step, setStep] = useState<"form" | "code">("form");
  const [code, setCode] = useState("");
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const t = useTranslations("auth");

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown]);

  const sendCode = useCallback(async () => {
    setCodeSending(true);
    setError("");
    try {
      await apiPost("/api/v1/auth/send-code", { email, purpose: "register" });
      setCountdown(60);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("register.error"));
    } finally {
      setCodeSending(false);
    }
  }, [email, t]);

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendCode();
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const auth = await apiPost<{ workspace: { id: string } }>("/api/v1/auth/register", {
        email,
        password,
        display_name: displayName,
        code,
      });
      persistWorkspaceId(auth.workspace.id);
      router.push("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("register.error"));
    }
  };

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
          {step === "form" ? (
            <>
              <div>
                <div className="console-kicker">{t("register.kicker")}</div>
                <h2 className="display-face mt-3 text-4xl">{t("register.title")}</h2>
                <p className="auth-helper mt-3">{t("register.helper")}</p>
              </div>
              <form className="space-y-4" onSubmit={handleFormSubmit}>
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
                    minLength={12}
                    className="console-input"
                    placeholder={t("register.password.placeholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button className="console-button w-full" disabled={codeSending}>
                  {codeSending ? t("register.sending") : t("register.getCode")}
                </button>
                {error ? <div className="console-inline-notice is-error">{error}</div> : null}
              </form>
              <div className="auth-helper">
                {t("register.hasAccount")}{" "}
                <Link href="/login" className="console-link">
                  {t("register.login")}
                </Link>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="console-kicker">{t("register.verifyKicker")}</div>
                <h2 className="display-face mt-3 text-4xl">{t("register.verifyTitle")}</h2>
                <p className="auth-helper mt-3">{t("register.verifyHelper", { email })}</p>
              </div>
              <form className="space-y-4" onSubmit={handleCodeSubmit}>
                <div>
                  <label className="console-label" htmlFor="register-code">{t("register.code.label")}</label>
                  <input
                    id="register-code"
                    required
                    className="console-input text-center text-2xl tracking-[0.3em]"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoFocus
                  />
                </div>
                <button className="console-button w-full">{t("register.submit")}</button>
                {error ? <div className="console-inline-notice is-error">{error}</div> : null}
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="console-link"
                    onClick={() => { setStep("form"); setCode(""); setError(""); }}
                  >
                    {t("register.backToForm")}
                  </button>
                  <button
                    type="button"
                    className="console-link"
                    disabled={countdown > 0}
                    onClick={sendCode}
                  >
                    {countdown > 0 ? t("register.resendCountdown", { seconds: countdown }) : t("register.resend")}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
