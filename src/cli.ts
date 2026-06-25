#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_FILE_NAME, loadConfigFile, writeConfigTemplate } from './config.js';
import { runDoctorFromFile, type DoctorReport } from './doctor.js';
import { listReleases, type ListReleasesResult } from './list.js';
import { createDeployPlan, deploy, type DeployPlan, type DeployResult } from './release.js';
import { rollback, type RollbackResult } from './rollback.js';
import { createRemoteClient } from './ssh.js';

export interface CliIo {
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface DeployCliOptions {
  dryRun?: boolean;
}

export interface CliHandlers {
  init: () => Promise<void>;
  deploy: (options?: DeployCliOptions) => Promise<DeployResult | DeployPlan>;
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
  const parsed = parseCliArgs(argv);

  if (parsed.error) {
    io.error(parsed.error);
    return 1;
  }

  if (parsed.help) {
    printUsage(io);
    return 0;
  }

  if (parsed.version) {
    io.log(readPackageVersion());
    return 0;
  }

  const handlers = options.handlers ?? createDefaultHandlers(parsed.configPath);
  const command = parsed.command;
  const args = parsed.args;

  try {
    if (command === 'init') {
      await handlers.init();
      io.log(`已创建 ${parsed.configPath}`);
      return 0;
    }

    if (command === 'deploy') {
      printDeployResult(await handlers.deploy({ dryRun: parsed.dryRun }), io);
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

    printUsage(io);
    return command ? 1 : 0;
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

interface ParsedCliArgs {
  args: string[];
  command?: string;
  configPath: string;
  dryRun: boolean;
  error?: string;
  help: boolean;
  version: boolean;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args: string[] = [];
  let configPath = CONFIG_FILE_NAME;
  let dryRun = false;
  let help = false;
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

    if (arg === '--config' || arg === '-c') {
      const value = argv[index + 1];

      if (!value || value.startsWith('-')) {
        return createParsedError('--config 需要配置文件路径', configPath);
      }

      configPath = value;
      index += 1;
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg.startsWith('-')) {
      return createParsedError(`未知选项: ${arg}`, configPath);
    }

    args.push(arg);
  }

  return {
    args: args.slice(1),
    command: args[0],
    configPath,
    dryRun,
    help,
    version,
  };
}

function createParsedError(error: string, configPath: string): ParsedCliArgs {
  return {
    args: [],
    configPath,
    dryRun: false,
    error,
    help: false,
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

      return deploy(config, createRemoteClient(config));
    },
    rollback: async (version) => {
      const config = await loadConfigFile(configPath);
      return rollback(config, createRemoteClient(config), version);
    },
    list: async () => {
      const config = await loadConfigFile(configPath);
      return listReleases(config, createRemoteClient(config));
    },
    doctor: async () => {
      return runDoctorFromFile(configPath, createRemoteClient);
    },
  };
}

function printDeployResult(result: DeployResult | DeployPlan, io: CliIo): void {
  if ('dryRun' in result) {
    io.log('发布预检通过，不会修改远程服务器');
    io.log(`模式: ${result.mode}`);
    io.log(`源路径: ${result.sourcePath}`);
    io.log(`目标目录: ${result.targetPath}`);

    if (result.version) {
      io.log(`计划版本: ${result.version}`);
    }

    if (result.currentSymlink) {
      io.log(`计划切换: ${result.currentSymlink}`);
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

function printUsage(io: CliIo): void {
  io.log(`用法:
  ssh-release init [--config <path>]
  ssh-release doctor [--config <path>]
  ssh-release deploy [--config <path>]
  ssh-release deploy --dry-run [--config <path>]
  ssh-release list [--config <path>]
  ssh-release rollback [version] [--config <path>]
  ssh-release --help
  ssh-release --version`);
}

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };

  return packageJson.version ?? '0.0.0';
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
