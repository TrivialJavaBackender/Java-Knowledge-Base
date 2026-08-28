-- AlterTable
ALTER TABLE "InterviewQA" ADD COLUMN     "refDocSlug" TEXT,
ADD COLUMN     "refSection" INTEGER;

-- AlterTable
ALTER TABLE "Module" ADD COLUMN     "track" TEXT NOT NULL DEFAULT 'architecture';

-- AlterTable
ALTER TABLE "TheoryDoc" ADD COLUMN     "readingMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sectionCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyReviewLimit" INTEGER;

-- AlterTable
ALTER TABLE "UserTheoryProgress" ADD COLUMN     "lastSectionIndex" INTEGER,
ADD COLUMN     "lastVisitedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Flashcard_moduleId_idx" ON "Flashcard"("moduleId");

-- CreateIndex
CREATE INDEX "InterviewQA_moduleId_refDocSlug_idx" ON "InterviewQA"("moduleId", "refDocSlug");

-- CreateIndex
CREATE INDEX "UserTheoryProgress_userId_lastVisitedAt_idx" ON "UserTheoryProgress"("userId", "lastVisitedAt");
