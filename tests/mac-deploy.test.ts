/** Real filesystem moves with mocked service/build commands; never touches a Mac service. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

async function scenario(mode: string) {
  const root = await mkdtemp(join(tmpdir(), 've-deploy-test-'));
  const app = join(root, 'app with spaces 学生'), bin = join(root, 'bin');
  await mkdir(join(app, '.next-final'), { recursive: true });
  await mkdir(join(app, 'node_modules')); await mkdir(bin);
  await writeFile(join(app, '.next-final', 'marker'), 'old-build');
  await writeFile(join(app, 'database.db'), 'preserved-database');
  await writeFile(join(app, '.env.local'), 'preserved-environment');
  await writeFile(join(root, 'mock.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>WorkingDirectory</key><string>${app}</string><key>EnvironmentVariables</key><dict><key>NEXT_DIST_DIR</key><string>.next-final</string></dict></dict></plist>`);
  const commands: Record<string,string> = {
    uname: 'echo Darwin',
    git: `case "$*" in
      'branch --show-current') echo main;;
      'status --porcelain') if [ "$VE_TEST_MODE" = dirty ]; then echo ' M user-work'; fi;;
      'remote get-url origin') echo https://github.com/caizi333333/VE.git;;
      diff*) if [ "$VE_TEST_MODE" = dependencies ]; then exit 1; fi;;
      'merge --ff-only'*) if [ "$VE_TEST_MODE" = divergence ]; then echo divergent >&2; exit 1; fi;;
      'log -1 --oneline') echo test-release;;
    esac`,
    launchctl: 'echo "$1" >> "$VE_TEST_ROOT/service.log"; exit 0',
    npm: 'mkdir -p "$NEXT_DIST_DIR"; echo new-build > "$NEXT_DIST_DIR/marker"; if [ "$VE_TEST_MODE" = build-fails ]; then exit 1; fi',
    curl: 'if [ "$VE_TEST_MODE" = health-fails ]; then exit 1; fi; echo \'{"status":"ok"}\'',
    sleep: 'exit 0',
  };
  for (const [name, command] of Object.entries(commands)) await writeFile(join(bin, name), `#!/bin/bash\nset -eu\n${command}\n`, { mode: 0o700 });
  try {
    const run = spawnSync('bash', [resolve('scripts/deploy-macos.sh'), 'a'.repeat(40)], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: root, VE_DEPLOY_PLIST: join(root, 'mock.plist'), VE_DEPLOY_PATH_PREFIX: bin, VE_TEST_ROOT: root, VE_TEST_MODE: mode },
    });
    assert.equal(run.error, undefined);
    const marker = (await readFile(join(app, '.next-final', 'marker'), 'utf8')).trim();
    assert.equal(await readFile(join(app, 'database.db'), 'utf8'), 'preserved-database');
    assert.equal(await readFile(join(app, '.env.local'), 'utf8'), 'preserved-environment');
    const service = await readFile(join(root, 'service.log'), 'utf8').catch(() => '');
    if (mode === 'success') {
      assert.equal(run.status, 0, run.stderr); assert.equal(marker, 'new-build');
      assert.equal(service.trim(), 'bootout\nbootstrap');
      const backup = (await readdir(root)).find(name => name.startsWith('ve-release.'))!;
      assert.equal(await readFile(join(root, backup, '.next-final', 'marker'), 'utf8'), 'old-build');
    } else if (mode === 'build-fails' || mode === 'health-fails') {
      assert.equal(run.status, 1, run.stderr); assert.equal(marker, 'old-build');
      assert.match(service, /bootout\nbootstrap\n$/); assert.match(run.stderr, /尝试恢复旧构建/);
      const backup = (await readdir(root)).find(name => name.startsWith('ve-release.'))!;
      assert.equal((await readFile(join(root, backup, 'failed-build', 'marker'), 'utf8')).trim(), 'new-build');
    } else {
      assert.equal(run.status, 1, run.stderr); assert.equal(marker, 'old-build'); assert.equal(service, '');
      assert.match(run.stderr, mode === 'dirty' ? /本地修改/ : mode === 'dependencies' ? /运行依赖发生变化/ : /divergent/);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
}
for (const mode of ['success', 'build-fails', 'health-fails', 'dirty', 'dependencies', 'divergence']) {
  test(`Mac update ${mode}: preserves local data and safely handles the existing build`, async () => { await scenario(mode); });
}
