import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sensitivePattern = new RegExp([
  ['47', '114', '97', '21'].join('\\.'),
  ['xiao', 'mao', '1994'].join(''),
  'npm_[A-Za-z0-9]{20,}',
].join('|'));

test('keeps ssh-release publishing skill project-local and scoped to this repository', async () => {
  const skill = await readFile(
    new URL('../.codex/skills/publishing-ssh-release/SKILL.md', import.meta.url),
    'utf8',
  );
  const metadata = await readFile(
    new URL('../.codex/skills/publishing-ssh-release/agents/openai.yaml', import.meta.url),
    'utf8',
  );

  assert.match(skill, /name: publishing-ssh-release/);
  assert.match(skill, /project-local skill/);
  assert.match(skill, /this ssh-release repository/);
  assert.match(skill, /npm run release:preflight/);
  assert.match(skill, /npm run release:postcheck -- <version>/);
  assert.match(skill, /Do not create tags, push tags, publish npm, or create GitHub Releases unless the user explicitly approves/);
  assert.match(metadata, /发布 ssh-release/);
  assert.doesNotMatch(`${skill}\n${metadata}`, /\/Users\/jacklee\/\.codex\/skills/);
  assert.doesNotMatch(`${skill}\n${metadata}`, sensitivePattern);
});
