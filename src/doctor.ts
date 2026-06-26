import { access } from 'node:fs/promises';

import { loadConfigFile } from './config.js';
import { readRemoteLockStatus } from './lock.js';
import { runProcess } from './process.js';
import { shellQuote } from './remote.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export interface DoctorOptions {
  configPath?: string;
  localCommandExists?: (command: string) => Promise<boolean>;
}

export async function runDoctorFromFile(
  configPath: string,
  createClient: (config: SshReleaseConfig) => RemoteClient,
): Promise<DoctorReport> {
  let config: SshReleaseConfig;

  try {
    config = await loadConfigFile(configPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isMissing = message.includes('ENOENT');

    return {
      ok: false,
      checks: [
        {
          name: isMissing ? '配置文件' : '配置字段',
          status: 'fail',
          message: isMissing ? `配置文件不存在: ${configPath}` : message,
        },
      ],
    };
  }

  return runDoctor(config, createClient(config), { configPath });
}

export async function runDoctor(
  config: SshReleaseConfig,
  client: RemoteClient,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  await addConfigFileCheck(checks, options.configPath);
  checks.push({
    name: '配置字段',
    status: 'pass',
    message: '配置字段有效',
  });
  await addSourcePathCheck(checks, config.source.path);
  await addLocalDependencyChecks(
    checks,
    config,
    options.localCommandExists ?? defaultLocalCommandExists,
  );

  if (checks.some((check) => check.status === 'fail')) {
    return {
      ok: false,
      checks,
    };
  }

  await addRemoteCheck(checks, 'SSH 连接', () => client.exec('true'), 'SSH 可连接');
  await addRemoteCheck(
    checks,
    '远程目录',
    () => client.exec(`mkdir -p ${shellQuote(config.target.path)} && test -w ${shellQuote(config.target.path)}`),
    '远程目录可创建且可写',
  );
  await addRemoteCheck(
    checks,
    '远端 hash',
    () => client.exec([
      'if command -v sha256sum >/dev/null 2>&1; then',
      'command -v sha256sum;',
      'elif command -v shasum >/dev/null 2>&1; then',
      'command -v shasum;',
      'else',
      'echo "远端缺少 sha256sum 或 shasum" >&2;',
      'exit 1;',
      'fi',
    ].join(' ')),
    '远端 sha256sum 或 shasum 可用',
  );
  await addRemoteLockCheck(checks, config, client);

  try {
    await client.exec('command -v tar');
    checks.push({
      name: '远端 tar',
      status: 'pass',
      message: '远端 tar 可用',
    });
  } catch {
    checks.push({
      name: '远端 tar',
      status: 'warn',
      message: '远端 tar 不可用，将回退逐文件上传',
    });
  }

  return {
    ok: checks.every((check) => check.status !== 'fail'),
    checks,
  };
}

async function addConfigFileCheck(checks: DoctorCheck[], configPath?: string): Promise<void> {
  if (!configPath) {
    checks.push({
      name: '配置文件',
      status: 'pass',
      message: '配置文件已加载',
    });
    return;
  }

  try {
    await access(configPath);
    checks.push({
      name: '配置文件',
      status: 'pass',
      message: `配置文件存在: ${configPath}`,
    });
  } catch {
    checks.push({
      name: '配置文件',
      status: 'fail',
      message: `配置文件不存在: ${configPath}`,
    });
  }
}

async function addRemoteLockCheck(
  checks: DoctorCheck[],
  config: SshReleaseConfig,
  client: RemoteClient,
): Promise<void> {
  try {
    const lockStatus = await readRemoteLockStatus(config, client);

    if (!lockStatus.locked) {
      checks.push({
        name: '远端锁',
        status: 'pass',
        message: '没有发现发布或回滚锁',
      });
      return;
    }

    checks.push({
      name: '远端锁',
      status: 'warn',
      message: [
        `发现远端锁: ${lockStatus.lockPath}`,
        `pid: ${lockStatus.pid ?? '未知'}`,
        `创建时间: ${lockStatus.createdAt ?? '未知'}`,
        '确认没有发布或回滚任务后再手动删除该目录',
      ].join('；'),
    });
  } catch (error) {
    checks.push({
      name: '远端锁',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function addSourcePathCheck(checks: DoctorCheck[], sourcePath: string): Promise<void> {
  try {
    await access(sourcePath);
    checks.push({
      name: '本地源路径',
      status: 'pass',
      message: `本地源路径存在: ${sourcePath}`,
    });
  } catch {
    checks.push({
      name: '本地源路径',
      status: 'fail',
      message: `本地源路径不存在: ${sourcePath}`,
    });
  }
}

async function addLocalDependencyChecks(
  checks: DoctorCheck[],
  config: SshReleaseConfig,
  localCommandExists: (command: string) => Promise<boolean>,
): Promise<void> {
  await addLocalCommandCheck(checks, 'tar', '本地 tar', localCommandExists);
  await addLocalCommandCheck(checks, 'ssh', '本地 ssh', localCommandExists);
  await addLocalCommandCheck(checks, 'scp', '本地 scp', localCommandExists);

  if (config.server.password) {
    await addLocalCommandCheck(
      checks,
      'sshpass',
      '本地 sshpass',
      localCommandExists,
      '本地 sshpass 不可用；密码登录需要安装 sshpass，或改用私钥登录',
    );
  }
}

async function addLocalCommandCheck(
  checks: DoctorCheck[],
  command: string,
  name: string,
  localCommandExists: (command: string) => Promise<boolean>,
  missingMessage = `${name} 不可用；请安装后重试`,
): Promise<void> {
  const exists = await localCommandExists(command);

  checks.push({
    name,
    status: exists ? 'pass' : 'fail',
    message: exists ? `${name} 可用` : missingMessage,
  });
}

async function defaultLocalCommandExists(command: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await runProcess('where.exe', [command]);
      return true;
    }

    await runProcess('sh', ['-c', `command -v ${shellQuote(command)} >/dev/null 2>&1`]);
    return true;
  } catch {
    return false;
  }
}

async function addRemoteCheck(
  checks: DoctorCheck[],
  name: string,
  run: () => Promise<unknown>,
  successMessage: string,
): Promise<void> {
  try {
    await run();
    checks.push({
      name,
      status: 'pass',
      message: successMessage,
    });
  } catch (error) {
    checks.push({
      name,
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
