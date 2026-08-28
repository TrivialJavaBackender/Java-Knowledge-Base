import Link from 'next/link';
import { TRACK_DOT_CLASS } from './colors';

export interface DeckRowData {
  key: string;
  title: string;
  /** null для колоды «Свои» — у ручных карточек нет трека. */
  trackColor: 1 | 2 | 3 | 4 | 5 | null;
  dueLabel: string;
  hasDue: boolean;
  boxes: [number, number, number, number, number];
  meta: string;
  selected: boolean;
  href: string;
}

/** Насыщенность акцента по ящикам: box 1 — полная, box 5 — едва заметная. */
const BOX_OPACITY = [1, 0.78, 0.56, 0.34, 0.16];

export function DeckSidebar({
  decks,
  selectAllLabel,
  selectAllHref,
}: {
  decks: DeckRowData[];
  selectAllLabel: string;
  selectAllHref: string;
}) {
  return (
    <aside className="scroll min-h-0 w-[428px] flex-none overflow-y-auto border-r border-border bg-bg-soft px-4 pb-6 pt-[18px]">
      <div className="mb-3 flex items-center gap-2">
        <span className="grp text-fg-muted">Колоды по модулям</span>
        <span className="flex-1" />
        <Link
          href={selectAllHref}
          className="rounded-full border border-border bg-bg-card px-2.5 py-1 text-[11.5px] text-fg-muted hover:border-accent/50 hover:text-fg"
        >
          {selectAllLabel}
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        {decks.map((d) => (
          <Link
            key={d.key}
            href={d.href}
            className={`block rounded-[9px] border px-3 py-2.5 transition ${
              d.selected ? 'border-accent/45 bg-accent-soft' : 'border-border bg-bg-card hover:border-accent/30'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-[15px] w-[15px] flex-none items-center justify-center rounded-[4px] border ${
                  d.selected ? 'border-accent bg-accent' : 'border-border bg-bg-card'
                }`}
              >
                {d.selected && (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="var(--bg)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 8l3 3 7-7" />
                  </svg>
                )}
              </span>
              {d.trackColor != null ? (
                <span className={`h-2 w-2 flex-none rounded-[2px] ${TRACK_DOT_CLASS[d.trackColor]}`} />
              ) : (
                <span className="h-2 w-2 flex-none rounded-[2px] bg-fg-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-fg">{d.title}</span>
              <span
                className={`flex-none rounded-full px-1.5 py-px font-mono text-[11px] ${
                  d.hasDue ? 'bg-accent-soft text-accent' : 'bg-bg-soft text-fg-subtle'
                }`}
              >
                {d.dueLabel}
              </span>
            </div>

            <div className="ml-[33px] mt-2 flex gap-[3px]">
              {d.boxes.map((count, i) => (
                <span
                  key={i}
                  className="h-[5px] rounded-sm bg-accent"
                  style={{ flex: count + 1, opacity: BOX_OPACITY[i] }}
                />
              ))}
            </div>
            <div className="ml-[33px] mt-1.5 text-[11px] text-fg-subtle">{d.meta}</div>
          </Link>
        ))}
      </div>

      <div className="mt-3.5 rounded-[9px] border border-dashed border-border p-3 text-[11.5px] leading-[1.55] text-fg-muted">
        Смешивать модули полезнее для памяти, чем гонять один — раздельные колоды хороши, чтобы добить конкретное
        слабое место перед собеседованием, а не заменить общую очередь.
      </div>
    </aside>
  );
}
