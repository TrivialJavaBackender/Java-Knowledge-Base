export function LoadChart({
  before,
  after,
  labels,
  peakAfter,
  clearIn,
  keepLabel,
  keepTone,
}: {
  before: number[];
  after: number[];
  labels: string[];
  peakAfter: number;
  clearIn: string;
  keepLabel: string;
  keepTone: 'ok' | 'warn';
}) {
  const max = Math.max(1, ...before, ...after);
  const h = (v: number) => `${Math.max(2, Math.round((v / max) * 116))}px`;

  return (
    <div className="rounded-[10px] border border-border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="grp text-fg-muted">Нагрузка на две недели вперёд</span>
        <span className="flex-1" />
        <span className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
          <span className="h-[9px] w-[9px] rounded-sm bg-border" />
          сейчас
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-fg-subtle">
          <span className="h-[9px] w-[9px] rounded-sm bg-accent" />
          после
        </span>
      </div>

      <div className="flex h-32 items-end gap-[5px] border-b border-border pb-1.5">
        {before.map((v, i) => (
          <div key={i} className="flex h-full flex-1 items-end justify-center gap-[2px]">
            <span
              className="w-full max-w-[9px] rounded-t-sm bg-border"
              style={{ height: h(v) }}
              title={`${labels[i]} — сейчас: ${v}`}
            />
            <span
              className="w-full max-w-[9px] rounded-t-sm bg-accent"
              style={{ height: h(after[i]) }}
              title={`${labels[i]} — после: ${after[i]}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[5px]">
        {labels.map((l, i) => (
          <span key={i} className="flex-1 text-center font-mono text-[9.5px] text-fg-subtle">
            {l}
          </span>
        ))}
      </div>

      <div className="mt-3.5 grid grid-cols-3 gap-4 border-t border-border pt-3">
        <div>
          <div className="grp text-fg-subtle">Пик в день</div>
          <div className="mt-0.5 font-mono text-[17px] text-fg">{peakAfter}</div>
        </div>
        <div>
          <div className="grp text-fg-subtle">Разгрести за</div>
          <div className="mt-0.5 font-mono text-[17px] text-fg">{clearIn}</div>
        </div>
        <div>
          <div className="grp text-fg-subtle">Боксы и стрики</div>
          <div className={`mt-0.5 text-[14px] ${keepTone === 'ok' ? 'text-ok' : 'text-warn'}`}>{keepLabel}</div>
        </div>
      </div>
    </div>
  );
}
