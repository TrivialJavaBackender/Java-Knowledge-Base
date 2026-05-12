/**
 * One-off: migrate user progress from local SQLite to PostgreSQL (Neon).
 *
 * Usage (from web/):
 *   DATABASE_URL_SQLITE="./prisma/dev.db" node_modules/.bin/tsx scripts/migrate-data.ts
 *
 * Requires DATABASE_URL to point at Neon (set in .env).
 * Run AFTER `tsx scripts/sync.ts` has populated the Neon DB.
 *
 * Transfers:
 *   - TheoryDoc.isRead / readAt
 *   - Exercise.isRead / readAt
 *   - InterviewQA.isKnown / knownAt
 *   - LeitnerState (box, nextDueAt, streak, lapses)
 *   - ReviewLog entries
 *   - Manual flashcards (source = 'MANUAL')
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const sqlitePath = process.env.DATABASE_URL_SQLITE;
if (!sqlitePath) {
  console.error('Set DATABASE_URL_SQLITE, e.g. DATABASE_URL_SQLITE="./prisma/dev.db"');
  process.exit(1);
}

const absPath = path.resolve(__dirname, '..', sqlitePath);
console.log('Starting SQLite → PostgreSQL data migration...');
console.log('SQLite:', absPath);
console.log('PostgreSQL:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'));

const db = new DatabaseSync(absPath);
const pg = new PrismaClient();

function toDate(v: number | string | null): Date | null {
  if (!v) return null;
  return new Date(typeof v === 'number' ? v : v);
}

async function migrateTheoryRead() {
  const rows = db
    .prepare(
      `SELECT td.slug, m.slug AS moduleSlug, td.isRead, td.readAt
       FROM TheoryDoc td JOIN Module m ON m.id = td.moduleId
       WHERE td.isRead = 1`,
    )
    .all() as { slug: string; moduleSlug: string; isRead: number; readAt: number | null }[];

  let migrated = 0;
  for (const row of rows) {
    const target = await pg.theoryDoc.findFirst({
      where: { slug: row.slug, module: { slug: row.moduleSlug } },
    });
    if (!target) continue;
    await pg.theoryDoc.update({
      where: { id: target.id },
      data: { isRead: true, readAt: toDate(row.readAt) },
    });
    migrated++;
  }
  console.log(`theoryDoc.isRead: ${migrated}/${rows.length}`);
}

async function migrateExerciseRead() {
  const rows = db
    .prepare(
      `SELECT e.slug, m.slug AS moduleSlug, e.isRead, e.readAt
       FROM Exercise e JOIN Module m ON m.id = e.moduleId
       WHERE e.isRead = 1`,
    )
    .all() as { slug: string; moduleSlug: string; isRead: number; readAt: number | null }[];

  let migrated = 0;
  for (const row of rows) {
    const target = await pg.exercise.findFirst({
      where: { slug: row.slug, module: { slug: row.moduleSlug } },
    });
    if (!target) continue;
    await pg.exercise.update({
      where: { id: target.id },
      data: { isRead: true, readAt: toDate(row.readAt) },
    });
    migrated++;
  }
  console.log(`exercise.isRead: ${migrated}/${rows.length}`);
}

async function migrateQAKnown() {
  const rows = db
    .prepare(
      `SELECT qa.qNumber, m.slug AS moduleSlug, qa.isKnown, qa.knownAt
       FROM InterviewQA qa JOIN Module m ON m.id = qa.moduleId
       WHERE qa.isKnown = 1`,
    )
    .all() as { qNumber: number; moduleSlug: string; isKnown: number; knownAt: number | null }[];

  let migrated = 0;
  for (const row of rows) {
    const target = await pg.interviewQA.findFirst({
      where: { qNumber: row.qNumber, module: { slug: row.moduleSlug } },
    });
    if (!target) continue;
    await pg.interviewQA.update({
      where: { id: target.id },
      data: { isKnown: true, knownAt: toDate(row.knownAt) },
    });
    migrated++;
  }
  console.log(`interviewQA.isKnown: ${migrated}/${rows.length}`);
}

async function migrateLeitnerAndReviews() {
  const cards = db
    .prepare(
      `SELECT f.id, qa.qNumber, m.slug AS moduleSlug,
              ls.box, ls.nextDueAt, ls.lastReviewedAt, ls.lapses, ls.streak
       FROM Flashcard f
       JOIN InterviewQA qa ON qa.id = f.qaId
       JOIN Module m ON m.id = qa.moduleId
       JOIN LeitnerState ls ON ls.flashcardId = f.id
       WHERE f.source = 'AUTO' AND f.archived = 0`,
    )
    .all() as {
    id: number;
    qNumber: number;
    moduleSlug: string;
    box: number;
    nextDueAt: number;
    lastReviewedAt: number | null;
    lapses: number;
    streak: number;
  }[];

  let leitnerMigrated = 0;
  let reviewsMigrated = 0;

  for (const card of cards) {
    const targetQA = await pg.interviewQA.findFirst({
      where: { qNumber: card.qNumber, module: { slug: card.moduleSlug } },
      include: { flashcard: true },
    });
    if (!targetQA?.flashcard) continue;

    await pg.leitnerState.update({
      where: { flashcardId: targetQA.flashcard.id },
      data: {
        box: card.box,
        nextDueAt: new Date(card.nextDueAt),
        lastReviewedAt: toDate(card.lastReviewedAt),
        lapses: card.lapses,
        streak: card.streak,
      },
    });
    leitnerMigrated++;

    const reviews = db
      .prepare(
        `SELECT reviewedAt, prevBox, newBox, knewIt FROM ReviewLog WHERE flashcardId = ?`,
      )
      .all(card.id) as {
      reviewedAt: number;
      prevBox: number;
      newBox: number;
      knewIt: number;
    }[];

    for (const rev of reviews) {
      await pg.reviewLog.create({
        data: {
          flashcardId: targetQA.flashcard.id,
          reviewedAt: new Date(rev.reviewedAt),
          prevBox: rev.prevBox,
          newBox: rev.newBox,
          knewIt: rev.knewIt === 1,
        },
      });
      reviewsMigrated++;
    }
  }
  console.log(`leitnerState: ${leitnerMigrated}/${cards.length}`);
  console.log(`reviewLog: ${reviewsMigrated} entries`);
}

async function migrateManualFlashcards() {
  const manuals = db
    .prepare(
      `SELECT f.id, f.front, f.back, f.tags, f.archived, f.createdAt, f.updatedAt,
              m.slug AS moduleSlug,
              ls.box, ls.nextDueAt, ls.lastReviewedAt, ls.lapses, ls.streak
       FROM Flashcard f
       LEFT JOIN Module m ON m.id = f.moduleId
       LEFT JOIN LeitnerState ls ON ls.flashcardId = f.id
       WHERE f.source = 'MANUAL'`,
    )
    .all() as {
    id: number;
    front: string;
    back: string;
    tags: string;
    archived: number;
    createdAt: number;
    updatedAt: number;
    moduleSlug: string | null;
    box: number | null;
    nextDueAt: number | null;
    lastReviewedAt: number | null;
    lapses: number | null;
    streak: number | null;
  }[];

  let migrated = 0;
  for (const card of manuals) {
    const moduleId = card.moduleSlug
      ? (await pg.module.findUnique({ where: { slug: card.moduleSlug } }))?.id ?? null
      : null;

    const created = await pg.flashcard.create({
      data: {
        source: 'MANUAL',
        front: card.front,
        back: card.back,
        tags: card.tags,
        moduleId,
        archived: card.archived === 1,
        createdAt: new Date(card.createdAt),
        updatedAt: new Date(card.updatedAt),
      },
    });

    if (card.box !== null && card.nextDueAt !== null) {
      await pg.leitnerState.create({
        data: {
          flashcardId: created.id,
          box: card.box,
          nextDueAt: new Date(card.nextDueAt),
          lastReviewedAt: toDate(card.lastReviewedAt),
          lapses: card.lapses ?? 0,
          streak: card.streak ?? 0,
        },
      });
    }

    const reviews = db
      .prepare(`SELECT reviewedAt, prevBox, newBox, knewIt FROM ReviewLog WHERE flashcardId = ?`)
      .all(card.id) as { reviewedAt: number; prevBox: number; newBox: number; knewIt: number }[];

    for (const rev of reviews) {
      await pg.reviewLog.create({
        data: {
          flashcardId: created.id,
          reviewedAt: new Date(rev.reviewedAt),
          prevBox: rev.prevBox,
          newBox: rev.newBox,
          knewIt: rev.knewIt === 1,
        },
      });
    }
    migrated++;
  }
  console.log(`manual flashcards: ${migrated}/${manuals.length}`);
}

async function main() {
  await migrateTheoryRead();
  await migrateExerciseRead();
  await migrateQAKnown();
  await migrateLeitnerAndReviews();
  await migrateManualFlashcards();
  console.log('Done.');
  await pg.$disconnect();
  db.close();
}

main().catch((e) => {
  console.error(e);
  pg.$disconnect();
  process.exit(1);
});
