#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  CONFIG_FILE_NAME,
  type ConfigAuthMethod,
  isConfigTemplateName,
  listConfigTemplateNames,
  loadConfigFile,
  writeCustomConfigTemplate,
  writeConfigTemplate,
  type ConfigTemplateName,
} from './config.js';
import { runDoctorFromFile, type DoctorReport } from './doctor.js';
import { listReleases, type ListReleasesResult } from './list.js';
import {
  createDeployPlan,
  deploy,
  type DeployPlan,
  type DeployProgressEvent,
  type DeployResult,
} from './release.js';
import {
  createRollbackPlan,
  rollback,
  type RollbackPlan,
  type RollbackProgressEvent,
  type RollbackResult,
} from './rollback.js';
import { createRemoteClient } from './ssh.js';
import { unlock, type UnlockResult } from './unlock.js';
import { validateTargetPath } from './validate.js';

const GITHUB_ACTIONS_WORKFLOW_PATH = '.github/workflows/ssh-release-deploy.yml';

type PromptFn = (question: string) => Promise<string>;

export interface CliIo {
  log: (message: string) => void;
  error: (message: string) => void;
  prompt?: PromptFn;
}

export interface DeployCliOptions {
  dryRun?: boolean;
  onProgress?: (event: DeployProgressEvent) => void | Promise<void>;
}

export interface RollbackCliOptions {
  dryRun?: boolean;
  onProgress?: (event: RollbackProgressEvent) => void | Promise<void>;
}

export interface UnlockCliOptions {
  confirmPath?: string;
}

export interface InitCliOptions {
  interactive: boolean;
  log?: (message: string) => void;
  prompt?: PromptFn;
  templateName: ConfigTemplateName;
}

export interface InitCliResult {
  workflowPath?: string;
}

export interface CliHandlers {
  init: (options?: InitCliOptions) => Promise<void | InitCliResult>;
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
  const io: CliIo = options.io ?? console;
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
      const initResult = await handlers.init({
        interactive: parsed.interactive,
        log: io.log,
        prompt: io.prompt,
        templateName: parsed.templateName,
      });

      if (parsed.json) {
        printJsonResult('init', {
          configPath: parsed.configPath,
          template: parsed.templateName,
        }, 0, io);
        return 0;
      }

      io.log(`已创建 ${parsed.configPath}`);
      if (parsed.interactive) {
        io.log('已完成交互式初始化');
      } else if (parsed.templateName !== 'default') {
        io.log(`已使用模板 ${parsed.templateName}`);
      }
      const workflowPath = initResult && 'workflowPath' in initResult
        ? initResult.workflowPath
        : undefined;

      if (workflowPath) {
        io.log(`已创建 ${workflowPath}`);
      }
      printInitNextSteps(parsed.configPath, io);
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
      const rollbackOptions: RollbackCliOptions = {
        dryRun: parsed.dryRun,
      };

      if (parsed.json && parsed.progress) {
        rollbackOptions.onProgress = (event) => printJsonProgress('rollback', event, io);
      }

      const result = await handlers.rollback(args[0], rollbackOptions);

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
    const errorMessage = formatError(error);
    const hint = createErrorHint(command, errorMessage);

    if (parsed.json) {
      printJsonError(command, errorMessage, io, hint);
      return 1;
    }

    io.error(errorMessage);

    if (hint) {
      io.error(`下一步: ${hint}`);
    }

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
  interactive: boolean;
  json: boolean;
  progress: boolean;
  templateName: ConfigTemplateName;
  version: boolean;
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args: string[] = [];
  let confirmPath: string | undefined;
  let configPath = CONFIG_FILE_NAME;
  let dryRun = false;
  let help = false;
  let interactive = false;
  let json = false;
  let progress = false;
  let templateName: string | undefined;
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

    if (arg === '--interactive' || arg === '-i') {
      interactive = true;
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

    if (arg === '--template') {
      const value = argv[index + 1];

      if (!value || value.startsWith('-')) {
        return createParsedError('--template 需要配置模板名称', configPath, json);
      }

      templateName = value;
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

  if (progress && args[0] && args[0] !== 'deploy' && args[0] !== 'rollback') {
    return createParsedError('--progress 仅支持 deploy 或 rollback 命令', configPath, json);
  }

  if (templateName && args[0] !== 'init') {
    return createParsedError('--template 仅支持 init 命令', configPath, json);
  }

  if (interactive && args[0] !== 'init') {
    return createParsedError('--interactive 仅支持 init 命令', configPath, json);
  }

  if (interactive && templateName) {
    return createParsedError('--interactive 不能配合 --template 使用', configPath, json);
  }

  if (interactive && json) {
    return createParsedError('--interactive 不能配合 --json 使用', configPath, json);
  }

  let selectedTemplateName: ConfigTemplateName = 'default';

  if (templateName) {
    if (!isConfigTemplateName(templateName)) {
      return createParsedError(
        `未知配置模板: ${templateName}。可用模板: ${listConfigTemplateNames().join(', ')}`,
        configPath,
        json,
      );
    }

    selectedTemplateName = templateName;
  }

  return {
    args: args.slice(1),
    command: args[0],
    confirmPath,
    configPath,
    dryRun,
    help,
    interactive,
    json,
    progress,
    templateName: selectedTemplateName,
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
    interactive: false,
    json,
    progress: false,
    templateName: 'default',
    version: false,
  };
}

function createDefaultHandlers(configPath: string): CliHandlers {
  return {
    init: async (options) => {
      if (options?.interactive) {
        return runInteractiveInit(configPath, options);
      }

      await writeConfigTemplate(configPath, options?.templateName);
      return undefined;
    },
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

      return rollback(config, createRemoteClient(config), version, {
        onProgress: options?.onProgress,
      });
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

interface InteractiveInitAnswers {
  authMethod: ConfigAuthMethod;
  generateWorkflow: boolean;
  privateKeyPath?: string;
  sourcePath: string;
  targetPath: string;
}

async function runInteractiveInit(
  configPath: string,
  options: InitCliOptions,
): Promise<InitCliResult> {
  return withPrompt(options.prompt, async (prompt) => {
    const answers = await collectInteractiveInitAnswers(prompt, options.log ?? (() => undefined));

    await assertInteractiveInitOutputsAvailable(configPath, answers.generateWorkflow);

    await writeCustomConfigTemplate(configPath, {
      authMethod: answers.authMethod,
      privateKeyPath: answers.privateKeyPath,
      sourcePath: answers.sourcePath,
      targetPath: answers.targetPath,
    });

    if (!answers.generateWorkflow) {
      return {};
    }

    await mkdir(dirname(GITHUB_ACTIONS_WORKFLOW_PATH), { recursive: true });
    await writeFile(
      GITHUB_ACTIONS_WORKFLOW_PATH,
      createGitHubActionsWorkflow(answers.authMethod),
      { flag: 'wx' },
    );

    return {
      workflowPath: GITHUB_ACTIONS_WORKFLOW_PATH,
    };
  });
}

async function assertInteractiveInitOutputsAvailable(
  configPath: string,
  generateWorkflow: boolean,
): Promise<void> {
  await assertFileDoesNotExist(configPath, '配置文件');

  if (generateWorkflow) {
    await assertFileDoesNotExist(GITHUB_ACTIONS_WORKFLOW_PATH, 'GitHub Actions workflow');
  }
}

async function assertFileDoesNotExist(filePath: string, label: string): Promise<void> {
  try {
    await access(filePath);
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;

    if (code === 'ENOENT') {
      return;
    }

    throw error;
  }

  throw new Error(`${label} 已存在: ${filePath}。请删除或改名后重试。`);
}

async function withPrompt<T>(
  injectedPrompt: PromptFn | undefined,
  run: (prompt: PromptFn) => Promise<T>,
): Promise<T> {
  if (injectedPrompt) {
    return run(injectedPrompt);
  }

  if (!process.stdin.isTTY) {
    const answers = await readPromptLinesFromStdin();

    return run(async (question) => {
      process.stdout.write(question);

      const answer = answers.shift();

      if (answer === undefined) {
        throw new Error('交互式输入不足，请重新运行 ssh-release init --interactive 并回答全部问题。');
      }

      return answer;
    });
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await run((question) => readline.question(question));
  } finally {
    readline.close();
  }
}

async function readPromptLinesFromStdin(): Promise<string[]> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/);
}

async function collectInteractiveInitAnswers(
  prompt: PromptFn,
  log: (message: string) => void,
): Promise<InteractiveInitAnswers> {
  const releaseShape = await askChoice(
    prompt,
    log,
    '发布内容类型 (static-site/single-file) [static-site]: ',
    ['static-site', 'single-file'],
    'static-site',
  );
  const defaultSourcePath = releaseShape === 'single-file' ? './dist/app.tar.gz' : './dist';
  const sourcePath = await askText(prompt, '本地产物路径', defaultSourcePath);
  const targetPath = await askTargetPath(prompt, log, '/var/www/my-app');
  const authMethod = await askChoice(
    prompt,
    log,
    '认证方式 (password/private-key) [password]: ',
    ['password', 'private-key'],
    'password',
  );
  const privateKeyPath = authMethod === 'private-key'
    ? await askText(prompt, '私钥路径', '~/.ssh/id_rsa')
    : undefined;
  const generateWorkflow = await askYesNo(prompt, log, '是否生成 GitHub Actions 发布 workflow? (y/N): ', false);

  return {
    authMethod,
    generateWorkflow,
    privateKeyPath,
    sourcePath,
    targetPath,
  };
}

async function askChoice<T extends string>(
  prompt: PromptFn,
  log: (message: string) => void,
  question: string,
  choices: readonly T[],
  defaultValue: T,
): Promise<T> {
  for (;;) {
    const answer = normalizeChoiceAnswer(await prompt(question)) || defaultValue;
    const selected = choices.find((choice) => choice === answer);

    if (selected) {
      return selected;
    }

    log(`请输入: ${choices.join(' / ')}`);
  }
}

async function askText(prompt: PromptFn, label: string, defaultValue: string): Promise<string> {
  const answer = trimAnswer(await prompt(`${label} [${defaultValue}]: `));
  return answer || defaultValue;
}

async function askTargetPath(
  prompt: PromptFn,
  log: (message: string) => void,
  defaultValue: string,
): Promise<string> {
  for (;;) {
    const answer = await askText(prompt, '远端目标目录', defaultValue);

    try {
      return validateTargetPath(answer);
    } catch (error) {
      log(`target.path 无效: ${formatError(error)}`);
    }
  }
}

async function askYesNo(
  prompt: PromptFn,
  log: (message: string) => void,
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  for (;;) {
    const answer = normalizeChoiceAnswer(await prompt(question));

    if (!answer) {
      return defaultValue;
    }

    if (['y', 'yes', '是'].includes(answer)) {
      return true;
    }

    if (['n', 'no', '否'].includes(answer)) {
      return false;
    }

    log('请输入 y 或 n');
  }
}

function trimAnswer(answer: string): string {
  return answer.trim();
}

function normalizeChoiceAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function createGitHubActionsWorkflow(authMethod: ConfigAuthMethod): string {
  const secret = (name: string) => `\${{ secrets.${name} }}`;
  const authSetup = authMethod === 'private-key'
    ? `
      - name: Write SSH private key
        run: |
          mkdir -p ~/.ssh
          printf '%s\\n' "$SSH_RELEASE_PRIVATE_KEY" > ~/.ssh/ssh-release
          chmod 600 ~/.ssh/ssh-release
        env:
          SSH_RELEASE_PRIVATE_KEY: ${secret('SSH_RELEASE_PRIVATE_KEY')}
`
    : '';
  const authEnv = authMethod === 'private-key'
    ? `          SSH_RELEASE_PRIVATE_KEY_PATH: ~/.ssh/ssh-release`
    : `          SSH_RELEASE_PASSWORD: ${secret('SSH_RELEASE_PASSWORD')}`;

  return `name: Deploy

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: production-deploy
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: '24'
          cache: npm

      - run: npm ci
      - run: npm run build
${authSetup}
      - name: Check remote environment
        run: npx ssh-release doctor --json
        env:
          SSH_RELEASE_HOST: ${secret('SSH_RELEASE_HOST')}
          SSH_RELEASE_USER: ${secret('SSH_RELEASE_USER')}
${authEnv}

      - name: Deploy files
        run: npx ssh-release deploy --json --progress
        env:
          SSH_RELEASE_HOST: ${secret('SSH_RELEASE_HOST')}
          SSH_RELEASE_USER: ${secret('SSH_RELEASE_USER')}
${authEnv}
`;
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

  if (result.verified) {
    io.log('回滚校验通过');

    for (const check of result.verification ?? []) {
      io.log(`校验: ${check.name} - ${check.message}`);
    }
  }

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

    if (check.status === 'fail') {
      const hint = createErrorHint('doctor', check.message);

      if (hint) {
        io.log(`下一步: ${hint}`);
      }
    }
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

function printInitNextSteps(configPath: string, io: CliIo): void {
  io.log('下一步:');
  io.log('1. 设置 SSH_RELEASE_HOST、SSH_RELEASE_USER，并选择密码或私钥认证。');
  io.log('2. 确认 source.path 和 target.path 指向要发布的本地目录和远端目录。');
  io.log(`3. 运行 ssh-release doctor --config ${configPath} 检查配置和服务器连接。`);
  io.log(`4. 运行 ssh-release deploy --plan --config ${configPath} 预览发布计划。`);
}

function printJsonResult(command: string, result: unknown, exitCode: number, io: CliIo): void {
  io.log(JSON.stringify({
    ok: exitCode === 0,
    command,
    result,
  }));
}

function printJsonProgress(
  command: string,
  event: DeployProgressEvent | RollbackProgressEvent,
  io: CliIo,
): void {
  io.log(JSON.stringify({
    ok: true,
    command,
    event: 'progress',
    ...event,
  }));
}

function printJsonError(
  command: string | undefined,
  error: string,
  io: CliIo,
  hint?: string,
): void {
  const payload: {
    ok: false;
    command: string | undefined;
    error: string;
    hint?: string;
  } = {
    ok: false,
    command,
    error,
  };

  if (hint) {
    payload.hint = hint;
  }

  io.log(JSON.stringify(payload));
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
  ssh-release init [--template default|single-file|static-site] [--config <path>]
  ssh-release init --interactive [--config <path>]
  ssh-release doctor [--config <path>]
  ssh-release deploy [--config <path>]
  ssh-release deploy --dry-run [--config <path>]
  ssh-release deploy --plan [--config <path>]
  ssh-release deploy --json --progress [--config <path>]
  ssh-release list [--config <path>]
  ssh-release rollback [version] [--config <path>]
  ssh-release rollback [version] --dry-run [--config <path>]
  ssh-release rollback [version] --plan [--config <path>]
  ssh-release rollback [version] --json --progress [--config <path>]
  ssh-release unlock [--confirm <lock-path>] [--config <path>]
  ssh-release <command> --json
  ssh-release --help
  ssh-release --version

模板:
  default: 通用发布配置
  static-site: 发布 ./dist 静态站点目录
  single-file: 发布单个构建产物文件

首次接入推荐:
  ssh-release init --template static-site
  ssh-release doctor
  ssh-release deploy --plan`;
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

function createErrorHint(command: string | undefined, error: string): string | undefined {
  if (error.includes('配置文件不存在')) {
    return '先运行 ssh-release init --template static-site 生成配置文件；如果发布单个文件，改用 ssh-release init --template single-file。';
  }

  if (
    error.includes('server.privateKeyPath 或 server.password 必须配置一个')
    || error.includes('server.host 不能为空')
    || error.includes('server.username 不能为空')
  ) {
    return '设置 SSH_RELEASE_HOST、SSH_RELEASE_USER，并选择 SSH_RELEASE_PASSWORD 或 SSH_RELEASE_PRIVATE_KEY_PATH；设置后运行 ssh-release doctor。';
  }

  const missingSourcePath = getMissingSourcePath(error);

  if (missingSourcePath) {
    return `先构建项目生成 ${missingSourcePath}，或修改 ssh-release.config.ts 里的 source.path 后再运行 ssh-release deploy --plan。`;
  }

  if (error.includes('远程已有发布任务正在运行') || error.includes('.ssh-release.lock')) {
    return '先运行 ssh-release unlock 查看远端锁，确认没有发布或回滚任务后再按提示删除锁。';
  }

  if (command === 'rollback') {
    if (
      error.includes('回滚目标不存在')
      || error.includes('没有可回滚版本')
      || error.includes('当前版本不存在')
    ) {
      return '先运行 ssh-release list 查看当前版本和可用版本，再选择存在的版本回滚。';
    }

    if (error.includes('overwrite 模式不支持回滚')) {
      return 'overwrite 模式没有版本目录；需要恢复内容时请重新发布正确的本地文件。';
    }
  }

  if (command === 'deploy' && (
    error.includes('current 未指向新版本')
    || error.includes('版本目录校验失败')
    || error.includes('目标目录校验失败')
    || error.includes('发布锁未清理')
    || error.includes('manifest.json hash')
  )) {
    return '先运行 ssh-release list --json 和 ssh-release doctor --json，确认 current、版本目录、manifest 和远端锁状态。';
  }

  if (error.includes('sshpass')) {
    return '当前配置使用密码登录，本机需要安装 sshpass；macOS 可运行 brew install hudochenkov/sshpass/sshpass，Ubuntu/Debian 可运行 sudo apt-get install sshpass，Windows 和 CI 推荐改用私钥登录。';
  }

  if (
    command
    && command !== 'init'
    && (
      error.includes('Permission denied')
      || error.includes('Connection timed out')
      || error.includes('Could not resolve hostname')
      || error.includes('SSH')
    )
  ) {
    return '先运行 ssh-release doctor 检查 SSH 连接、认证信息和远端目录权限。';
  }

  return undefined;
}

function getMissingSourcePath(error: string): string | undefined {
  const match = error.match(/(?:source\.path 不存在|本地源路径不存在): (.+)$/);

  if (!match) {
    return undefined;
  }

  return match[1];
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const exitCode = await runCli();
  process.exit(exitCode);
}
