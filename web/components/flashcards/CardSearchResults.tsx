import { TrackDot } from '@/components/ui/TrackDot';
import { InlineMd } from '@/lib/inline-md';
import { CardRowActions } from './CardRowActions';

export interface CardResultRow {
  id: number;
  /** Вопрос уже прогнан через headingText — без markdown-разметки. */
  front: string;
  /** Ответ, отрендеренный в HTML на сервере (lib/markdown.tsx). */
  backHtml: string;
  tags: string;
  moduleTitle: string | null;
  trackColor: 1 | 2 | 3 | 4 | 5 | null;
  box: number | null;
  dueLabel: string;
  overdue: boolean;
  source: string;
  archived: boolean;
}

function Chevron() {
  return (
    <svg
      className="mt-[3px] flex-none text-fg-subtle transition-transform group-open:rotate-90"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export function CardSearchResults({ rows, emptyHint }: { rows: CardResultRow[]; emptyHint: string }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-bg-soft p-8 text-center text-[13px] text-fg-muted">
        {emptyHint}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
      {rows.map((r) => (
        // <details> вместо клиентского аккордеона: раскрытие работает без JS,
        // и список остаётся целиком серверным компонентом.
        <details key={r.id} className="group border-b border-border last:border-b-0">
          <summary className="flex min-h-[52px] cursor-pointer list-none items-start gap-2.5 px-3.5 py-2.5 transition hover:bg-bg-soft [&::-webkit-details-marker]:hidden">
            <Chevron />
            <div className="min-w-0 flex-1">
              <div className={`line-clamp-2 text-[13.5px] leading-snug ${r.archived ? 'text-fg-muted' : 'text-fg'}`}>
                <InlineMd text={r.front} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-fg-subtle">
                {r.moduleTitle && (
                  <>
                    <TrackDot color={r.trackColor} size={7} />
                    <span>{r.moduleTitle}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                {r.box !== null && (
                  <>
                    <span className="font-mono">box {r.box}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span className={r.overdue ? 'text-warn' : undefined}>{r.dueLabel}</span>
                {r.tags && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{r.tags}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-none items-center gap-1.5">
              {r.source === 'MANUAL' && (
                <span className="rounded-full bg-accent-soft px-2 py-px font-mono text-[10.5px] text-accent">своя</span>
              )}
              {r.archived && (
                <span className="rounded-full bg-bg-soft px-2 py-px font-mono text-[10.5px] text-fg-subtle">архив</span>
              )}
            </div>
          </summary>

          <div className="border-t border-border bg-bg-soft px-3.5 py-3 pl-[26px]">
            <div
              className="prose prose-sm max-w-none text-[13px]"
              dangerouslySetInnerHTML={{ __html: r.backHtml }}
            />
            <div className="mt-3 border-t border-border pt-3">
              <CardRowActions id={r.id} archived={r.archived} source={r.source} />
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
