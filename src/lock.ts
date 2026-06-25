import { remoteJoin, shellQuote } from './remote.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

const remoteLockDir = '.ssh-release.lock';

export interface RemoteLockOptions {
  createTargetPath?: boolean;
}

export function getRemoteLockPath(config: SshReleaseConfig): string {
  return remoteJoin(config.target.path, remoteLockDir);
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
