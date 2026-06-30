import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  isCliEntrypoint,
  runCli,
  type DeployCliOptions,
  type RollbackCliOptions,
} from '../src/cli.js';

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

  assert.equal(stdout.some((line) => line.includes('ssh-release init [--template default|single-file|static-site]')), true);
  assert.equal(stdout.some((line) => line.includes('ssh-release init --interactive [--config <path>]')), true);
  assert.equal(stdout.some((line) => line.includes('ssh-release deploy --dry-run')), true);
  assert.equal(stdout.some((line) => line.includes('ssh-release deploy --plan')), true);
  assert.equal(stdout.some((line) => line.includes('ssh-release rollback [version] --dry-run')), true);
  assert.equal(stdout.some((line) => line.includes('ssh-release rollback [version] --plan')), true);
  assert.equal(stdout.some((line) => line.includes('模板:')), true);
  assert.equal(stdout.some((line) => line.includes('static-site: 发布 ./dist 静态站点目录')), true);
  assert.equal(stdout.some((line) => line.includes('首次接入推荐:')), true);
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
  assert.equal(stdout.includes('下一步:'), true);
  assert.equal(stdout.includes('1. 设置 SSH_RELEASE_HOST、SSH_RELEASE_USER，并选择密码或私钥认证。'), true);
  assert.equal(stdout.includes('2. 确认 source.path 和 target.path 指向要发布的本地目录和远端目录。'), true);
  assert.equal(stdout.includes(`3. 运行 ssh-release doctor --config ${configPath} 检查配置和服务器连接。`), true);
  assert.equal(stdout.includes(`4. 运行 ssh-release deploy --plan --config ${configPath} 预览发布计划。`), true);
});

test('init writes a named config template', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-template-'));
  t.after(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });
  const configPath = join(tempDir, 'static-site.config.ts');
  const stdout: string[] = [];

  assert.equal(await runCli(['init', '--template', 'static-site', '--config', configPath], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
  }), 0);

  const content = await readFile(configPath, 'utf8');
  assert.match(content, /path: '\.\/dist'/);
  assert.match(content, /path: '\/var\/www\/example-static-site'/);
  assert.equal(stdout.includes('已使用模板 static-site'), true);
});

test('init interactive writes answered config and GitHub Actions workflow', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-interactive-'));
  const previousCwd = process.cwd();
  t.after(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { force: true, recursive: true });
  });
  process.chdir(tempDir);

  const stdout: string[] = [];
  const stderr: string[] = [];
  const questions: string[] = [];
  const answers = [
    'single-file',
    './Build/App.tar.gz',
    '/var/www/My-Artifacts',
    'private-key',
    '~/.ssh/Deploy_Key',
    'yes',
  ];

  assert.equal(await runCli(['init', '--interactive'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
      prompt: async (question: string) => {
        questions.push(question);
        return answers.shift() ?? '';
      },
    },
  }), 0);

  const config = await readFile('ssh-release.config.ts', 'utf8');
  const workflow = await readFile('.github/workflows/ssh-release-deploy.yml', 'utf8');

  assert.equal(answers.length, 0);
  assert.equal(questions.some((question) => question.includes('发布内容类型')), true);
  assert.match(config, /path: '\.\/Build\/App\.tar\.gz'/);
  assert.match(config, /path: '\/var\/www\/My-Artifacts'/);
  assert.match(config, /privateKeyPath: process\.env\.SSH_RELEASE_PRIVATE_KEY_PATH \|\| '~\/\.ssh\/Deploy_Key'/);
  assert.doesNotMatch(config, /password:/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /SSH_RELEASE_PRIVATE_KEY: \$\{\{ secrets\.SSH_RELEASE_PRIVATE_KEY \}\}/);
  assert.match(workflow, /SSH_RELEASE_PRIVATE_KEY_PATH: ~\/\.ssh\/ssh-release/);
  assert.doesNotMatch(workflow, /SSH_RELEASE_PASSWORD/);
  assert.equal(stdout.includes('已创建 ssh-release.config.ts'), true);
  assert.equal(stdout.includes('已创建 .github/workflows/ssh-release-deploy.yml'), true);
  assert.deepEqual(stderr, []);
});

test('init interactive accepts defaults and password auth without workflow', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-interactive-default-'));
  const previousCwd = process.cwd();
  t.after(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { force: true, recursive: true });
  });
  process.chdir(tempDir);

  const stdout: string[] = [];
  const answers = ['', '', '', '', ''];

  assert.equal(await runCli(['init', '--interactive'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
      prompt: async () => answers.shift() ?? '',
    },
  }), 0);

  const config = await readFile('ssh-release.config.ts', 'utf8');

  assert.match(config, /path: '\.\/dist'/);
  assert.match(config, /path: '\/var\/www\/my-app'/);
  assert.match(config, /password: process\.env\.SSH_RELEASE_PASSWORD/);
  assert.doesNotMatch(config, /privateKeyPath:/);
  assert.equal(stdout.includes('已创建 .github/workflows/ssh-release-deploy.yml'), false);
});

test('init interactive rejects existing workflow without writing partial config', async (t) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'ssh-release-interactive-existing-workflow-'));
  const previousCwd = process.cwd();
  t.after(async () => {
    process.chdir(previousCwd);
    await rm(tempDir, { force: true, recursive: true });
  });
  process.chdir(tempDir);
  await mkdir('.github/workflows', { recursive: true });
  await writeFile('.github/workflows/ssh-release-deploy.yml', 'existing\n');

  const stdout: string[] = [];
  const stderr: string[] = [];
  const answers = ['', '', '', '', 'yes'];

  assert.equal(await runCli(['init', '--interactive'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
      prompt: async () => answers.shift() ?? '',
    },
  }), 1);

  await assert.rejects(readFile('ssh-release.config.ts', 'utf8'), /ENOENT/);
  assert.equal(await readFile('.github/workflows/ssh-release-deploy.yml', 'utf8'), 'existing\n');
  assert.equal(stdout.includes('已创建 ssh-release.config.ts'), false);
  assert.equal(stderr.includes('GitHub Actions workflow 已存在: .github/workflows/ssh-release-deploy.yml。请删除或改名后重试。'), true);
});

test('init rejects unknown config templates', async () => {
  const stderr: string[] = [];

  assert.equal(await runCli(['init', '--template', 'unknown'], {
    io: {
      log: () => undefined,
      error: (message: string) => stderr.push(message),
    },
  }), 1);

  assert.equal(stderr.includes('未知配置模板: unknown。可用模板: default, single-file, static-site'), true);
});

test('init rejects conflicting interactive options', async () => {
  const stderr: string[] = [];

  assert.equal(await runCli(['init', '--interactive', '--template', 'static-site'], {
    io: {
      log: () => undefined,
      error: (message: string) => stderr.push(message),
    },
  }), 1);
  assert.equal(await runCli(['deploy', '--interactive'], {
    io: {
      log: () => undefined,
      error: (message: string) => stderr.push(message),
    },
  }), 1);

  assert.equal(stderr.includes('--interactive 不能配合 --template 使用'), true);
  assert.equal(stderr.includes('--interactive 仅支持 init 命令'), true);
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
          upload: {
            sourcePath: './dist',
            archivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
            manifestPath: '/var/www/site/releases/20260625-180000/manifest.json',
            fileCount: 2,
            totalBytes: 120,
          },
          switch: {
            currentSymlink: '/var/www/site/current',
            target: 'releases/20260625-180000',
          },
          cleanup: {
            lockPath: '/var/www/site/.ssh-release.lock',
            tempArchivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
            keepReleases: 5,
            oldReleases: '发布成功后保留最新 5 个版本，并保留当前版本',
          },
          verification: [
            '版本目录存在',
            'current 指向新版本',
            'manifest.json hash 匹配',
            '远端锁已清理',
          ],
        };
      },
    },
  }), 0);

  assert.deepEqual(receivedOptions, [{ dryRun: true }]);
  assert.equal(stdout.includes('发布预检通过，不会修改远程服务器'), true);
  assert.equal(stdout.includes('模式: release'), true);
  assert.equal(stdout.includes('源路径: ./dist'), true);
  assert.equal(stdout.includes('计划上传: ./dist -> /var/www/site/.ssh-release-tmp/20260625-180000.tgz'), true);
  assert.equal(stdout.includes('计划清单: /var/www/site/releases/20260625-180000/manifest.json'), true);
  assert.equal(stdout.includes('计划切换: /var/www/site/current -> releases/20260625-180000'), true);
  assert.equal(stdout.includes('计划清理: /var/www/site/.ssh-release-tmp/20260625-180000.tgz'), true);
});

test('accepts deploy --plan as a dry-run preview alias', async () => {
  const receivedOptions: unknown[] = [];

  assert.equal(await runCli(['deploy', '--plan'], {
    io: {
      log: () => undefined,
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async (options?: unknown) => {
        receivedOptions.push(options);
        return {
          dryRun: true as const,
          mode: 'overwrite' as const,
          sourcePath: './dist',
          targetPath: '/var/www/site',
          upload: {
            sourcePath: './dist',
            archivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
            manifestPath: '/var/www/site/manifest.json',
            fileCount: 1,
            totalBytes: 10,
          },
          cleanup: {
            lockPath: '/var/www/site/.ssh-release.lock',
            tempArchivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
            keepReleases: 5,
            oldReleases: 'overwrite 模式不清理版本目录',
          },
          verification: [
            '目标目录存在',
            'manifest.json hash 匹配',
            '远端锁已清理',
          ],
        };
      },
    },
  }), 0);

  assert.deepEqual(receivedOptions, [{ dryRun: true }]);
});

test('passes dry-run option to rollback handler and prints rollback plan', async () => {
  const stdout: string[] = [];
  const receivedCalls: unknown[] = [];

  assert.equal(await runCli(['rollback', '20260625-120000', '--dry-run'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      rollback: async (version?: string, options?: RollbackCliOptions) => {
        receivedCalls.push({ version, options });
        return {
          dryRun: true as const,
          mode: 'release' as const,
          version: '20260625-120000',
          requestedVersion: '20260625-120000',
          currentVersion: '20260625-122000',
          targetPath: '/var/www/site/releases/20260625-120000',
          currentSymlink: '/var/www/site/current',
          switch: {
            currentSymlink: '/var/www/site/current',
            from: 'releases/20260625-122000',
            target: 'releases/20260625-120000',
          },
          cleanup: {
            lockPath: '/var/www/site/.ssh-release.lock',
            oldReleases: '回滚只切换 current，不删除任何版本目录',
          },
          verification: [
            '远端锁未占用',
            '目标版本目录存在',
            'current 将指向目标版本',
          ],
        };
      },
    },
  }), 0);

  assert.deepEqual(receivedCalls, [
    {
      version: '20260625-120000',
      options: { dryRun: true },
    },
  ]);
  assert.equal(stdout.includes('回滚预检通过，不会修改远程服务器'), true);
  assert.equal(stdout.includes('当前版本: 20260625-122000'), true);
  assert.equal(stdout.includes('目标版本: 20260625-120000'), true);
  assert.equal(stdout.includes('计划切换: /var/www/site/current: releases/20260625-122000 -> releases/20260625-120000'), true);
  assert.equal(stdout.includes('计划清理: 回滚只切换 current，不删除任何版本目录'), true);
  assert.equal(stdout.includes('计划校验: 远端锁未占用'), true);
});

test('accepts rollback --plan as a dry-run preview alias', async () => {
  const receivedCalls: unknown[] = [];

  assert.equal(await runCli(['rollback', '--plan'], {
    io: {
      log: () => undefined,
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      rollback: async (version?: string, options?: RollbackCliOptions) => {
        receivedCalls.push({ version, options });
        return {
          dryRun: true as const,
          mode: 'release' as const,
          version: '20260625-121000',
          currentVersion: '20260625-122000',
          targetPath: '/var/www/site/releases/20260625-121000',
          currentSymlink: '/var/www/site/current',
          switch: {
            currentSymlink: '/var/www/site/current',
            from: 'releases/20260625-122000',
            target: 'releases/20260625-121000',
          },
          cleanup: {
            lockPath: '/var/www/site/.ssh-release.lock',
            oldReleases: '回滚只切换 current，不删除任何版本目录',
          },
          verification: [
            '远端锁未占用',
            '目标版本目录存在',
            'current 将指向目标版本',
          ],
        };
      },
    },
  }), 0);

  assert.deepEqual(receivedCalls, [
    {
      version: undefined,
      options: { dryRun: true },
    },
  ]);
});

test('prints rollback plan as a single json object', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['rollback', '20260625-120000', '--plan', '--json'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      rollback: async () => ({
        dryRun: true as const,
        mode: 'release' as const,
        version: '20260625-120000',
        requestedVersion: '20260625-120000',
        currentVersion: '20260625-122000',
        targetPath: '/var/www/site/releases/20260625-120000',
        currentSymlink: '/var/www/site/current',
        switch: {
          currentSymlink: '/var/www/site/current',
          from: 'releases/20260625-122000',
          target: 'releases/20260625-120000',
        },
        cleanup: {
          lockPath: '/var/www/site/.ssh-release.lock',
          oldReleases: '回滚只切换 current，不删除任何版本目录',
        },
        verification: [
          '远端锁未占用',
          '目标版本目录存在',
          'current 将指向目标版本',
        ],
      }),
    },
  }), 0);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: true,
    command: 'rollback',
    result: {
      dryRun: true,
      mode: 'release',
      version: '20260625-120000',
      requestedVersion: '20260625-120000',
      currentVersion: '20260625-122000',
      targetPath: '/var/www/site/releases/20260625-120000',
      currentSymlink: '/var/www/site/current',
      switch: {
        currentSymlink: '/var/www/site/current',
        from: 'releases/20260625-122000',
        target: 'releases/20260625-120000',
      },
      cleanup: {
        lockPath: '/var/www/site/.ssh-release.lock',
        oldReleases: '回滚只切换 current，不删除任何版本目录',
      },
      verification: [
        '远端锁未占用',
        '目标版本目录存在',
        'current 将指向目标版本',
      ],
    },
  });
  assert.deepEqual(stderr, []);
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
        upload: {
          sourcePath: './dist',
          archivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
          manifestPath: '/var/www/site/releases/20260625-180000/manifest.json',
          fileCount: 2,
          totalBytes: 120,
        },
        switch: {
          currentSymlink: '/var/www/site/current',
          target: 'releases/20260625-180000',
        },
        cleanup: {
          lockPath: '/var/www/site/.ssh-release.lock',
          tempArchivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
          keepReleases: 5,
          oldReleases: '发布成功后保留最新 5 个版本，并保留当前版本',
        },
        verification: [
          '版本目录存在',
          'current 指向新版本',
          'manifest.json hash 匹配',
          '远端锁已清理',
        ],
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
      upload: {
        sourcePath: './dist',
        archivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
        manifestPath: '/var/www/site/releases/20260625-180000/manifest.json',
        fileCount: 2,
        totalBytes: 120,
      },
      switch: {
        currentSymlink: '/var/www/site/current',
        target: 'releases/20260625-180000',
      },
      cleanup: {
        lockPath: '/var/www/site/.ssh-release.lock',
        tempArchivePath: '/var/www/site/.ssh-release-tmp/20260625-180000.tgz',
        keepReleases: 5,
        oldReleases: '发布成功后保留最新 5 个版本，并保留当前版本',
      },
      verification: [
        '版本目录存在',
        'current 指向新版本',
        'manifest.json hash 匹配',
        '远端锁已清理',
      ],
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

test('prints a setup hint when the config file is missing', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['doctor', '--json'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      doctor: async () => {
        throw new Error('配置文件不存在: ssh-release.config.ts');
      },
    },
  }), 1);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: false,
    command: 'doctor',
    error: '配置文件不存在: ssh-release.config.ts',
    hint: '先运行 ssh-release init --template static-site 生成配置文件；如果发布单个文件，改用 ssh-release init --template single-file。',
  });
  assert.deepEqual(stderr, []);
});

test('prints onboarding hints for failed doctor checks', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['doctor'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      doctor: async () => ({
        ok: false,
        checks: [
          {
            name: '配置文件',
            status: 'fail' as const,
            message: '配置文件不存在: ssh-release.config.ts',
          },
          {
            name: '本地源路径',
            status: 'fail' as const,
            message: '本地源路径不存在: ./dist',
          },
        ],
      }),
    },
  }), 1);

  assert.equal(stdout.includes('[fail] 配置文件: 配置文件不存在: ssh-release.config.ts'), true);
  assert.equal(
    stdout.includes('下一步: 先运行 ssh-release init --template static-site 生成配置文件；如果发布单个文件，改用 ssh-release init --template single-file。'),
    true,
  );
  assert.equal(stdout.includes('[fail] 本地源路径: 本地源路径不存在: ./dist'), true);
  assert.equal(
    stdout.includes('下一步: 先构建项目生成 ./dist，或修改 ssh-release.config.ts 里的 source.path 后再运行 ssh-release deploy --plan。'),
    true,
  );
  assert.deepEqual(stderr, []);
});

test('prints platform guidance when sshpass is missing', async () => {
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
        throw new Error('spawn sshpass ENOENT');
      },
    },
  }), 1);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: false,
    command: 'deploy',
    error: 'spawn sshpass ENOENT',
    hint: '当前配置使用密码登录，本机需要安装 sshpass；macOS 可运行 brew install hudochenkov/sshpass/sshpass，Ubuntu/Debian 可运行 sudo apt-get install sshpass，Windows 和 CI 推荐改用私钥登录。',
  });
  assert.deepEqual(stderr, []);
});

test('prints onboarding hints for missing auth and source path errors', async () => {
  const authStdout: string[] = [];
  const sourceStdout: string[] = [];

  assert.equal(await runCli(['deploy', '--json'], {
    io: {
      log: (message: string) => authStdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async () => {
        throw new Error('server.privateKeyPath 或 server.password 必须配置一个');
      },
    },
  }), 1);

  assert.deepEqual(JSON.parse(authStdout[0]), {
    ok: false,
    command: 'deploy',
    error: 'server.privateKeyPath 或 server.password 必须配置一个',
    hint: '设置 SSH_RELEASE_HOST、SSH_RELEASE_USER，并选择 SSH_RELEASE_PASSWORD 或 SSH_RELEASE_PRIVATE_KEY_PATH；设置后运行 ssh-release doctor。',
  });

  assert.equal(await runCli(['deploy', '--json'], {
    io: {
      log: (message: string) => sourceStdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async () => {
        throw new Error('source.path 不存在: ./dist');
      },
    },
  }), 1);

  assert.deepEqual(JSON.parse(sourceStdout[0]), {
    ok: false,
    command: 'deploy',
    error: 'source.path 不存在: ./dist',
    hint: '先构建项目生成 ./dist，或修改 ssh-release.config.ts 里的 source.path 后再运行 ssh-release deploy --plan。',
  });
});

test('prints an actionable next step for remote lock failures', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['deploy'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      deploy: async () => {
        throw new Error('远程已有发布任务正在运行，请确认后删除 /var/www/site/.ssh-release.lock');
      },
    },
  }), 1);

  assert.deepEqual(stdout, []);
  assert.equal(stderr.includes('远程已有发布任务正在运行，请确认后删除 /var/www/site/.ssh-release.lock'), true);
  assert.equal(
    stderr.includes('下一步: 先运行 ssh-release unlock 查看远端锁，确认没有发布或回滚任务后再按提示删除锁。'),
    true,
  );
});

test('prints rollback failure hints in json errors', async () => {
  const stdout: string[] = [];
  const stderr: string[] = [];

  assert.equal(await runCli(['rollback', '20260625-090000', '--json'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: (message: string) => stderr.push(message),
    },
    handlers: {
      ...createFailingHandlers(),
      rollback: async () => {
        throw new Error('回滚目标不存在: 20260625-090000');
      },
    },
  }), 1);

  assert.equal(stdout.length, 1);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: false,
    command: 'rollback',
    error: '回滚目标不存在: 20260625-090000',
    hint: '先运行 ssh-release list 查看当前版本和可用版本，再选择存在的版本回滚。',
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

test('prints rollback progress as ndjson before the final json result', async () => {
  const stdout: string[] = [];

  assert.equal(await runCli(['rollback', '--json', '--progress'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      rollback: async (version?: string, options?: RollbackCliOptions) => {
        assert.equal(version, undefined);
        options?.onProgress?.({ stage: 'switch', status: 'start' });
        options?.onProgress?.({ stage: 'switch', status: 'success' });
        return {
          version: '20260625-121000',
          currentSymlink: '/var/www/site/current',
          verified: true,
          verification: [
            {
              name: '当前版本',
              status: 'pass' as const,
              message: 'current 已指向目标版本',
            },
          ],
          warnings: [],
        };
      },
    },
  }), 0);

  assert.equal(stdout.length, 3);
  assert.deepEqual(JSON.parse(stdout[0]), {
    ok: true,
    command: 'rollback',
    event: 'progress',
    stage: 'switch',
    status: 'start',
  });
  assert.deepEqual(JSON.parse(stdout[1]), {
    ok: true,
    command: 'rollback',
    event: 'progress',
    stage: 'switch',
    status: 'success',
  });
  assert.equal(JSON.parse(stdout[2]).result.verified, true);
});

test('prints remote verification status after rollback succeeds', async () => {
  const stdout: string[] = [];

  assert.equal(await runCli(['rollback'], {
    io: {
      log: (message: string) => stdout.push(message),
      error: () => undefined,
    },
    handlers: {
      ...createFailingHandlers(),
      rollback: async () => ({
        version: '20260625-121000',
        currentSymlink: '/var/www/site/current',
        verified: true,
        verification: [
          {
            name: '当前版本',
            status: 'pass' as const,
            message: 'current 已指向目标版本',
          },
        ],
        warnings: [],
      }),
    },
  }), 0);

  assert.equal(stdout.includes('回滚校验通过'), true);
  assert.equal(stdout.includes('校验: 当前版本 - current 已指向目标版本'), true);
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

test('prints manifest path after deploy succeeds', async () => {
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
        manifest: {
          remotePath: '/var/www/site/releases/20260625-180000/manifest.json',
          fileCount: 2,
          totalBytes: 120,
          sha256: 'a'.repeat(64),
        },
        warnings: [],
      }),
    },
  }), 0);

  assert.equal(stdout.includes('发布清单: /var/www/site/releases/20260625-180000/manifest.json'), true);
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
