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
  hashAvailable = true;
  lockInfo: { pid?: string; createdAt?: string } | undefined;

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.commands.push(command);

    if (command.includes('/var/www/site/.ssh-release.lock')) {
      if (!this.lockInfo) {
        return { stdout: 'unlocked\n', stderr: '' };
      }

      return {
        stdout: `locked\npid=${this.lockInfo.pid ?? ''}\ncreated_at=${this.lockInfo.createdAt ?? ''}\n`,
        stderr: '',
      };
    }

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

    if (command.includes('sha256sum') || command.includes('shasum')) {
      if (!this.hashAvailable) {
        throw new Error('remote hash command missing');
      }

      return { stdout: '/usr/bin/sha256sum\n', stderr: '' };
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
  const report = await runDoctor(createConfig({ sourcePath }), client, {
    configPath,
    localCommandExists: async () => true,
  });

  assert.equal(report.ok, true);
  assert.deepEqual(
    report.checks.map((check) => [check.name, check.status]),
    [
      ['配置文件', 'pass'],
      ['配置字段', 'pass'],
      ['本地源路径', 'pass'],
      ['本地 tar', 'pass'],
      ['本地 ssh', 'pass'],
      ['本地 scp', 'pass'],
      ['SSH 连接', 'pass'],
      ['远程目录', 'pass'],
      ['远端 hash', 'pass'],
      ['远端锁', 'pass'],
      ['远端 tar', 'pass'],
    ],
  );
  assert.equal(
    report.checks.find((check) => check.name === '远端锁')?.message,
    '没有发现发布或回滚锁',
  );
  assert.ok(client.commands.some((command) => command.includes('command -v tar')));
  assert.ok(client.commands.some((command) => command.includes('sha256sum')));
});

test('doctor warns when remote lock exists and prints safe cleanup guidance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-doctor-lock-'));
  const sourcePath = path.join(root, 'dist');
  const configPath = path.join(root, 'ssh-release.config.ts');
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(configPath, 'export default {};');

  const client = new FakeRemoteClient();
  client.lockInfo = {
    pid: '12345',
    createdAt: '2026-06-25T13:20:00Z',
  };

  const report = await runDoctor(createConfig({ sourcePath }), client, {
    configPath,
    localCommandExists: async () => true,
  });
  const lockCheck = report.checks.find((check) => check.name === '远端锁');

  assert.equal(report.ok, true);
  assert.equal(lockCheck?.status, 'warn');
  assert.equal(lockCheck?.message.includes('/var/www/site/.ssh-release.lock'), true);
  assert.equal(lockCheck?.message.includes('pid: 12345'), true);
  assert.equal(lockCheck?.message.includes('创建时间: 2026-06-25T13:20:00Z'), true);
  assert.equal(lockCheck?.message.includes('确认没有发布或回滚任务后'), true);
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

  const report = await runDoctor(createConfig({ sourcePath }), client, {
    configPath,
    localCommandExists: async () => true,
  });

  assert.equal(report.ok, true);
  assert.equal(report.checks.at(-1)?.status, 'warn');
});

test('doctor fails before remote checks when password auth needs missing sshpass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-doctor-local-'));
  const sourcePath = path.join(root, 'dist');
  const configPath = path.join(root, 'ssh-release.config.ts');
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(configPath, 'export default {};');

  const client = new FakeRemoteClient();
  const report = await runDoctor(
    createConfig({ sourcePath, password: 'secret-password', privateKeyPath: undefined }),
    client,
    {
      configPath,
      localCommandExists: async (command) => command !== 'sshpass',
    },
  );
  const sshpassCheck = report.checks.find((check) => check.name === '本地 sshpass');

  assert.equal(report.ok, false);
  assert.equal(sshpassCheck?.status, 'fail');
  assert.equal(
    sshpassCheck?.message,
    '本地 sshpass 不可用；密码登录需要安装 sshpass，或改用私钥登录',
  );
  assert.deepEqual(client.commands, []);
});

test('doctor fails when remote hash command is unavailable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-doctor-hash-'));
  const sourcePath = path.join(root, 'dist');
  const configPath = path.join(root, 'ssh-release.config.ts');
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await writeFile(configPath, 'export default {};');

  const client = new FakeRemoteClient();
  client.hashAvailable = false;

  const report = await runDoctor(createConfig({ sourcePath }), client, {
    configPath,
    localCommandExists: async () => true,
  });
  const hashCheck = report.checks.find((check) => check.name === '远端 hash');

  assert.equal(report.ok, false);
  assert.equal(hashCheck?.status, 'fail');
  assert.equal(hashCheck?.message, 'remote hash command missing');
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
  password?: string;
  privateKeyPath?: string;
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
      privateKeyPath: 'privateKeyPath' in overrides
        ? overrides.privateKeyPath
        : path.join(os.homedir(), '.ssh/id_rsa'),
      password: overrides.password,
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
