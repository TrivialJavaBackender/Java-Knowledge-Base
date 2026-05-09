'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { reviewCard } from '@/lib/leitner';

export async function toggleTheoryRead(id: number, value: boolean) {
  await prisma.theoryDoc.update({
    where: { id },
    data: { isRead: value, readAt: value ? new Date() : null },
  });
  revalidatePath('/');
  revalidatePath('/modules');
}

export async function toggleExerciseRead(id: number, value: boolean) {
  await prisma.exercise.update({
    where: { id },
    data: { isRead: value, readAt: value ? new Date() : null },
  });
  revalidatePath('/');
  revalidatePath('/modules');
}

export async function toggleQAKnown(id: number, value: boolean) {
  await prisma.interviewQA.update({
    where: { id },
    data: { isKnown: value, knownAt: value ? new Date() : null },
  });
  revalidatePath('/');
  revalidatePath('/modules');
}

export async function reviewFlashcard(flashcardId: number, knewIt: boolean) {
  const state = await prisma.leitnerState.findUnique({ where: { flashcardId } });
  if (!state) throw new Error('Leitner state not found');
  const next = reviewCard({ box: state.box, streak: state.streak, lapses: state.lapses }, knewIt);
  await prisma.$transaction([
    prisma.leitnerState.update({
      where: { flashcardId },
      data: {
        box: next.box,
        streak: next.streak,
        lapses: next.lapses,
        nextDueAt: next.nextDueAt,
        lastReviewedAt: next.lastReviewedAt,
      },
    }),
    prisma.reviewLog.create({
      data: {
        flashcardId,
        prevBox: state.box,
        newBox: next.box,
        knewIt,
      },
    }),
  ]);
  revalidatePath('/flashcards');
  revalidatePath('/');
}

export async function createManualFlashcard(input: {
  front: string;
  back: string;
  tags?: string;
  moduleId?: number | null;
}) {
  const card = await prisma.flashcard.create({
    data: {
      source: 'MANUAL',
      front: input.front,
      back: input.back,
      tags: input.tags ?? '',
      moduleId: input.moduleId ?? null,
    },
  });
  await prisma.leitnerState.create({
    data: {
      flashcardId: card.id,
      box: 1,
      nextDueAt: new Date(),
    },
  });
  revalidatePath('/flashcards/manage');
  revalidatePath('/flashcards');
  return card.id;
}

export async function updateManualFlashcard(
  id: number,
  input: { front: string; back: string; tags?: string; moduleId?: number | null },
) {
  await prisma.flashcard.update({
    where: { id },
    data: {
      front: input.front,
      back: input.back,
      tags: input.tags ?? '',
      moduleId: input.moduleId ?? null,
    },
  });
  revalidatePath('/flashcards/manage');
}

export async function archiveFlashcard(id: number, archived: boolean) {
  await prisma.flashcard.update({ where: { id }, data: { archived } });
  revalidatePath('/flashcards/manage');
  revalidatePath('/flashcards');
}

export async function resetLeitner(flashcardId: number) {
  await prisma.leitnerState.update({
    where: { flashcardId },
    data: { box: 1, streak: 0, nextDueAt: new Date() },
  });
  revalidatePath('/flashcards/manage');
}
