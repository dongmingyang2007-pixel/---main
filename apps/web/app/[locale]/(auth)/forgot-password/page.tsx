"use client";

import { Link } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";

import { MagneticButton } from "@/components/MagneticButton";
import { apiPost } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [step, setStep] = useState<"email" | "code">("email");
  const [success, setSuccess] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const t = useTranslations("auth");

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
    tl.from(el.querySelector(".auth-heading"), { opacity: 0, y: 20, duration: 0.6 });
    tl.from(el.querySelector(".auth-form-card"), { opacity: 0, y: 30, duration: 0.6 }, "<0.15");
    return () => { tl.kill(); };
  }, []);

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

  const inputClass = "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--brand-v2)] focus:outline-none";

  const getHeading = () => {
    if (success) {
      return { kicker: t("reset.successKicker"), title: t("reset.successHeading"), desc: t("reset.successHelper") };
    }
    if (step === "email") {
      return { kicker: t("reset.kicker"), title: t("reset.title"), desc: t("reset.helper") };
    }
    return { kicker: t("reset.verifyKicker"), title: t("reset.verifyTitle"), desc: t("reset.verifyHelper", { email }) };
  };

  const heading = getHeading();

  return (
    <section
      ref={sectionRef}
      className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-20 text-center"
    >
      <div className="auth-heading">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          {heading.kicker}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-[var(--text-primary)]">
          {heading.title}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[var(--text-secondary)]">
          {heading.desc}
        </p>
      </div>

      <div className="auth-form-card mt-8 w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8 text-left">
        {success ? (
          <MagneticButton
            href="/login"
            className="block w-full rounded-[var(--radius-full)] bg-[var(--brand-v2)] py-3 text-center text-sm font-medium text-white"
            strength={0.15}
          >
            {t("reset.goLogin")}
          </MagneticButton>
        ) : step === "email" ? (
          <>
            <form className="space-y-4" onSubmit={handleEmailSubmit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="reset-email">
                  {t("reset.email.label")}
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  className={inputClass}
                  placeholder={t("reset.email.placeholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              <button
                className="w-full rounded-[var(--radius-full)] bg-[var(--brand-v2)] py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                disabled={codeSending}
              >
                {codeSending ? t("reset.sending") : t("reset.getCode")}
              </button>
              {error && (
                <div className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>
            <div className="mt-6 text-center text-sm text-[var(--text-secondary)]">
              <Link href="/login" className="font-medium text-[var(--brand-v2)] hover:underline">
                {t("reset.backToLogin")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <form className="space-y-4" onSubmit={handleResetSubmit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="reset-code">
                  {t("reset.code.label")}
                </label>
                <input
                  id="reset-code"
                  required
                  className={`${inputClass} text-center text-2xl tracking-[0.3em]`}
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="reset-password">
                  {t("reset.newPassword.label")}
                </label>
                <input
                  id="reset-password"
                  type="password"
                  required
                  minLength={12}
                  className={inputClass}
                  placeholder={t("reset.newPassword.placeholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <MagneticButton
                className="w-full rounded-[var(--radius-full)] bg-[var(--brand-v2)] py-3 text-sm font-medium text-white"
                strength={0.15}
              >
                {t("reset.submit")}
              </MagneticButton>
              {error && (
                <div className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>
            <div className="mt-6 flex items-center justify-between text-sm">
              <button
                type="button"
                className="font-medium text-[var(--brand-v2)] hover:underline"
                onClick={() => { setStep("email"); setCode(""); setPassword(""); setError(""); }}
              >
                {t("reset.backToEmail")}
              </button>
              <button
                type="button"
                className="font-medium text-[var(--brand-v2)] hover:underline disabled:opacity-50"
                disabled={countdown > 0}
                onClick={sendCode}
              >
                {countdown > 0 ? t("reset.resendCountdown", { seconds: countdown }) : t("reset.resend")}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
