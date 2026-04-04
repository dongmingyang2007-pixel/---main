"use client";

interface HighlightsSceneProps {
  eyebrow: string;
  title: string;
  details?: { label: string; body: string }[];
}

export function HighlightsScene({ eyebrow, title, details }: HighlightsSceneProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <p className="text-sm font-medium tracking-widest text-[var(--text-secondary)] uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-3xl font-bold text-[var(--text-primary)] md:text-4xl">
        {title}
      </h2>
      <div className="mt-12 grid w-full max-w-4xl gap-6 md:grid-cols-3">
        {details?.map((d) => (
          <div
            key={d.label}
            className="highlight-card rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-6"
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{d.label}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">{d.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
