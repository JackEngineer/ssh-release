import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const sensitivePattern = new RegExp([
  ['47', '114', '97', '21'].join('\\.'),
  ['xiao', 'mao', '1994'].join(''),
  'npm_[A-Za-z0-9]{20,}',
].join('|'));

test('provides a reusable real-server dogfood script without embedded secrets', async () => {
  const scriptUrl = new URL('../scripts/dogfood-real.sh', import.meta.url);
  const script = await readFile(scriptUrl, 'utf8');

  await access(scriptUrl);
  assert.match(script, /SSH_RELEASE_HOST/);
  assert.match(script, /SSH_RELEASE_USER/);
  assert.match(script, /SSH_RELEASE_PASSWORD/);
  assert.match(script, /SSH_RELEASE_PRIVATE_KEY_PATH/);
  assert.match(script, /\/tmp\/ssh-release-dogfood-/);
  assert.match(script, /rollback --json --progress/);
  assert.match(script, /remote_cleanup=ok/);
  assert.match(script, /dogfood[^\\n]+ok/);
  assert.match(script, /SSH_RELEASE_KEEP_LOCAL_ON_FAILURE/);
  assert.match(script, /dogfood failed/);
  assert.match(script, /NumberOfPasswordPrompts=1/);
  assert.match(script, /ConnectTimeout=15/);
  assert.match(script, /ServerAliveInterval=15/);
  assert.match(script, /ServerAliveCountMax=2/);
  assert.doesNotMatch(script, sensitivePattern);
});

test('documents safe real-server dogfood usage', async () => {
  const guide = await readFile(new URL('../docs/dogfood.md', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const releaseChecklist = await readFile(
    new URL('../docs/release-checklist.md', import.meta.url),
    'utf8',
  );

  assert.match(guide, /scripts\/dogfood-real\.sh/);
  assert.match(guide, /SSH_RELEASE_HOST/);
  assert.match(guide, /SSH_RELEASE_USER/);
  assert.match(guide, /SSH_RELEASE_PASSWORD/);
  assert.match(guide, /SSH_RELEASE_PRIVATE_KEY_PATH/);
  assert.match(guide, /\/tmp\/ssh-release-dogfood-\*/);
  assert.match(guide, /doctor/);
  assert.match(guide, /deploy/);
  assert.match(guide, /rollback --json --progress/);
  assert.match(guide, /remote_cleanup=ok/);
  assert.match(guide, /SSH_RELEASE_KEEP_LOCAL_ON_FAILURE/);
  assert.match(guide, /不要使用生产路径/);
  assert.match(guide, /传输类 SSH\/SCP 错误会自动重试/);
  assert.match(readme, /docs\/dogfood\.md/);
  assert.match(releaseChecklist, /docs\/dogfood\.md/);
  assert.doesNotMatch(`${guide}\n${readme}\n${releaseChecklist}`, sensitivePattern);
});
