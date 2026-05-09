-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TheoryDoc" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "moduleId" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 999,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" DATETIME,
    CONSTRAINT "TheoryDoc_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TheoryDoc" ("body", "contentHash", "filePath", "id", "isRead", "moduleId", "readAt", "slug", "title") SELECT "body", "contentHash", "filePath", "id", "isRead", "moduleId", "readAt", "slug", "title" FROM "TheoryDoc";
DROP TABLE "TheoryDoc";
ALTER TABLE "new_TheoryDoc" RENAME TO "TheoryDoc";
CREATE UNIQUE INDEX "TheoryDoc_moduleId_slug_key" ON "TheoryDoc"("moduleId", "slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
