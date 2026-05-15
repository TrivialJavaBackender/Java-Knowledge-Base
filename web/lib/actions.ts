'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { reviewCard, startOfDay, addDays } from '@/lib/leitner';

export async function toggleTheoryRead(theoryDocId: number, value: boolean) {
  const userId = await requireUser();
  await prisma.userTheoryProgress.upsert({
    where: { userId_theoryDocId: { userId, theoryDocId } },
    create: { userId, theoryDocId, isRead: value, readAt: value ? new Date() : null },
    update: { isRead: value, readAt: value ? new Date() : null },
  });
  revalidatePath('/');
  revalidatePath('/modules');
}

export async function toggleExerciseRead(exerciseId: number, value: boolean) {
  const userId = await requireUser();
  await prisma.userExerciseProgress.upsert({
    where: { userId_exerciseId: { userId, exerciseId } },
    create: { userId, exerciseId, isRead: value, readAt: value ? new Date() : null },
    update: { isRead: value, readAt: value ? new Date() : null },
  });
  revalidatePath('/');
  revalidatePath('/modules');
}

export async function toggleQAKnown(qaId: number, value: boolean) {
  const userId = await requireUser();
  await prisma.userQAProgress.upsert({
    where: { userId_qaId: { userId, qaId } },
    create: { userId, qaId, isKnown: value, knownAt: value ? new Date() : null },
    update: { isKnown: value, knownAt: value ? new Date() : null },
  });

  if (value) {
    const flashcard = await prisma.flashcard.findUnique({ where: { qaId } });
    if (flashcard) {
      const tomorrow = startOfDay(addDays(new Date(), 1));
      const leitner = await prisma.leitnerState.findUnique({
        where: { userId_flashcardId: { userId, flashcardId: flashcard.id } },
      });
      if (!leitner) {
        await prisma.leitnerState.create({
          data: { userId, flashcardId: flashcard.id, box: 1, nextDueAt: tomorrow },
        });
      } else if (leitner.box === 1 && leitner.nextDueAt >= new Date('2098-01-01')) {
        await prisma.leitnerState.update({
          where: { userId_flashcardId: { userId, flashcardId: flashcard.id } },
          data: { nextDueAt: tomorrow },
        });
      }
    }
  }

  revalidatePath('/');
  revalidatePath('/modules');
}

export async function reviewFlashcard(flashcardId: number, knewIt: boolean) {
  const userId = await requireUser();
  const state =
    (await prisma.leitnerState.findUnique({
      where: { userId_flashcardId: { userId, flashcardId } },
    })) ??
    (await prisma.leitnerState.create({
      data: { userId, flashcardId, box: 1, nextDueAt: new Date() },
    }));
  const next = reviewCard({ box: state.box, streak: state.streak, lapses: state.lapses }, knewIt);
  await prisma.$transaction([
    prisma.leitnerState.update({
      where: { userId_flashcardId: { userId, flashcardId } },
      data: {
        box: next.box,
        streak: next.streak,
        lapses: next.lapses,
        nextDueAt: next.nextDueAt,
        lastReviewedAt: next.lastReviewedAt,
      },
    }),
    prisma.reviewLog.create({
      data: { flashcardId, userId, prevBox: state.box, newBox: next.box, knewIt },
    }),
  ]);
  // No revalidatePath: queue is managed client-side, page is force-dynamic.
}

export async function createManualFlashcard(input: {
  front: string;
  back: string;
  tags?: string;
  moduleId?: number | null;
}) {
  const userId = await requireUser();
  const card = await prisma.flashcard.create({
    data: {
      source: 'MANUAL',
      userId,
      front: input.front,
      back: input.back,
      tags: input.tags ?? '',
      moduleId: input.moduleId ?? null,
    },
  });
  await prisma.leitnerState.create({
    data: { flashcardId: card.id, userId, box: 1, nextDueAt: new Date() },
  });
  revalidatePath('/flashcards/manage');
  revalidatePath('/flashcards');
  return card.id;
}

export async function updateManualFlashcard(
  id: number,
  input: { front: string; back: string; tags?: string; moduleId?: number | null },
) {
  const userId = await requireUser();
  await prisma.flashcard.update({
    where: { id, userId },
    data: { front: input.front, back: input.back, tags: input.tags ?? '', moduleId: input.moduleId ?? null },
  });
  revalidatePath('/flashcards/manage');
}

export async function archiveFlashcard(id: number, archived: boolean) {
  const userId = await requireUser();
  const card = await prisma.flashcard.findUnique({ where: { id } });
  if (!card) return;
  // MANUAL cards: only owner can archive. AUTO cards: archive per user via leitner dormant.
  if (card.source === 'MANUAL') {
    await prisma.flashcard.update({ where: { id, userId }, data: { archived } });
  } else {
    const dormant = new Date('2099-01-01');
    await prisma.leitnerState.upsert({
      where: { userId_flashcardId: { userId, flashcardId: id } },
      create: { userId, flashcardId: id, box: 1, nextDueAt: archived ? dormant : new Date() },
      update: { nextDueAt: archived ? dormant : new Date() },
    });
  }
  revalidatePath('/flashcards/manage');
  revalidatePath('/flashcards');
}

export async function resetLeitner(flashcardId: number) {
  const userId = await requireUser();
  await prisma.leitnerState.upsert({
    where: { userId_flashcardId: { userId, flashcardId } },
    create: { userId, flashcardId, box: 1, nextDueAt: new Date() },
    update: { box: 1, streak: 0, nextDueAt: new Date() },
  });
  revalidatePath('/flashcards/manage');
}
