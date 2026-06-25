import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { unlock } from '../src/unlock.js';
import type { RemoteClient } from '../src/ssh.js';
import type { SshReleaseConfig } from '../src/types.js';

test('reports a remote lock without removing it when confirm path is missing', async () => {
  const client = new FakeRemoteClient({
    pid: '12345',
    createdAt: '2026-06-25T13:30:00Z',
  });

  const result = await unlock(createConfig(), client);

  assert.deepEqual(result, {
    locked: true,
    removed: false,
    lockPath: '/var/www/site/.ssh-release.lock',
    pid: '12345',
    createdAt: '2026-06-25T13:30:00Z',
  });
  assert.equal(client.commands.some((command) => command.includes('rm -rf')), false);
});

test('removes a remote lock only when confirm path matches', async () => {
  const client = new FakeRemoteClient({
    pid: '12345',
    createdAt: '2026-06-25T13:30:00Z',
  });

  const result = await unlock(createConfig(), client, {
    confirmPath: '/var/www/site/.ssh-release.lock',
  });

  assert.equal(result.locked, true);
  assert.equal(result.removed, true);
  assert.equal(client.lockInfo, undefined);
  assert.equal(client.commands.at(-1), "rm -rf '/var/www/site/.ssh-release.lock'");
});

test('rejects a mismatched confirm path before removing a lock', async () => {
  const client = new FakeRemoteClient({
    pid: '12345',
    createdAt: '2026-06-25T13:30:00Z',
  });

  await assert.rejects(
    () => unlock(createConfig(), client, {
      confirmPath: '/var/www/other/.ssh-release.lock',
    }),
    /确认路径不匹配/,
  );
  assert.equal(client.lockInfo?.pid, '12345');
  assert.equal(client.commands.some((command) => command.includes('rm -rf')), false);
});

class FakeRemoteClient implements RemoteClient {
  commands: string[] = [];

  constructor(public lockInfo: { pid?: string; createdAt?: string } | undefined) {}

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.commands.push(command);

    if (command.includes('rm -rf')) {
      this.lockInfo = undefined;
      return { stdout: '', stderr: '' };
    }

    if (!this.lockInfo) {
      return { stdout: 'unlocked\n', stderr: '' };
    }

    return {
      stdout: `locked\npid=${this.lockInfo.pid ?? ''}\ncreated_at=${this.lockInfo.createdAt ?? ''}\n`,
      stderr: '',
    };
  }

  async uploadFile(): Promise<void> {}

  async uploadDirectory(): Promise<void> {}
}

function createConfig(): SshReleaseConfig {
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
      mode: 'release',
      keepReleases: 5,
      compression: 'tgz',
      preferTar: true,
      fallbackToFileUpload: true,
    },
  };
}
