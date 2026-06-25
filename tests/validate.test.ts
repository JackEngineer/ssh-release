import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeConfig, validateTargetPath } from '../src/validate.js';
import type { SshReleaseConfigInput } from '../src/types.js';

const baseConfig: SshReleaseConfigInput = {
  source: {
    path: './dist',
  },
  server: {
    host: 'example.com',
    username: 'deploy',
    privateKeyPath: '~/.ssh/id_rsa',
  },
  target: {
    path: '/var/www/my-app',
  },
};

test('fills documented defaults for optional config fields', () => {
  const config = normalizeConfig(baseConfig);

  assert.deepEqual(config.source.exclude, []);
  assert.equal(config.server.port, 22);
  assert.equal(config.target.currentSymlink, 'current');
  assert.equal(config.target.releasesDir, 'releases');
  assert.equal(config.target.tempDir, '.ssh-release-tmp');
  assert.equal(config.deploy.mode, 'release');
  assert.equal(config.deploy.keepReleases, 5);
  assert.equal(config.deploy.compression, 'tgz');
  assert.equal(config.deploy.preferTar, true);
  assert.equal(config.deploy.fallbackToFileUpload, true);
});

test('rejects dangerous top-level remote target paths', () => {
  assert.throws(
    () => validateTargetPath('/var'),
    /危险远程路径/,
  );

  assert.throws(
    () => validateTargetPath('/'),
    /危险远程路径/,
  );
});

test('allows child directories under dangerous parent paths', () => {
  assert.equal(validateTargetPath('/var/www/my-app'), '/var/www/my-app');
  assert.equal(validateTargetPath('/opt/apps/site'), '/opt/apps/site');
});

test('rejects invalid deploy mode and compression', () => {
  assert.throws(
    () => normalizeConfig({
      ...baseConfig,
      deploy: {
        mode: 'mirror',
      },
    }),
    /deploy.mode/,
  );

  assert.throws(
    () => normalizeConfig({
      ...baseConfig,
      deploy: {
        compression: 'zip',
      },
    }),
    /deploy.compression/,
  );
});
