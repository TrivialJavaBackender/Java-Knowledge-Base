import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { startOfDay, endOfDay, addDays } from '@/lib/leitner';
import { getTrack, type TrackKey } from '@/lib/tracks';
import { pluralRu } from '@/components/flashcards/format';
import { DiagnosisBanner } from '@/components/triage/DiagnosisBanner';
import { PlanCards, type PlanCardData } from '@/components/triage/PlanCards';
import { ParamsPanel, type HorizonOption, type ScopeOption } from '@/components/triage/ParamsPanel';
import { LoadChart } from '@/components/triage/LoadChart';
import { ApplyBar } from '@/components/triage/ApplyBar';
import { DailyLimitPanel } from '@/components/triage/DailyLimitPanel';
import { QueueList, type QueueRow } from '@/components/triage/QueueList';
import type { TriageScope } from '@/lib/triage-actions';

export const dynamic = 'force-dynamic';

const HORIZONS = [7, 14, 30] as const;
const NONE_SLUG = 'none';

interface Search {
  plan?: string;
  n?: string;
  scope?: string;
  list?: string;
}

function isPlan(v: string | undefined): v is 'spread' | 'reset' | 'archive' {
  return v === 'spread' || v === 'reset' || v === 'archive';
}

function bucketShares(count: number, horizon: number): number[] {
  const base = Math.floor(count / horizon);
  const rem = count % horizon;
  return Array.from({ length: horizon }, (_, j) => base + (j < rem ? 1 : 0));
}

export default async function TriagePage({ searchParams }: { searchParams: Promise<Search> }) {
  const userId = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  const plan: 'spread' | 'reset' | 'archive' = isPlan(sp.plan) ? sp.plan : 'spread';
  const nRaw = Number(sp.n);
  const n: number = (HORIZONS as readonly number[]).includes(nRaw) ? nRaw : plan === 'archive' ? 30 : 14;
  const scopeParam = sp.scope ?? 'all';
  const showList = sp.list === '1';

  const modules = await prisma.module.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, slug: true, title: true, track: true },
  });
  const scopeModule = scopeParam !== 'all' && scopeParam !== NONE_SLUG ? modules.find((m) => m.slug === scopeParam) : null;
  const scope: TriageScope = scopeParam === 'all' ? 'all' : scopeParam === NONE_SLUG ? 'none' : scopeModule ? scopeModule.id : 'all';
  const effectiveScopeParam = scope === 'all' ? 'all' : scope === 'none' ? NONE_SLUG : scopeModule!.slug;

  const scopeFlashcardWhere = scope === 'all' ? {} : scope === 'none' ? { moduleId: null } : { moduleId: scope };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { dailyReviewLimit: true } });
  const effectiveLimit = user?.dailyReviewLimit ?? 50;

  // --- Diagnosis: whole account, independent of plan/horizon/scope ---
  const [totalActive, overdueTotal, overdueOld30, lastReviewAgg, oldestOverdue] = await Promise.all([
    prisma.leitnerState.count({ where: { userId, flashcard: { archived: false } } }),
    prisma.leitnerState.count({ where: { userId, flashcard: { archived: false }, nextDueAt: { lt: todayStart } } }),
    prisma.leitnerState.count({
      where: { userId, flashcard: { archived: false }, nextDueAt: { lt: startOfDay(addDays(now, -30)) } },
    }),
    prisma.leitnerState.aggregate({ where: { userId }, _max: { lastReviewedAt: true } }),
    prisma.leitnerState.findFirst({
      where: { userId, flashcard: { archived: false }, nextDueAt: { lt: todayStart } },
      orderBy: { nextDueAt: 'asc' },
      select: { nextDueAt: true },
    }),
  ]);
  const inTimeTotal = totalActive - overdueTotal;
  const lastReviewedAt = lastReviewAgg._max.lastReviewedAt;
  const daysSinceLastReview = lastReviewedAt ? Math.floor((now.getTime() - lastReviewedAt.getTime()) / 86400000) : null;
  const oldestOverdueDays = oldestOverdue
    ? Math.floor((todayStart.getTime() - startOfDay(oldestOverdue.nextDueAt).getTime()) / 86400000)
    : 0;

  // --- Scope picker: overdue count per module ---
  const scopeRows = await prisma.$queryRaw<{ moduleId: number | null; overdue: number }[]>`
    SELECT f."moduleId" AS "moduleId", COUNT(*)::int AS overdue
    FROM "LeitnerState" l JOIN "Flashcard" f ON f.id = l."flashcardId"
    WHERE l."userId" = ${userId} AND f.archived = false AND l."nextDueAt" < ${todayStart}
    GROUP BY f."moduleId"
  `;
  const overdueByModuleId = new Map(scopeRows.map((r) => [r.moduleId, r.overdue]));
  const noModuleOverdue = overdueByModuleId.get(null) ?? 0;

  function hrefFor(overrides: Partial<{ plan: string; n: number; scope: string; list: string }>): string {
    const params = new URLSearchParams();
    const p = overrides.plan ?? plan;
    const nn = overrides.n ?? n;
    const sc = overrides.scope ?? effectiveScopeParam;
    const l = overrides.list ?? (showList ? '1' : '');
    if (p !== 'spread') params.set('plan', p);
    params.set('n', String(nn));
    if (sc !== 'all') params.set('scope', sc);
    if (l === '1') params.set('list', '1');
    const qs = params.toString();
    return qs ? `/flashcards/triage?${qs}` : '/flashcards/triage';
  }

  // --- Scoped counts, recomputed for the currently selected plan/horizon/scope ---
  const [overdueInScope, dueTodayInScope, overdueOlderThanN] = await Promise.all([
    prisma.leitnerState.count({
      where: { userId, nextDueAt: { lt: todayStart }, flashcard: { archived: false, ...scopeFlashcardWhere } },
    }),
    prisma.leitnerState.count({
      where: { userId, nextDueAt: { gte: todayStart, lte: todayEnd }, flashcard: { archived: false, ...scopeFlashcardWhere } },
    }),
    prisma.leitnerState.count({
      where: {
        userId,
        nextDueAt: { lt: startOfDay(addDays(now, -n)) },
        flashcard: { archived: false, ...scopeFlashcardWhere },
      },
    }),
  ]);

  const futureDayCounts = await Promise.all(
    Array.from({ length: 13 }, (_, idx) => {
      const i = idx + 1;
      const s = startOfDay(addDays(now, i));
      const e = endOfDay(addDays(now, i));
      return prisma.leitnerState.count({
        where: { userId, nextDueAt: { gte: s, lte: e }, flashcard: { archived: false, ...scopeFlashcardWhere } },
      });
    }),
  );

  const before = [dueTodayInScope + overdueInScope, ...futureDayCounts];
  let after: number[];
  let peakAfter: number;
  let clearIn: string;
  const remainAfterArchive = overdueInScope - overdueOlderThanN;

  if (plan === 'spread') {
    after = before.slice();
    after[0] = dueTodayInScope;
    const shares = bucketShares(overdueInScope, n);
    for (let j = 0; j < n && j + 1 < 14; j++) after[j + 1] = before[j + 1] + shares[j];
    peakAfter = Math.max(...after);
    clearIn = `${n} ${pluralRu(n, ['день', 'дня', 'дней'])}`;
  } else if (plan === 'reset') {
    after = before.slice();
    peakAfter = before[0];
    clearIn = before[0] <= effectiveLimit ? 'один заход' : `${Math.ceil(before[0] / effectiveLimit)} дн.`;
  } else {
    after = before.slice();
    after[0] = dueTodayInScope + remainAfterArchive;
    peakAfter = after[0];
    clearIn = after[0] <= effectiveLimit ? 'один заход' : `${Math.ceil(after[0] / effectiveLimit)} дн.`;
  }

  const labels = Array.from({ length: 14 }, (_, i) => (i === 0 ? 'сегодня' : i % 2 === 1 ? '' : `+${i}`));

  // --- Plan cards ---
  const plans: PlanCardData[] = [
    {
      id: 'spread',
      title: 'Разложить по дням',
      tag: 'мягко',
      body: 'Просроченные раскидываются по ближайшим дням в том же порядке, в каком стали должны. Тот же приём, которым приложение уже разводит карточки после первого импорта.',
      cost: 'Ничего не теряется: ящик, стрик и интервал остаются как были.',
      costTone: 'ok',
      active: plan === 'spread',
      href: hrefFor({ plan: 'spread' }),
    },
    {
      id: 'reset',
      title: 'Сбросить в первый ящик',
      tag: 'жёстко',
      body: 'Всё просроченное уезжает в box 1 на сегодня. То же, что кнопка Reset в таблице, но разом по всей выборке.',
      cost: 'Стрики обнулятся, интервалы придётся набирать заново: 1 → 3 → 7 → 14 → 30 дней.',
      costTone: 'warn',
      active: plan === 'reset',
      href: hrefFor({ plan: 'reset' }),
    },
    {
      id: 'archive',
      title: 'Заархивировать старое',
      tag: `${overdueOlderThanN} ${pluralRu(overdueOlderThanN, ['карточка', 'карточки', 'карточек'])}`,
      body: 'Просрочка старше порога уходит из очереди. AUTO-карточки не удаляются — уходят в «спячку» на 2099 год, MANUAL помечаются archived. Обе формы снимаются построчным Restore.',
      cost: `Останется ${remainAfterArchive} просроченных, но ${overdueOlderThanN} выпадут из повторения совсем.`,
      costTone: 'warn',
      active: plan === 'archive',
      href: hrefFor({ plan: 'archive' }),
    },
  ];

  // --- Params panel ---
  const paramTitle = plan === 'spread' ? 'На сколько дней растянуть' : plan === 'reset' ? 'Горизонт после сброса' : 'Порог архивации (дней)';
  const paramNote =
    plan === 'spread'
      ? `Получится примерно ${Math.round(overdueInScope / n)} ${pluralRu(Math.round(overdueInScope / n), ['карточка', 'карточки', 'карточек'])} в день сверх обычного расписания. Порядок сохраняется: то, что просрочено дольше, приходит раньше.`
      : plan === 'reset'
        ? 'После сброса всё просроченное придёт сегодня, а дальше пойдёт по циклу первого ящика — завтра, через три дня, через неделю.'
        : `В архив уходит просрочка старше ${n} ${pluralRu(n, ['дня', 'дней', 'дней'])} — ${overdueOlderThanN} ${pluralRu(overdueOlderThanN, ['карточка', 'карточки', 'карточек'])}. Остальное просроченное остаётся как есть.`;

  const horizons: HorizonOption[] = HORIZONS.map((h) => ({
    n: h,
    label: `на ${h} дней`,
    href: hrefFor({ n: h }),
    active: n === h,
  }));

  const scopeOptions: ScopeOption[] = [
    { key: 'all', title: 'Все модули', count: overdueTotal, href: hrefFor({ scope: 'all' }), active: scope === 'all', trackColor: null },
    ...modules.map((m) => ({
      key: m.slug,
      title: m.title,
      count: overdueByModuleId.get(m.id) ?? 0,
      href: hrefFor({ scope: m.slug }),
      active: scope === m.id,
      trackColor: getTrack(m.track as TrackKey).color,
    })),
    ...(noModuleOverdue > 0
      ? [{ key: NONE_SLUG, title: 'Без модуля', count: noModuleOverdue, href: hrefFor({ scope: NONE_SLUG }), active: scope === 'none', trackColor: null as null }]
      : []),
  ];

  // --- Apply bar ---
  const applyCount = plan === 'archive' ? overdueOlderThanN : overdueInScope;
  const applyLabel =
    plan === 'spread'
      ? `Разложить ${applyCount} ${pluralRu(applyCount, ['карточку', 'карточки', 'карточек'])}`
      : plan === 'reset'
        ? `Сбросить ${applyCount} в box 1`
        : `Заархивировать ${applyCount}`;
  const applyNote =
    plan === 'reset'
      ? 'Действие необратимо: прежние интервалы и стрики восстановить будет нечем. Перед применением можно посмотреть список.'
      : 'Действие обратимо: даты пересчитываются (или карточка «засыпает»/помечается archived), содержимое карточек не меняется.';

  // --- Queue preview list ---
  let listRows: QueueRow[] = [];
  if (showList) {
    const listWhere =
      plan === 'archive'
        ? { userId, nextDueAt: { lt: startOfDay(addDays(now, -n)) }, flashcard: { archived: false, ...scopeFlashcardWhere } }
        : { userId, nextDueAt: { lt: todayStart }, flashcard: { archived: false, ...scopeFlashcardWhere } };
    const rows = await prisma.leitnerState.findMany({
      where: listWhere,
      orderBy: { nextDueAt: 'asc' },
      take: 200,
      include: { flashcard: { include: { module: { select: { title: true } } } } },
    });
    listRows = rows.map((r) => ({
      id: r.flashcardId,
      front: r.flashcard.front,
      moduleTitle: r.flashcard.module?.title ?? 'Без модуля',
      box: r.box,
      lateDays: Math.floor((todayStart.getTime() - startOfDay(r.nextDueAt).getTime()) / 86400000),
      source: r.flashcard.source,
    }));
  }

  // --- Daily limit panel ---
  const limitEnabled = user?.dailyReviewLimit != null;
  const limitValue = user?.dailyReviewLimit ?? 30;

  return (
    <div className="mx-auto max-w-[1152px] px-4 py-6 sm:px-6">
      <div className="mb-3 flex items-center gap-1.5 text-xs text-fg-subtle">
        <Link href="/flashcards/manage" className="text-fg-muted hover:text-accent">
          Карточки
        </Link>
        <span>/</span>
        <span>Разобрать очередь</span>
      </div>

      <div className="space-y-3.5">
        <DiagnosisBanner
          overdueTotal={overdueTotal}
          totalActive={totalActive}
          overdueOld30={overdueOld30}
          inTimeTotal={inTimeTotal}
          oldestOverdueDays={oldestOverdueDays}
          daysSinceLastReview={daysSinceLastReview}
        />

        {overdueTotal > 0 && (
          <>
            <div>
              <div className="grp mb-2.5 mt-1 text-fg-muted">Что сделать с просроченными</div>
              <PlanCards plans={plans} />
            </div>

            <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1.25fr]">
              <ParamsPanel paramTitle={paramTitle} paramNote={paramNote} horizons={horizons} scopes={scopeOptions} />
              <LoadChart
                before={before}
                after={after}
                labels={labels}
                peakAfter={peakAfter}
                clearIn={clearIn}
                keepLabel={plan === 'reset' ? 'обнулятся' : 'сохранятся'}
                keepTone={plan === 'reset' ? 'warn' : 'ok'}
              />
            </div>

            <ApplyBar
              plan={plan}
              n={n}
              scope={scope}
              label={applyLabel}
              note={applyNote}
              reversible={plan !== 'reset'}
              listHref={hrefFor({ list: showList ? '' : '1' })}
              listActive={showList}
              disabled={applyCount === 0}
            />

            {showList && <QueueList rows={listRows} totalCount={applyCount} />}
          </>
        )}

        <DailyLimitPanel enabled={limitEnabled} value={limitValue} />
      </div>
    </div>
  );
}
