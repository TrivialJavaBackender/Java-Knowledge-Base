'use client';

import { useState } from 'react';
import Link from 'next/link';
import { TRACK_DOT_CLASS } from '@/components/ui/TrackDot';
import { pluralRu } from './format';

export interface DeckRowData {
  key: string;
  title: string;
  /** null для колоды «Свои» — у ручных карточек нет трека. */
  trackColor: 1 | 2 | 3 | 4 | 5 | null;
  dueLabel: string;
  hasDue: boolean;
  /** Числовое due отдельно от dueLabel — нужно суммировать по выбранным колодам для мобильного триггера. */
  due: number;
  boxes: [number, number, number, number, number];
  meta: string;
  selected: boolean;
  href: string;
}

/** Насыщенность акцента по ящикам: box 1 — полная, box 5 — едва заметная. */
const BOX_OPACITY = [1, 0.78, 0.56, 0.34, 0.16];

/**
 * Список колод. На `lg`+ — колонка в потоке слева, как раньше (428px).
 * Ниже `lg` она шире вьюпорта, поэтому уходит в off-canvas панель — паттерн
 * скопирован с components/theory/LeftNav.tsx: свой floating-триггер + backdrop,
 * панель фиксирована и выезжает transform'ом. Отличие от LeftNav: клик по
 * колоде здесь не должен закрывать панель — это тоггл множественного выбора
 * (см. decksHref в app/flashcards/page.tsx), а не переход «выбрал и ушёл»,
 * поэтому закрытие только по backdrop и по кнопке «Готово» в шапке.
 */
export function DeckSidebar({
  decks,
  selectAllLabel,
  selectAllHref,
}: {
  decks: DeckRowData[];
  selectAllLabel: string;
  selectAllHref: string;
}) {
  /**
   * Состояние мобильной шторки, и только её: на lg+ колонка стоит в потоке и
   * держится классом `lg:translate-x-0` независимо от этого флага.
   *
   * Раньше здесь был стартовый `true` и эффект, закрывавший панель после
   * гидратации на узком экране. Вместе с `transition-transform` это давало
   * видимый глюк: панель успевала отрисоваться поверх карточки и уезжала за
   * левый край сама собой на каждой загрузке. Закрытая по умолчанию шторка
   * верна на сервере и на клиенте сразу, эффект не нужен.
   */
  const [open, setOpen] = useState(false);

  const selectedCount = decks.filter((d) => d.selected).length;
  const dueSum = decks.reduce((sum, d) => (d.selected ? sum + d.due : sum), 0);

  return (
    <>
      {/* Mobile trigger — по нему видно текущий выбор, не открывая панель.
          При открытой панели прячем: он лежит выше неё по z-index и иначе
          висел бы поверх, ничего не делая. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Выбор колод"
        aria-expanded={open}
        className={`fixed left-2 top-[60px] z-30 h-9 items-center gap-1.5 rounded-md border border-border bg-bg-card px-2.5 text-fg-muted shadow-sm lg:hidden ${open ? 'hidden' : 'flex'}`}
      >
        <DeckIcon />
        <span className="max-w-[46vw] truncate text-[12px]">
          {selectedCount} {pluralRu(selectedCount, ['колода', 'колоды', 'колод'])}
        </span>
        {dueSum > 0 && (
          <span className="flex-none rounded-full bg-accent-soft px-1.5 py-px font-mono text-[10.5px] text-accent">
            {dueSum}
          </span>
        )}
      </button>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`scroll fixed bottom-0 left-0 top-[52px] z-20 min-h-0 w-[min(88vw,428px)] flex-none overflow-y-auto border-r border-border bg-bg-soft px-4 pb-6 pt-[18px] transition-transform duration-200 lg:static lg:z-auto lg:h-full lg:w-[428px] lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="grp text-fg-muted">Колоды по модулям</span>
          <span className="flex-1" />
          <Link
            href={selectAllHref}
            scroll={false}
            className="flex h-8 items-center rounded-full border border-border bg-bg-card px-3 text-[11.5px] text-fg-muted transition hover:border-accent/50 hover:text-fg"
          >
            {selectAllLabel}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 items-center rounded-full border border-border bg-bg-card px-3 text-[11.5px] text-fg-muted transition hover:border-accent/50 hover:text-fg lg:hidden"
          >
            Готово
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {decks.map((d) => (
            <Link
              key={d.key}
              href={d.href}
              scroll={false}
              aria-pressed={d.selected}
              className={`block rounded-[9px] border px-3 py-2.5 transition ${
                d.selected
                  ? 'border-border bg-bg-card hover:border-accent/40'
                  : 'border-dashed border-border bg-transparent opacity-55 hover:opacity-90'
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
                    d.hasDue ? 'bg-accent-soft text-accent' : 'text-fg-subtle'
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
    </>
  );
}

function DeckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
      <rect x="3" y="10.5" width="18" height="4.5" rx="1.2" />
      <rect x="3" y="17" width="18" height="4.5" rx="1.2" />
    </svg>
  );
}
