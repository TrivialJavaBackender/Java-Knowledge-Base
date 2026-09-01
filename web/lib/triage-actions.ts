'use server';

/**
 * Batch operations for the queue-triage screen (/flashcards/triage). Every action
 * works on a *scope* (module/all/none), never on a single card, and writes with
 * updateMany/transaction/raw SQL — never a per-row loop.
 *
 * Single-card operations live in lib/actions.ts (`resetLeitner`,
 * `archiveFlashcard`) and are driven by /flashcards/manage. There used to be a
 * third kind here — bulk actions over an explicit id list, for a checkbox table
 * on the manage page — but that table duplicated this screen without its
 * diagnosis, horizon and load chart, so both it and those actions were removed.
 *
 * AUTO-card archival is NOT the `Flashcard.archived` flag (that column is
 * global, shared by every user of a shared AUTO card). It is per-user
 * "dormancy": `LeitnerState.nextDueAt` pushed to `DORMANT_DATE`, exactly what
 * the row-level `archiveFlashcard` in lib/actions.ts does. Bulk archive here
 * must produce the identical state or the two surfaces would disagree.
 */

import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { startOfDay, addDays, spreadDueDates, DORMANT_DATE } from '@/lib/leitner';

/**
 * Выборка модулей для массовой операции.
 *
 * `'all'` — вся учётная запись. Иначе — явный набор: список id модулей плюс
 * флаг «карточки без модуля». Раньше здесь был одиночный выбор
 * (`'all' | 'none' | number`), и разложить по дням просрочку сразу по двум-трём
 * модулям было нельзя — приходилось применять план по одному.
 */
export type TriageScope = 'all' | { moduleIds: number[]; noModule: boolean };

/** Условие, которому не удовлетворяет ни одна строка: выбрано пусто. */
const MATCH_NOTHING: Prisma.FlashcardWhereInput = { id: { in: [] } };

function scopeFilter(scope: TriageScope): Prisma.FlashcardWhereInput {
  if (scope === 'all') return {};
  const or: Prisma.FlashcardWhereInput[] = [];
  if (scope.moduleIds.length > 0) or.push({ moduleId: { in: scope.moduleIds } });
  if (scope.noModule) or.push({ moduleId: null });
  if (or.length === 0) return MATCH_NOTHING;
  return { OR: or };
}

function revalidateQueueViews() {
  revalidatePath('/flashcards/triage');
  revalidatePath('/flashcards');
  revalidatePath('/flashcards/manage');
}

/** Batched bucket-update: group ids by target date, one updateMany per bucket. */
async function writeSpreadBuckets(ids: number[], dateForIndex: (i: number) => Date) {
  const buckets = new Map<number, number[]>();
  ids.forEach((id, i) => {
    const t = startOfDay(dateForIndex(i)).getTime();
    const arr = buckets.get(t);
    if (arr) arr.push(id);
    else buckets.set(t, [id]);
  });
  await prisma.$transaction(
    Array.from(buckets.entries()).map(([t, bucketIds]) =>
      prisma.leitnerState.updateMany({ where: { id: { in: bucketIds } }, data: { nextDueAt: new Date(t) } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Scope-based actions — driven by the triage screen (whole overdue selection).
// ---------------------------------------------------------------------------

/** "Разложить по дням": redistribute every overdue card across horizonDays, oldest-due first. Boxes/streaks untouched. */
export async function applySpreadPlan(horizonDays: number, scope: TriageScope): Promise<number> {
  const userId = await requireUser();
  const now = new Date();
  const rows = await prisma.leitnerState.findMany({
    where: { userId, nextDueAt: { lt: startOfDay(now) }, flashcard: { archived: false, ...scopeFilter(scope) } },
    orderBy: { nextDueAt: 'asc' },
    select: { id: true },
  });
  await writeSpreadBuckets(
    rows.map((r) => r.id),
    (i) => spreadDueDates(i, horizonDays, now),
  );
  revalidateQueueViews();
  return rows.length;
}

/** "Сбросить в первый ящик": every overdue card → box 1, streak 0, due today. Irreversible (streak/interval history lost). */
export async function applyResetPlan(scope: TriageScope): Promise<number> {
  const userId = await requireUser();
  const res = await prisma.leitnerState.updateMany({
    where: { userId, nextDueAt: { lt: startOfDay(new Date()) }, flashcard: { archived: false, ...scopeFilter(scope) } },
    data: { box: 1, streak: 0, nextDueAt: new Date() },
  });
  revalidateQueueViews();
  return res.count;
}

/** "Заархивировать старое": overdue-longer-than-thresholdDays leaves the queue via per-user dormancy (AUTO) or the archived flag (MANUAL, owner-only). */
export async function applyArchivePlan(thresholdDays: number, scope: TriageScope): Promise<number> {
  const userId = await requireUser();
  const cutoff = startOfDay(addDays(new Date(), -thresholdDays));
  const targets = await prisma.leitnerState.findMany({
    where: { userId, nextDueAt: { lt: cutoff }, flashcard: { archived: false, ...scopeFilter(scope) } },
    select: { id: true, flashcardId: true, flashcard: { select: { source: true } } },
  });
  const autoIds = targets.filter((t) => t.flashcard.source === 'AUTO').map((t) => t.id);
  const manualFlashcardIds = targets.filter((t) => t.flashcard.source === 'MANUAL').map((t) => t.flashcardId);
  await prisma.$transaction([
    ...(autoIds.length
      ? [prisma.leitnerState.updateMany({ where: { id: { in: autoIds } }, data: { nextDueAt: DORMANT_DATE } })]
      : []),
    ...(manualFlashcardIds.length
      ? [prisma.flashcard.updateMany({ where: { id: { in: manualFlashcardIds }, userId }, data: { archived: true } })]
      : []),
  ]);
  revalidateQueueViews();
  return targets.length;
}

// ---------------------------------------------------------------------------
// Daily review limit — prevention, not cleanup.
// ---------------------------------------------------------------------------

/** null = fall back to the app default (50, see /flashcards). */
export async function setDailyReviewLimit(value: number | null): Promise<void> {
  const userId = await requireUser();
  await prisma.user.update({ where: { id: userId }, data: { dailyReviewLimit: value } });
  revalidateQueueViews();
}
