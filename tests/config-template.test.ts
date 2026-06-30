import assert from 'node:assert/strict';
import test from 'node:test';

import { createConfigTemplate, listConfigTemplateNames } from '../src/config.js';

test('creates config template without real secrets or hosts', () => {
  const template = createConfigTemplate();

  assert.match(template, /SSH_RELEASE_HOST/);
  assert.match(template, /SSH_RELEASE_USER/);
  assert.match(template, /SSH_RELEASE_PASSWORD/);
  assert.match(template, /privateKeyPath: '~\/\.ssh\/id_rsa'/);
  assert.doesNotMatch(template, /password:\s*['"`]/i);
  assert.doesNotMatch(template, /\b\d{1,3}(?:\.\d{1,3}){3}\b/);
});

test('creates named config templates for common release shapes', () => {
  assert.deepEqual(listConfigTemplateNames(), ['default', 'single-file', 'static-site']);

  const staticSite = createConfigTemplate('static-site');
  assert.match(staticSite, /path: '\.\/dist'/);
  assert.match(staticSite, /path: '\/var\/www\/example-static-site'/);
  assert.match(staticSite, /port: Number\(process\.env\.SSH_RELEASE_PORT \|\| 22\)/);
  assert.match(staticSite, /privateKeyPath: process\.env\.SSH_RELEASE_PRIVATE_KEY_PATH/);

  const singleFile = createConfigTemplate('single-file');
  assert.match(singleFile, /path: '\.\/dist\/app\.tar\.gz'/);
  assert.match(singleFile, /path: '\/var\/www\/example-artifacts'/);
  assert.match(singleFile, /exclude: \[\]/);
  assert.match(singleFile, /keepReleases: 10/);
});
