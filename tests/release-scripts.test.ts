import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const sensitivePattern = new RegExp([
  ['47', '114', '97', '21'].join('\\.'),
  ['xiao', 'mao', '1994'].join(''),
  'npm_[A-Za-z0-9]{20,}',
].join('|'));

test('provides release preflight and postcheck scripts without automating irreversible release actions', async () => {
  const preflightUrl = new URL('../scripts/release-preflight.sh', import.meta.url);
  const postcheckUrl = new URL('../scripts/release-postcheck.sh', import.meta.url);
  const preflight = await readFile(preflightUrl, 'utf8');
  const postcheck = await readFile(postcheckUrl, 'utf8');

  await access(preflightUrl);
  await access(postcheckUrl);

  assert.match(preflight, /^set -euo pipefail/m);
  assert.match(preflight, /git status --short --branch/);
  assert.match(preflight, /package\.json/);
  assert.match(preflight, /package-lock\.json/);
  assert.match(preflight, /git tag --list "v\$VERSION"/);
  assert.match(preflight, /npm run prepublishOnly/);
  assert.match(preflight, /npm publish --dry-run --cache/);
  assert.match(preflight, /npm pack --pack-destination/);
  assert.match(preflight, /BIN="\$PACK_DIR\/prefix\/bin\/ssh-release"/);
  assert.match(preflight, /"\$BIN" --version/);
  assert.match(preflight, /init --template static-site/);
  assert.doesNotMatch(preflight, /npm publish(?! --dry-run)|git push|git tag -a|gh release create/);

  assert.match(postcheck, /^set -euo pipefail/m);
  assert.match(postcheck, /Usage: .*release-postcheck\.sh <version>/);
  assert.match(postcheck, /gh run list/);
  assert.match(postcheck, /gh run view/);
  assert.match(postcheck, /npm view ssh-release version dist-tags\.latest --json/);
  assert.match(postcheck, /npm install -g "ssh-release@\$VERSION"/);
  assert.match(postcheck, /BIN="\$PACK_DIR\/prefix\/bin\/ssh-release"/);
  assert.match(postcheck, /"\$BIN" --version/);
  assert.match(postcheck, /init --template static-site/);
  assert.match(postcheck, /gh release view "v\$VERSION"/);
  assert.doesNotMatch(postcheck, /npm publish(?! --dry-run)|git push|git tag -a|gh release create/);

  assert.doesNotMatch(`${preflight}\n${postcheck}`, sensitivePattern);
});
