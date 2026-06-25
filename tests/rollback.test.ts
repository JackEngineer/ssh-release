import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { rollback, selectRollbackTarget } from '../src/rollback.js';
import type { RemoteClient } from '../src/ssh.js';
import type { SshReleaseConfig } from '../src/types.js';

const releases = [
  '20260625-120000',
  '20260625-121000',
  '20260625-122000',
];

test('selects previous release by default', () => {
  assert.equal(
    selectRollbackTarget({
      releases,
      currentVersion: '20260625-122000',
    }),
    '20260625-121000',
  );
});

test('selects requested rollback release when it exists', () => {
  assert.equal(
    selectRollbackTarget({
      releases,
      currentVersion: '20260625-122000',
      requestedVersion: '20260625-120000',
    }),
    '20260625-120000',
  );
});

test('rejects missing rollback target', () => {
  assert.throws(
    () => selectRollbackTarget({
      releases,
      currentVersion: '20260625-122000',
      requestedVersion: '20260625-090000',
    }),
    /回滚目标不存在/,
  );
});

test('rolls back to the previous remote release by switching current symlink', async () => {
  const client = new FakeRemoteClient();

  const result = await rollback(createConfig(), client);

  assert.equal(result.version, '20260625-121000');
  assert.equal(result.warnings.length, 0);
  assert.equal(client.commands[0].includes('/var/www/site/.ssh-release.lock'), true);
  assert.ok(client.commands.some((command) => command.includes("ln -sfn 'releases/20260625-121000' '/var/www/site/current'")));
  assert.equal(client.commands.at(-1), "rm -rf '/var/www/site/.ssh-release.lock'");
  assert.equal(client.commands.some((command) => command.includes("rm -rf '/var/www/site/releases")), false);
});

test('rejects rollback in overwrite mode before touching remote state', async () => {
  const client = new FakeRemoteClient();

  await assert.rejects(
    () => rollback(createConfig({ mode: 'overwrite' }), client),
    /overwrite 模式不支持回滚/,
  );
  assert.deepEqual(client.commands, []);
});

test('stops rollback before reading remote state when the remote lock exists', async () => {
  const client = new FakeRemoteClient();
  client.failLock = true;

  await assert.rejects(
    () => rollback(createConfig(), client),
    /远程已有发布任务正在运行/,
  );
  assert.equal(client.commands.length, 1);
  assert.equal(client.commands[0].includes('/var/www/site/.ssh-release.lock'), true);
  assert.equal(client.commands.some((command) => command.includes('for release_path in')), false);
  assert.equal(client.commands.some((command) => command.includes('readlink')), false);
});

class FakeRemoteClient implements RemoteClient {
  commands: string[] = [];
  failLock = false;

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.commands.push(command);

    if (this.failLock && command.includes('/var/www/site/.ssh-release.lock')) {
      throw new Error('远程已有发布任务正在运行');
    }

    if (command.includes('for release_path in')) {
      return { stdout: `${releases.join('\n')}\n`, stderr: '' };
    }

    if (command.includes('readlink')) {
      return { stdout: 'releases/20260625-122000\n', stderr: '' };
    }

    return { stdout: '', stderr: '' };
  }

  async uploadFile(): Promise<void> {}

  async uploadDirectory(): Promise<void> {}
}

function createConfig(overrides: { mode?: 'release' | 'overwrite' } = {}): SshReleaseConfig {
  return {
    source: {
      path: './dist',
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
