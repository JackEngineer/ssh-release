#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE_NAME, loadConfigFile, writeConfigTemplate } from './config.js';
import { runDoctorFromFile, type DoctorReport } from './doctor.js';
import { listReleases, type ListReleasesResult } from './list.js';
import {
  createDeployPlan,
  deploy,
  type DeployPlan,
  type DeployProgressEvent,
  type DeployResult,
} from './release.js';
import { createRollbackPlan, rollback, type RollbackPlan, type RollbackResult } from './rollback.js';
import { createRemoteClient } from './ssh.js';
import { unlock, type UnlockResult } from './unlock.js';

export interface CliIo {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface DeployCliOptions {
  dryRun?: boolean;
  onProgress?: (event: DeployProgressEvent) => void | Promise<void>;
}

export interface RollbackCliOptions {
  dryRun?: boolean;
}

export interface UnlockCliOptions {
  confirmPath?: string;
}

export interface CliHandlers {
  init: () => Promise<void>;
  deploy: (options?: DeployCliOptions) => Promise<DeployResult | DeployPlan>;
  rollback: (version?: string, options?: RollbackCliOptions) => Promise<RollbackResult | RollbackPlan>;
  list: () => Promise<ListReleasesResult>;
  doctor: () => Promise<DoctorReport>;
  unlock: (options?: UnlockCliOptions) => Promise<UnlockResult>;
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
  const parsed = parseCliArgs(argv);

  if (parsed.error) {
    if (parsed.json) {
      printJsonError(parsed.command, parsed.error, io);
      return 1;
    }

    io.error(parsed.error);
    return 1;
  }

  if (parsed.help) {
    if (parsed.json) {
      printJsonResult('help', { usage: createUsageText() }, 0, io);
      return 0;
    }

    printUsage(io);
    return 0;
  }

  if (parsed.version) {
    const version = readPackageVersion();

    if (parsed.json) {
      printJsonResult('version', { version }, 0, io);
      return 0;
    }

    io.log(version);
    return 0;
  }

  const handlers = options.handlers ?? createDefaultHandlers(parsed.configPath);
  const command = parsed.command;
  const args = parsed.args;

  try {
    if (command === 'init') {
      await handlers.init();

      if (parsed.json) {
        printJsonResult('init', { configPath: parsed.configPath }, 0, io);
        return 0;
      }

      io.log(`已创建 ${parsed.configPath}`);
      return 0;
    }

    if (command === 'deploy') {
      const deployOptions: DeployCliOptions = {
        dryRun: parsed.dryRun,
      };

      if (parsed.json && parsed.progress) {
        deployOptions.onProgress = (event) => printJsonProgress('deploy', event, io);
      }

      const result = await handlers.deploy(deployOptions);

      if (parsed.json) {
        printJsonResult('deploy', result, 0, io);
        return 0;
      }

      printDeployResult(result, io);
      return 0;
    }

    if (command === 'rollback') {
      const result = await handlers.rollback(args[0], { dryRun: parsed.dryRun });

      if (parsed.json) {
        printJsonResult('rollback', result, 0, io);
        return 0;
      }

      printRollbackResult(result, io);
      return 0;
    }

    if (command === 'list') {
      const result = await handlers.list();

      if (parsed.json) {
        printJsonResult('list', result, 0, io);
        return 0;
      }

      printListResult(result, io);
      return 0;
    }

    if (command === 'doctor') {
      const report = await handlers.doctor();
      const exitCode = report.ok ? 0 : 1;

      if (parsed.json) {
        printJsonResult('doctor', report, exitCode, io);
        return exitCode;
      }

      printDoctorReport(report, io);
      return exitCode;
    }

    if (command === 'unlock') {
      const result = await handlers.unlock({ confirmPath: parsed.confirmPath });
      const exitCode = result.locked && !result.removed ? 1 : 0;

      if (parsed.json) {
        printJsonResult('unlock', result, exitCode, io);
        return exitCode;
      }

      printUnlockResult(result, io);
      return exitCode;
    }

    if (parsed.json) {
      if (!command) {
        printJsonResult('help', { usage: createUsageText() }, 0, io);
        return 0;
      }

      printJsonError(command, `未知命令: ${command}`, io);
      return 1;
    }

    printUsage(io);
    return command ? 1 : 0;
  } catch (error) {
    if (parsed.json) {
      printJsonError(command, formatError(error), io);
      return 1;
    }

    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

interface ParsedCliArgs {
  args: string[];
  command?: string;
  confirmPath?: string;
  configPath: string;
  dryRun: boolean;
  error?: string;
  help: boolean;
  json: boolean;
  progress: boolean;
  version: boolean;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args: string[] = [];
  let confirmPath: string | undefined;
  let configPath = CONFIG_FILE_NAME;
  let dryRun = false;
  let help = false;
  let json = false;
  let progress = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      version = true;
      continue;
    }

    if (arg === '--json') {
      json = true;
      continue;
    }

    if (arg === '--progress') {
      progress = true;
      continue;
    }

    if (arg === '--config' || arg === '-c') {
      const value = argv[index + 1];

      if (!value || value.startsWith('-')) {
        return createParsedError('--config 需要配置文件路径', configPath, json);
      }

      configPath = value;
      index += 1;
      continue;
    }

    if (arg === '--dry-run' || arg === '--plan') {
      dryRun = true;
      continue;
    }

    if (arg === '--confirm') {
      const value = argv[index + 1];

      if (!value || value.startsWith('-')) {
        return createParsedError('--confirm 需要远端锁路径', configPath, json);
      }

      confirmPath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      return createParsedError(`未知选项: ${arg}`, configPath, json);
    }

    args.push(arg);
  }

  if (progress && !json) {
    return createParsedError('--progress 需要配合 --json 使用', configPath, json);
  }

  if (progress && args[0] && args[0] !== 'deploy') {
    return createParsedError('--progress 仅支持 deploy 命令', configPath, json);
  }

  return {
    args: args.slice(1),
    command: args[0],
    confirmPath,
    configPath,
    dryRun,
    help,
    json,
    progress,
    version,
  };
}

function createParsedError(error: string, configPath: string, json = false): ParsedCliArgs {
  return {
    args: [],
    configPath,
    dryRun: false,
    error,
    help: false,
    json,
    progress: false,
    version: false,
  };
}

function createDefaultHandlers(configPath: string): CliHandlers {
  return {
    init: () => writeConfigTemplate(configPath),
    deploy: async (options) => {
      const config = await loadConfigFile(configPath);

      if (options?.dryRun) {
        return createDeployPlan(config);
      }

      return deploy(config, createRemoteClient(config), {
        onProgress: options?.onProgress,
      });
    },
    rollback: async (version, options) => {
      const config = await loadConfigFile(configPath);

      if (options?.dryRun) {
        return createRollbackPlan(config, createRemoteClient(config), version);
      }

      return rollback(config, createRemoteClient(config), version);
    },
    list: async () => {
      const config = await loadConfigFile(configPath);
      return listReleases(config, createRemoteClient(config));
    },
    doctor: async () => {
      return runDoctorFromFile(configPath, createRemoteClient);
    },
    unlock: async (options) => {
      const config = await loadConfigFile(configPath);
      return unlock(config, createRemoteClient(config), options);
    },
  };
}

function printDeployResult(result: DeployResult | DeployPlan, io: CliIo): void {
  if ('dryRun' in result) {
    io.log('发布预检通过，不会修改远程服务器');
    io.log(`模式: ${result.mode}`);
    io.log(`源路径: ${result.sourcePath}`);
    io.log(`目标目录: ${result.targetPath}`);
    io.log(`计划上传: ${result.upload.sourcePath} -> ${result.upload.archivePath}`);
    io.log(`计划清单: ${result.upload.manifestPath}`);
    io.log(`计划文件: ${result.upload.fileCount} 个，${result.upload.totalBytes} 字节`);

    if (result.version) {
      io.log(`计划版本: ${result.version}`);
    }

    if (result.switch) {
      io.log(`计划切换: ${result.switch.currentSymlink} -> ${result.switch.target}`);
    } else if (result.currentSymlink) {
      io.log(`计划切换: ${result.currentSymlink}`);
    }

    io.log(`计划清理: ${result.cleanup.tempArchivePath}`);
    io.log(`版本保留: ${result.cleanup.oldReleases}`);

    for (const verification of result.verification) {
      io.log(`计划校验: ${verification}`);
    }

    return;
  }

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

  if (result.manifest) {
    io.log(`发布清单: ${result.manifest.remotePath}`);
    io.log(`清单文件数: ${result.manifest.fileCount}`);
  }

  if (result.verified) {
    io.log('远端校验通过');

    for (const check of result.verification ?? []) {
      io.log(`校验: ${check.name} - ${check.message}`);
    }
  }

  for (const warning of result.warnings) {
    io.log(`警告: ${warning}`);
  }
}

function printRollbackResult(result: RollbackResult | RollbackPlan, io: CliIo): void {
  if ('dryRun' in result) {
    io.log('回滚预检通过，不会修改远程服务器');
    io.log(`当前版本: ${result.currentVersion}`);
    io.log(`目标版本: ${result.version}`);
    io.log(`目标目录: ${result.targetPath}`);
    io.log(`计划切换: ${result.switch.currentSymlink}: ${result.switch.from} -> ${result.switch.target}`);
    io.log(`计划清理: ${result.cleanup.oldReleases}`);

    for (const verification of result.verification) {
      io.log(`计划校验: ${verification}`);
    }

    return;
  }

  io.log(`已回滚到版本: ${result.version}`);
  io.log(`当前指向: ${result.currentSymlink}`);

  for (const warning of result.warnings) {
    io.log(`警告: ${warning}`);
  }
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

function printUnlockResult(result: UnlockResult, io: CliIo): void {
  if (!result.locked) {
    io.log(`没有发现远端锁: ${result.lockPath}`);
    return;
  }

  if (result.removed) {
    io.log(`已删除远端锁: ${result.lockPath}`);
    return;
  }

  io.log(`发现远端锁: ${result.lockPath}`);
  io.log(`pid: ${result.pid ?? '未知'}`);
  io.log(`创建时间: ${result.createdAt ?? '未知'}`);
  io.log('不会自动删除远端锁');
  io.log('确认没有发布或回滚任务后再执行:');
  io.log(`ssh-release unlock --confirm ${result.lockPath}`);
}

function printJsonResult(command: string, result: unknown, exitCode: number, io: CliIo): void {
  io.log(JSON.stringify({
    ok: exitCode === 0,
    command,
    result,
  }));
}

function printJsonProgress(command: string, event: DeployProgressEvent, io: CliIo): void {
  io.log(JSON.stringify({
    ok: true,
    command,
    event: 'progress',
    ...event,
  }));
}

function printJsonError(command: string | undefined, error: string, io: CliIo): void {
  io.log(JSON.stringify({
    ok: false,
    command,
    error,
  }));
}

function toRealPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function printUsage(io: CliIo): void {
  io.log(createUsageText());
}

function createUsageText(): string {
  return `用法:
  ssh-release init [--config <path>]
  ssh-release doctor [--config <path>]
  ssh-release deploy [--config <path>]
  ssh-release deploy --dry-run [--config <path>]
  ssh-release deploy --plan [--config <path>]
  ssh-release deploy --json --progress [--config <path>]
  ssh-release list [--config <path>]
  ssh-release rollback [version] [--config <path>]
  ssh-release rollback [version] --dry-run [--config <path>]
  ssh-release rollback [version] --plan [--config <path>]
  ssh-release unlock [--confirm <lock-path>] [--config <path>]
  ssh-release <command> --json
  ssh-release --help
  ssh-release --version`;
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };

  return packageJson.version ?? '0.0.0';
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
