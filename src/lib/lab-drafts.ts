import { assemblyLab, MAX_ASSEMBLY_CHARS } from './assembly-labs';

export interface LabDraft {
  version: 1;
  labId: number;
  presetId: string;
  code: string;
  clockHz: number;
  traceWindow: number;
}

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const prefix = (scope: string) => `ve:lab-draft:v1:${encodeURIComponent(scope)}:`;
const key = (scope: string, labId: number) => `${prefix(scope)}lab:${labId}`;

export interface HelpDraft {
  version: 1;
  labId: number;
  symptom: string;
  code: string;
  evidence: string;
  issueType: 'wiring' | 'code' | 'result' | null;
  requestKey: string;
}

const helpKey = (scope: string, labId: number) => `${prefix(scope)}help:${labId}`;

/** Unsubmitted help is separate from editor inputs and from published teacher guidance. */
export function readHelpDraft(storage: DraftStorage, scope: string, labId: number): HelpDraft | null {
  const raw = storage.getItem(helpKey(scope, labId));
  if (!raw || raw.length > 80_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<HelpDraft>;
    if (!assemblyLab(labId) || value.version !== 1 || value.labId !== labId) return null;
    if (typeof value.symptom !== 'string' || value.symptom.length > 2000 || typeof value.code !== 'string' || value.code.length > MAX_ASSEMBLY_CHARS) return null;
    if (typeof value.evidence !== 'string' || value.evidence.length > 2000 || (value.issueType !== null && !['wiring', 'code', 'result'].includes(value.issueType ?? ''))) return null;
    if (typeof value.requestKey !== 'string' || value.requestKey.length > 128) return null;
    return { version: 1, labId, symptom: value.symptom, code: value.code, evidence: value.evidence, issueType: value.issueType!, requestKey: value.requestKey };
  } catch { return null; }
}

export function saveHelpDraft(storage: DraftStorage, scope: string, draft: HelpDraft): void {
  if (!draft.symptom && !draft.code && !draft.evidence && !draft.issueType && !draft.requestKey) {
    clearHelpDraft(storage, scope, draft.labId);
  } else storage.setItem(helpKey(scope, draft.labId), JSON.stringify(draft));
}

export function clearHelpDraft(storage: DraftStorage, scope: string, labId: number): void {
  storage.removeItem(helpKey(scope, labId));
}

export function readLastTicket(storage: DraftStorage, scope: string): string | null {
  const value = storage.getItem(`${prefix(scope)}last-ticket`);
  return value && /^[A-Z0-9-]{1,64}$/.test(value) ? value : null;
}

export function saveLastTicket(storage: DraftStorage, scope: string, ticket: string): void {
  if (/^[A-Z0-9-]{1,64}$/.test(ticket)) storage.setItem(`${prefix(scope)}last-ticket`, ticket);
}

/** Only editor inputs are restored. A stored draft is never a verified execution result. */
export function readLabDraft(storage: DraftStorage, scope: string, labId: number): LabDraft | null {
  const raw = storage.getItem(key(scope, labId));
  if (!raw || raw.length > 80_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<LabDraft>;
    const lab = assemblyLab(labId);
    if (!lab || value.version !== 1 || value.labId !== labId || typeof value.code !== 'string' || value.code.length > MAX_ASSEMBLY_CHARS) return null;
    if (value.presetId !== 'basic' && !lab.variants?.some(item => item.id === value.presetId)) return null;
    if (![12_000_000, 11_059_200].includes(value.clockHz ?? 0) || ![0, 500, 5_000, 50_000].includes(value.traceWindow ?? -1)) return null;
    return { version: 1, labId, presetId: value.presetId!, code: value.code, clockHz: value.clockHz!, traceWindow: value.traceWindow! };
  } catch { return null; }
}

export function saveLabDraft(storage: DraftStorage, scope: string, draft: LabDraft): void {
  storage.setItem(key(scope, draft.labId), JSON.stringify(draft));
}

export function readLastLab(storage: DraftStorage, scope: string): number | null {
  const raw = storage.getItem(`${prefix(scope)}last-lab`);
  return raw && /^[1-8]$/.test(raw) ? Number(raw) : null;
}

export function saveLastLab(storage: DraftStorage, scope: string, labId: number): void {
  if (assemblyLab(labId)) storage.setItem(`${prefix(scope)}last-lab`, String(labId));
}

/** Shared classroom computers must not retain the departing learner's saved work. */
export function clearLabDrafts(storage: DraftStorage, scope: string): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const candidate = storage.key(i);
    if (candidate?.startsWith(prefix(scope))) keys.push(candidate);
  }
  keys.forEach(candidate => storage.removeItem(candidate));
}
