import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('publishes npm packages through trusted publishing without long-lived tokens', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8',
  );
  const checklist = await readFile(
    new URL('../docs/release-checklist.md', import.meta.url),
    'utf8',
  );
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(workflow, /tags:\n\s+- 'v\*'/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: '24'/);
  assert.match(workflow, /registry-url: 'https:\/\/registry\.npmjs\.org'/);
  assert.match(workflow, /package-manager-cache: false/);
  assert.match(workflow, /TAG_VERSION="\$\{GITHUB_REF_NAME#v\}"/);
  assert.match(workflow, /npm run prepublishOnly/);
  assert.match(workflow, /npm publish --dry-run/);
  assert.match(workflow, /npm publish/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);

  assert.match(checklist, /Trusted Publisher/);
  assert.match(checklist, /workflow 文件为 `publish\.yml`/);
  assert.match(checklist, /OIDC/);
  assert.match(checklist, /不需要 `NPM_TOKEN`/);
  assert.match(readme, /\.github\/workflows\/publish\.yml/);
});
