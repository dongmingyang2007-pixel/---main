"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";

import { MagneticButton } from "@/components/MagneticButton";
import { apiPost, persistWorkspaceId } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const [step, setStep] = useState<"form" | "code">("form");
  const [code, setCode] = useState("");
  const [codeSending, setCodeSending] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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
    if (password !== confirmPassword) {
      setError(t("register.passwordMismatch"));
      return;
    }
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

  const inputClass = "w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--brand-v2)] focus:outline-none";

  return (
    <section
      ref={sectionRef}
      className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-20 text-center"
    >
      <div className="auth-heading">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          {step === "form" ? t("register.kicker") : t("register.verifyKicker")}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-[var(--text-primary)]">
          {step === "form" ? t("register.title") : t("register.verifyTitle")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[var(--text-secondary)]">
          {step === "form" ? t("register.helper") : t("register.verifyHelper", { email })}
        </p>
      </div>

      <div className="auth-form-card mt-8 w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8 text-left">
        {step === "form" ? (
          <>
            <form className="space-y-4" onSubmit={handleFormSubmit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="register-display-name">
                  {t("register.displayName.label")}
                </label>
                <input
                  id="register-display-name"
                  required
                  className={inputClass}
                  placeholder={t("register.displayName.placeholder")}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="register-email">
                  {t("register.email.label")}
                </label>
                <input
                  id="register-email"
                  type="email"
                  required
                  className={inputClass}
                  placeholder={t("register.email.placeholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="register-password">
                  {t("register.password.label")}
                </label>
                <input
                  id="register-password"
                  type="password"
                  required
                  minLength={12}
                  className={inputClass}
                  placeholder={t("register.password.placeholder")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="register-confirm-password">
                  {t("register.confirmPassword.label")}
                </label>
                <input
                  id="register-confirm-password"
                  type="password"
                  required
                  minLength={12}
                  className={inputClass}
                  placeholder={t("register.confirmPassword.placeholder")}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <button
                className="w-full rounded-[var(--radius-full)] bg-[var(--brand-v2)] py-3 text-sm font-medium text-white transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                disabled={codeSending}
              >
                {codeSending ? t("register.sending") : t("register.getCode")}
              </button>
              {error && (
                <div className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>
            <div className="mt-6 text-center text-sm text-[var(--text-secondary)]">
              {t("register.hasAccount")}{" "}
              <Link href="/login" className="font-medium text-[var(--brand-v2)] hover:underline">
                {t("register.login")}
              </Link>
            </div>
          </>
        ) : (
          <>
            <form className="space-y-4" onSubmit={handleCodeSubmit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="register-code">
                  {t("register.code.label")}
                </label>
                <input
                  id="register-code"
                  required
                  className={`${inputClass} text-center text-2xl tracking-[0.3em]`}
                  placeholder="000000"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                />
              </div>
              <MagneticButton
                className="w-full rounded-[var(--radius-full)] bg-[var(--brand-v2)] py-3 text-sm font-medium text-white"
                strength={0.15}
              >
                {t("register.submit")}
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
                onClick={() => { setStep("form"); setCode(""); setError(""); }}
              >
                {t("register.backToForm")}
              </button>
              <button
                type="button"
                className="font-medium text-[var(--brand-v2)] hover:underline disabled:opacity-50"
                disabled={countdown > 0}
                onClick={sendCode}
              >
                {countdown > 0 ? t("register.resendCountdown", { seconds: countdown }) : t("register.resend")}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
