"use client";

import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { WorkbenchHero } from "@/components/WorkbenchHero";
import { apiPost } from "@/lib/api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step: "email" = enter email, "code" = enter code + new password
  const [step, setStep] = useState<"email" | "code">("email");
  const [success, setSuccess] = useState(false);
  const t = useTranslations("auth");

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
      await apiPost("/api/v1/auth/send-code", { email, purpose: "reset" });
      setCountdown(60);
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reset.error"));
    } finally {
      setCodeSending(false);
    }
  }, [email, t]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendCode();
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await apiPost("/api/v1/auth/reset-password", { email, password, code });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("reset.error"));
    }
  };

  if (success) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <WorkbenchHero
            eyebrow={t("reset.eyebrow")}
            title={t("reset.successTitle")}
            summary={t("reset.successSummary")}
            statusLabel={t("reset.studioAccess")}
            points={[]}
          />
          <section className="auth-panel">
            <div>
              <div className="console-kicker">{t("reset.successKicker")}</div>
              <h2 className="display-face mt-3 text-4xl">{t("reset.successHeading")}</h2>
              <p className="auth-helper mt-3">{t("reset.successHelper")}</p>
            </div>
            <Link href="/login" className="console-button w-full text-center mt-4">
              {t("reset.goLogin")}
            </Link>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <WorkbenchHero
          eyebrow={t("reset.eyebrow")}
          title={t("reset.heroTitle")}
          summary={t("reset.heroSummary")}
          statusLabel={t("reset.studioAccess")}
          points={[
            { label: t("reset.point0.label"), detail: t("reset.point0.detail") },
            { label: t("reset.point1.label"), detail: t("reset.point1.detail") },
          ]}
        />

        <section className="auth-panel">
          {step === "email" ? (
            <>
              <div>
                <div className="console-kicker">{t("reset.kicker")}</div>
                <h2 className="display-face mt-3 text-4xl">{t("reset.title")}</h2>
                <p className="auth-helper mt-3">{t("reset.helper")}</p>
              </div>
              <form className="space-y-4" onSubmit={handleEmailSubmit}>
                <div>
                  <label className="console-label" htmlFor="reset-email">{t("reset.email.label")}</label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    className="console-input"
                    placeholder={t("reset.email.placeholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                </div>
                <button className="console-button w-full" disabled={codeSending}>
                  {codeSending ? t("reset.sending") : t("reset.getCode")}
                </button>
                {error ? <div className="console-inline-notice is-error">{error}</div> : null}
              </form>
              <div className="auth-helper">
                <Link href="/login" className="console-link">
                  {t("reset.backToLogin")}
                </Link>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="console-kicker">{t("reset.verifyKicker")}</div>
                <h2 className="display-face mt-3 text-4xl">{t("reset.verifyTitle")}</h2>
                <p className="auth-helper mt-3">{t("reset.verifyHelper", { email })}</p>
              </div>
              <form className="space-y-4" onSubmit={handleResetSubmit}>
                <div>
                  <label className="console-label" htmlFor="reset-code">{t("reset.code.label")}</label>
                  <input
                    id="reset-code"
                    required
                    className="console-input text-center text-2xl tracking-[0.3em]"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="console-label" htmlFor="reset-password">{t("reset.newPassword.label")}</label>
                  <input
                    id="reset-password"
                    type="password"
                    required
                    minLength={12}
                    className="console-input"
                    placeholder={t("reset.newPassword.placeholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <button className="console-button w-full">{t("reset.submit")}</button>
                {error ? <div className="console-inline-notice is-error">{error}</div> : null}
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    className="console-link"
                    onClick={() => { setStep("email"); setCode(""); setPassword(""); setError(""); }}
                  >
                    {t("reset.backToEmail")}
                  </button>
                  <button
                    type="button"
                    className="console-link"
                    disabled={countdown > 0}
                    onClick={sendCode}
                  >
                    {countdown > 0 ? t("reset.resendCountdown", { seconds: countdown }) : t("reset.resend")}
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
