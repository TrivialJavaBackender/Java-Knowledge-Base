import Link from 'next/link';
import { pluralizeRu } from './pluralize';

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
              Роадмап модуля · {steps.length} {pluralizeRu(steps.length, 'шаг', 'шага', 'шагов')}
            </div>
            <div>
              {steps.map((s, i) => (
                <div key={s.slug} className="flex items-stretch gap-3.5">
                  <div className="flex w-[26px] flex-none flex-col items-center">
                    <span
                      className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 ${
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
                          className="h-[11px] w-[11px]"
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
                    {i < steps.length - 1 && (
                      <span
                        className={`w-0.5 flex-1 ${s.status === 'done' ? 'bg-accent' : 'bg-border'}`}
                        style={{ minHeight: 10 }}
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pb-2.5">
                    <Link
                      href={`/modules/${moduleSlug}/theory/${s.slug}`}
                      className={`flex items-center gap-2.5 rounded-[9px] border px-3.5 py-2.5 ${
                        s.status === 'current' ? 'border-accent/45 bg-accent-soft' : 'border-border bg-bg-card hover:bg-bg-soft'
                      }`}
                    >
                      <span className="flex-none font-mono text-[11px] text-fg-subtle">{s.num}</span>
                      <span
                        className={`min-w-0 flex-1 truncate text-[13.5px] leading-snug ${
                          s.status === 'current' ? 'font-semibold text-fg' : s.status === 'done' ? 'text-fg-muted' : 'text-fg'
                        }`}
                      >
                        {s.title}
                      </span>
                      <span className="flex-none text-[11px] text-fg-subtle">{s.meta}</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {continueInfo && (
          <div className="rounded-[10px] border border-accent/30 bg-bg-card p-3.5">
            <div className="grp mb-2 text-accent">Продолжить</div>
            <div className="text-[14.5px] font-semibold leading-snug text-fg">{continueInfo.title}</div>
            <div className="mb-2.5 mt-1 text-xs text-fg-muted">{continueInfo.meta}</div>
            <Link
              href={`/modules/${moduleSlug}/theory/${continueInfo.slug}`}
              className="block h-8 rounded-md border border-accent bg-accent text-center text-[13px] font-medium leading-8 text-white hover:opacity-90"
            >
              Читать дальше
            </Link>
          </div>
        )}

        {weakQas.length > 0 && (
          <div className="rounded-[10px] border border-border bg-bg-card p-3.5">
            <div className="grp mb-2.5 text-fg-muted">Слабые места</div>
            <div className="flex flex-col gap-2">
              {weakQas.map((q) => (
                <div key={q.qNumber} className="flex items-center gap-2">
                  <span className="flex-none rounded border border-border bg-bg-soft px-1.5 py-px font-mono text-[10.5px] text-fg-muted">
                    Q{q.qNumber}
                  </span>
                  <span className="min-w-0 flex-1 text-xs leading-snug text-fg-muted">{q.question}</span>
                  <span className="flex-none font-mono text-[10.5px] text-fg-subtle">×{q.lapses}</span>
                </div>
              ))}
            </div>
            <Link
              href="/flashcards"
              className="mt-2.5 block h-[30px] rounded-md border border-border bg-bg-soft text-center text-xs leading-[30px] text-fg hover:border-accent/50"
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
