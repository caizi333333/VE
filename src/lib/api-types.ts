/** Shared contracts: student responses contain approved content only. */
export type FaultId = 'timer-isr-not-entered' | 'uart-garbled' | 'timing-inaccurate';
export type DataSource = 'demo' | 'test' | 'classroom' | 'legacy_unknown';
export interface ConstraintEdgeView { from_id: string; to_id: string; reason: string | null }
export interface ConstraintPointView { id: string; name: string; chapter: number }
export interface RedactionHitView { rule: string; count: number }
export interface Checkpoint { id: string; point_id: string; instruction: string }
export interface RubricItem { id: string; label: string; max_score: number; criterion: string }
export interface Assessment { criterion_id: string; score: number | null; reason: string; line_no?: number; point_id?: string; issue_type?: string }
export interface ExperimentConfig {
  chip?: string; clock_hz?: number; clocks_per_tick?: number; timer_mode?: 1 | 2;
  target_ms?: number; target_baud?: number; smod?: 0 | 1; verification_method?: string;
  time_definition?: string; tolerance_percent?: number; toolchain?: string; benches?: string[];
}
export interface ExperimentView { id: string; classroom_id: string; name: string; fault_chain_id: FaultId; config: ExperimentConfig; rubric: RubricItem[]; confirmed: boolean; version: number }
export interface ClassroomView { id: string; name: string; join_code: string; join_open: boolean; data_source: DataSource; review_reference: string; participation_confirmed: boolean; experiments: ExperimentView[]; learners: { id: string; number: string; active: boolean; participated: boolean }[] }
export interface SessionView { teacher: { id: string; name: string; username: string } | null; learner: { id: string; number: string; classroom_id: string; classroom_name: string } | null }
export interface PracticeTaskView { level: 1 | 2 | 3; title: string; instruction: string; point_id: string; objective?: string; conditions?: string; deliverable?: string; verification?: string; unlocked?: boolean }
export interface AttemptView { id: string; published_version: number; level: number; ticks: string[]; observation: string; code: string; outcome: string; status: string; teacher_feedback: string; verification_evidence: string; created_at: string; verified_at: string | null }
export interface DiagnoseResponse { id: string; ticket: string; status: string }
export interface CodeMapHitView { line_no: number; text: string; point_id: string; label: string }
export interface TicketView {
  id: string; ticket: string; status: string; version: number; published_version: number | null; round: number;
  created_at: string; bench_label: string; experiment_name: string; experiment_id: string | null; lab_id?: number;
  /** The following fields are absent until a teacher publishes. */
  released?: { reviewer: string; comment: string; reviewed_at: string; checkpoints: Checkpoint[]; bridging_task: string; assessments: Assessment[] };
  rubric?: RubricItem[]; code_text?: string; symptom_text?: string; constraint?: { points: ConstraintPointView[]; edges: ConstraintEdgeView[] };
  practice_tasks?: PracticeTaskView[]; code_map?: CodeMapHitView[]; active_task_level?: number;
  student_outcome?: string; attempts?: AttemptView[]; completed_at?: string | null;
}
export interface TeacherDiagnosisView {
  id: string; ticket: string; status: string; version: number; round: number; published_version: number | null;
  created_at: string; classroom_id: string | null; experiment_id: string | null; experiment_name: string;
  learner_number: string; bench_label: string; data_source: string; symptom: string; code: string;
  classification: string; review_notes: string[]; checkpoints: Checkpoint[]; bridging_task: string;
  tasks: PracticeTaskView[]; assessments: Assessment[]; ai_assessments: Assessment[]; rubric: RubricItem[];
  comment: string; original: { checkpoints: Checkpoint[]; bridging_task: string };
  attempts: AttemptView[]; revisions: { version: number; action: string; created_at: string; payload: unknown }[];
  rounds: unknown[]; config: ExperimentConfig; completed_at: string | null;
}
export interface TeacherListView { items: TeacherDiagnosisView[]; total: number; page: number; page_size: number }
export interface StatsView {
  classroom_id: string; from: string | null; to: string | null; data_source: string;
  counts: { submissions: number; pending: number; released: number; help: number; verified: number; learners: number; participants: number; completed_learners: number };
  completion_rate: number | null; participation_confirmed: boolean;
  nodes: { point_id: string; name: string; confirmed_errors: number; diagnosis_ids: string[] }[];
  records: { id: string; ticket: string; learner_number: string; status: string; experiment_name: string; completed: boolean }[];
  feedback_minutes: { median: number | null; p90: number | null; count: number };
  assessment_agreement: { matched: number; total: number; rate: number | null; mean_absolute_score_difference: number | null };
}
export const REDACTION_RULE_LABELS: Record<string,string> = { id_card:'身份证号',phone:'手机号',student_id:'学号',email:'邮箱',labeled_identity:'身份标注',signature_comment:'代码署名',self_identity:'姓名自述' };
