import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { deploy } from '../src/release.js';
import type { RemoteClient } from '../src/ssh.js';
import type { SshReleaseConfig } from '../src/types.js';

class FakeRemoteClient implements RemoteClient {
  commands: string[] = [];
  uploadedFiles: Array<{ localPath: string; remotePath: string; content?: string }> = [];
  uploadedDirectories: Array<{ localPath: string; remotePath: string; exclude: string[] }> = [];
  releases = ['20260625-120000', '20260625-121000', '20260625-122000'];
  currentVersion = '20260625-122000';
  failTar = false;
  lockExists = false;
  keepStaleCurrent = false;
  existingReleaseDirs = new Set<string>();

  async exec(command: string): Promise<{ stdout: string; stderr: string }> {
    this.commands.push(command);

    const existsMatch = command.match(/^test -e '([^']+)' && echo exists \|\| true$/);
    if (existsMatch) {
      return {
        stdout: this.existingReleaseDirs.has(existsMatch[1]) ? 'exists\n' : '',
        stderr: '',
      };
    }

    if (command.includes("mkdir '/var/www/site/.ssh-release.lock'")) {
      this.lockExists = true;
    }

    if (command.includes("rm -rf '/var/www/site/.ssh-release.lock'")) {
      this.lockExists = false;
    }

    const symlinkMatch = command.match(/ln -sfn 'releases\/([^']+)' '\/var\/www\/site\/current'/);
    if (symlinkMatch && !this.keepStaleCurrent) {
      this.currentVersion = symlinkMatch[1];
    }

    if (command.includes('tar -xzf') && this.failTar) {
      throw new Error('tar failed');
    }

    if (command.includes("if [ -d '/var/www/site/.ssh-release.lock' ]")) {
      return { stdout: this.lockExists ? 'locked\npid=123\ncreated_at=2026-06-25T00:00:00Z\n' : 'unlocked\n', stderr: '' };
    }

    if (command.includes("test -d '/var/www/site/releases/")) {
      return { stdout: '', stderr: '' };
    }

    if (command.includes("test -d '/var/www/site'")) {
      return { stdout: '', stderr: '' };
    }

    if (command.includes("test -f '/var/www/site/") && command.includes('manifest.json')) {
      return { stdout: '', stderr: '' };
    }

    if (command.includes('manifest.json') && (command.includes('sha256sum') || command.includes('shasum'))) {
      const manifestPath = command.match(/'([^']*manifest\.json)'/)?.[1];
      const uploadedManifest = this.uploadedFiles.find((file) => file.remotePath === manifestPath);

      if (!uploadedManifest) {
        throw new Error('manifest missing');
      }

      const manifestBuffer = Buffer.from(uploadedManifest.content ?? '');
      return {
        stdout: `${createHash('sha256').update(manifestBuffer).digest('hex')}\n`,
        stderr: '',
      };
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
    if (remotePath.endsWith('/manifest.json')) {
      this.uploadedFiles.push({
        localPath,
        remotePath,
        content: await readFile(localPath, 'utf8'),
      });
      return;
    }

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
  assert.deepEqual(client.uploadedFiles.map((file) => file.remotePath), [
    '/var/www/site/.ssh-release-tmp/20260625-153000.tgz',
    '/var/www/site/releases/20260625-153000/manifest.json',
  ]);
  assert.equal(client.uploadedFiles[0].localPath, path.join(sourcePath, 'release.tgz'));
  assert.match(client.uploadedFiles[1].localPath, /manifest\.json$/);
  assert.deepEqual(client.uploadedFiles.slice(0, 1), [
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

test('appends a numeric suffix when the release directory already exists', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();
  client.existingReleaseDirs.add('/var/www/site/releases/20260625-153000');

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:30:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.version, '20260625-153000-2');
  assert.equal(result.targetPath, '/var/www/site/releases/20260625-153000-2');
  assert.equal(result.manifest?.remotePath, '/var/www/site/releases/20260625-153000-2/manifest.json');
  assert.ok(client.commands.some((command) => command.includes("ln -sfn 'releases/20260625-153000-2' '/var/www/site/current'")));
});

test('uploads a release manifest and verifies it after deploy', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:30:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.manifest?.remotePath, '/var/www/site/releases/20260625-153000/manifest.json');
  assert.equal(result.manifest?.fileCount, 1);
  assert.equal(result.manifest?.totalBytes, Buffer.byteLength('<h1>ok</h1>'));
  assert.match(result.manifest?.sha256 ?? '', /^[a-f0-9]{64}$/);

  const manifestUpload = client.uploadedFiles.find((file) => file.remotePath === result.manifest?.remotePath);
  assert.ok(manifestUpload);

  const manifest = JSON.parse(manifestUpload.content ?? '') as {
    version: string;
    createdAt: string;
    files: Array<{ path: string; size: number; sha256: string }>;
  };

  assert.equal(manifest.version, '20260625-153000');
  assert.equal(manifest.createdAt, '2026-06-25T07:30:00.000Z');
  assert.deepEqual(manifest.files, [
    {
      path: 'index.html',
      size: Buffer.byteLength('<h1>ok</h1>'),
      sha256: createHash('sha256').update('<h1>ok</h1>').digest('hex'),
    },
  ]);
  assert.ok(result.verification?.some((check) => check.name === '发布清单'));
  assert.ok(client.commands.some((command) => command.includes("test -f '/var/www/site/releases/20260625-153000/manifest.json'")));
});

test('verifies release target, current symlink, and lock cleanup after deploy', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:30:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.verified, true);
  assert.deepEqual(result.verification, [
    {
      name: '版本目录',
      status: 'pass',
      message: '远端版本目录存在',
    },
    {
      name: '当前版本',
      status: 'pass',
      message: 'current 已指向新版本',
    },
    {
      name: '发布清单',
      status: 'pass',
      message: 'manifest.json 已上传并校验，文件数 1',
    },
    {
      name: '远端锁',
      status: 'pass',
      message: '发布锁已清理',
    },
  ]);
  assert.ok(client.commands.some((command) => command.includes("test -d '/var/www/site/releases/20260625-153000'")));
  assert.ok(client.commands.some((command) => command.includes("readlink '/var/www/site/current'")));
  assert.ok(client.commands.some((command) => command.includes("if [ -d '/var/www/site/.ssh-release.lock' ]")));
});

test('fails deploy when release verification sees a stale current symlink', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();
  client.keepStaleCurrent = true;

  await assert.rejects(
    () => deploy(config, client, {
      now: new Date('2026-06-25T15:30:00+08:00'),
      createPackage: async () => ({
        archivePath: path.join(sourcePath, 'release.tgz'),
        cleanup: async () => {},
      }),
    }),
    /current 未指向新版本/,
  );
  assert.ok(client.commands.some((command) => command.includes("readlink '/var/www/site/current'")));
});

test('emits deploy progress events for release stages', async () => {
  const { config, sourcePath } = await createConfig();
  const client = new FakeRemoteClient();
  const progressEvents: Array<{ stage: string; status: string }> = [];

  await deploy(config, client, {
    now: new Date('2026-06-25T15:30:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
    onProgress: (event) => {
      progressEvents.push(event);
    },
  });

  assert.deepEqual(progressEvents, [
    { stage: 'source', status: 'start' },
    { stage: 'source', status: 'success' },
    { stage: 'lock', status: 'start' },
    { stage: 'lock', status: 'success' },
    { stage: 'package', status: 'start' },
    { stage: 'package', status: 'success' },
    { stage: 'publish', status: 'start' },
    { stage: 'publish', status: 'success' },
    { stage: 'cleanup', status: 'start' },
    { stage: 'cleanup', status: 'success' },
  ]);
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

test('verifies overwrite target and lock cleanup after deploy', async () => {
  const { config, sourcePath } = await createConfig({ mode: 'overwrite' });
  const client = new FakeRemoteClient();

  const result = await deploy(config, client, {
    now: new Date('2026-06-25T15:32:00+08:00'),
    createPackage: async () => ({
      archivePath: path.join(sourcePath, 'release.tgz'),
      cleanup: async () => {},
    }),
  });

  assert.equal(result.verified, true);
  assert.deepEqual(result.verification, [
    {
      name: '目标目录',
      status: 'pass',
      message: '远端目标目录存在',
    },
    {
      name: '发布清单',
      status: 'pass',
      message: 'manifest.json 已上传并校验，文件数 1',
    },
    {
      name: '远端锁',
      status: 'pass',
      message: '发布锁已清理',
    },
  ]);
  assert.ok(client.commands.some((command) => command.includes("test -d '/var/www/site'")));
  assert.ok(client.commands.some((command) => command.includes("if [ -d '/var/www/site/.ssh-release.lock' ]")));
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
