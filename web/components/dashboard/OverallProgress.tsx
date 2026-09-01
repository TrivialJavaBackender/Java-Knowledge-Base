import { ProgressBar } from '@/components/ProgressBar';

interface Stat {
  done: number;
  total: number;
}

export function OverallProgress({
  done,
  total,
  theory,
  exercises,
  qas,
}: {
  done: number;
  total: number;
  theory: Stat;
  exercises: Stat;
  qas: Stat;
}) {
  return (
    <div className="flex flex-col items-stretch gap-4 rounded-lg border border-border bg-bg-soft px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex-1">
        <div className="mb-1.5 text-[13px] text-fg-muted">Всё вместе</div>
        <ProgressBar done={done} total={total} />
      </div>
      <div className="grid flex-none grid-cols-3 gap-4 sm:flex sm:gap-5 sm:border-l sm:border-border sm:pl-4">
        <StatCol label="Теория" stat={theory} />
        <StatCol label="Упражнения" stat={exercises} />
        <StatCol label="Вопросы" stat={qas} />
      </div>
    </div>
  );
}

function StatCol({ label, stat }: { label: string; stat: Stat }) {
  return (
    <div className="text-left sm:text-right">
      <div className="text-[10.5px] uppercase tracking-wide text-fg-subtle">{label}</div>
      <div className="font-mono text-sm text-fg tabular-nums">
        {stat.done}/{stat.total}
      </div>
    </div>
  );
}
