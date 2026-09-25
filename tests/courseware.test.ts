import assert from 'node:assert/strict';
import test from 'node:test';
import { COURSEWARE, coursewareForLab } from '../src/lib/courseware';
import { labGuide, LAB_GUIDES, LAB_PPT_NOTES, LAB_REPORT_TITLES } from '../src/lib/lab-guides';

test('six distinct courseware pages cover proposal topics and the linked experiments', () => {
  assert.equal(COURSEWARE.length, 6);
  assert.equal(new Set(COURSEWARE.map(item => item.slug)).size, 6);
  for (const topic of ['interrupt', 'timer', 'serial']) assert.ok(COURSEWARE.some(item => item.slug === topic));
  for (const item of COURSEWARE) {
    assert.ok(item.source.length > 10);
    for (const id of item.relatedLabs) assert.ok(labGuide(id));
  }
  for (const id of [2, 3, 4, 5, 7, 8]) assert.ok(coursewareForLab(id).length);
});

test('guide tasks keep secondary assignments in the original eight-report template', () => {
  assert.deepEqual(Object.keys(LAB_REPORT_TITLES).map(Number), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(LAB_GUIDES.map(lab => lab.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
    assert.match(LAB_REPORT_TITLES[id], new RegExp(`^实验[一二三四五六七八]：.+实验$`));
    assert.ok(labGuide(id)?.ppt && LAB_PPT_NOTES[id], `实验${id}缺少课程对应`);
  }
  assert.match(labGuide(2)!.task, /闪烁5次/);
  assert.match(labGuide(3)!.task, /0 到 9/);
  assert.match(labGuide(4)!.task, /发光二极管/);
  assert.match(labGuide(5)!.task, /100 ms/);
  assert.match(labGuide(6)!.goal, /救护车/);
  assert.match(labGuide(8)!.task, /0\.3\/0\.7/);
});
