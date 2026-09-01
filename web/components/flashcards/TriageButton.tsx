import Link from 'next/link';

/**
 * Вход в разбор очереди — один на все места, где виден размер просрочки:
 * экран повторения и «Карточки». Раньше это были две отдельные вёрстки одной
 * кнопки: 198px против 183px, с иконкой и без, счётчик то жирным моноширинным,
 * то через «·» обычным текстом.
 *
 * Счётчик оформлен как у кнопки «Повторение» в шапке приложения — обе про одну
 * и ту же очередь, и выглядеть они должны родственно.
 *
 * Ничего не рисует при нулевой просрочке: разбирать нечего.
 */
export function TriageButton({ overdue }: { overdue: number }) {
  if (overdue <= 0) return null;
  return (
    <Link
      href="/flashcards/triage"
      title={`${overdue} карточек просрочено — разложить по дням, сбросить или заархивировать`}
      // pl меньше pr: слева стоит иконка, и при равных отступах она оптически
      // проваливается внутрь. Тот же приём в шапке у кнопки «Повторение».
      className="flex h-9 flex-none items-center gap-1.5 rounded-md border border-warn/40 bg-warn/10 pl-2.5 pr-3 text-[13px] text-warn transition hover:bg-warn/20"
    >
      <svg
        className="h-[15px] w-[15px] flex-none"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="7.5" x2="12" y2="13" />
        <circle cx="12" cy="16.5" r="0.7" fill="currentColor" stroke="none" />
      </svg>
      Разобрать очередь
      <b className="font-mono tabular-nums">{overdue}</b>
    </Link>
  );
}
