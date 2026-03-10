import Link from "next/link";

export default function NotFound() {
  return (
    <div className="site-container py-10">
      <section className="public-hero glass-panel">
        <div className="public-hero-copy">
          <div className="site-kicker mx-auto w-fit">404</div>
          <h1 className="site-title">这个页面不存在，或者你当前不该看到它。</h1>
          <p className="site-lead mx-auto">
            如果你是从控制台深链进入，可能是资源已删除或当前 workspace 无权限；如果你在公开站里跳转，这通常只是一个无效链接。
          </p>
          <div className="site-actions justify-center">
            <Link className="site-button" href="/">
              返回首页
            </Link>
            <Link className="site-button-secondary" href="/demo">
              打开 Demo
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
