import type { Classroom, Experiment, Learner } from '@prisma/client';
import type { ClassroomView, ExperimentView } from './api-types';
export function experimentView(e: Experiment): ExperimentView { return { id: e.id, classroom_id: e.classroomId, name: e.name, fault_chain_id: e.faultChainId as ExperimentView['fault_chain_id'], config: JSON.parse(e.configJson), rubric: JSON.parse(e.rubricJson), confirmed: e.confirmed, version: e.version }; }
export function classroomView(c: Classroom & { experiments: Experiment[]; learners: Learner[] }): ClassroomView {
  return { id: c.id, name: c.name, join_code: c.joinCode, join_open: c.joinOpen, data_source: c.dataSource as ClassroomView['data_source'], review_reference: c.reviewReference, participation_confirmed: c.participationConfirmed, experiments: c.experiments.map(experimentView), learners: c.learners.map(l => ({ id: l.id, number: l.number, active: l.active, participated: Boolean(l.participatedAt) })) };
}
