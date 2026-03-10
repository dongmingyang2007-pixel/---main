type WorkbenchPoint = {
  label: string;
  detail: string;
};

export function WorkbenchHero({
  eyebrow,
  title,
  summary,
  points,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  points: WorkbenchPoint[];
}) {
  return (
    <section className="workbench-hero">
      <div className="workbench-hero-topline">
        <div className="site-kicker is-on-dark">{eyebrow}</div>
        <div className="workbench-hero-status">Studio Access</div>
      </div>
      <h1 className="workbench-hero-title">{title}</h1>
      <p className="workbench-hero-summary">{summary}</p>
      <div className="workbench-point-list">
        {points.map((point) => (
          <article key={point.label} className="workbench-point">
            <strong className="workbench-point-label">{point.label}</strong>
            <span className="workbench-point-detail">{point.detail}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
