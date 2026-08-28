import Link from 'next/link';
import { pluralRu } from './format';

export type ContinueReadingData =
  | {
      kind: 'continue';
      moduleSlug: string;
      moduleTitle: string;
      docSlug: string;
      docTitle: string;
      doneSections: number;
      totalSections: number;
      remainingMinutes: number;
      qaCount: number;
    }
  | {
      kind: 'start';
      moduleSlug: string;
      moduleTitle: string;
      docSlug: string;
      docTitle: string;
      totalSections: number;
    }
  | { kind: 'empty' };

export function ContinueReadingCard({ data }: { data: ContinueReadingData }) {
  if (data.kind === 'empty') {
    return (
      <div className="flex h-full flex-col justify-center rounded-lg border border-border bg-bg-card px-4 py-4">
        <div className="grp mb-1.5 text-fg-subtle">Продолжить чтение</div>
        <p className="text-sm text-fg-muted">
          Теория ещё не прочитана. Загляни в любой модуль ниже и начни с первой темы.
        </p>
      </div>
    );
  }

  const href = `/modules/${data.moduleSlug}/theory/${data.docSlug}`;

  if (data.kind === 'start') {
    return (
      <div className="flex h-full flex-col gap-4 rounded-lg border border-border bg-bg-card px-4 py-4 sm:flex-row">
        <div className="min-w-0 flex-1">
          <div className="grp mb-1.5 text-fg-subtle">Продолжить чтение</div>
          <div className="mb-1 text-[17px] font-semibold tracking-tight text-fg">{data.docTitle}</div>
          <div className="mb-3 text-[12.5px] text-fg-muted">
            {data.moduleTitle} · ещё не начато · {data.totalSections}{' '}
            {pluralRu(data.totalSections, ['раздел', 'раздела', 'разделов'])}
          </div>
        </div>
        <div className="flex flex-none flex-col justify-center gap-1.5 sm:w-[168px]">
          <Link
            href={href}
            className="flex h-[34px] items-center justify-center rounded-md border border-accent bg-accent text-[13px] font-medium text-white"
          >
            Начать §1
          </Link>
        </div>
      </div>
    );
  }

  const pct = data.totalSections > 0 ? Math.round((data.doneSections / data.totalSections) * 100) : 0;

  return (
    <div className="flex h-full flex-col gap-4 rounded-lg border border-accent/30 bg-bg-card px-4 py-4 sm:flex-row">
      <div className="min-w-0 flex-1">
        <div className="grp mb-1.5 text-accent">Продолжить чтение</div>
        <div className="mb-1 text-[17px] font-semibold tracking-tight text-fg">{data.docTitle}</div>
        <div className="mb-3 text-[12.5px] text-fg-muted">
          {data.moduleTitle} · остановились на §{data.doneSections} из {data.totalSections} · осталось ~{data.remainingMinutes} мин
        </div>
        <div className="bar max-w-[420px]">
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="flex flex-none flex-col justify-center gap-1.5 sm:w-[168px]">
        <Link
          href={href}
          className="flex h-[34px] items-center justify-center rounded-md border border-accent bg-accent text-[13px] font-medium text-white"
        >
          Открыть §{data.doneSections}
        </Link>
        {data.qaCount > 0 && (
          <Link
            href={href}
            className="flex h-[30px] items-center justify-center rounded-md border border-border bg-bg-card text-[12.5px] text-fg-muted hover:text-fg"
          >
            {data.qaCount} {pluralRu(data.qaCount, ['вопрос', 'вопроса', 'вопросов'])} к файлу
          </Link>
        )}
      </div>
    </div>
  );
}
