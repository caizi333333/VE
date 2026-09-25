CREATE TABLE "CourseMaterial" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "classroomId" TEXT NOT NULL,
  "teacherId" TEXT NOT NULL,
  "labId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "content" BLOB NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "CourseMaterial_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "Classroom" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CourseMaterial_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CourseMaterial_classroomId_labId_active_published_idx" ON "CourseMaterial"("classroomId", "labId", "active", "published");
