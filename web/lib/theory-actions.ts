'use server';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/**
 * Records reading position for the scroll-spy in the theory reader
 * (batch B2) — `UserTheoryProgress.lastSectionIndex` / `lastVisitedAt`.
 * Called from the client with a ~2s debounce as the active section changes,
 * so this fires far less often than the scroll events themselves.
 *
 * No `revalidatePath`: the theory page is `force-dynamic` and this value
 * isn't shown anywhere else that would need a cache bust (unlike
 * `toggleTheoryRead` in lib/actions.ts, which flips a checkbox visible on
 * the dashboard/module page).
 */
export async function setTheoryPosition(theoryDocId: number, sectionIndex: number) {
  const userId = await requireUser();
  await prisma.userTheoryProgress.upsert({
    where: { userId_theoryDocId: { userId, theoryDocId } },
    create: { userId, theoryDocId, lastSectionIndex: sectionIndex, lastVisitedAt: new Date() },
    update: { lastSectionIndex: sectionIndex, lastVisitedAt: new Date() },
  });
}
