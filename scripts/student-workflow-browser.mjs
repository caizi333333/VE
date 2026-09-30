/* Browser interaction regression. All /api responses are fixtures, never classroom data. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

async function main() {
  const base = process.env.VE_UI_BASE_URL || 'http://127.0.0.1:3118';
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Only a local test server is allowed');
  const output = path.resolve('tmp/student-ui');
  await fs.mkdir(output, { recursive: true });
  const server = process.env.VE_UI_BASE_URL ? null : spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3118', '-H', '127.0.0.1'], { stdio: 'ignore', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  const stopServer = () => server?.kill('SIGTERM');
  process.on('exit', stopServer);
  if (server) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { if ((await fetch(base)).ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, 'Run npm run build before the UI test; port 3118 must be available');
  }
  const custom = process.env.VE_BROWSER_LAUNCH_CONFIG ? JSON.parse(await fs.readFile(process.env.VE_BROWSER_LAUNCH_CONFIG, 'utf8')) : {};
  const browser = await chromium.launch({ headless: true, ...custom });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let learner = 'student-a';
  let failNextRun = false;
  let holdNextRun = false;
  let releaseRun;
  let failNextSubmission = false;
  const submissionKeys = [];
  const runs = [];
  let submitted;
  let checks = 0;
  const passed = name => { checks++; console.log(`PASS ${checks} ${name}`); };
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/session') {
      if (request.method() === 'POST') learner = null;
      return json(route, { teacher: null, learner: learner && { id: learner, number: learner, classroom_id: 'ui-class', classroom_name: '隔离界面测试课堂' } });
    }
    if (pathname === '/api/join') { learner = request.postDataJSON().learner_number; return json(route, { ok: true }); }
    if (pathname === '/api/experiments') return json(route, { experiments: [] });
    if (pathname === '/api/materials') return json(route, { materials: [] });
    if (pathname === '/api/assembly') {
      const p = request.postDataJSON();
      runs.push(p);
      if (holdNextRun) { holdNextRun = false; await new Promise(resolve => { releaseRun = resolve; }); }
      if (failNextRun) { failNextRun = false; return json(route, { error: '测试服务暂不可用，请重试' }, 503); }
      if (p.code.includes('SERVER_FAIL')) return json(route, { error: '测试汇编失败' }, 422);
      const count = p.key_steps.length;
      return json(route, {
        toolchain: 'AS31 + SDCC ucSim/s51', code_sha256: 'a'.repeat(64), hex: ':0100000000FF\n:00000001FF', code_bytes: 1,
        steps: p.steps, clock_hz: p.clock_hz, pc: 75, machine_clocks: p.steps * 12, elapsed_seconds: p.steps / 1e6,
        registers: { A: 0, SP: 7, P0: 255, P1: count, P2: 255, P3: 251, TMOD: 0, TCON: 1, TH0: 0, TL0: 0 },
        ram: Object.fromEntries(['20H', '30H', '31H', '32H', '33H', '34H', '35H', '36H', '37H', '38H'].map(key => [key, key === '30H' ? count : 0])),
        port_trace: p.steps ? [{ step: p.steps, value: count }] : [], secondary_trace: [], tertiary_trace: [],
      });
    }
    if (pathname === '/api/lab-help') {
      submitted = request.postDataJSON(); submissionKeys.push(submitted.idempotency_key);
      if (failNextSubmission) { failNextSubmission = false; return json(route, { error: '求助提交网络中断，请重试' }, 503); }
      return json(route, { id: 'test-d', ticket: 'TEST-0001', status: 'manual_pending' }, 201);
    }
    if (pathname.startsWith('/api/ticket/')) return json(route, { id: 'test-d', ticket: 'TEST-0001', status: 'manual_pending', lab_id: 4, round: 1, version: 0, experiment_name: '实验四', created_at: '2026-09-28T00:00:00Z' });
    return json(route, { error: 'Unexpected test request' }, 400);
  });
  const editor = () => page.getByLabel('8051 汇编代码', { exact: true });
  const runButton = () => page.getByRole('button', { name: '运行程序', exact: true });
  const transfer = () => page.getByRole('button', { name: '带入代码与记录，向教师求助', exact: true });
  const savedCode = () => page.evaluate(() => {
    const raw = localStorage.getItem('ve:lab-draft:v1:ui-class%3Astudent-a:lab:4');
    return raw ? JSON.parse(raw).code : null;
  });
  const openBench = async () => {
    await page.getByRole('button', { name: /^(开始|继续)实验$/ }).click();
    await expect(editor()).toBeVisible();
  };
  try {
    await page.goto(`${base}/?lab=4`);
    await expect(page.getByRole('button', { name: '开始实验', exact: true })).toBeVisible();
    await openBench();
    await expect(runButton()).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.assembly-advanced').first()).not.toHaveAttribute('open', '');
    await page.screenshot({ path: path.join(output, 'start-390.png') });
    passed('mobile entry exposes the primary run action without advanced controls');
    const original = await editor().inputValue();
    holdNextRun = true;
    await runButton().click();
    await expect(page.locator('.assembly-wait')).toContainText('已等待 1 秒');
    await expect(page.getByRole('button', { name: '正在运行…', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '下载当前源码', exact: true })).toBeEnabled();
    assert.equal(runs.length, 1);
    await page.screenshot({ path: path.join(output, 'waiting-390.png') });
    releaseRun();
    await expect(transfer()).toBeEnabled();
    await expect(page.locator('.assembly-wait')).toHaveCount(0);
    await expect(page.locator('.assembly-next-step')).toContainText('按一次虚拟 P3.2');
    passed('actual wait time, locked repeat actions, source-download fallback and next-step guidance');
    assert.equal(runs.at(-1).steps, 20);
    failNextRun = true;
    const key = page.getByRole('button', { name: /按一次 P3.2/ });
    await key.click();
    await expect(page.getByText('测试服务暂不可用，请重试', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '重试本次按键', exact: true }).click();
    await expect(page.getByText('已执行 1 次虚拟按键', { exact: false })).toBeVisible();
    assert.deepEqual(runs.at(-1).key_steps, [20]);
    assert.equal(runs.at(-1).steps, 45);
    await key.click();
    await expect(page.getByText('已执行 2 次虚拟按键', { exact: false })).toBeVisible();
    assert.deepEqual(runs.at(-1).key_steps, [20, 45]);
    passed('one-click run, automatic key execution, and failure retry without duplicate key events');
    await page.locator('.assembly-advanced > summary').first().click();
    await page.getByLabel('下一次运行的采样范围').selectOption('500');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载调试记录', exact: true }).click();
    const download = await downloadEvent;
    const evidence = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(evidence.traceWindow, 0);
    assert.equal(evidence.result.steps, 70);
    assert.deepEqual(evidence.keySteps, [20, 45]);
    const modified = `${original}\n; saved student draft`;
    await editor().fill(modified);
    await expect(transfer()).toBeDisabled();
    await expect.poll(savedCode).toBe(modified);
    await editor().scrollIntoViewIfNeeded();
    await expect(runButton()).toBeInViewport({ ratio: 1 });
    await page.locator('[data-lab-id="5"]').click();
    await page.locator('[data-lab-id="4"]').click();
    await openBench();
    await expect(editor()).toHaveValue(modified);
    await page.reload();
    await openBench();
    await expect(editor()).toHaveValue(modified);
    await expect(page.locator('.assembly-native')).toHaveCount(0);
    await page.goto(base);
    await expect(page.locator('[data-lab-id="4"]')).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`${base}/?lab=5`);
    await expect(page.locator('[data-lab-id="5"]')).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`${base}/?lab=4`);
    await openBench();
    passed('immutable exported settings, stale result isolation, lab switching, refresh and explicit-link priority');
    await editor().fill(`${modified}\n; SERVER_FAIL`);
    await runButton().click();
    await expect(page.getByText('测试汇编失败', { exact: true })).toBeVisible();
    await expect(page.locator('.assembly-native')).toHaveCount(0);
    await page.locator('.assembly-advanced > summary').first().click();
    await page.getByLabel('晶振条件').selectOption('11059200');
    await expect(page.getByRole('button', { name: '重试本次运行', exact: true })).toHaveCount(0);
    await page.getByLabel('晶振条件').selectOption('12000000');
    await runButton().click();
    await expect(page.getByText('测试汇编失败', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '检查代码', exact: true }).click();
    await expect(editor()).toBeFocused();
    await page.getByRole('button', { name: '重试本次运行', exact: true }).click();
    await expect(page.getByText('测试汇编失败', { exact: true })).toBeVisible();
    const failedSource = await editor().inputValue();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '恢复当前版本示例', exact: true }).click();
    await expect(editor()).toHaveValue(failedSource);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '恢复当前版本示例', exact: true }).click();
    await expect(editor()).toHaveValue(original);
    await expect(page.locator('.assembly-native')).toHaveCount(0);
    await editor().press('Control+Enter');
    await expect(transfer()).toBeEnabled();
    await page.getByRole('button', { name: '修改代码，比较变化', exact: true }).click();
    await expect(editor()).toBeFocused();
    passed('error recovery focuses the editor, safe example restore and keyboard run preserve result consistency');
    await editor().fill(modified);
    await runButton().click();
    await expect(transfer()).toBeEnabled();
    const observation = '按键后计数与预期不同，请帮助检查。';
    await page.locator('#student-observation').fill(observation);
    await transfer().click();
    await expect(page.locator('#student-observation')).toHaveValue(observation);
    await expect(page.locator('#student-observation')).toBeFocused();
    await page.locator('.optional-code > summary').click();
    const helpCode = page.locator('.code-input');
    await expect(helpCode).toHaveValue(modified);
    await helpCode.fill(`${modified}\n; help-only edit`);
    await expect(page.locator('.assembly-help-evidence')).toHaveCount(0);
    page.once('dialog', dialog => dialog.dismiss());
    await transfer().click();
    await expect(helpCode).toHaveValue(`${modified}\n; help-only edit`);
    page.once('dialog', dialog => dialog.accept());
    await transfer().click();
    await expect(helpCode).toHaveValue(modified);
    passed('compile failure recovery, student observation preservation, focus and code replacement confirmation');
    await page.locator('[data-lab-id="5"]').click();
    await expect(page.locator('#student-observation')).toHaveValue('');
    await page.locator('#student-observation').fill('实验五的独立现象草稿，不应出现在实验四。');
    await page.locator('[data-lab-id="4"]').click();
    await expect(page.locator('#student-observation')).toHaveValue(observation);
    await page.reload();
    await expect(page.locator('#student-observation')).toHaveValue(observation);
    await expect(page.locator('.code-input')).toHaveValue(modified);
    await expect(page.locator('.assembly-help-evidence')).toHaveCount(1);
    await page.locator('#ask-teacher').screenshot({ path: path.join(output, 'help-draft-390.png') });
    await openBench();
    await expect(page.locator('.assembly-native')).toHaveCount(0);
    const helpDownloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载求助草稿', exact: true }).click();
    const helpDownload = await helpDownloadEvent;
    const helpText = await fs.readFile(await helpDownload.path(), 'utf8');
    assert.ok(helpText.includes(observation) && helpText.includes(modified));
    passed('unsubmitted help survives lab switching and refresh, with downloadable input and no restored simulation result');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`);
      await page.locator('#lab-workbench').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: path.join(output, `lab-${width}.png`) });
    }
    passed('390 / 768 / 1440px layout fits viewport');
    failNextSubmission = true;
    await page.getByRole('button', { name: '提交给教师求助', exact: true }).click();
    await expect(page.getByText('求助提交网络中断，请重试', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('#student-observation')).toHaveValue(observation);
    await page.getByRole('button', { name: '提交给教师求助', exact: true }).click();
    await expect(page.getByText('TEST-0001', { exact: true })).toBeVisible();
    assert.equal(submitted.code, modified);
    assert.equal(submitted.lab_id, 4);
    assert.match(submitted.symptom, /学生提交，待教师复核/);
    assert.ok(submitted.symptom.length <= 2000);
    assert.equal(submissionKeys.length, 2);
    assert.equal(submissionKeys[0], submissionKeys[1]);
    passed('submission retry after refresh retains the original idempotency key');
    await page.getByRole('button', { name: '返回实验', exact: true }).click();
    await expect(page.locator('#student-observation')).toHaveValue('');
    await expect(page.locator('.assembly-help-evidence')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: '查看上次求助', exact: true })).toBeVisible();
    await openBench();
    await expect(editor()).toHaveValue(modified);
    await page.getByRole('button', { name: '查看上次求助', exact: true }).click();
    await expect(page.getByText('TEST-0001', { exact: true })).toBeVisible();
    passed('evidence submission and returning between the original lab and the last help ticket');
    await page.getByRole('button', { name: '退出课堂', exact: true }).click();
    await expect(page.getByRole('button', { name: '进入实验台', exact: true })).toBeVisible();
    assert.equal(await savedCode(), null);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('ve:lab-draft:v1:ui-class%3Astudent-a:'))), false);
    await page.getByLabel('班级码', { exact: true }).fill('UITEST');
    await page.getByLabel('匿名学习编号').fill('student-b');
    await page.getByLabel('私密恢复码').fill('test-recovery');
    await page.getByRole('button', { name: '进入实验台', exact: true }).click();
    await page.locator('[data-lab-id="4"]').click();
    await openBench();
    await expect(editor()).toHaveValue(original);
    passed('logout clears the current learner draft and the next learner receives a fresh example');
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError'); }; });
    await editor().fill(`${original}\n; storage failure`);
    await expect(page.getByText('自动保存不可用，请下载源码保留修改。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载当前源码', exact: true })).toBeEnabled();
    await page.locator('#student-observation').fill('不能自动保存时，我仍然可以下载求助草稿。');
    await expect(page.getByText('求助草稿无法自动保存，请在离开页面前下载草稿。', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载求助草稿', exact: true })).toBeEnabled();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('[data-lab-id="5"]').click();
    await expect(page.locator('#student-observation')).toHaveValue('不能自动保存时，我仍然可以下载求助草稿。');
    passed('blocked browser storage provides source-download fallback without losing the editor');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, api: 'fixtures only', widths: [390, 768, 1440], pageErrors: errors }, null, 2));
    console.log(`UI_PASS ${checks} groups; API fixtures only, no native simulator or hardware validation.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); stopServer(); }
}
main().catch(error => { console.error(error); process.exit(1); });
