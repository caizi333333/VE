-- AlterTable
ALTER TABLE "Pitfall" ADD COLUMN "classroomId" TEXT;
ALTER TABLE "Pitfall" ADD COLUMN "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "teacherId" TEXT,
    "learnerId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Session_learnerId_fkey" FOREIGN KEY ("learnerId") REFERENCES "Learner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Classroom" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teacherId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "joinCode" TEXT NOT NULL,
    "joinOpen" BOOLEAN NOT NULL DEFAULT true,
    "dataSource" TEXT NOT NULL DEFAULT 'classroom',
    "reviewReference" TEXT NOT NULL DEFAULT '',
    "participationConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Classroom_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Learner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "recoveryHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "participatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Learner_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "faultChainId" TEXT NOT NULL,
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "rubricJson" TEXT NOT NULL DEFAULT '[]',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Experiment_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diagnosisId" TEXT NOT NULL,
    "teacherId" TEXT,
    "version" INTEGER NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "action" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewRevision_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diagnosisId" TEXT NOT NULL,
    "learnerId" TEXT NOT NULL,
    "publishedVersion" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "ticksJson" TEXT NOT NULL DEFAULT '[]',
    "observation" TEXT NOT NULL,
    "codeText" TEXT NOT NULL DEFAULT '',
    "outcome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "teacherFeedback" TEXT NOT NULL DEFAULT '',
    "verificationEvidence" TEXT NOT NULL DEFAULT '',
    "verifiedAt" DATETIME,
    "verifiedBy" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAttempt_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "Diagnosis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classroomId" TEXT,
    "learnerId" TEXT,
    "diagnosisId" TEXT,
    "kind" TEXT NOT NULL,
    "dataSource" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "GenerationRequest" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "learnerId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "diagnosisId" TEXT,
    "errorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Diagnosis" (
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
    "activeTaskLevel" INTEGER NOT NULL DEFAULT 1,
    "classroomId" TEXT,
    "learnerId" TEXT,
    "experimentId" TEXT,
    "dataSource" TEXT NOT NULL DEFAULT 'legacy_unknown',
    "version" INTEGER NOT NULL DEFAULT 0,
    "round" INTEGER NOT NULL DEFAULT 1,
    "publishedVersion" INTEGER,
    "promptVersion" TEXT NOT NULL DEFAULT 'legacy',
    "graphVersion" TEXT NOT NULL DEFAULT 'legacy',
    "configSnapshot" TEXT NOT NULL DEFAULT '{}',
    "rubricSnapshot" TEXT NOT NULL DEFAULT '[]',
    "constraintSnapshot" TEXT NOT NULL DEFAULT '{}',
    "assessmentJson" TEXT NOT NULL DEFAULT '[]',
    "taskPackJson" TEXT NOT NULL DEFAULT '[]',
    "roundsJson" TEXT NOT NULL DEFAULT '[]',
    "completedAt" DATETIME
);
INSERT INTO "new_Diagnosis" ("activeTaskLevel", "benchLabel", "bridgingTask", "chainPointIds", "checkpoints", "classification", "codeText", "createdAt", "faultChainId", "id", "model", "provider", "rawResponse", "redactionLog", "reviewNotes", "status", "studentOutcome", "studentResolvedPoint", "studentTicks", "symptomText", "ticket") SELECT "activeTaskLevel", "benchLabel", "bridgingTask", "chainPointIds", "checkpoints", "classification", "codeText", "createdAt", "faultChainId", "id", "model", "provider", "rawResponse", "redactionLog", "reviewNotes", "status", "studentOutcome", "studentResolvedPoint", "studentTicks", "symptomText", "ticket" FROM "Diagnosis";
DROP TABLE "Diagnosis";
ALTER TABLE "new_Diagnosis" RENAME TO "Diagnosis";
CREATE UNIQUE INDEX "Diagnosis_ticket_key" ON "Diagnosis"("ticket");
CREATE INDEX "Diagnosis_classroomId_status_createdAt_idx" ON "Diagnosis"("classroomId", "status", "createdAt");
CREATE INDEX "Diagnosis_learnerId_experimentId_idx" ON "Diagnosis"("learnerId", "experimentId");
CREATE INDEX "Diagnosis_createdAt_idx" ON "Diagnosis"("createdAt");
CREATE INDEX "Diagnosis_faultChainId_idx" ON "Diagnosis"("faultChainId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_username_key" ON "Teacher"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Classroom_joinCode_key" ON "Classroom"("joinCode");

-- CreateIndex
CREATE UNIQUE INDEX "Learner_classroomId_number_key" ON "Learner"("classroomId", "number");

-- CreateIndex
CREATE INDEX "Experiment_classroomId_idx" ON "Experiment"("classroomId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRevision_diagnosisId_version_key" ON "ReviewRevision"("diagnosisId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAttempt_idempotencyKey_key" ON "TaskAttempt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "TaskAttempt_diagnosisId_createdAt_idx" ON "TaskAttempt"("diagnosisId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_classroomId_kind_createdAt_idx" ON "ActivityEvent"("classroomId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationRequest_learnerId_createdAt_idx" ON "GenerationRequest"("learnerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Pitfall_dedupeKey_key" ON "Pitfall"("dedupeKey");

