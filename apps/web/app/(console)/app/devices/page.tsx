export default function DevicesPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="console-panel">
        <div className="console-panel-header">
          <div>
            <h2 className="console-panel-title">设备工作区</h2>
            <p className="console-panel-description">设备绑定、固件升级和硬件诊断还没接入，但信息架构已经按后续方向预留。</p>
          </div>
        </div>
        <div className="console-panel-body">
          <div className="console-empty">当前还没有已绑定设备。后续将展示序列号、固件版本、电量和隐私开关状态。</div>
        </div>
      </section>

      <section className="console-panel">
        <div className="console-panel-body">
          <div className="console-kicker">Planned Modules</div>
          <div className="console-key-grid mt-4">
            {[
              ["绑定", "设备激活与归属确认"],
              ["固件", "升级版本与回滚"],
              ["诊断", "传感器、隐私开关与连接状态"],
              ["日志", "本地采集与同步行为摘要"],
            ].map(([label, value]) => (
              <div key={label} className="console-key-item">
                <div className="console-key-label">{label}</div>
                <div className="console-key-value">{value}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
