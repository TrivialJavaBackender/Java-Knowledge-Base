import Link from 'next/link';

export type ModuleTab = 'overview' | 'theory' | 'exercises' | 'qa';

export const MODULE_TABS: ModuleTab[] = ['overview', 'theory', 'exercises', 'qa'];

const TAB_LABELS: Record<ModuleTab, string> = {
  overview: 'Обзор',
  theory: 'Теория',
  exercises: 'Упражнения',
  qa: 'Вопросы',
};

/**
 * Вкладки через обычные `Link` на `?tab=...` — переживает перезагрузку и
 * работает без клиентского JS. `overview` — путь без query (значение по
 * умолчанию).
 */
export function ModuleTabs({
  slug,
  active,
  counts,
}: {
  slug: string;
  active: ModuleTab;
  counts: Record<Exclude<ModuleTab, 'overview'>, string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      {MODULE_TABS.map((key) => {
        const isActive = key === active;
        const href = key === 'overview' ? `/modules/${slug}` : `/modules/${slug}?tab=${key}`;
        const count = key === 'overview' ? null : counts[key];
        return (
          <Link
            key={key}
            href={href}
            className={`flex h-9 items-center gap-1.5 border-b-2 px-3.5 text-[13.5px] ${
              isActive
                ? 'border-accent font-semibold text-fg'
                : 'border-transparent font-normal text-fg-muted hover:text-fg'
            }`}
          >
            {TAB_LABELS[key]}
            {count !== null && (
              <span
                className={`rounded-full px-1.5 py-px font-mono text-[10.5px] ${
                  isActive ? 'bg-accent-soft text-accent' : 'bg-bg-soft text-fg-subtle'
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
