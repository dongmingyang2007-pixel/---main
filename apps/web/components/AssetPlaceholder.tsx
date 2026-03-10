import clsx from "clsx";

export function AssetPlaceholder({
  eyebrow,
  title,
  summary,
  specs = [],
  tone = "light",
  compact = false,
}: {
  eyebrow: string;
  title: string;
  summary: string;
  specs?: string[];
  tone?: "light" | "dark";
  compact?: boolean;
}) {
  return (
    <article className={clsx("asset-placeholder", tone === "dark" && "is-dark", compact && "is-compact")}>
      <div className="asset-placeholder-kicker">{eyebrow}</div>
      <h3 className="asset-placeholder-title">{title}</h3>
      <p className="asset-placeholder-summary">{summary}</p>
      {specs.length ? (
        <div className="asset-placeholder-specs">
          {specs.map((spec) => (
            <span key={spec}>{spec}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
