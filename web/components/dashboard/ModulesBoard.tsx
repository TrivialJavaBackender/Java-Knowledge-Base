'use client';

import { useMemo, useState } from 'react';
import { TRACK_DOT_CLASS } from '@/components/ui/TrackDot';
import { ModuleCard, type ModuleCardData } from './ModuleCard';

export interface TrackGroup {
  key: string;
  title: string;
  color: 1 | 2 | 3 | 4 | 5;
  modules: ModuleCardData[];
}

type FilterKey = 'all' | 'active' | 'new' | 'due';

function keep(m: ModuleCardData, filter: FilterKey): boolean {
  if (filter === 'active') return m.started && !m.finished;
  if (filter === 'new') return !m.started;
  if (filter === 'due') return m.due > 0;
  return true;
}

export function ModulesBoard({ groups }: { groups: TrackGroup[] }) {
  const [filter, setFilter] = useState<FilterKey>('all');

  const all = useMemo(() => groups.flatMap((g) => g.modules), [groups]);
  const counts = useMemo(
    () => ({
      all: all.length,
      active: all.filter((m) => keep(m, 'active')).length,
      new: all.filter((m) => keep(m, 'new')).length,
      due: all.filter((m) => keep(m, 'due')).length,
    }),
    [all],
  );

  const filters: { key: FilterKey; label: string }[] = [
    { key: 'all', label: `Все · ${counts.all}` },
    { key: 'active', label: `В работе · ${counts.active}` },
    { key: 'new', label: `Не начато · ${counts.new}` },
    { key: 'due', label: `Есть повторение · ${counts.due}` },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="grp text-fg-muted">Модули · {counts.all}</span>
        <span className="flex-1" />
        {filters.map((f) => {
          const active = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setFilter(f.key)}
              className={`h-8 rounded-full border px-3 text-[12.5px] transition ${
                active
                  ? 'border-accent/45 bg-accent-soft text-accent'
                  : 'border-border bg-bg-card text-fg-muted hover:text-fg'
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-6">
        {groups.map((g) => {
          const modules = g.modules.filter((m) => keep(m, filter));
          if (modules.length === 0) return null;
          return (
            <section key={g.key}>
              <div className="mb-2.5 flex items-center gap-2">
                <span className={`h-2 w-2 flex-none rounded-sm ${TRACK_DOT_CLASS[g.color]}`} />
                <span className="grp text-fg-muted">{g.title}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {modules.map((m) => (
                  <ModuleCard key={m.slug} m={m} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
