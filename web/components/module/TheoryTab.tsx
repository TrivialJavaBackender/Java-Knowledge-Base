import Link from 'next/link';
import { pluralizeRu } from './pluralize';

export interface TheoryRow {
  slug: string;
  num: number;
  title: string;
  sectionCount: number;
  readingMinutes: number;
  qCount: number;
  isRead: boolean;
  isCurrent: boolean;
}

export function TheoryTab({ moduleSlug, rows }: { moduleSlug: string; rows: TheoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-border p-6 text-center text-sm text-fg-muted">
        В этом модуле пока нет теории.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-border bg-border">
      {rows.map((d) => (
        <Link
          key={d.slug}
          href={`/modules/${moduleSlug}/theory/${d.slug}`}
          className={`flex items-center gap-3 px-4 py-2.5 ${d.isCurrent ? 'bg-accent-soft' : 'bg-bg-card hover:bg-bg-soft'}`}
        >
          <span
            className={`flex h-4 w-4 flex-none items-center justify-center rounded border ${
              d.isRead ? 'border-accent bg-accent' : 'border-border bg-bg-card'
            }`}
          >
            {d.isRead && (
              <svg
                viewBox="0 0 16 16"
                className="h-2.5 w-2.5"
                fill="none"
                stroke="var(--bg)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 8l3 3 7-7" />
              </svg>
            )}
          </span>
          <span className="w-5 flex-none font-mono text-[11px] text-fg-subtle">{d.num}</span>
          <span
            className={`min-w-0 flex-1 truncate text-sm ${
              d.isCurrent ? 'font-semibold text-fg' : d.isRead ? 'text-fg-muted' : 'text-fg'
            }`}
          >
            {d.title}
          </span>
          <span className="hidden flex-none text-[11.5px] text-fg-subtle sm:inline">
            {d.sectionCount} {pluralizeRu(d.sectionCount, 'раздел', 'раздела', 'разделов')}
          </span>
          <span className="hidden w-[62px] flex-none text-right text-[11.5px] text-fg-subtle sm:inline">
            ~{d.readingMinutes} мин
          </span>
          <span className="flex-none rounded-full bg-bg-soft px-1.5 py-px text-right font-mono text-[10.5px] text-fg-muted sm:w-[74px]">
            {d.qCount} вопр.
          </span>
        </Link>
      ))}
    </div>
  );
}
