"use client";

import { Link, useRouter } from "@/i18n/navigation";
import { useRef, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { gsap } from "@/lib/gsap-register";

import { MagneticButton } from "@/components/MagneticButton";
import { apiPost, persistWorkspaceId } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
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

  return (
    <section
      ref={sectionRef}
      className="flex min-h-[70vh] flex-col items-center justify-center px-6 py-20 text-center"
    >
      <div className="auth-heading">
        <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
          {t("login.kicker")}
        </p>
        <h1 className="mt-3 text-3xl font-bold text-[var(--text-primary)]">
          {t("login.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[var(--text-secondary)]">
          {t("login.helper")}
        </p>
      </div>

      <div className="auth-form-card mt-8 w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8 text-left">
        <form
          className="space-y-4"
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
            <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="login-email">
              {t("login.email.label")}
            </label>
            <input
              id="login-email"
              type="email"
              required
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--brand-v2)] focus:outline-none"
              placeholder={t("login.email.placeholder")}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[var(--text-secondary)]" htmlFor="login-password">
              {t("login.password.label")}
            </label>
            <input
              id="login-password"
              type="password"
              required
              className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-base)] px-4 py-3 text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--brand-v2)] focus:outline-none"
              placeholder={t("login.password.placeholder")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <MagneticButton
            className="w-full rounded-[var(--radius-full)] bg-[var(--brand-v2)] py-3 text-sm font-medium text-white"
            strength={0.15}
          >
            {t("login.submit")}
          </MagneticButton>
          {error && (
            <div className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </form>

        <div className="mt-6 space-y-2 text-center text-sm text-[var(--text-secondary)]">
          <div>
            <Link href="/forgot-password" className="font-medium text-[var(--brand-v2)] hover:underline">
              {t("login.forgotPassword")}
            </Link>
          </div>
          <div>
            {t("login.noAccount")}{" "}
            <Link href="/register" className="font-medium text-[var(--brand-v2)] hover:underline">
              {t("login.register")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
