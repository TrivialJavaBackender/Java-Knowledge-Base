'use client';

import { useEffect, useState } from 'react';
import { ToggleQAKnown } from '@/components/ToggleProgress';
import { InlineMd } from '@/lib/inline-md';

export interface QaCard {
  id: number;
  qNumber: number;
  /** `§N` при привязке к разделу теории, иначе заголовок секции вопросов. Пустая строка — бейдж не рисуем. */
  sectionLabel: string;
  box: number | null;
  question: string;
  answerHtml: string;
  sourceRef: string | null;
  isKnown: boolean;
}

/**
 * Карточка вопроса — одна на два места: выдвижную панель читалки
 * (components/theory/QuestionsPanel.tsx) и страницу /modules/[slug]/qa.
 *
 * Состоянием управляет вызывающий: в панели открыт максимум один вопрос,
 * на странице каждый раскрывается сам по себе (см. AnchoredQuestionCard).
 *
 * Ответ намеренно лежит ВНЕ кнопки-заголовка: он содержит markdown-ссылки,
 * а интерактив внутри интерактива — невалидный HTML, и клики по таким
 * ссылкам не доходят до браузера.
 */
export function QuestionCard({
  q,
  open,
  onToggle,
  anchor,
  flat,
}: {
  q: QaCard;
  open: boolean;
  onToggle: () => void;
  /** id для прямых ссылок вида `#qa-12`. В панели читалки не нужен. */
  anchor?: string;
  /**
   * Строка внутри уже обрамлённого списка (страница вопросов): своя рамка не
   * нужна — иначе получается карточка в карточке в карточке.
   */
  flat?: boolean;
}) {
  return (
    <div
      id={anchor}
      className={
        flat
          ? `border-b border-border last:border-b-0 ${anchor ? 'scroll-mt-24' : ''} ${open ? 'bg-bg-soft' : ''}`
          : `overflow-hidden rounded-lg border bg-bg-card transition ${anchor ? 'scroll-mt-24' : ''} ${
              open ? 'border-accent/45' : 'border-border hover:border-accent/40'
            }`
      }
    >
      <div className={`flex items-start gap-2.5 ${flat ? 'px-3.5 py-2.5' : 'p-2.5'}`}>
        <div className="mt-0.5 flex-none">
          <ToggleQAKnown id={q.id} initial={q.isKnown} size="sm" />
        </div>
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span className="min-w-0 flex-1">
            <span className="mb-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10.5px] text-fg-subtle">Q{q.qNumber}</span>
              {q.sectionLabel && (
                <span className="rounded border border-border bg-bg-soft px-1 font-mono text-[10px] text-fg-muted">
                  {q.sectionLabel}
                </span>
              )}
              {q.box !== null && <span className="font-mono text-[10.5px] text-fg-subtle">box {q.box}</span>}
            </span>
            <InlineMd className="block text-[13.5px] font-medium leading-[1.45] text-fg" text={q.question} />
          </span>
          <ChevronIcon open={open} />
        </button>
      </div>
      {open && (
        <div className={flat ? 'pb-3 pl-[45px] pr-3.5' : 'px-2.5 pb-2.5 pl-[37px]'}>
          <div className={flat ? 'rounded-md border border-border bg-bg-card p-2.5' : 'rounded-md bg-bg-soft p-2.5'}>
            <div
              className="prose prose-sm max-w-none text-fg [&>p:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: q.answerHtml }}
            />
            {q.sourceRef && (
              <div className="mt-2 border-l-2 border-accent/40 pl-2.5 font-mono text-[11px] text-fg-subtle">
                {q.sourceRef}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Та же карточка со своим состоянием и якорем `#qa-<qNumber>` — для страницы
 * вопросов. qNumber, а не id: это natural key контента, поэтому ссылка
 * переживает пере-импорт модуля так же, как остальные ключи.
 *
 * Подписка на `hashchange` обязательна: глобальный поиск
 * (components/SearchBox.tsx) переходит к вопросу присваиванием
 * `window.location.hash`, потому что pushState у Next события не даёт.
 * Проскроллить браузер умеет сам, раскрыть ответ — нет.
 */
export function AnchoredQuestionCard({ q }: { q: QaCard }) {
  const [open, setOpen] = useState(false);
  const anchor = `qa-${q.qNumber}`;

  useEffect(() => {
    function openIfTargeted() {
      if (window.location.hash !== `#${anchor}`) return;
      setOpen(true);
      document.getElementById(anchor)?.scrollIntoView({ block: 'start' });
    }
    openIfTargeted();
    window.addEventListener('hashchange', openIfTargeted);
    return () => window.removeEventListener('hashchange', openIfTargeted);
  }, [anchor]);

  return <QuestionCard q={q} anchor={anchor} flat open={open} onToggle={() => setOpen((v) => !v)} />;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`mt-1 h-3.5 w-3.5 flex-none text-fg-subtle transition-transform ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
