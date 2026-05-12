-- CreateTable
CREATE TABLE "Module" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TheoryDoc" (
    "id" SERIAL NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 999,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "TheoryDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" SERIAL NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'kotlin',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSection" (
    "id" SERIAL NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "InterviewSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewQA" (
    "id" SERIAL NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "moduleId" INTEGER NOT NULL,
    "qNumber" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sourceRef" TEXT,
    "contentHash" TEXT NOT NULL,
    "isKnown" BOOLEAN NOT NULL DEFAULT false,
    "knownAt" TIMESTAMP(3),

    CONSTRAINT "InterviewQA_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flashcard" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "qaId" INTEGER,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "moduleId" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flashcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeitnerState" (
    "id" SERIAL NOT NULL,
    "flashcardId" INTEGER NOT NULL,
    "box" INTEGER NOT NULL DEFAULT 1,
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastReviewedAt" TIMESTAMP(3),
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeitnerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewLog" (
    "id" SERIAL NOT NULL,
    "flashcardId" INTEGER NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prevBox" INTEGER NOT NULL,
    "newBox" INTEGER NOT NULL,
    "knewIt" BOOLEAN NOT NULL,

    CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "TheoryDoc" ADD CONSTRAINT "TheoryDoc_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSection" ADD CONSTRAINT "InterviewSection_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQA" ADD CONSTRAINT "InterviewQA_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "InterviewSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewQA" ADD CONSTRAINT "InterviewQA_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_qaId_fkey" FOREIGN KEY ("qaId") REFERENCES "InterviewQA"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeitnerState" ADD CONSTRAINT "LeitnerState_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
