#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE_NAME, loadConfigFile, writeConfigTemplate } from './config.js';
import { runDoctorFromFile, type DoctorReport } from './doctor.js';
import { listReleases, type ListReleasesResult } from './list.js';
import { deploy, type DeployResult } from './release.js';
import { rollback, type RollbackResult } from './rollback.js';
import { createRemoteClient } from './ssh.js';

export interface CliIo {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface CliHandlers {
  init: () => Promise<void>;
  deploy: () => Promise<DeployResult>;
  rollback: (version?: string) => Promise<RollbackResult>;
  list: () => Promise<ListReleasesResult>;
  doctor: () => Promise<DoctorReport>;
}

export interface RunCliOptions {
  io?: CliIo;
  handlers?: CliHandlers;
}

export function isCliEntrypoint(moduleUrl: string, argvEntry?: string): boolean {
  if (!argvEntry) {
    return false;
  }

  return toRealPath(fileURLToPath(moduleUrl)) === toRealPath(argvEntry);
}

export async function runCli(
  argv = process.argv.slice(2),
  options: RunCliOptions = {},
): Promise<number> {
  const io = options.io ?? console;
  const handlers = options.handlers ?? createDefaultHandlers();
  const [command, ...args] = argv;

  try {
    if (command === 'init') {
      await handlers.init();
      io.log('已创建 ssh-release.config.ts');
      return 0;
    }

    if (command === 'deploy') {
      printDeployResult(await handlers.deploy(), io);
      return 0;
    }

    if (command === 'rollback') {
      printRollbackResult(await handlers.rollback(args[0]), io);
      return 0;
    }

    if (command === 'list') {
      printListResult(await handlers.list(), io);
      return 0;
    }

    if (command === 'doctor') {
      const report = await handlers.doctor();
      printDoctorReport(report, io);
      return report.ok ? 0 : 1;
    }

    io.log(`用法:
  ssh-release init
  ssh-release deploy
  ssh-release rollback [version]
  ssh-release list
  ssh-release doctor`);
    return command ? 1 : 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function createDefaultHandlers(): CliHandlers {
  return {
    init: () => writeConfigTemplate(),
    deploy: async () => {
      const config = await loadConfigFile();
      return deploy(config, createRemoteClient(config));
    },
    rollback: async (version) => {
      const config = await loadConfigFile();
      return rollback(config, createRemoteClient(config), version);
    },
    list: async () => {
      const config = await loadConfigFile();
      return listReleases(config, createRemoteClient(config));
    },
    doctor: async () => {
      return runDoctorFromFile(CONFIG_FILE_NAME, createRemoteClient);
    },
  };
}

function printDeployResult(result: DeployResult, io: CliIo): void {
  if (result.mode === 'release') {
    io.log(`发布成功: ${result.version}`);
    io.log(`版本目录: ${result.targetPath}`);
    io.log(`当前指向: ${result.currentSymlink}`);
  } else {
    io.log('覆盖发布成功');
    io.log(`目标目录: ${result.targetPath}`);
  }

  if (result.usedFallback) {
    io.log('远端 tar 不可用或解压失败，已使用逐文件上传');
  }

  for (const warning of result.warnings) {
    io.log(`警告: ${warning}`);
  }
}

function printRollbackResult(result: RollbackResult, io: CliIo): void {
  io.log(`已回滚到版本: ${result.version}`);
  io.log(`当前指向: ${result.currentSymlink}`);
}

function printListResult(result: ListReleasesResult, io: CliIo): void {
  io.log(`远程目录: ${result.targetPath}`);

  if (result.mode === 'overwrite') {
    io.log('overwrite 模式没有版本列表');
    return;
  }

  io.log(`当前版本: ${result.currentVersion ?? '未设置'}`);

  for (const release of result.releases) {
    const marker = release.current ? '*' : ' ';
    io.log(`${marker} ${release.version} ${release.modifiedAt.toISOString()}`);
  }
}

function printDoctorReport(report: DoctorReport, io: CliIo): void {
  for (const check of report.checks) {
    io.log(`[${check.status}] ${check.name}: ${check.message}`);
  }
}

function toRealPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
