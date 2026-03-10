export default function BillingPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">计费与额度</h2>
            <p className="console-panel-description">v0.1 还没有正式计费，但后续会在这里管理算力、存储和团队额度。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-empty">当前版本不产生真实账单。套餐结构和配额规则会在控制台正式开放前补齐。</div>
        </div>
      </section>

      <aside className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">Future Quotas</div>
          <ul className="site-feature-list mt-4">
            <li>训练并发与保留天数</li>
            <li>对象存储额度与带宽</li>
            <li>团队成员数与 workspace 级权限</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
