import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { isCliEntrypoint, runCli, type DeployCliOptions } from '../src/cli.js';

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
          warnings: [],
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
      unlock: async () => {
        calls.push('unlock');
        return {
          locked: false,
          removed: false,
          lockPath: '/var/www/site/.ssh-release.lock',
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

test('dispatches unlock with an explicit confirm path and prints safe guidance', async () => {
  const stdout: string[] = [];
  const receivedOptions: unknown[] = [];
  const base = {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      unlock: async (options?: unknown) => {
        receivedOptions.push(options);
        return {
          locked: true,
          removed: false,
          lockPath: '/var/www/site/.ssh-release.lock',
          pid: '12345',
          createdAt: '2026-06-25T13:30:00Z',
        };
      },
    },
  } as Parameters<typeof runCli>[1];

  assert.equal(await runCli(['unlock'], base), 1);
  assert.equal(stdout.includes('发现远端锁: /var/www/site/.ssh-release.lock'), true);
  assert.equal(stdout.includes('不会自动删除远端锁'), true);
  assert.equal(stdout.includes('确认没有发布或回滚任务后再执行:'), true);
  assert.equal(stdout.includes('ssh-release unlock --confirm /var/www/site/.ssh-release.lock'), true);

  stdout.length = 0;
  assert.equal(await runCli(['unlock', '--confirm', '/var/www/site/.ssh-release.lock'], {
    ...base,
    handlers: {
      ...createFailingHandlers(),
      unlock: async (options?: unknown) => {
        receivedOptions.push(options);
        return {
          locked: true,
          removed: true,
          lockPath: '/var/www/site/.ssh-release.lock',
        };
      },
    },
  } as Parameters<typeof runCli>[1]), 0);

  assert.deepEqual(receivedOptions, [
    { confirmPath: undefined },
    { confirmPath: '/var/www/site/.ssh-release.lock' },
  ]);
  assert.equal(stdout.includes('已删除远端锁: /var/www/site/.ssh-release.lock'), true);
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

test('prints command results as a single json object', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['deploy', '--dry-run', '--json'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async () => ({
        dryRun: true as const,
        mode: 'release' as const,
        version: '20260625-180000',
        sourcePath: './dist',
        targetPath: '/var/www/site/releases/20260625-180000',
        currentSymlink: '/var/www/site/current',
      }),
    },
  }), 0);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: true,
    command: 'deploy',
    result: {
      dryRun: true,
      mode: 'release',
      version: '20260625-180000',
      sourcePath: './dist',
      targetPath: '/var/www/site/releases/20260625-180000',
      currentSymlink: '/var/www/site/current',
    },
  });
  assert.deepEqual(stderr, []);
});

test('prints non-zero command results as json without human text', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['unlock', '--json'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      unlock: async () => ({
        locked: true,
        removed: false,
        lockPath: '/var/www/site/.ssh-release.lock',
        pid: '12345',
      }),
    },
  }), 1);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: false,
    command: 'unlock',
    result: {
      locked: true,
      removed: false,
      lockPath: '/var/www/site/.ssh-release.lock',
      pid: '12345',
    },
  });
  assert.deepEqual(stderr, []);
});

test('prints command failures as json errors', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['deploy', '--json'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async () => {
        throw new Error('deploy failed');
      },
    },
  }), 1);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: false,
    command: 'deploy',
    error: 'deploy failed',
  });
  assert.deepEqual(stderr, []);
});

test('prints deploy progress as ndjson before the final json result', async () => {
  const stdout: string[] = [];

  assert.equal(await runCli(['deploy', '--json', '--progress'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async (options?: DeployCliOptions) => {
        options?.onProgress?.({ stage: 'package', status: 'start' });
        options?.onProgress?.({ stage: 'package', status: 'success' });
        return {
          mode: 'release' as const,
          version: '20260625-180000',
          targetPath: '/var/www/site/releases/20260625-180000',
          currentSymlink: '/var/www/site/current',
          usedFallback: false,
          warnings: [],
        };
      },
    },
  }), 0);

  assert.equal(stdout.length, 3);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: true,
    command: 'deploy',
    event: 'progress',
    stage: 'package',
    status: 'start',
  });
  assert.deepEqual(JSON.parse(stdout[1]), {
    ok: true,
    command: 'deploy',
    event: 'progress',
    stage: 'package',
    status: 'success',
  });
  assert.equal(JSON.parse(stdout[2]).result.version, '20260625-180000');
});

test('prints remote verification status after deploy succeeds', async () => {
  const stdout: string[] = [];

  assert.equal(await runCli(['deploy'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async () => ({
        mode: 'release' as const,
        version: '20260625-180000',
        targetPath: '/var/www/site/releases/20260625-180000',
        currentSymlink: '/var/www/site/current',
        usedFallback: false,
        verified: true,
        verification: [
          {
            name: '当前版本',
            status: 'pass' as const,
            message: 'current 已指向新版本',
          },
        ],
        warnings: [],
      }),
    },
  }), 0);

  assert.equal(stdout.includes('远端校验通过'), true);
  assert.equal(stdout.includes('校验: 当前版本 - current 已指向新版本'), true);
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
    unlock: async () => {
      throw new Error('unexpected unlock');
    },
  };
}
