import { BOX_INTERVAL_DAYS } from '@/lib/leitner';
import { intervalLabel } from './format';

export function BoxDistributionGrid({ boxes }: { boxes: [number, number, number, number, number] }) {
  return (
    <div className="mt-6">
      <div className="grp mb-2.5 text-fg-muted">Распределение по ящикам · выбранное</div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {boxes.map((count, i) => {
          const box = i + 1;
          return (
            <div key={box} className="rounded-lg border border-border bg-bg-card p-2.5 text-center">
              <div className="text-[10px] uppercase tracking-wide text-fg-subtle">Box {box}</div>
              <div className="mt-1 font-mono text-[17px] text-fg tabular-nums">{count}</div>
              <div className="text-[10.5px] text-fg-subtle">{intervalLabel(BOX_INTERVAL_DAYS[box])}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
