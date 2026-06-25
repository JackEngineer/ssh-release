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
