import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deploy } from '../src/release.js';
import type { RemoteClient } from '../src/ssh.js';
import type { SshReleaseConfig } from '../src/types.js';

class FakeRemoteClient implements RemoteClient {
  commands: string[] = [];
  uploadedFiles: Array<{ localPath: string; remotePath: string }> = [];
  uploadedDirectories: Array<{ localPath: string; remotePath: string; exclude: string[] }> = [];
  releases = ['20260625-120000', '20260625-121000', '20260625-122000'];
  currentVersion = '20260625-122000';
  failTar = false;

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.commands.push(command);

    if (command.includes('tar -xzf') && this.failTar) {
      throw new Error('tar failed');
    }

    if (command.includes('for release_path in')) {
      return { stdout: `${this.releases.join('\n')}\n`, stderr: '' };
    }

    if (command.includes('readlink')) {
      return { stdout: `releases/${this.currentVersion}\n`, stderr: '' };
    }

    return { stdout: '', stderr: '' };
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    this.uploadedFiles.push({ localPath, remotePath });
  }

  async uploadDirectory(localPath: string, remotePath: string, exclude: string[]): Promise<void> {
    this.uploadedDirectories.push({ localPath, remotePath, exclude });
  }
}

test('deploys release mode with package upload, tar extraction, symlink switch, and cleanup', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:30:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.mode, 'release');
  assert.equal(result.version, '20260625-153000');
  assert.equal(result.usedFallback, false);
  assert.deepEqual(client.uploadedFiles, [
    {
      localPath: path.join(sourcePath, 'release.tgz'),
      remotePath: '/var/www/site/.ssh-release-tmp/20260625-153000.tgz',
    },
  ]);
  assert.equal(client.uploadedDirectories.length, 0);
  assert.ok(client.commands.some((command) => command.includes("tar -xzf '/var/www/site/.ssh-release-tmp/20260625-153000.tgz' -C '/var/www/site/releases/20260625-153000'")));
  assert.ok(client.commands.some((command) => command.includes("ln -sfn 'releases/20260625-153000' '/var/www/site/current'")));
  assert.ok(client.commands.some((command) => command.includes("rm -rf '/var/www/site/releases/20260625-120000'")));
});

test('falls back to directory upload when remote tar extraction fails', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();
  client.failTar = true;

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:31:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.usedFallback, true);
  assert.deepEqual(client.uploadedDirectories, [
    {
      localPath: sourcePath,
      remotePath: '/var/www/site/releases/20260625-153100',
      exclude: ['node_modules'],
    },
  ]);
  assert.ok(client.commands.some((command) => command.includes("rm -rf '/var/www/site/releases/20260625-153100'")));
  assert.ok(client.commands.some((command) => command.includes("ln -sfn 'releases/20260625-153100' '/var/www/site/current'")));
});

test('deploys overwrite mode without release directories or current symlink', async () => {
  const { config, sourcePath } = await createConfig({ mode: 'overwrite' });
  const client = new FakeRemoteClient();

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:32:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.mode, 'overwrite');
  assert.equal(result.version, undefined);
  assert.equal(result.targetPath, '/var/www/site');
  assert.ok(client.commands.some((command) => command.includes("tar -xzf '/var/www/site/.ssh-release-tmp/20260625-153200.tgz' -C '/var/www/site'")));
  assert.equal(client.commands.some((command) => command.includes('ln -sfn')), false);
});

test('overwrite fallback uploads files without deleting the whole target directory first', async () => {
  const { config, sourcePath } = await createConfig({ mode: 'overwrite' });
  const client = new FakeRemoteClient();
  client.failTar = true;

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:33:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.usedFallback, true);
  assert.equal(client.commands.some((command) => command.includes("rm -rf '/var/www/site'")), false);
  assert.deepEqual(client.uploadedDirectories, [
    {
      localPath: sourcePath,
      remotePath: '/var/www/site',
      exclude: ['node_modules'],
    },
  ]);
});

test('does not connect to remote when source path is missing', async () => {
  const { config } = await createConfig();
  config.source.path = path.join(os.tmpdir(), 'ssh-release-missing-source');
  const client = new FakeRemoteClient();

  await assert.rejects(
    () => deploy(config, client),
    /source.path 不存在/,
  );
  assert.deepEqual(client.commands, []);
});

async function createConfig(overrides: { mode?: 'release' | 'overwrite' } = {}): Promise<{
  config: SshReleaseConfig;
  sourcePath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ssh-release-deploy-'));
  const sourcePath = path.join(root, 'dist');
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, 'index.html'), '<h1>ok</h1>');
  await access(sourcePath);

  return {
    sourcePath,
    config: {
      source: {
        path: sourcePath,
        exclude: ['node_modules'],
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
        keepReleases: 3,
        compression: 'tgz',
        preferTar: true,
        fallbackToFileUpload: true,
      },
    },
  };
}
