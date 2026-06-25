import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  deploy,
  createDeployPlan,
  createVersionName,
  selectReleasesToDelete,
} from '../src/release.js';
import type { RemoteClient } from '../src/ssh.js';
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

test('deploy uses a remote lock and releases it when packaging fails', async (t) => {
  const { config } = await createConfigFixture(t);
  const client = new FakeRemoteClient();
  let createPackageCalled = false;

  await assert.rejects(
    () => deploy(config, client, {
      now: new Date('2026-06-25T18:00:00+08:00'),
      createPackage: async () => {
        createPackageCalled = true;
        throw new Error('package failed');
      },
    }),
    /package failed/,
  );

  assert.equal(createPackageCalled, true);
  assert.equal(client.uploads.length, 0);
  assert.equal(client.execCommands[0].includes('mkdir'), true);
  assert.equal(client.execCommands[0].includes('/var/www/site/.ssh-release.lock'), true);
  assert.equal(client.execCommands.at(-1), "rm -rf '/var/www/site/.ssh-release.lock'");
});

test('deploy stops before packaging when the remote lock exists', async (t) => {
  const { config } = await createConfigFixture(t);
  const client = new FakeRemoteClient((command) => {
    if (command.includes('/var/www/site/.ssh-release.lock')) {
      throw new Error('远程已有发布任务正在运行');
    }

    return { stdout: '', stderr: '' };
  });
  let createPackageCalled = false;

  await assert.rejects(
    () => deploy(config, client, {
      createPackage: async () => {
        createPackageCalled = true;
        throw new Error('unexpected package');
      },
    }),
    /远程已有发布任务正在运行/,
  );

  assert.equal(createPackageCalled, false);
  assert.equal(client.uploads.length, 0);
  assert.equal(client.execCommands.length, 1);
});

async function createConfigFixture(t: TestContext): Promise<{
  config: SshReleaseConfig;
  sourcePath: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-fixture-'));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });
  const sourcePath = join(tempDir, 'dist');
  await mkdir(sourcePath);

  return {
    sourcePath,
    config: {
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
    },
  };
}

class FakeRemoteClient implements RemoteClient {
  readonly execCommands: string[] = [];
  readonly uploads: string[] = [];

  constructor(
    private readonly execHandler: (command: string) => Promise<{ stdout: string; stderr: string }> | { stdout: string; stderr: string } = () => ({
      stdout: '',
      stderr: '',
    }),
  ) {}

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.execCommands.push(command);
    return this.execHandler(command);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    this.uploads.push(`${localPath}:${remotePath}`);
  }

  async uploadDirectory(localPath: string, remotePath: string): Promise<void> {
    this.uploads.push(`${localPath}:${remotePath}`);
  }
}
