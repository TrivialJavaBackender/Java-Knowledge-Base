import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { endOfDay } from '@/lib/leitner';
import { countDue, countOverdue } from '@/lib/review-queue';
import { TRACKS, getTrack, type TrackKey } from '@/lib/tracks';
import { ContinueReadingCard, type ContinueReadingData } from '@/components/dashboard/ContinueReadingCard';
import { TodayReviewCard, type DueBreakdownEntry } from '@/components/dashboard/TodayReviewCard';
import { OverallProgress } from '@/components/dashboard/OverallProgress';
import { ModulesBoard, type TrackGroup } from '@/components/dashboard/ModulesBoard';
import { nextLabel } from '@/components/dashboard/format';
import type { ModuleCardData } from '@/components/dashboard/ModuleCard';

export const dynamic = 'force-dynamic';

interface Stat {
  done: number;
  total: number;
}

interface DashboardData {
  hasModules: boolean;
  continueReading: ContinueReadingData;
  due: number;
  /** Просрочено (срок раньше сегодняшнего дня) — подмножество `due`. */
  overdue: number;
  dueBreakdown: DueBreakdownEntry[];
  totalDone: number;
  totalAll: number;
  theoryTotals: Stat;
  exerciseTotals: Stat;
  qaTotals: Stat;
  groups: TrackGroup[];
}

function groupCountMap(rows: { moduleId: number; _count: { _all: number } }[]): Map<number, number> {
  return new Map(rows.map((r) => [r.moduleId, r._count._all]));
}

async function loadDashboard(userId: number): Promise<DashboardData> {
  const now = new Date();

  const modules = await prisma.module.findMany({
    orderBy: { order: 'asc' },
    select: { id: true, slug: true, title: true, track: true },
  });
  if (modules.length === 0) {
    return {
      hasModules: false,
      continueReading: { kind: 'empty' },
      due: 0,
      overdue: 0,
      dueBreakdown: [],
      totalDone: 0,
      totalAll: 0,
      theoryTotals: { done: 0, total: 0 },
      exerciseTotals: { done: 0, total: 0 },
      qaTotals: { done: 0, total: 0 },
      groups: [],
    };
  }
  const modulesById = new Map(modules.map((m) => [m.id, m]));

  // Тео́рия: лёгкая построчная выборка (без body) — нужна и для тоталов/выполненного,
  // и для «первого непрочитанного документа» на карточке модуля и на «Продолжить чтение».
  const [theoryDocs, theoryProgress, exerciseTotalsRaw, exerciseDoneRaw, qaTotalsRaw, qaDoneRaw, due, overdue, dueByModuleRaw] =
    await Promise.all([
      prisma.theoryDoc.findMany({
        select: { id: true, moduleId: true, slug: true, title: true, order: true, sectionCount: true, readingMinutes: true },
        orderBy: { order: 'asc' },
      }),
      prisma.userTheoryProgress.findMany({
        where: { userId },
        select: { theoryDocId: true, isRead: true, lastVisitedAt: true, lastSectionIndex: true },
        // Порядок важен: «Продолжить чтение» берёт первый непустой lastVisitedAt
        // линейным сканом ниже. Без сортировки при совпадении отметок победитель
        // зависел бы от того, в каком порядке строки вернула база.
        orderBy: { lastVisitedAt: { sort: 'desc', nulls: 'last' } },
      }),
      prisma.exercise.groupBy({ by: ['moduleId'], _count: { _all: true } }),
      prisma.$queryRaw<{ moduleId: number; count: number }[]>`
        SELECT e."moduleId" AS "moduleId", COUNT(*)::int AS count
        FROM "UserExerciseProgress" p
        JOIN "Exercise" e ON e.id = p."exerciseId"
        WHERE p."userId" = ${userId} AND p."isRead" = true
        GROUP BY e."moduleId"`,
      prisma.interviewQA.groupBy({ by: ['moduleId'], _count: { _all: true } }),
      prisma.$queryRaw<{ moduleId: number; count: number }[]>`
        SELECT q."moduleId" AS "moduleId", COUNT(*)::int AS count
        FROM "UserQAProgress" p
        JOIN "InterviewQA" q ON q.id = p."qaId"
        WHERE p."userId" = ${userId} AND p."isKnown" = true
        GROUP BY q."moduleId"`,
      countDue(userId, now),
      countOverdue(userId, now),
      prisma.$queryRaw<{ moduleId: number; count: number }[]>`
        SELECT f."moduleId" AS "moduleId", COUNT(*)::int AS count
        FROM "LeitnerState" l
        JOIN "Flashcard" f ON f.id = l."flashcardId"
        WHERE l."userId" = ${userId}
          AND l."nextDueAt" <= ${endOfDay(now)}
          AND f.archived = false
          AND f."moduleId" IS NOT NULL
        GROUP BY f."moduleId"`,
    ]);

  const theoryProgressByDocId = new Map(theoryProgress.map((p) => [p.theoryDocId, p]));
  const theoryDocsById = new Map(theoryDocs.map((d) => [d.id, d]));

  const theoryTotalByModule = new Map<number, number>();
  const theoryDoneByModule = new Map<number, number>();
  const firstUnreadByModule = new Map<number, (typeof theoryDocs)[number]>();

  for (const d of theoryDocs) {
    theoryTotalByModule.set(d.moduleId, (theoryTotalByModule.get(d.moduleId) ?? 0) + 1);
    const isRead = theoryProgressByDocId.get(d.id)?.isRead ?? false;
    if (isRead) {
      theoryDoneByModule.set(d.moduleId, (theoryDoneByModule.get(d.moduleId) ?? 0) + 1);
    } else if (!firstUnreadByModule.has(d.moduleId)) {
      firstUnreadByModule.set(d.moduleId, d);
    }
  }

  // «Продолжить чтение» — документ с максимальным lastVisitedAt среди всех.
  let continueProgress: (typeof theoryProgress)[number] | null = null;
  for (const p of theoryProgress) {
    if (!p.lastVisitedAt) continue;
    if (!continueProgress || !continueProgress.lastVisitedAt || p.lastVisitedAt > continueProgress.lastVisitedAt) {
      continueProgress = p;
    }
  }

  let continueReading: ContinueReadingData;
  if (continueProgress) {
    const doc = theoryDocsById.get(continueProgress.theoryDocId)!;
    const mod = modulesById.get(doc.moduleId)!;
    const doneSections = (continueProgress.lastSectionIndex ?? 0) + 1;
    const totalSections = Math.max(doc.sectionCount, doneSections);
    const remainingMinutes =
      totalSections > 0 ? Math.max(1, Math.round((doc.readingMinutes * (totalSections - doneSections)) / totalSections)) : 0;
    const qaCount = await prisma.interviewQA.count({ where: { moduleId: doc.moduleId, refDocSlug: doc.slug } });
    continueReading = {
      kind: 'continue',
      moduleSlug: mod.slug,
      moduleTitle: mod.title,
      docSlug: doc.slug,
      docTitle: doc.title,
      doneSections,
      totalSections,
      remainingMinutes,
      qaCount,
    };
  } else {
    // Никто ничего не читал — предложим первый непрочитанный документ в порядке модулей.
    let candidate: { doc: (typeof theoryDocs)[number]; mod: (typeof modules)[number] } | null = null;
    for (const m of modules) {
      const doc = firstUnreadByModule.get(m.id);
      if (doc) {
        candidate = { doc, mod: m };
        break;
      }
    }
    continueReading = candidate
      ? {
          kind: 'start',
          moduleSlug: candidate.mod.slug,
          moduleTitle: candidate.mod.title,
          docSlug: candidate.doc.slug,
          docTitle: candidate.doc.title,
          totalSections: candidate.doc.sectionCount,
        }
      : { kind: 'empty' };
  }

  const exerciseTotalMap = groupCountMap(exerciseTotalsRaw);
  const exerciseDoneMap = new Map(exerciseDoneRaw.map((r) => [r.moduleId, r.count]));
  const qaTotalMap = groupCountMap(qaTotalsRaw);
  const qaDoneMap = new Map(qaDoneRaw.map((r) => [r.moduleId, r.count]));
  const dueByModule = new Map(dueByModuleRaw.map((r) => [r.moduleId, r.count]));

  const cardsByTrack = new Map<TrackKey, ModuleCardData[]>();
  let totalTheoryDone = 0;
  let totalTheoryTotal = 0;
  let totalExDone = 0;
  let totalExTotal = 0;
  let totalQaDone = 0;
  let totalQaTotal = 0;

  for (const m of modules) {
    const theoryTotal = theoryTotalByModule.get(m.id) ?? 0;
    const theoryDone = theoryDoneByModule.get(m.id) ?? 0;
    const exTotal = exerciseTotalMap.get(m.id) ?? 0;
    const exDone = exerciseDoneMap.get(m.id) ?? 0;
    const qaTotal = qaTotalMap.get(m.id) ?? 0;
    const qaDone = qaDoneMap.get(m.id) ?? 0;
    const due = dueByModule.get(m.id) ?? 0;

    totalTheoryDone += theoryDone;
    totalTheoryTotal += theoryTotal;
    totalExDone += exDone;
    totalExTotal += exTotal;
    totalQaDone += qaDone;
    totalQaTotal += qaTotal;

    const done = theoryDone + exDone + qaDone;
    const total = theoryTotal + exTotal + qaTotal;
    const track = getTrack(m.track as TrackKey);

    const card: ModuleCardData = {
      slug: m.slug,
      title: m.title,
      trackColor: track.color,
      theory: { done: theoryDone, total: theoryTotal },
      exercises: { done: exDone, total: exTotal },
      qas: { done: qaDone, total: qaTotal },
      due,
      done,
      total,
      pct: total === 0 ? 0 : Math.round((done / total) * 100),
      started: done > 0,
      finished: total > 0 && done === total,
      next: nextLabel({
        theoryDone,
        theoryTotal,
        qaDone,
        qaTotal,
        firstUnreadTitle: firstUnreadByModule.get(m.id)?.title ?? null,
      }),
    };

    const arr = cardsByTrack.get(track.key) ?? [];
    arr.push(card);
    cardsByTrack.set(track.key, arr);
  }

  const groups: TrackGroup[] = TRACKS.map((t) => ({
    key: t.key,
    title: t.title,
    color: t.color,
    modules: cardsByTrack.get(t.key) ?? [],
  })).filter((g) => g.modules.length > 0);

  const dueBreakdown: DueBreakdownEntry[] = dueByModuleRaw
    .map((r) => {
      const m = modulesById.get(r.moduleId);
      if (!m) return null;
      const track = getTrack(m.track as TrackKey);
      return { moduleSlug: m.slug, moduleTitle: m.title, trackColor: track.color, count: r.count } satisfies DueBreakdownEntry;
    })
    .filter((x): x is DueBreakdownEntry => x !== null)
    .sort((a, b) => b.count - a.count);

  return {
    hasModules: true,
    continueReading,
    due,
    overdue,
    dueBreakdown,
    totalDone: totalTheoryDone + totalExDone + totalQaDone,
    totalAll: totalTheoryTotal + totalExTotal + totalQaTotal,
    theoryTotals: { done: totalTheoryDone, total: totalTheoryTotal },
    exerciseTotals: { done: totalExDone, total: totalExTotal },
    qaTotals: { done: totalQaDone, total: totalQaTotal },
    groups,
  };
}

export default async function DashboardPage() {
  const userId = await requireUser();
  const data = await loadDashboard(userId);

  if (!data.hasModules) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold text-fg">Welcome</h1>
          <p className="text-fg">
            База пуста. Запусти <code className="rounded bg-bg-card px-1.5 py-0.5">pnpm sync</code> чтобы
            подтянуть теорию и Q&amp;A из <code>../modules/</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      {/* Растягиваем обе карточки до общей высоты. Раньше здесь стоял items-start:
          карточка повторений рисовала строку на каждый модуль с просрочкой и при
          16 модулях уезжала втрое выше соседней. Теперь её список свёрнут до пяти
          строк (TodayReviewCard), высоты сопоставимы, и лишнее место лучше отдать
          внутрь карточки, чем оставить провалом между ними.

          Повторение идёт первым: это единственное действие с дедлайном — карточки
          созревают по расписанию и просрочиваются, а глава теории ждёт сколько
          угодно. На узком экране сетка схлопывается в колонку, и «Начать
          повторение» оказывается первым экраном без прокрутки. Ширину при этом
          не отдаём: кнопка на две трети экрана выглядит нелепо, а прочитывается
          не лучше. */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <TodayReviewCard due={data.due} overdue={data.overdue} breakdown={data.dueBreakdown} />
        <div className="sm:col-span-2">
          <ContinueReadingCard data={data.continueReading} />
        </div>
      </div>

      <OverallProgress
        done={data.totalDone}
        total={data.totalAll}
        theory={data.theoryTotals}
        exercises={data.exerciseTotals}
        qas={data.qaTotals}
      />

      <ModulesBoard groups={data.groups} />
    </div>
  );
}
