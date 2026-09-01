import Link from 'next/link';
import { countOf } from '@/lib/plural';
import { InlineMd } from '@/lib/inline-md';

export interface RoadmapStep {
  slug: string;
  num: number;
  title: string;
  status: 'done' | 'current' | 'future';
  meta: string;
}

export interface ContinueInfo {
  slug: string;
  title: string;
  meta: string;
  /** Вся теория модуля прочитана — «дальше» уже не про чтение. */
  allRead: boolean;
  /** Сколько вопросов модуля ещё не отмечены «знаю». */
  qaOpen: number;
}

export interface WeakQa {
  qNumber: number;
  question: string;
  lapses: number;
}

export interface RelatedModule {
  slug: string;
  title: string;
}

export function OverviewTab({
  moduleSlug,
  steps,
  continueInfo,
  weakQas,
  relatedModules,
}: {
  moduleSlug: string;
  steps: RoadmapStep[];
  continueInfo: ContinueInfo | null;
  weakQas: WeakQa[];
  relatedModules: RelatedModule[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        {steps.length > 0 && (
          <>
            <div className="grp mb-3 text-fg-muted">
              Роадмап модуля · {countOf(steps.length, 'step')}
            </div>
            {/* Раньше каждый шаг был отдельной карточкой с рамкой: двенадцать
                одинаковых прямоугольников лесенкой вдоль вертикальной линии.
                Теперь роадмап — один список с волосяными разделителями, рамку
                получает только текущий шаг: он и должен быть виден первым. */}
            <ol className="overflow-hidden rounded-[10px] border border-border bg-bg-card">
              {steps.map((s, i) => (
                <li key={s.slug} className={i > 0 ? 'border-t border-border' : undefined}>
                  <Link
                    href={`/modules/${moduleSlug}/theory/${s.slug}`}
                    aria-current={s.status === 'current' ? 'step' : undefined}
                    className={`group flex items-center gap-3 py-2.5 pl-3 pr-3.5 transition sm:pl-3.5 ${
                      s.status === 'current' ? 'bg-accent-soft' : 'hover:bg-bg-soft'
                    }`}
                  >
                    {/* Рельс роадмапа: маркер шага плюс отрезок линии до соседей.
                        Отрезки рисуем от маркера вверх/вниз на всю высоту строки,
                        поэтому линия остаётся сплошной при любой высоте строки. */}
                    {/* -my-2.5 гасит вертикальный padding ссылки: без него
                        self-stretch даёт высоту ровно в размер маркера, отрезки
                        рельса оказываются под ним и не видны. */}
                    <span className="relative -my-2.5 flex w-[22px] flex-none items-center justify-center self-stretch">
                      {/* Отрезки идут до середины строки: непрозрачный маркер
                          ниже по DOM накрывает стык, поэтому рельс выглядит
                          сплошным без вычисления зазора под размер маркера. */}
                      {i > 0 && (
                        <span
                          className={`absolute left-1/2 top-0 h-1/2 w-0.5 -translate-x-1/2 ${
                            s.status === 'future' ? 'bg-border' : 'bg-accent'
                          }`}
                        />
                      )}
                      {i < steps.length - 1 && (
                        <span
                          className={`absolute bottom-0 left-1/2 h-1/2 w-0.5 -translate-x-1/2 ${
                            s.status === 'done' ? 'bg-accent' : 'bg-border'
                          }`}
                        />
                      )}
                      <span
                        className={`relative flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full border-2 ${
                          s.status === 'done'
                            ? 'border-accent bg-accent'
                            : s.status === 'current'
                              ? 'border-accent bg-bg'
                              : 'border-border bg-bg'
                        }`}
                      >
                        {s.status === 'done' && (
                          <svg
                            viewBox="0 0 16 16"
                            className="h-[10px] w-[10px]"
                            fill="none"
                            stroke="var(--bg)"
                            strokeWidth="2.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden
                          >
                            <path d="M3 8l3 3 7-7" />
                          </svg>
                        )}
                      </span>
                    </span>
                    <span className="w-4 flex-none font-mono text-[11px] text-fg-subtle tabular-nums">{s.num}</span>
                    <span
                      className={`min-w-0 flex-1 truncate text-[13.5px] leading-snug ${
                        s.status === 'current'
                          ? 'font-semibold text-fg'
                          : s.status === 'done'
                            ? 'text-fg-muted group-hover:text-fg'
                            : 'text-fg'
                      }`}
                    >
                      <InlineMd text={s.title} />
                    </span>
                    <span className="flex-none text-[11px] text-fg-subtle">{s.meta}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {continueInfo &&
          (continueInfo.allRead ? (
            <div className="rounded-[10px] border border-border bg-bg-card p-3.5">
              <div className="grp mb-2 text-ok">Теория пройдена</div>
              <div className="text-[13px] leading-relaxed text-fg-muted">
                {continueInfo.qaOpen > 0
                  ? `Все темы роадмапа прочитаны. Осталось закрыть ${countOf(continueInfo.qaOpen, 'question')} — это и есть подготовка к собеседованию.`
                  : 'Все темы прочитаны и все вопросы отмечены. Дальше модуль держится повторениями.'}
              </div>
              <Link
                href={
                  continueInfo.qaOpen > 0 ? `/modules/${moduleSlug}?tab=qa` : '/flashcards'
                }
                className="mt-2.5 flex h-9 items-center justify-center rounded-md border border-accent bg-accent text-[13px] font-medium text-white transition hover:opacity-90"
              >
                {continueInfo.qaOpen > 0 ? 'К вопросам' : 'К повторению'}
              </Link>
              <Link
                href={`/modules/${moduleSlug}/theory/${continueInfo.slug}`}
                className="mt-1.5 flex h-8 items-center justify-center rounded-md border border-border bg-bg-soft text-[12.5px] text-fg-muted transition hover:border-accent/50 hover:text-fg"
              >
                Перечитать последнее
              </Link>
            </div>
          ) : (
            <div className="rounded-[10px] border border-accent/30 bg-bg-card p-3.5">
              <div className="grp mb-2 text-accent">Продолжить</div>
              <div className="text-[14.5px] font-semibold leading-snug text-fg">
                <InlineMd text={continueInfo.title} />
              </div>
              <div className="mb-2.5 mt-1 text-xs text-fg-muted">{continueInfo.meta}</div>
              <Link
                href={`/modules/${moduleSlug}/theory/${continueInfo.slug}`}
                className="flex h-9 items-center justify-center rounded-md border border-accent bg-accent text-[13px] font-medium text-white transition hover:opacity-90"
              >
                Читать дальше
              </Link>
            </div>
          ))}

        {weakQas.length > 0 && (
          <div className="rounded-[10px] border border-border bg-bg-card p-3.5">
            <div className="grp mb-2.5 text-fg-muted">Слабые места</div>
            <div className="flex flex-col gap-2">
              {weakQas.map((q) => (
                <div key={q.qNumber} className="flex items-center gap-2">
                  <span className="flex-none rounded border border-border bg-bg-soft px-1.5 py-px font-mono text-[10.5px] text-fg-muted">
                    Q{q.qNumber}
                  </span>
                  <InlineMd className="min-w-0 flex-1 text-xs leading-snug text-fg-muted" text={q.question} />
                  <span className="flex-none font-mono text-[10.5px] text-fg-subtle">×{q.lapses}</span>
                </div>
              ))}
            </div>
            <Link
              href="/flashcards"
              className="mt-2.5 flex h-9 items-center justify-center rounded-md border border-border bg-bg-soft text-xs text-fg transition hover:border-accent/50"
            >
              Прогнать {weakQas.length} слабых
            </Link>
          </div>
        )}

        {relatedModules.length > 0 && (
          <div className="rounded-[10px] border border-border bg-bg-card p-3.5">
            <div className="grp mb-2.5 text-fg-muted">Связанные модули</div>
            <div className="flex flex-wrap gap-1.5">
              {relatedModules.map((m) => (
                <Link
                  key={m.slug}
                  href={`/modules/${m.slug}`}
                  className="rounded-full border border-border bg-bg-soft px-2.5 py-0.5 text-xs text-fg-muted hover:border-accent/50 hover:text-fg"
                >
                  {m.title}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
