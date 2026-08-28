import Link from 'next/link';

export interface PlanCardData {
  id: string;
  title: string;
  tag: string;
  body: string;
  cost: string;
  costTone: 'ok' | 'warn';
  active: boolean;
  href: string;
}

export function PlanCards({ plans }: { plans: PlanCardData[] }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {plans.map((p) => (
        <Link
          key={p.id}
          href={p.href}
          className={`flex flex-col rounded-[10px] border p-[14px] ${
            p.active ? 'border-accent/45 bg-accent-soft' : 'border-border bg-bg-card hover:border-accent/25'
          }`}
        >
          <div className="mb-2 flex items-start gap-2.5">
            <span
              className={`mt-0.5 flex h-[15px] w-[15px] flex-none items-center justify-center rounded-full border bg-bg-card ${
                p.active ? 'border-2 border-accent' : 'border border-border'
              }`}
            >
              {p.active && <span className="h-[7px] w-[7px] rounded-full bg-accent" />}
            </span>
            <span className="flex-1 text-[14.5px] font-semibold leading-tight text-fg">{p.title}</span>
            <span
              className={`flex-none rounded-full px-1.5 py-px font-mono text-[10px] ${
                p.active ? 'bg-bg-card text-accent' : 'bg-bg-soft text-fg-subtle'
              }`}
            >
              {p.tag}
            </span>
          </div>
          <div className="text-[12.5px] leading-[1.55] text-fg-muted">{p.body}</div>
          <div
            className={`mt-2.5 border-t border-dashed border-border pt-2.5 text-[12px] leading-[1.5] ${
              p.costTone === 'ok' ? 'text-ok' : 'text-warn'
            }`}
          >
            {p.cost}
          </div>
        </Link>
      ))}
    </div>
  );
}
