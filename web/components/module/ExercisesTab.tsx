import Link from 'next/link';
import { InlineMd } from '@/lib/inline-md';

export interface ExerciseRow {
  slug: string;
  number: number;
  title: string;
  language: string;
  isRead: boolean;
}

export function ExercisesTab({ moduleSlug, rows }: { moduleSlug: string; rows: ExerciseRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <svg
          viewBox="0 0 24 24"
          className="h-[26px] w-[26px] text-fg-subtle"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 8 5 12 9 16" />
          <polyline points="15 8 19 12 15 16" />
        </svg>
        <div className="text-[15px] font-medium text-fg">В этом модуле упражнений нет</div>
        <div className="max-w-[420px] text-[12.5px] leading-relaxed text-fg-muted">
          Тема разбирается через теорию и вопросы для собеседования. Вкладка появится, как только в модуле
          заведутся файлы <span className="font-mono">Ex&lt;NN&gt;_*</span>.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-px overflow-hidden rounded-[10px] border border-border bg-border">
      {rows.map((e) => (
        <Link
          key={e.slug}
          href={`/modules/${moduleSlug}/exercises/${e.slug}`}
          className="flex items-center gap-3 bg-bg-card px-4 py-2.5 hover:bg-bg-soft"
        >
          <span
            className={`flex h-4 w-4 flex-none items-center justify-center rounded border ${
              e.isRead ? 'border-accent bg-accent' : 'border-border bg-bg-card'
            }`}
          >
            {e.isRead && (
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
          <span className="w-5 flex-none font-mono text-[11px] text-fg-subtle">{e.number}</span>
          <InlineMd className={`min-w-0 flex-1 truncate text-sm ${e.isRead ? 'text-fg-muted' : 'text-fg'}`} text={e.title} />
          <span className="flex-none font-mono text-[11px] text-fg-subtle">{e.language}</span>
        </Link>
      ))}
    </div>
  );
}
