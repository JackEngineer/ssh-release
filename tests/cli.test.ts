import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { isCliEntrypoint, runCli } from '../src/cli.js';

test('prints help and version without running command handlers', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const handlers = createFailingHandlers();
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };

  assert.equal(await runCli(['--help'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers,
  }), 0);
  assert.equal(await runCli(['--version'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers,
  }), 0);

  assert.equal(stdout.some((line) => line.includes('ssh-release deploy --dry-run')), true);
  assert.equal(stdout.includes(packageJson.version), true);
  assert.deepEqual(stderr, []);
});

test('dispatches deploy, rollback, list, and doctor commands', async () => {
  const calls: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];

  const base = {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      init: async () => {
        calls.push('init');
      },
      deploy: async () => {
        calls.push('deploy');
        return {
          mode: 'release' as const,
          version: '20260625-153000',
          targetPath: '/var/www/site/releases/20260625-153000',
          currentSymlink: '/var/www/site/current',
          usedFallback: false,
          warnings: [],
        };
      },
      rollback: async (version?: string) => {
        calls.push(`rollback:${version ?? ''}`);
        return {
          version: version ?? '20260625-150000',
          currentSymlink: '/var/www/site/current',
        };
      },
      list: async () => {
        calls.push('list');
        return {
          mode: 'release' as const,
          targetPath: '/var/www/site',
          currentVersion: '20260625-153000',
          releases: [],
        };
      },
      doctor: async () => {
        calls.push('doctor');
        return {
          ok: true,
          checks: [],
        };
      },
    },
  };

  assert.equal(await runCli(['deploy'], base), 0);
  assert.equal(await runCli(['rollback', '20260625-120000'], base), 0);
  assert.equal(await runCli(['list'], base), 0);
  assert.equal(await runCli(['doctor'], base), 0);

  assert.deepEqual(calls, [
    'deploy',
    'rollback:20260625-120000',
    'list',
    'doctor',
  ]);
  assert.equal(stderr.length, 0);
  assert.equal(stdout.some((line) => line.includes('命令尚未实现')), false);
});

test('recognizes npm bin symlink as cli entrypoint', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-cli-'));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });
  const realEntry = join(tempDir, 'dist', 'cli.js');
  const binDir = join(tempDir, 'bin');
  const binEntry = join(binDir, 'ssh-release');

  await mkdir(join(tempDir, 'dist'));
  await mkdir(binDir);
  await writeFile(realEntry, '#!/usr/bin/env node\n');
  await symlink(realEntry, binEntry);

  assert.equal(isCliEntrypoint(pathToFileURL(realEntry).href, binEntry), true);
  assert.equal(isCliEntrypoint(pathToFileURL(join(tempDir, 'other.js')).href, binEntry), false);
});

test('init writes a custom config path', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-config-'));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });
  const configPath = join(tempDir, 'custom-release.config.ts');
  const stdout: string[] = [];

  assert.equal(await runCli(['init', '--config', configPath], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
  }), 0);

  const content = await readFile(configPath, 'utf8');
  assert.match(content, /export default/);
  assert.equal(stdout.includes(`已创建 ${configPath}`), true);
});

test('passes dry-run option to deploy handler and prints deploy plan', async () => {
  const stdout: string[] = [];
  const receivedOptions: unknown[] = [];

  assert.equal(await runCli(['deploy', '--dry-run'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async (options?: unknown) => {
        receivedOptions.push(options);
        return {
          dryRun: true as const,
          mode: 'release' as const,
          version: '20260625-180000',
          sourcePath: './dist',
          targetPath: '/var/www/site/releases/20260625-180000',
          currentSymlink: '/var/www/site/current',
        };
      },
    },
  }), 0);

  assert.deepEqual(receivedOptions, [{ dryRun: true }]);
  assert.equal(stdout.includes('发布预检通过，不会修改远程服务器'), true);
  assert.equal(stdout.includes('模式: release'), true);
  assert.equal(stdout.includes('源路径: ./dist'), true);
});

function createFailingHandlers() {
  return {
    init: async () => {
      throw new Error('unexpected init');
    },
    deploy: async () => {
      throw new Error('unexpected deploy');
    },
    rollback: async () => {
      throw new Error('unexpected rollback');
    },
    list: async () => {
      throw new Error('unexpected list');
    },
    doctor: async () => {
      throw new Error('unexpected doctor');
    },
  };
}
