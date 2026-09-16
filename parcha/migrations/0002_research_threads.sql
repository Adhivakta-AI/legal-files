PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "researchThread" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "researchThread_userId_updatedAt_idx"
  ON "researchThread"("userId", "updatedAt" DESC);

CREATE TABLE IF NOT EXISTS "researchMessage" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "threadId" TEXT NOT NULL,
  "role" TEXT NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" TEXT NOT NULL,
  "resultJson" TEXT,
  "createdAt" TEXT NOT NULL,
  FOREIGN KEY ("threadId") REFERENCES "researchThread"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "researchMessage_threadId_createdAt_idx"
  ON "researchMessage"("threadId", "createdAt" ASC);
