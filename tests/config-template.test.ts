import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfigTemplate } from '../src/config.js';

test('creates config template without real secrets or hosts', () => {
  const template = createConfigTemplate();

  assert.match(template, /SSH_RELEASE_HOST/);
  assert.match(template, /SSH_RELEASE_USER/);
  assert.match(template, /SSH_RELEASE_PASSWORD/);
  assert.match(template, /privateKeyPath: '~\/\.ssh\/id_rsa'/);
  assert.doesNotMatch(template, /password:\s*['"`]/i);
  assert.doesNotMatch(template, /\b\d{1,3}(?:\.\d{1,3}){3}\b/);
});
