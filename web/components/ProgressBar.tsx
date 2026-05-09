export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="space-y-1">
      <div className="progress-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-fg-muted tabular-nums">
        {done} / {total} <span className="text-fg-subtle">({pct}%)</span>
      </div>
    </div>
  );
}
