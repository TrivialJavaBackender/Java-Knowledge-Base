import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { startOfDay, DORMANT_DATE } from '@/lib/leitner';
import { getTrack, type TrackKey } from '@/lib/tracks';
import { headingText } from '@/lib/slugify';
import { renderMarkdown } from '@/lib/markdown';
import { CardSearchResults, type CardResultRow } from '@/components/flashcards/CardSearchResults';
import { dueLabel, pluralRu } from '@/components/flashcards/format';

export const dynamic = 'force-dynamic';

/**
 * Управление карточками — это поиск, а не таблица. Массовые операции живут на
 * /flashcards/triage: там к ним прилагаются диагноз, горизонт и график нагрузки,
 * и дублировать их здесь голыми чекбоксами смысла нет. Здесь решается другая
 * задача, которой больше нигде нет: найти конкретную карточку, посмотреть ответ
 * и что-то сделать с ней одной — либо разобрать архив.
 */

interface Search {
  q?: string;
  module?: string;
  view?: string;
}

/** Пресеты взаимоисключающие: они кодируют и источник, и статус разом. */
type Preset = 'all' | 'mine' | 'archived';

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'mine', label: 'Свои' },
  { key: 'archived', label: 'Архив' },
];

/** Без запроса не вываливаем всё подряд — только хвост последних правок. */
const BROWSE_LIMIT = 20;
const SEARCH_LIMIT = 40;

function isPreset(v: string | undefined): v is Preset {
  return v === 'all' || v === 'mine' || v === 'archived';
}

/**
 * Условие пресета. Архив AUTO-карточки — это не флаг `Flashcard.archived`
 * (колонка глобальная, общая для всех владельцев одной AUTO-карточки), а
 * персональная спячка `LeitnerState.nextDueAt = DORMANT_DATE`, см.
 * `archiveFlashcard` в lib/actions.ts. Поэтому «архив» и «активные» обязаны
 * смотреть на оба признака, иначе убранная отсюда же AUTO-карточка исчезает
 * без следа и вернуть её нечем.
 */
function presetWhere(preset: Preset, userId: number): Prisma.FlashcardWhereInput {
  const dormant: Prisma.FlashcardWhereInput = {
    leitnerStates: { some: { userId, nextDueAt: { gte: DORMANT_DATE } } },
  };
  if (preset === 'archived') {
    return {
      OR: [
        { source: 'MANUAL', userId, archived: true },
        { source: 'AUTO', ...dormant },
      ],
    };
  }
  if (preset === 'mine') {
    return { source: 'MANUAL', userId, archived: false };
  }
  return {
    archived: false,
    OR: [{ source: 'AUTO' }, { source: 'MANUAL', userId }],
    NOT: dormant,
  };
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<Search> }) {
  const userId = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const todayStart = startOfDay(now);

  const preset: Preset = isPreset(sp.view) ? sp.view : 'all';
  const search = sp.q?.trim() ?? '';
  const moduleSlug = sp.module ?? 'all';

  const modules = await prisma.module.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, slug: true, title: true, track: true },
  });
  const moduleId = moduleSlug !== 'all' ? modules.find((m) => m.slug === moduleSlug)?.id ?? null : null;
  const trackBySlug = new Map(modules.map((m) => [m.slug, getTrack(m.track as TrackKey).color]));

  // Собираем через AND, а не мутацией одного объекта: у пресета уже есть свой OR,
  // и дописывание полей поверх него молча меняло бы смысл условия.
  const filters: Prisma.FlashcardWhereInput[] = [presetWhere(preset, userId)];
  if (moduleId !== null) filters.push({ moduleId });
  if (search) {
    // mode: 'insensitive' обязателен — в Postgres `contains` регистрозависим,
    // и без него «что» и «Что» дают разные выдачи по одной и той же базе.
    filters.push({
      OR: [
        { front: { contains: search, mode: 'insensitive' } },
        { back: { contains: search, mode: 'insensitive' } },
        { tags: { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  const where: Prisma.FlashcardWhereInput = { AND: filters };
  const take = search ? SEARCH_LIMIT : BROWSE_LIMIT;

  const [cards, matchCount, activeCount, mineCount, archivedCount, overdueCount] = await Promise.all([
    prisma.flashcard.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
      include: {
        module: { select: { slug: true, title: true } },
        leitnerStates: { where: { userId }, take: 1 },
      },
    }),
    prisma.flashcard.count({ where }),
    // Счётчики считаем по Flashcard, а не по LeitnerState: у карточки, которую
    // ещё ни разу не отметили, стейта нет, и счёт по стейтам занижает итог.
    prisma.flashcard.count({ where: presetWhere('all', userId) }),
    prisma.flashcard.count({ where: presetWhere('mine', userId) }),
    prisma.flashcard.count({ where: presetWhere('archived', userId) }),
    prisma.leitnerState.count({
      where: { userId, flashcard: { archived: false }, nextDueAt: { lt: todayStart } },
    }),
  ]);

  const rows: CardResultRow[] = await Promise.all(
    cards.map(async (c) => {
      const leitner = c.leitnerStates[0] ?? null;
      const dormant = leitner !== null && leitner.nextDueAt >= DORMANT_DATE;
      const archived = c.source === 'MANUAL' ? c.archived : dormant;
      return {
        id: c.id,
        front: headingText(c.front),
        backHtml: await renderMarkdown(c.back),
        tags: c.tags,
        moduleTitle: c.module?.title ?? null,
        trackColor: c.module ? trackBySlug.get(c.module.slug) ?? null : null,
        box: leitner?.box ?? null,
        dueLabel: archived ? 'в архиве' : dueLabel(leitner?.nextDueAt ?? null, now),
        overdue: !archived && leitner !== null && leitner.nextDueAt < todayStart,
        source: c.source,
        archived,
      };
    }),
  );

  function hrefWith(overrides: Partial<Search>): string {
    const params = new URLSearchParams();
    const q = overrides.q ?? search;
    const m = overrides.module ?? moduleSlug;
    const v = overrides.view ?? preset;
    if (q) params.set('q', q);
    if (m !== 'all') params.set('module', m);
    if (v !== 'all') params.set('view', v);
    const qs = params.toString();
    return qs ? `/flashcards/manage?${qs}` : '/flashcards/manage';
  }

  const emptyHint = search
    ? `По запросу «${search}» ничего не нашлось. Попробуйте другое слово или снимите фильтр модуля.`
    : preset === 'archived'
      ? 'Архив пуст — ни одна карточка не убрана из очереди.'
      : preset === 'mine'
        ? 'Своих карточек ещё нет. «+ Новая карточка» — и она появится здесь.'
        : 'Карточек нет. Запустите sync, чтобы подтянуть Q&A из modules/.';

  const resultsCaption = search
    ? `Найдено ${matchCount} · показаны первые ${rows.length}`
    : `Последние изменённые · ${rows.length} из ${matchCount}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/flashcards" className="text-sm text-fg-muted hover:text-accent">
            ← Повторение
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Карточки</h1>
          <p className="text-[12.5px] text-fg-subtle">
            <b className="font-mono text-fg">{activeCount}</b> активных ·{' '}
            <b className="font-mono text-fg">{mineCount}</b> своих ·{' '}
            <b className="font-mono text-fg">{archivedCount}</b> в архиве
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overdueCount > 0 && (
            <Link
              href="/flashcards/triage"
              className="flex h-8 items-center rounded-md border border-warn/40 bg-warn/10 px-3 text-[13px] text-warn hover:bg-warn/20"
            >
              Разобрать очередь · {overdueCount}
            </Link>
          )}
          <Link
            href="/flashcards/new"
            className="flex h-8 items-center rounded-md border border-accent/60 bg-accent/10 px-3 text-[13px] text-accent hover:bg-accent/20"
          >
            + Новая карточка
          </Link>
        </div>
      </header>

      <div className="rounded-lg border border-border bg-bg-card p-3">
        {/* GET-форма: поиск и модуль. Пресет едет скрытым полем, чтобы отправка
            поиска не сбрасывала выбранную вкладку. */}
        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value={preset} />
          <div className="relative w-full flex-1 sm:min-w-[220px]">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <input
              type="text"
              name="q"
              defaultValue={search}
              placeholder="Найти по вопросу, ответу, тегу…"
              className="h-9 w-full rounded-md border border-border bg-bg-soft pl-8 pr-2.5 text-[13px] text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none"
            />
          </div>
          <select
            name="module"
            defaultValue={moduleSlug}
            className="h-9 w-full appearance-none rounded-md border border-border bg-bg-soft px-2.5 text-[13px] text-fg focus:border-accent focus:outline-none sm:w-[190px]"
          >
            <option value="all">Все модули</option>
            {modules.map((m) => (
              <option key={m.id} value={m.slug}>
                {m.title}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="h-9 flex-none rounded-md border border-accent/60 bg-accent/10 px-3.5 text-[13px] text-accent hover:bg-accent/20"
          >
            Найти
          </button>
        </form>

        <div className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2.5">
          {PRESETS.map((p) => {
            const count = p.key === 'all' ? activeCount : p.key === 'mine' ? mineCount : archivedCount;
            const active = p.key === preset;
            return (
              <Link
                key={p.key}
                href={hrefWith({ view: p.key })}
                className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] ${
                  active
                    ? 'border-accent/50 bg-accent-soft text-accent'
                    : 'border-border bg-bg-soft text-fg-muted hover:border-accent/30 hover:text-fg'
                }`}
              >
                {p.label}
                <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
          <span className="flex-1" />
          {(search || moduleSlug !== 'all') && (
            <Link href={hrefWith({ q: '', module: 'all' })} className="text-[12px] text-fg-subtle hover:text-accent">
              сбросить фильтры
            </Link>
          )}
        </div>
      </div>

      <div className="flex items-baseline justify-between">
        <span className="grp text-fg-muted">{resultsCaption}</span>
        {!search && matchCount > rows.length && (
          <span className="text-[11.5px] text-fg-subtle">
            остальные {matchCount - rows.length}{' '}
            {pluralRu(matchCount - rows.length, ['карточка', 'карточки', 'карточек'])} — через поиск
          </span>
        )}
      </div>

      <CardSearchResults rows={rows} emptyHint={emptyHint} />
    </div>
  );
}
