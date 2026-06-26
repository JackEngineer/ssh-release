import { remoteJoin, shellQuote } from './remote.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

const remoteLockDir = '.ssh-release.lock';

export interface RemoteLockOptions {
  createTargetPath?: boolean;
}

export interface RemoteLockStatus {
  locked: boolean;
  lockPath: string;
  pid?: string;
  createdAt?: string;
}

export interface WaitForRemoteLockReleasedOptions {
  label?: string;
  attempts?: number;
  delayMs?: number;
}

export function getRemoteLockPath(config: SshReleaseConfig): string {
  return remoteJoin(config.target.path, remoteLockDir);
}

export async function readRemoteLockStatus(
  config: SshReleaseConfig,
  client: RemoteClient,
): Promise<RemoteLockStatus> {
  const lockPath = getRemoteLockPath(config);
  const pidPath = remoteJoin(lockPath, 'pid');
  const createdAtPath = remoteJoin(lockPath, 'created_at');
  const result = await client.exec(`if [ -d ${shellQuote(lockPath)} ]; then echo locked; printf 'pid='; cat ${shellQuote(pidPath)} 2>/dev/null || true; printf '\\ncreated_at='; cat ${shellQuote(createdAtPath)} 2>/dev/null || true; printf '\\n'; else echo unlocked; fi`);
  const lines = result.stdout.split('\n').map((line) => line.trim());

  if (lines[0] !== 'locked') {
    return {
      locked: false,
      lockPath,
    };
  }

  return {
    locked: true,
    lockPath,
    pid: parseRemoteLockValue(lines, 'pid'),
    createdAt: parseRemoteLockValue(lines, 'created_at'),
  };
}

export async function acquireRemoteLock(
  config: SshReleaseConfig,
  client: RemoteClient,
  options: RemoteLockOptions = {},
): Promise<() => Promise<void>> {
  const createTargetPath = options.createTargetPath ?? true;
  const lockPath = getRemoteLockPath(config);
  const createdAtPath = remoteJoin(lockPath, 'created_at');
  const pidPath = remoteJoin(lockPath, 'pid');
  const lockedMessage = `远程已有发布任务正在运行，请确认后删除 ${lockPath}`;
  const missingTargetMessage = `远程目标目录不存在: ${config.target.path}`;
  const prepareTarget = createTargetPath
    ? `mkdir -p ${shellQuote(config.target.path)}`
    : `if [ -d ${shellQuote(config.target.path)} ]; then :; else echo ${shellQuote(missingTargetMessage)} >&2; exit 74; fi`;
  const command = `${prepareTarget} && if mkdir ${shellQuote(lockPath)} 2>/dev/null; then printf '%s\\n' "$$" > ${shellQuote(pidPath)}; date -u '+%Y-%m-%dT%H:%M:%SZ' > ${shellQuote(createdAtPath)}; else echo ${shellQuote(lockedMessage)} >&2; exit 73; fi`;

  await client.exec(command);

  return async () => {
    await client.exec(`rm -rf ${shellQuote(lockPath)}`);
  };
}

export async function removeRemoteLock(
  config: SshReleaseConfig,
  client: RemoteClient,
): Promise<void> {
  await client.exec(`rm -rf ${shellQuote(getRemoteLockPath(config))}`);
}

export async function waitForRemoteLockReleased(
  config: SshReleaseConfig,
  client: RemoteClient,
  options: WaitForRemoteLockReleasedOptions = {},
): Promise<void> {
  const label = options.label ?? '远端锁';
  const attempts = Math.max(1, options.attempts ?? 4);
  const delayMs = Math.max(0, options.delayMs ?? 50);
  let lockStatus = await readRemoteLockStatus(config, client);

  for (let attempt = 1; attempt < attempts && lockStatus.locked; attempt += 1) {
    await delay(delayMs);
    lockStatus = await readRemoteLockStatus(config, client);
  }

  if (lockStatus.locked) {
    throw new Error(`${label}未清理: ${lockStatus.lockPath}`);
  }
}

function parseRemoteLockValue(lines: string[], fieldName: string): string | undefined {
  const prefix = `${fieldName}=`;
  const line = lines.find((entry) => entry.startsWith(prefix));
  const value = line?.slice(prefix.length).trim();

  return value || undefined;
}

async function delay(ms: number): Promise<void> {
  if (ms === 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
