import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAB_PREP, labPrep } from '../src/lib/lab-prep';
import { COURSEWARE } from '../src/lib/courseware';

test('every lab has a prep sheet with two questions and a courseware unit', () => {
  assert.equal(LAB_PREP.length, 8);
  const slugs = new Set(COURSEWARE.map((c) => c.slug));
  for (const p of LAB_PREP) {
    assert.ok(slugs.has(p.coursewareSlug), `lab ${p.labId} courseware ${p.coursewareSlug} missing`);
    assert.equal(p.questions.length, 2);
    assert.ok(p.runStep.length > 10);
  }
});

test('prep questions reference knowledge-graph points that exist', () => {
  const kg = JSON.parse(readFileSync('data/kg-8051.json', 'utf8')) as { points: { id: string }[] };
  const ids = new Set(kg.points.map((n) => n.id));
  for (const p of LAB_PREP) for (const q of p.questions) assert.ok(ids.has(q.point), `lab ${p.labId} question point ${q.point} not in kg-8051`);
});

test('labPrep lookup is by lab id only', () => {
  assert.equal(labPrep(3)?.coursewareSlug, 'timer');
  assert.equal(labPrep(9), undefined);
});
