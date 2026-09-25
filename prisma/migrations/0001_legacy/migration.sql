-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticket" TEXT NOT NULL,
    "benchLabel" TEXT NOT NULL DEFAULT '',
    "symptomText" TEXT NOT NULL,
    "codeText" TEXT NOT NULL,
    "redactionLog" TEXT NOT NULL,
    "faultChainId" TEXT,
    "chainPointIds" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "checkpoints" TEXT NOT NULL,
    "bridgingTask" TEXT NOT NULL,
    "reviewNotes" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "studentTicks" TEXT NOT NULL DEFAULT '[]',
    "studentOutcome" TEXT NOT NULL DEFAULT '',
    "studentResolvedPoint" TEXT NOT NULL DEFAULT '',
    "activeTaskLevel" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "Pitfall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pointId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "diagnosisId" TEXT,
    "author" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diagnosisId" TEXT NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewer" TEXT NOT NULL,
    "checkpoints" TEXT NOT NULL,
    "bridgingTask" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "released" BOOLEAN NOT NULL,
    FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Diagnosis_faultChainId_idx" ON "Diagnosis"("faultChainId" ASC);

-- CreateIndex
CREATE INDEX "Diagnosis_createdAt_idx" ON "Diagnosis"("createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Diagnosis_ticket_key" ON "Diagnosis"("ticket" ASC);

-- CreateIndex
CREATE INDEX "Pitfall_active_idx" ON "Pitfall"("active" ASC);

-- CreateIndex
CREATE INDEX "Pitfall_pointId_idx" ON "Pitfall"("pointId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Review_diagnosisId_key" ON "Review"("diagnosisId" ASC);

