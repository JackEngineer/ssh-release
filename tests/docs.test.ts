import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('documents a GitHub Actions deployment workflow with safe secrets usage', async () => {
  const guide = await readFile(new URL('../docs/github-actions.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(guide, /ssh-release deploy --dry-run --json/);
  assert.match(guide, /ssh-release deploy --json --progress/);
  assert.match(guide, /SSH_RELEASE_HOST/);
  assert.match(guide, /SSH_RELEASE_USER/);
  assert.match(guide, /SSH_RELEASE_PASSWORD/);
  assert.match(guide, /environment: production/);
  assert.doesNotMatch(guide, new RegExp([
    ['47', '114', '97', '21'].join('\\.'),
    ['xiao', 'mao', '1994'].join(''),
    'npm_[A-Za-z0-9]{20,}',
  ].join('|')));
  assert.match(readme, /docs\/github-actions\.md/);
});

test('documents recovery steps for common deployment failures', async () => {
  const guide = await readFile(new URL('../docs/recovery.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(guide, /远端锁/);
  assert.match(guide, /ssh-release unlock --confirm/);
  assert.match(guide, /current/);
  assert.match(guide, /rollback/);
  assert.match(guide, /verified/);
  assert.match(guide, /下一步/);
  assert.match(guide, /tar/);
  assert.match(guide, /--json --progress/);
  assert.doesNotMatch(guide, new RegExp([
    ['47', '114', '97', '21'].join('\\.'),
    ['xiao', 'mao', '1994'].join(''),
    'npm_[A-Za-z0-9]{20,}',
  ].join('|')));
  assert.match(readme, /docs\/recovery\.md/);
});

test('documents stable CLI, JSON, config, and safety contracts for 1.0', async () => {
  const guide = await readFile(new URL('../docs/contracts.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(guide, /1\.0\.0/);
  assert.match(guide, /ssh-release deploy --json --progress/);
  assert.match(guide, /ssh-release deploy --plan/);
  assert.match(guide, /ssh-release rollback \[version\] --plan/);
  assert.match(guide, /"ok": true/);
  assert.match(guide, /"hint"/);
  assert.match(guide, /"verified": true/);
  assert.match(guide, /manifest\.json/);
  assert.match(guide, /SHA-256/);
  assert.match(guide, /退出码/);
  assert.match(guide, /SSH_RELEASE_HOST/);
  assert.match(guide, /不会执行自定义远程 hook/);
  assert.match(guide, /不重启服务/);
  assert.match(guide, /SemVer/);
  assert.doesNotMatch(guide, new RegExp([
    ['47', '114', '97', '21'].join('\\.'),
    ['xiao', 'mao', '1994'].join(''),
    'npm_[A-Za-z0-9]{20,}',
  ].join('|')));
  assert.match(readme, /当前版本已进入 1\.0 稳定版/);
  assert.match(readme, /发布 manifest/);
  assert.match(readme, /ssh-release deploy --plan/);
  assert.match(readme, /ssh-release rollback \[version\] --plan/);
  assert.match(readme, /manifest\.json/);
  assert.match(readme, /docs\/contracts\.md/);
});

test('documents first release setup and platform dependencies', async () => {
  const quickStart = await readFile(new URL('../docs/quick-start.md', import.meta.url), 'utf8');
  const platforms = await readFile(
    new URL('../docs/platform-requirements.md', import.meta.url),
    'utf8',
  );
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(quickStart, /ssh-release init/);
  assert.match(quickStart, /ssh-release doctor/);
  assert.match(quickStart, /ssh-release deploy --plan/);
  assert.match(quickStart, /ssh-release deploy --json --progress/);
  assert.match(quickStart, /ssh-release rollback --plan/);
  assert.match(quickStart, /SSH_RELEASE_HOST/);
  assert.match(quickStart, /SSH_RELEASE_USER/);
  assert.match(quickStart, /source\.path/);
  assert.match(quickStart, /target\.path/);

  assert.match(platforms, /Node\.js 20/);
  assert.match(platforms, /ssh/);
  assert.match(platforms, /scp/);
  assert.match(platforms, /tar/);
  assert.match(platforms, /远端可运行 `sha256sum` 或 `shasum`/);
  assert.match(platforms, /sshpass/);
  assert.match(platforms, /brew install hudochenkov\/sshpass\/sshpass/);
  assert.match(platforms, /sudo apt-get install sshpass/);
  assert.match(platforms, /Windows/);
  assert.match(platforms, /私钥登录/);

  assert.doesNotMatch(`${quickStart}\n${platforms}`, new RegExp([
    ['47', '114', '97', '21'].join('\\.'),
    ['xiao', 'mao', '1994'].join(''),
    'npm_[A-Za-z0-9]{20,}',
  ].join('|')));
  assert.match(readme, /docs\/quick-start\.md/);
  assert.match(readme, /docs\/platform-requirements\.md/);
});
