"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WorkbenchHero } from "@/components/WorkbenchHero";
import { apiPost, persistWorkspaceId } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <WorkbenchHero
          eyebrow="Create Workspace"
          title="注册后直接进入工作台，不再在前台和后台之间切换语气。"
          summary="默认会创建一个初始 workspace，把项目、数据集、训练和模型仓收进同一套操作面板。"
          points={[
            { label: "项目", detail: "按业务或实验边界组织工作。" },
            { label: "数据集", detail: "上传、标注、冻结版本。" },
            { label: "模型仓", detail: "发布 alias，并保留回滚路径。" },
          ]}
        />

        <section className="auth-panel">
          <div>
            <div className="console-kicker">Register</div>
            <h2 className="display-face mt-3 text-4xl">创建账号</h2>
            <p className="auth-helper mt-3">默认会创建初始 workspace。</p>
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
                setError(err instanceof Error ? err.message : "注册失败");
              }
            }}
          >
            <div>
              <label className="console-label" htmlFor="register-display-name">显示名</label>
              <input
                id="register-display-name"
                required
                className="console-input"
                placeholder="显示名"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <label className="console-label" htmlFor="register-email">邮箱</label>
              <input
                id="register-email"
                type="email"
                required
                className="console-input"
                placeholder="邮箱"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="console-label" htmlFor="register-password">密码</label>
              <input
                id="register-password"
                type="password"
                required
                className="console-input"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <button className="console-button w-full">注册并进入控制台</button>
            {error ? <div className="console-inline-notice is-error">{error}</div> : null}
          </form>
          <div className="auth-helper">
            已有账号？{" "}
            <Link href="/login" className="console-link">
              去登录
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
