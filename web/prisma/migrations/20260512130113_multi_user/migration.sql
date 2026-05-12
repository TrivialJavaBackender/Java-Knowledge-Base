-- CreateTable UserTheoryProgress
CREATE TABLE "UserTheoryProgress" (
    "userId" INTEGER NOT NULL,
    "theoryDocId" INTEGER NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "UserTheoryProgress_pkey" PRIMARY KEY ("userId","theoryDocId")
);

-- CreateTable UserExerciseProgress
CREATE TABLE "UserExerciseProgress" (
    "userId" INTEGER NOT NULL,
    "exerciseId" INTEGER NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    CONSTRAINT "UserExerciseProgress_pkey" PRIMARY KEY ("userId","exerciseId")
);

-- CreateTable UserQAProgress
CREATE TABLE "UserQAProgress" (
    "userId" INTEGER NOT NULL,
    "qaId" INTEGER NOT NULL,
    "isKnown" BOOLEAN NOT NULL DEFAULT false,
    "knownAt" TIMESTAMP(3),
    CONSTRAINT "UserQAProgress_pkey" PRIMARY KEY ("userId","qaId")
);

-- AlterTable: add new columns as nullable first (can't add NOT NULL to table with existing rows without default)
ALTER TABLE "LeitnerState" ADD COLUMN "userId" INTEGER;
ALTER TABLE "ReviewLog" ADD COLUMN "userId" INTEGER;
ALTER TABLE "Flashcard" ADD COLUMN "userId" INTEGER;

-- DataMigration: backfill existing progress for userId=1 (pavel)
INSERT INTO "UserTheoryProgress" ("userId","theoryDocId","isRead","readAt")
    SELECT 1, id, "isRead", "readAt" FROM "TheoryDoc" WHERE "isRead" = true;

INSERT INTO "UserExerciseProgress" ("userId","exerciseId","isRead","readAt")
    SELECT 1, id, "isRead", "readAt" FROM "Exercise" WHERE "isRead" = true;

INSERT INTO "UserQAProgress" ("userId","qaId","isKnown","knownAt")
    SELECT 1, id, "isKnown", "knownAt" FROM "InterviewQA" WHERE "isKnown" = true;

UPDATE "LeitnerState" SET "userId" = 1;
UPDATE "ReviewLog" SET "userId" = 1;
UPDATE "Flashcard" SET "userId" = 1 WHERE source = 'MANUAL';

-- AlterTable: now make NOT NULL after backfill
ALTER TABLE "LeitnerState" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "ReviewLog" ALTER COLUMN "userId" SET NOT NULL;

-- Drop old unique index on LeitnerState (was created as INDEX, not CONSTRAINT), add per-user unique
DROP INDEX IF EXISTS "LeitnerState_flashcardId_key";
DROP INDEX IF EXISTS "LeitnerState_nextDueAt_idx";
CREATE UNIQUE INDEX "LeitnerState_userId_flashcardId_key" ON "LeitnerState"("userId", "flashcardId");
CREATE INDEX "LeitnerState_userId_nextDueAt_idx" ON "LeitnerState"("userId", "nextDueAt");

-- Drop old index on ReviewLog, add per-user index
DROP INDEX IF EXISTS "ReviewLog_flashcardId_idx";
CREATE INDEX "ReviewLog_userId_flashcardId_idx" ON "ReviewLog"("userId", "flashcardId");

-- Drop progress columns from content tables (data already migrated above)
ALTER TABLE "TheoryDoc" DROP COLUMN "isRead";
ALTER TABLE "TheoryDoc" DROP COLUMN "readAt";
ALTER TABLE "Exercise" DROP COLUMN "isRead";
ALTER TABLE "Exercise" DROP COLUMN "readAt";
ALTER TABLE "InterviewQA" DROP COLUMN "isKnown";
ALTER TABLE "InterviewQA" DROP COLUMN "knownAt";

-- AddForeignKey UserTheoryProgress
ALTER TABLE "UserTheoryProgress" ADD CONSTRAINT "UserTheoryProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTheoryProgress" ADD CONSTRAINT "UserTheoryProgress_theoryDocId_fkey" FOREIGN KEY ("theoryDocId") REFERENCES "TheoryDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey UserExerciseProgress
ALTER TABLE "UserExerciseProgress" ADD CONSTRAINT "UserExerciseProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserExerciseProgress" ADD CONSTRAINT "UserExerciseProgress_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey UserQAProgress
ALTER TABLE "UserQAProgress" ADD CONSTRAINT "UserQAProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserQAProgress" ADD CONSTRAINT "UserQAProgress_qaId_fkey" FOREIGN KEY ("qaId") REFERENCES "InterviewQA"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey LeitnerState userId
ALTER TABLE "LeitnerState" ADD CONSTRAINT "LeitnerState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey ReviewLog userId
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey Flashcard userId
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
