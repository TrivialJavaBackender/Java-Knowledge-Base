-- CreateTable
CREATE TABLE "Module" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "TheoryDoc" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "moduleId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    CONSTRAINT "TheoryDoc_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "moduleId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'kotlin',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    CONSTRAINT "Exercise_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterviewSection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "moduleId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "InterviewSection_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InterviewQA" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sectionId" INTEGER NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "qNumber" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sourceRef" TEXT,
    "contentHash" TEXT NOT NULL,
    "isKnown" BOOLEAN NOT NULL DEFAULT false,
    "knownAt" DATETIME,
    CONSTRAINT "InterviewQA_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "InterviewSection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InterviewQA_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Flashcard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "source" TEXT NOT NULL,
    "qaId" INTEGER,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "moduleId" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Flashcard_qaId_fkey" FOREIGN KEY ("qaId") REFERENCES "InterviewQA" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Flashcard_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeitnerState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "flashcardId" INTEGER NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 1,
    "nextDueAt" DATETIME NOT NULL,
    "lastReviewedAt" DATETIME,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LeitnerState_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "flashcardId" INTEGER NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevBox" INTEGER NOT NULL,
    "newBox" INTEGER NOT NULL,
    "knewIt" BOOLEAN NOT NULL,
    CONSTRAINT "ReviewLog_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Module_slug_key" ON "Module"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "TheoryDoc_moduleId_slug_key" ON "TheoryDoc"("moduleId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_moduleId_slug_key" ON "Exercise"("moduleId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewSection_moduleId_number_key" ON "InterviewSection"("moduleId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "InterviewQA_moduleId_qNumber_key" ON "InterviewQA"("moduleId", "qNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Flashcard_qaId_key" ON "Flashcard"("qaId");

-- CreateIndex
CREATE UNIQUE INDEX "LeitnerState_flashcardId_key" ON "LeitnerState"("flashcardId");

-- CreateIndex
CREATE INDEX "LeitnerState_nextDueAt_idx" ON "LeitnerState"("nextDueAt");

-- CreateIndex
CREATE INDEX "ReviewLog_flashcardId_idx" ON "ReviewLog"("flashcardId");

-- CreateIndex
CREATE INDEX "ReviewLog_reviewedAt_idx" ON "ReviewLog"("reviewedAt");
