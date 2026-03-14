"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

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

  return (
    <div className="auth-shell" ref={shellRef}>
      <div className="auth-card">
        <WorkbenchHero
          eyebrow="QIHANG Console"
          title="进入你的工作台，把数据、训练和模型发布收在一处。"
          summary="公开站负责展示，控制台负责推进工作。登录后直接回到更克制、更高效的操作界面。"
          points={[
            { label: "私有", detail: "样本和产物读取走受管签名。" },
            { label: "可回滚", detail: "alias 发布和回退留在同一条线上。" },
            { label: "可追溯", detail: "关键动作会保留上下文。" },
          ]}
        />

        <section className="auth-panel">
          <div data-reveal>
            <div className="console-kicker">Sign In</div>
            <h2 className="display-face mt-3 text-4xl">登录控制台</h2>
            <p className="auth-helper mt-3">继续进入你的 workspace。</p>
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
                setError(err instanceof Error ? err.message : "登录失败");
              }
            }}
          >
            <div>
              <label className="console-label" htmlFor="login-email">邮箱</label>
              <input
                id="login-email"
                type="email"
                required
                className="console-input"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="console-label" htmlFor="login-password">密码</label>
              <input
                id="login-password"
                type="password"
                required
                className="console-input"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <MagneticButton className="console-button w-full" strength={0.15}>
              登录
            </MagneticButton>
            {error ? <div className="console-inline-notice is-error">{error}</div> : null}
          </form>
          <div className="auth-helper" data-reveal="fade" data-reveal-delay="4">
            还没有账号？{" "}
            <Link href="/register" className="console-link">
              去注册
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
