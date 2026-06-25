import { access } from 'node:fs/promises';

import { loadConfigFile } from './config.js';
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
  await addRemoteCheck(checks, 'SSH 连接', () => client.exec('true'), 'SSH 可连接');
  await addRemoteCheck(
    checks,
    '远程目录',
    () => client.exec(`mkdir -p ${shellQuote(config.target.path)} && test -w ${shellQuote(config.target.path)}`),
    '远程目录可创建且可写',
  );

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
