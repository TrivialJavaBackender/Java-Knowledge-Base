import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { endOfDay, startOfDay } from '@/lib/leitner';
import { getTrack, type TrackKey } from '@/lib/tracks';
import { FlashcardReview, type ReviewableCard } from '@/components/FlashcardReview';
import { DeckSidebar, type DeckRowData } from '@/components/flashcards/DeckSidebar';
import { BoxDistributionGrid } from '@/components/flashcards/BoxDistributionGrid';
import { TriageButton } from '@/components/flashcards/TriageButton';
import { pluralRu } from '@/components/flashcards/format';
import { countOf } from '@/lib/plural';
import { renderMarkdown } from '@/lib/markdown';

export const dynamic = 'force-dynamic';

/** Ключ колоды ручных карточек без модуля — не пересекается ни с одним реальным slug. */
const MANUAL_KEY = 'manual';
/** Явное «ничего не выбрано» — отличается от отсутствия параметра (= смешанная очередь из всех). */
const NONE_TOKEN = 'none';

type Boxes5 = [number, number, number, number, number];

interface DeckMeta {
  key: string;
  title: string;
  trackColor: 1 | 2 | 3 | 4 | 5 | null;
  due: number;
  total: number;
  boxes: Boxes5;
}

function emptyBoxes(): Boxes5 {
  return [0, 0, 0, 0, 0];
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function FlashcardsPage({
  searchParams,
}: {
  searchParams: Promise<{ decks?: string }>;
}) {
  const userId = await requireUser();
  const sp = await searchParams;
  const now = new Date();

  // Дневной лимит очереди (lib/triage-actions.ts → setDailyReviewLimit). Не
  // задан → дефолт 50, как было раньше жёстко закодировано в take.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dailyReviewLimit: true } });
  const dailyLimit = user?.dailyReviewLimit ?? 50;

  const modules = await prisma.module.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, slug: true, title: true, track: true },
  });

  // Просрочка — не то же, что «на сегодня»: due включает и сегодняшние карточки.
  // Ссылка на разбор очереди нужна именно здесь, на экране, где завал и виден;
  // раньше единственный вход в неё лежал на /flashcards/manage, третьим уровнем.
  const overdueCount = await prisma.leitnerState.count({
    where: { userId, nextDueAt: { lt: startOfDay(now) }, flashcard: { archived: false } },
  });

  // Распределение по ящикам + due-счётчик — один запрос (Prisma groupBy через
  // связь не умеет группировать по колонке из JOIN-нутой таблицы).
  const distRows = await prisma.$queryRaw<{ moduleId: number | null; box: number; total: number; due: number }[]>`
    SELECT f."moduleId" AS "moduleId", l.box AS box,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE l."nextDueAt" <= ${endOfDay(now)})::int AS due
    FROM "LeitnerState" l
    JOIN "Flashcard" f ON f.id = l."flashcardId"
    WHERE l."userId" = ${userId} AND f.archived = false
    GROUP BY f."moduleId", l.box
  `;

  const moduleSlugById = new Map(modules.map((m) => [m.id, m.slug]));
  const boxesByKey = new Map<string, Boxes5>();
  const dueByKey = new Map<string, number>();
  const totalByKey = new Map<string, number>();

  for (const row of distRows) {
    const key = row.moduleId === null ? MANUAL_KEY : moduleSlugById.get(row.moduleId) ?? MANUAL_KEY;
    if (!boxesByKey.has(key)) boxesByKey.set(key, emptyBoxes());
    if (row.box >= 1 && row.box <= 5) boxesByKey.get(key)![row.box - 1] += row.total;
    totalByKey.set(key, (totalByKey.get(key) ?? 0) + row.total);
    dueByKey.set(key, (dueByKey.get(key) ?? 0) + row.due);
  }

  const deckMetas: DeckMeta[] = [
    ...modules.map((m) => ({
      key: m.slug,
      title: m.title,
      trackColor: getTrack(m.track as TrackKey).color,
      due: dueByKey.get(m.slug) ?? 0,
      total: totalByKey.get(m.slug) ?? 0,
      boxes: boxesByKey.get(m.slug) ?? emptyBoxes(),
    })),
    {
      key: MANUAL_KEY,
      title: 'Свои',
      trackColor: null,
      due: dueByKey.get(MANUAL_KEY) ?? 0,
      total: totalByKey.get(MANUAL_KEY) ?? 0,
      boxes: boxesByKey.get(MANUAL_KEY) ?? emptyBoxes(),
    },
  ];
  const deckByKey = new Map(deckMetas.map((d) => [d.key, d]));
  const allDeckKeys = deckMetas.map((d) => d.key);

  // Выбор колод — целиком в URL. Пустой/отсутствующий параметр = смешанная
  // очередь из всех колод (поведение по умолчанию). `decks=none` — явное
  // «снято всё», отличное от дефолта. Неизвестные slug в параметре просто
  // не попадают в selectedKeys — страница не падает.
  const rawDecksParam = (sp.decks ?? '').trim();
  const selectedKeys: string[] =
    rawDecksParam === ''
      ? allDeckKeys
      : rawDecksParam === NONE_TOKEN
        ? []
        : allDeckKeys.filter((k) => rawDecksParam.split(',').map((s) => s.trim()).includes(k));

  function decksHref(nextKeys: string[]): string {
    if (nextKeys.length === allDeckKeys.length) return '/flashcards';
    if (nextKeys.length === 0) return `/flashcards?decks=${NONE_TOKEN}`;
    const ordered = allDeckKeys.filter((k) => nextKeys.includes(k));
    return `/flashcards?decks=${ordered.join(',')}`;
  }

  const allSelected = selectedKeys.length === allDeckKeys.length;
  const selectAllLabel = allSelected ? 'Снять все' : 'Выбрать все';
  const selectAllHref = decksHref(allSelected ? [] : allDeckKeys);

  const deckRows: DeckRowData[] = deckMetas.map((d) => {
    const selected = selectedKeys.includes(d.key);
    return {
      key: d.key,
      title: d.title,
      trackColor: d.trackColor,
      dueLabel: d.due > 0 ? `${d.due} сегодня` : '—',
      hasDue: d.due > 0,
      due: d.due,
      boxes: d.boxes,
      meta:
        d.boxes[4] > 0
          ? `${countOf(d.total, 'card')} · ${d.boxes[4]} в пятом ящике`
          : countOf(d.total, 'card'),
      selected,
      href: decksHref(selected ? selectedKeys.filter((k) => k !== d.key) : [...selectedKeys, d.key]),
    };
  });

  // Очередь на сегодня — только по выбранным колодам.
  const selectedModuleIds = modules.filter((m) => selectedKeys.includes(m.slug)).map((m) => m.id);
  const includeManual = selectedKeys.includes(MANUAL_KEY);

  let queue: ReviewableCard[] = [];
  if (selectedKeys.length > 0) {
    const flashcardOr: Record<string, unknown>[] = [];
    if (selectedModuleIds.length > 0) flashcardOr.push({ moduleId: { in: selectedModuleIds } });
    if (includeManual) flashcardOr.push({ moduleId: null, source: 'MANUAL', userId });

    const dueRows = await prisma.leitnerState.findMany({
      where: {
        userId,
        nextDueAt: { lte: endOfDay(now) },
        flashcard: { archived: false, OR: flashcardOr },
      },
      orderBy: [{ box: 'asc' }, { nextDueAt: 'asc' }],
      take: dailyLimit,
      include: {
        flashcard: {
          include: {
            module: { select: { slug: true, title: true, track: true } },
            qa: { select: { qNumber: true, refDocSlug: true, section: { select: { title: true } } } },
          },
        },
      },
    });

    // Одна колода — приоритет по box/nextDueAt как обычно. Несколько (или
    // дефолтная смешанная очередь из всех) — перемешиваем, чтобы модули
    // чередовались, а не шли блоками.
    const ordered = selectedKeys.length === 1 ? dueRows : shuffled(dueRows);

    queue = await Promise.all(
      ordered.map(async (r) => ({
        id: r.flashcard.id,
        front: r.flashcard.front,
        back: r.flashcard.back,
        frontHtml: await renderMarkdown(r.flashcard.front),
        backHtml: await renderMarkdown(r.flashcard.back),
        box: r.box,
        source: r.flashcard.source,
        moduleTitle: r.flashcard.module?.title ?? null,
        moduleSlug: r.flashcard.module?.slug ?? null,
        trackColor: r.flashcard.module ? getTrack(r.flashcard.module.track as TrackKey).color : null,
        sectionTitle: r.flashcard.qa?.section?.title ?? null,
        qNumber: r.flashcard.qa?.qNumber ?? null,
        refDocSlug: r.flashcard.qa?.refDocSlug ?? null,
        tags: r.flashcard.tags,
      })),
    );
  }

  // Заголовок сессии.
  let sessionTitle: string;
  let sessionSub: string;
  if (selectedKeys.length === 0) {
    sessionTitle = 'Ничего не выбрано';
    sessionSub = 'Отметьте колоду слева — очередь соберётся только из неё.';
  } else if (selectedKeys.length === 1) {
    const d = deckByKey.get(selectedKeys[0])!;
    sessionTitle = d.title;
    sessionSub = `${d.due} на сегодня из ${d.total} ${pluralRu(d.total, ['карточка', 'карточки', 'карточек'])} колоды`;
  } else {
    const dueSum = selectedKeys.reduce((a, k) => a + (deckByKey.get(k)?.due ?? 0), 0);
    sessionTitle = `Смешанная очередь · ${selectedKeys.length} ${pluralRu(selectedKeys.length, ['колода', 'колоды', 'колод'])}`;
    sessionSub = `${dueSum} на сегодня · вперемешку, порядок случайный`;
  }

  const gridBoxes = emptyBoxes();
  for (const k of selectedKeys) {
    const d = deckByKey.get(k);
    if (!d) continue;
    for (let i = 0; i < 5; i++) gridBoxes[i] += d.boxes[i];
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <DeckSidebar decks={deckRows} selectAllLabel={selectAllLabel} selectAllHref={selectAllHref} />

      <div className="scroll min-h-0 min-w-0 flex-1 overflow-y-auto bg-bg">
        {/* pt на мобильном — под плавающий триггер выбора колод (DeckSidebar),
            иначе он ложится на заголовок сессии. */}
        <div className="mx-auto max-w-[720px] px-4 pb-6 pt-[60px] sm:px-6 lg:pt-6">
          <header className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-0 flex-1 basis-full sm:basis-0">
              <h1 className="text-xl font-semibold leading-tight tracking-tight text-fg">{sessionTitle}</h1>
              <p className="mt-0.5 text-[12.5px] text-fg-muted">{sessionSub}</p>
            </div>
            <TriageButton overdue={overdueCount} />
            <Link
              href="/flashcards/manage"
              className="flex h-9 flex-none items-center rounded-md border border-border bg-bg-card px-3 text-[13px] text-fg-muted transition hover:border-accent/50 hover:text-fg"
            >
              Управление
            </Link>
          </header>

          {selectedKeys.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-bg-soft p-8 text-center text-fg-muted">
              Выберите хотя бы одну колоду слева, чтобы начать сессию.
            </div>
          ) : (
            <>
              {/* key по выбранным колодам: initialQueue уезжает в useState, и без
                  смены ключа снятие колоды не перерисовывало карточку — на
                  экране оставался вопрос из модуля, который только что убрали. */}
              <FlashcardReview key={selectedKeys.join(',')} initialQueue={queue} />
              <BoxDistributionGrid boxes={gridBoxes} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
