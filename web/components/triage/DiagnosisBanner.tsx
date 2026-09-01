import { pluralRu } from '@/components/flashcards/format';

export function DiagnosisBanner({
  overdueTotal,
  totalActive,
  overdueOld30,
  inTimeTotal,
  oldestOverdueDays,
  daysSinceLastReview,
}: {
  overdueTotal: number;
  totalActive: number;
  overdueOld30: number;
  inTimeTotal: number;
  oldestOverdueDays: number;
  daysSinceLastReview: number | null;
}) {
  if (overdueTotal === 0) {
    return (
      <div className="flex items-start gap-4 rounded-[10px] border border-ok/40 bg-ok/[0.07] p-4">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        <div className="text-[13px] leading-[1.55] text-fg-muted">
          Просроченных карточек нет — очередь в порядке ({totalActive}{' '}
          {pluralRu(totalActive, ['активная карточка', 'активные карточки', 'активных карточек'])}).
          Разбирать нечего.
        </div>
      </div>
    );
  }

  const lastVisitLabel =
    daysSinceLastReview === null
      ? 'ещё ни разу'
      : daysSinceLastReview === 0
        ? 'сегодня'
        : `${daysSinceLastReview} ${pluralRu(daysSinceLastReview, ['день', 'дня', 'дней'])} назад`;

  return (
    <div className="flex flex-wrap items-start gap-4 rounded-[10px] border border-warn/40 bg-warn/[0.07] p-4">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5" />
        <circle cx="12" cy="16.2" r="0.7" fill="var(--warn)" stroke="none" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-[16px] font-semibold text-fg">
          Очередь просрочена: {overdueTotal} {pluralRu(overdueTotal, ['карточка', 'карточки', 'карточек'])} из {totalActive}
        </div>
        <div className="text-[13px] leading-[1.55] text-fg-muted">
          Последний заход — {lastVisitLabel}. Самой старой просрочке {oldestOverdueDays}{' '}
          {pluralRu(oldestOverdueDays, ['день', 'дня', 'дней'])}. Разобрать всё это за один присест — не решение: усталость
          в конце длинной сессии роняет долю верных ответов, а неверный ответ возвращает карточку в первый ящик — тот же
          завал соберётся снова.
        </div>
      </div>
      <div className="flex basis-full gap-5 lg:flex-none lg:basis-auto lg:border-l lg:border-warn/30 lg:pl-4">
        <div className="text-right">
          <div className="grp text-fg-subtle">Просрочено</div>
          <div className="mt-0.5 font-mono text-[20px] text-fg">{overdueTotal}</div>
        </div>
        <div className="text-right">
          <div className="grp text-fg-subtle">Из них &gt; 30 дней</div>
          <div className="mt-0.5 font-mono text-[20px] text-fg">{overdueOld30}</div>
        </div>
        <div className="text-right">
          <div className="grp text-fg-subtle">В срок</div>
          <div className="mt-0.5 font-mono text-[20px] text-fg">{inTimeTotal}</div>
        </div>
      </div>
    </div>
  );
}
