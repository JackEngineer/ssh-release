import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runDoctor, runDoctorFromFile } from '../src/doctor.js';
import { listReleases } from '../src/list.js';
import type { RemoteClient } from '../src/ssh.js';
import type { SshReleaseConfig } from '../src/types.js';

class FakeRemoteClient implements RemoteClient {
  commands: string[] = [];
  tarAvailable = true;

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.commands.push(command);

    if (command.includes('readlink')) {
      return { stdout: 'releases/20260625-121000\n', stderr: '' };
    }

    if (command.includes('printf')) {
      return {
        stdout: '20260625-120000\t1782360000\n20260625-121000\t1782360600\n',
        stderr: '',
      };
    }

    if (command.includes('command -v tar')) {
      if (!this.tarAvailable) {
        throw new Error('tar missing');
      }

      return { stdout: '/usr/bin/tar\n', stderr: '' };
    }

    return { stdout: '', stderr: '' };
  }

  async uploadFile(): Promise<void> {}

  async uploadDirectory(): Promise<void> {}
}

test('lists remote releases and marks the current version', async () => {
  const client = new FakeRemoteClient();
  const result = await listReleases(createConfig(), client);

  assert.equal(result.mode, 'release');
  assert.equal(result.currentVersion, '20260625-121000');
  assert.deepEqual(result.releases, [
    {
      version: '20260625-120000',
      modifiedAt: new Date(1782360000 * 1000),
      current: false,
    },
    {
      version: '20260625-121000',
      modifiedAt: new Date(1782360600 * 1000),
      current: true,
    },
  ]);
});

test('list reports overwrite mode without remote version lookup', async () => {
  const client = new FakeRemoteClient();
  const result = await listReleases(createConfig({ mode: 'overwrite' }), client);

  assert.equal(result.mode, 'overwrite');
  assert.deepEqual(result.releases, []);
  assert.deepEqual(client.commands, []);
});

test('doctor reports config, source, ssh, remote path, and tar checks', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-doctor-'));
  const sourcePath = path.join(root, 'dist');
  const configPath = path.join(root, 'ssh-release.config.ts');
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(configPath, 'export default {};');

  const client = new FakeRemoteClient();
  const report = await runDoctor(createConfig({ sourcePath }), client, { configPath });

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.checks.map((check) => [check.name, check.status]),
    [
      ['配置文件', 'pass'],
      ['配置字段', 'pass'],
      ['本地源路径', 'pass'],
      ['SSH 连接', 'pass'],
      ['远程目录', 'pass'],
      ['远端 tar', 'pass'],
    ],
  );
  assert.ok(client.commands.some((command) => command.includes('command -v tar')));
});

test('doctor warns when remote tar is unavailable but still allows fallback', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-doctor-tar-'));
  const sourcePath = path.join(root, 'dist');
  const configPath = path.join(root, 'ssh-release.config.ts');
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(configPath, 'export default {};');

  const client = new FakeRemoteClient();
  client.tarAvailable = false;

  const report = await runDoctor(createConfig({ sourcePath }), client, { configPath });

  assert.equal(report.ok, true);
  assert.equal(report.checks.at(-1)?.status, 'warn');
});

test('doctor reports a missing config file without creating a remote client', async () => {
  const missingPath = path.join(os.tmpdir(), 'ssh-release-missing-config.ts');

  const report = await runDoctorFromFile(missingPath, () => {
    throw new Error('remote client should not be created');
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.checks, [
    {
      name: '配置文件',
      status: 'fail',
      message: `配置文件不存在: ${missingPath}`,
    },
  ]);
});

function createConfig(overrides: {
  mode?: 'release' | 'overwrite';
  sourcePath?: string;
} = {}): SshReleaseConfig {
  return {
    source: {
      path: overrides.sourcePath ?? './dist',
      exclude: [],
    },
    server: {
      host: 'example.com',
      port: 22,
      username: 'deploy',
      privateKeyPath: path.join(os.homedir(), '.ssh/id_rsa'),
    },
    target: {
      path: '/var/www/site',
      currentSymlink: 'current',
      releasesDir: 'releases',
      tempDir: '.ssh-release-tmp',
    },
    deploy: {
      mode: overrides.mode ?? 'release',
      keepReleases: 5,
      compression: 'tgz',
      preferTar: true,
      fallbackToFileUpload: true,
    },
  };
}
