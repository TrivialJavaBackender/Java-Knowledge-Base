import Link from 'next/link';
import { MiniBar } from './MiniBar';
import { InlineMd } from '@/lib/inline-md';

export interface QaSectionCard {
  id: number;
  title: string;
  known: number;
  total: number;
  fileName: string | null;
}

export function QaTab({ moduleSlug, sections }: { moduleSlug: string; sections: QaSectionCard[] }) {
  if (sections.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-border p-6 text-center text-sm text-fg-muted">
        В этом модуле пока нет вопросов.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sections.map((s) => {
        const pct = s.total === 0 ? 0 : (s.known / s.total) * 100;
        return (
          <Link
            key={s.id}
            href={`/modules/${moduleSlug}/qa#section-${s.id}`}
            className="rounded-[10px] border border-border bg-bg-card p-3.5 hover:border-accent/40"
          >
            <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
              <InlineMd className="min-w-0 flex-1 text-[13.5px] font-medium leading-snug text-fg" text={s.title} />
              <span className="flex-none font-mono text-[11px] text-fg-subtle">
                {s.known}/{s.total}
              </span>
            </div>
            <MiniBar pct={pct} />
            {s.fileName && <div className="mt-2 font-mono text-[11.5px] text-fg-subtle">{s.fileName}</div>}
          </Link>
        );
      })}
    </div>
  );
}
