/** The student projection is an allow-list built from the immutable published revision. */
import type { Diagnosis, Review, ReviewRevision, TaskAttempt } from '@prisma/client';
import { mapCodeToPoints } from './code-map';
import type { Assessment, AttemptView, Checkpoint, PracticeTaskView, TicketView } from './api-types';

export interface PublishedPayload {
  reviewer: string;
  checkpoints: Checkpoint[];
  bridging_task: string;
  comment: string;
  tasks: PracticeTaskView[];
  assessments: Assessment[];
}
export type DiagnosisRecord = Diagnosis & {
  review?: Review | null;
  revisions?: ReviewRevision[];
  attempts?: TaskAttempt[];
};
export function readJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
export function stableCheckpoints(value: { id?: string; point_id: string; instruction: string }[], round: number): Checkpoint[] {
  return value.map((item, index) => ({ ...item, id: item.id || `r${round}-cp${index + 1}` }));
}
export function publishedPayload(record: DiagnosisRecord): { payload: PublishedPayload; revision: ReviewRevision } | null {
  if (record.status !== 'released' || record.publishedVersion === null) return null;
  const revision = record.revisions?.find((item) => item.version === record.publishedVersion && item.action === 'release' && item.round === record.round);
  if (!revision) return null;
  const payload = readJson<PublishedPayload | null>(revision.payloadJson, null);
  if (!payload || !Array.isArray(payload.checkpoints) || !Array.isArray(payload.tasks) || !Array.isArray(payload.assessments)) return null;
  return { payload, revision };
}
export function toAttemptView(attempt: TaskAttempt): AttemptView {
  return {
    id: attempt.id, published_version: attempt.publishedVersion, level: attempt.level,
    ticks: readJson<string[]>(attempt.ticksJson, []), observation: attempt.observation,
    code: attempt.codeText, outcome: attempt.outcome, status: attempt.status,
    teacher_feedback: attempt.teacherFeedback, verification_evidence: attempt.verificationEvidence,
    created_at: attempt.createdAt.toISOString(), verified_at: attempt.verifiedAt?.toISOString() ?? null,
  };
}
export function toTicketView(record: DiagnosisRecord, experimentName = ''): TicketView {
  const result: TicketView = {
    id: record.id, ticket: record.ticket, status: record.status, version: record.version,
    published_version: record.publishedVersion, round: record.round, created_at: record.createdAt.toISOString(),
    bench_label: record.benchLabel, experiment_name: experimentName, experiment_id: record.experimentId,
    ...(/^lab-[1-8]$/.test(record.faultChainId ?? '') ? { lab_id: Number(record.faultChainId!.slice(4)) } : {}),
  };
  const published = publishedPayload(record);
  if (!published) return result;
  const { payload, revision } = published;
  return {
    ...result,
    released: { reviewer: payload.reviewer, comment: payload.comment, reviewed_at: revision.createdAt.toISOString(), checkpoints: payload.checkpoints, bridging_task: payload.bridging_task, assessments: payload.assessments },
    rubric: readJson(record.rubricSnapshot, []), code_text: record.codeText, symptom_text: record.symptomText,
    constraint: readJson(record.constraintSnapshot, { points: [], edges: [] }),
    // Locked tasks are omitted entirely, so hidden content cannot be read in a response.
    practice_tasks: payload.tasks.filter((task) => task.level <= record.activeTaskLevel).map((task) => ({ ...task, unlocked: true })),
    code_map: mapCodeToPoints(record.codeText), active_task_level: record.activeTaskLevel,
    student_outcome: record.studentOutcome, attempts: (record.attempts ?? []).map(toAttemptView),
    completed_at: record.completedAt?.toISOString() ?? null,
  };
}
