/** Тонкая полоса прогресса без подписи — обёртка над утилитами .bar/.bar>span из globals.css. */
export function MiniBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="bar">
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}
