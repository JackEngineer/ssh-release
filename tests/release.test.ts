import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createDeployPlan,
  createVersionName,
  selectReleasesToDelete,
} from '../src/release.js';
import type { SshReleaseConfig } from '../src/types.js';

test('creates timestamp version names in yyyyMMdd-HHmmss format', () => {
  const date = new Date('2026-06-25T15:30:00+08:00');

  assert.equal(createVersionName(date), '20260625-153000');
});

test('selects old releases for cleanup while preserving current release', () => {
  const releases = [
    '20260625-120000',
    '20260625-121000',
    '20260625-122000',
    '20260625-123000',
  ];

  assert.deepEqual(
    selectReleasesToDelete(releases, '20260625-121000', 2),
    ['20260625-120000'],
  );
});

test('does not delete releases when keepReleases covers all versions', () => {
  assert.deepEqual(
    selectReleasesToDelete(['20260625-120000', '20260625-121000'], '20260625-121000', 5),
    [],
  );
});

test('creates a deploy dry-run plan without remote side effects', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-plan-'));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });
  const sourcePath = join(tempDir, 'dist');
  await mkdir(sourcePath);

  const config: SshReleaseConfig = {
    source: {
      path: sourcePath,
      exclude: [],
    },
    server: {
      host: 'example.com',
      port: 22,
      username: 'deploy',
      privateKeyPath: '/tmp/id_rsa',
    },
    target: {
      path: '/var/www/site',
      currentSymlink: 'current',
      releasesDir: 'releases',
      tempDir: '.ssh-release-tmp',
    },
    deploy: {
      mode: 'release',
      keepReleases: 5,
      compression: 'tgz',
      preferTar: true,
      fallbackToFileUpload: true,
    },
  };

  assert.deepEqual(await createDeployPlan(config, {
    now: new Date('2026-06-25T18:00:00+08:00'),
  }), {
    dryRun: true,
    mode: 'release',
    version: '20260625-180000',
    sourcePath,
    targetPath: '/var/www/site/releases/20260625-180000',
    currentSymlink: '/var/www/site/current',
  });
});
