import assert from 'node:assert/strict';
import test from 'node:test';
import { clearHelpDraft, clearLabDrafts, readHelpDraft, readLabDraft, readLastLab, readLastTicket, saveHelpDraft, saveLabDraft, saveLastLab, saveLastTicket, type DraftStorage, type HelpDraft, type LabDraft } from '../src/lib/lab-drafts';

class MemoryStorage implements DraftStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
}
const draft: LabDraft = { version: 1, labId: 5, presetId: 'scan-fixed', code: 'ORG 0\nNOP\nEND', clockHz: 11_059_200, traceWindow: 5000 };

test('code and settings survive returning to a lab without restoring execution evidence', () => {
  const storage = new MemoryStorage();
  saveLabDraft(storage, 'class-a:learner-a', draft);
  const key = storage.key(0)!;
  storage.setItem(key, JSON.stringify({ ...draft, result: { steps: 500 }, completed: true }));
  assert.deepEqual(readLabDraft(storage, 'class-a:learner-a', 5), draft);
  saveLabDraft(storage, 'class-a:learner-a', { ...draft, code: '' });
  assert.equal(readLabDraft(storage, 'class-a:learner-a', 5)?.code, '');
});

test('drafts and last lab are isolated across learners, classrooms and labs', () => {
  const storage = new MemoryStorage();
  saveLabDraft(storage, 'class-a:learner-a', draft);
  saveLastLab(storage, 'class-a:learner-a', 5);
  for (const scope of ['class-a:learner-b', 'class-b:learner-a']) {
    assert.equal(readLabDraft(storage, scope, 5), null);
    assert.equal(readLastLab(storage, scope), null);
  }
  assert.equal(readLabDraft(storage, 'class-a:learner-a', 4), null);
  assert.equal(readLastLab(storage, 'class-a:learner-a'), 5);
});

test('corrupt, oversized and incompatible saved input falls back to the example', () => {
  const storage = new MemoryStorage();
  saveLabDraft(storage, 'student', draft);
  const key = storage.key(0)!;
  const bad = ['{broken', 'null', 'x'.repeat(80_001), ...[
    { version: 2 }, { labId: 4 }, { presetId: 'missing' }, { code: 42 },
    { code: 'x'.repeat(12_001) }, { clockHz: 1 }, { traceWindow: -1 },
  ].map(change => JSON.stringify({ ...draft, ...change }))];
  for (const value of bad) {
    storage.setItem(key, value);
    assert.equal(readLabDraft(storage, 'student', 5), null);
  }
  saveLastLab(storage, 'student', 0);
  assert.equal(readLastLab(storage, 'student'), null);
});

test('logout clears all and only the current learner’s drafts and last lab', () => {
  const storage = new MemoryStorage();
  for (const scope of ['student', 'student:other']) {
    saveLabDraft(storage, scope, draft);
    saveLabDraft(storage, scope, { ...draft, labId: 4, presetId: 'basic' });
    saveLastLab(storage, scope, 5);
  }
  storage.setItem('unrelated-preference', 'keep');
  clearLabDrafts(storage, 'student');
  assert.equal(readLabDraft(storage, 'student', 5), null);
  assert.equal(readLabDraft(storage, 'student', 4), null);
  assert.equal(readLastLab(storage, 'student'), null);
  assert.deepEqual(readLabDraft(storage, 'student:other', 5), draft);
  assert.equal(readLastLab(storage, 'student:other'), 5);
  assert.equal(storage.getItem('unrelated-preference'), 'keep');
});

test('storage errors reach the caller so the UI can offer source download', () => {
  const storage = new MemoryStorage();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => saveLabDraft(storage, 'student', draft), /QuotaExceeded/);
  storage.getItem = () => { throw new Error('SecurityError'); };
  assert.throws(() => readLabDraft(storage, 'student', 5), /SecurityError/);
});

const help: HelpDraft = { version: 1, labId: 4, symptom: '按键后计数没有变化', code: 'ORG 0\nNOP\nEND', evidence: '学生提交，待教师复核', issueType: null, requestKey: 'retry-after-network-failure' };

test('unsubmitted help and retry identity survive refresh and stay isolated by lab and learner', () => {
  const storage = new MemoryStorage();
  saveHelpDraft(storage, 'class:a', help);
  saveLabDraft(storage, 'class:a', draft);
  assert.deepEqual(readHelpDraft(storage, 'class:a', 4), help);
  for (const scope of ['class:b', 'other:a']) assert.equal(readHelpDraft(storage, scope, 4), null);
  assert.equal(readHelpDraft(storage, 'class:a', 5), null);
  clearHelpDraft(storage, 'class:a', 4);
  assert.equal(readHelpDraft(storage, 'class:a', 4), null);
  assert.deepEqual(readLabDraft(storage, 'class:a', 5), draft);
});

test('malformed help cannot restore foreign labs or oversized input', () => {
  const storage = new MemoryStorage();
  saveHelpDraft(storage, 'class:a', help);
  const key = storage.key(0)!;
  for (const value of ['null', '{broken', 'x'.repeat(80_001), ...[
    { version: 2 }, { labId: 5 }, { symptom: 42 }, { symptom: 'x'.repeat(2001) },
    { code: 'x'.repeat(12_001) }, { evidence: 'x'.repeat(2001) }, { issueType: 'bad' },
    { requestKey: 'x'.repeat(129) }, { requestKey: null },
  ].map(change => JSON.stringify({ ...help, ...change }))]) {
    storage.setItem(key, value);
    assert.equal(readHelpDraft(storage, 'class:a', 4), null);
  }
});

test('empty help removes the draft and logout clears last ticket only for the departing learner', () => {
  const storage = new MemoryStorage();
  for (const scope of ['class:a', 'class:b']) {
    saveHelpDraft(storage, scope, help);
    saveLastTicket(storage, scope, 'TEST-0001');
  }
  saveHelpDraft(storage, 'class:a', { ...help, symptom: '', code: '', evidence: '', requestKey: '' });
  assert.equal(readHelpDraft(storage, 'class:a', 4), null);
  saveHelpDraft(storage, 'class:a', help);
  clearLabDrafts(storage, 'class:a');
  assert.equal(readHelpDraft(storage, 'class:a', 4), null);
  assert.equal(readLastTicket(storage, 'class:a'), null);
  assert.deepEqual(readHelpDraft(storage, 'class:b', 4), help);
  assert.equal(readLastTicket(storage, 'class:b'), 'TEST-0001');
  saveLastTicket(storage, 'class:b', '../bad?ticket=1');
  assert.equal(readLastTicket(storage, 'class:b'), 'TEST-0001');
});
