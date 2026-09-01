/**
 * Очередь повторения на сегодня — один источник условия «карточка созрела».
 *
 * До этого одно и то же `nextDueAt <= endOfDay(now) AND archived = false`
 * лежало четырьмя копиями: счётчик в шапке (`app/layout.tsx`), дашборд
 * (`app/page.tsx`), очередь на `/flashcards` и теперь ещё рассылка
 * напоминаний. Расхождение между ними ловилось бы тяжелее всего именно в
 * уведомлении: в push «14 карточек», на экране — 11.
 *
 * Расписание Лейтнера тут не считается вообще: модуль только выбирает уже
 * созревшие карточки. Продвижение по ящикам живёт в `lib/leitner.ts` и
 * `reviewFlashcard` (`lib/actions.ts`).
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { endOfDay, startOfDay } from '@/lib/leitner';
import { getTrack, type TrackKey } from '@/lib/tracks';
import { renderMarkdown } from '@/lib/markdown';
import type { ReviewableCard } from '@/components/FlashcardReview';

/** Размер дневной очереди по умолчанию, если `User.dailyReviewLimit` не задан. */
export const DEFAULT_DAILY_LIMIT = 50;

/**
 * Условие «созрела на сегодня». `flashcardOr` — необязательный фильтр по
 * колодам с экрана `/flashcards`; пустой массив там означал бы «ничего не
 * выбрано», поэтому передавать его пустым нельзя — вызывающий отсекает такой
 * случай раньше.
 */
export function dueWhere(
  userId: number,
  now: Date = new Date(),
  flashcardOr?: Prisma.FlashcardWhereInput[],
): Prisma.LeitnerStateWhereInput {
  const flashcard: Prisma.FlashcardWhereInput = { archived: false };
  if (flashcardOr && flashcardOr.length > 0) flashcard.OR = flashcardOr;
  return { userId, nextDueAt: { lte: endOfDay(now) }, flashcard };
}

/** Сколько карточек созрело на сегодня. Включает просроченные. */
export function countDue(userId: number, now: Date = new Date()): Promise<number> {
  return prisma.leitnerState.count({ where: dueWhere(userId, now) });
}

/** Просрочка — подмножество `countDue`: срок наступил раньше сегодняшнего дня. */
export function countOverdue(userId: number, now: Date = new Date()): Promise<number> {
  return prisma.leitnerState.count({
    where: { userId, nextDueAt: { lt: startOfDay(now) }, flashcard: { archived: false } },
  });
}

/** Дневной лимит пользователя (`/flashcards/triage` его меняет). */
export async function dailyLimitOf(userId: number): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyReviewLimit: true },
  });
  return user?.dailyReviewLimit ?? DEFAULT_DAILY_LIMIT;
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Собрать очередь готовых к показу карточек.
 *
 * Порядок по умолчанию — `box ASC, nextDueAt ASC`: слабее всего усвоенное
 * идёт первым. `shuffle` перемешивает уже отобранный срез, чтобы модули
 * чередовались, а не шли блоками (режим смешанной очереди на `/flashcards`).
 * Перемешивание после `take`, а не до, — иначе отбор перестал бы быть
 * приоритетным.
 */
export async function loadDueQueue(
  userId: number,
  opts: {
    limit: number;
    now?: Date;
    flashcardOr?: Prisma.FlashcardWhereInput[];
    shuffle?: boolean;
  },
): Promise<ReviewableCard[]> {
  const now = opts.now ?? new Date();

  const rows = await prisma.leitnerState.findMany({
    where: dueWhere(userId, now, opts.flashcardOr),
    orderBy: [{ box: 'asc' }, { nextDueAt: 'asc' }],
    take: opts.limit,
    include: {
      flashcard: {
        include: {
          module: { select: { slug: true, title: true, track: true } },
          qa: { select: { qNumber: true, refDocSlug: true, section: { select: { title: true } } } },
        },
      },
    },
  });

  const ordered = opts.shuffle ? shuffled(rows) : rows;

  return Promise.all(
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
