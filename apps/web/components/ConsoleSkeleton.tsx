export function ConsoleSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="console-skeleton" aria-busy="true" aria-label="加载中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="console-skeleton-row">
          <div className="console-skeleton-bar" style={{ width: `${60 + (i % 3) * 15}%` }} />
        </div>
      ))}
    </div>
  );
}

export function ConsoleTableSkeleton({ cols = 4, rows = 5 }: { cols?: number; rows?: number }) {
  return (
    <div className="console-skeleton" aria-busy="true" aria-label="加载中">
      <div className="console-skeleton-table-head">
        {Array.from({ length: cols }, (_, i) => (
          <div key={i} className="console-skeleton-bar" style={{ width: "80%" }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="console-skeleton-table-row">
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="console-skeleton-bar" style={{ width: `${50 + ((r + c) % 4) * 12}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
