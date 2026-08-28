export interface QueueRow {
  id: number;
  front: string;
  moduleTitle: string;
  box: number | null;
  lateDays: number;
  source: string;
}

export function QueueList({ rows, totalCount }: { rows: QueueRow[]; totalCount: number }) {
  return (
    <div>
      <div className="grp mb-2.5 mt-[26px] text-fg-muted">
        Затронутые карточки · {rows.length} из {totalCount}
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border">
        <div className="flex items-center gap-3 border-b border-border bg-bg-soft px-3.5 py-1.5">
          <span className="grp flex-1 text-fg-subtle">Вопрос</span>
          <span className="grp w-[150px] flex-none text-fg-subtle">Модуль</span>
          <span className="grp w-[46px] flex-none text-fg-subtle">Box</span>
          <span className="grp w-[96px] flex-none text-fg-subtle">Просрочка</span>
          <span className="grp w-[74px] flex-none text-fg-subtle">Источник</span>
        </div>
        <div className="scroll max-h-[420px] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-border bg-bg-card px-3.5 py-[9px] last:border-b-0">
              <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{r.front}</span>
              <span className="w-[150px] flex-none truncate text-[12px] text-fg-muted">{r.moduleTitle}</span>
              <span className="w-[46px] flex-none font-mono text-[12px] text-fg-muted">{r.box ?? '—'}</span>
              <span className="w-[96px] flex-none font-mono text-[12px] text-warn">{r.lateDays} дн.</span>
              <span className={`w-[74px] flex-none font-mono text-[11px] ${r.source === 'MANUAL' ? 'text-accent' : 'text-fg-subtle'}`}>
                {r.source}
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="p-6 text-center text-[13px] text-fg-subtle">Ничего не попадает под выбор.</div>}
        </div>
      </div>
    </div>
  );
}
