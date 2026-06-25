import {
  readRemoteLockStatus,
  removeRemoteLock,
  type RemoteLockStatus,
} from './lock.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

export interface UnlockOptions {
  confirmPath?: string;
}

export interface UnlockResult extends RemoteLockStatus {
  removed: boolean;
}

export async function unlock(
  config: SshReleaseConfig,
  client: RemoteClient,
  options: UnlockOptions = {},
): Promise<UnlockResult> {
  const lockStatus = await readRemoteLockStatus(config, client);

  if (!lockStatus.locked) {
    return {
      ...lockStatus,
      removed: false,
    };
  }

  if (!options.confirmPath) {
    return {
      ...lockStatus,
      removed: false,
    };
  }

  if (options.confirmPath !== lockStatus.lockPath) {
    throw new Error(`确认路径不匹配: 需要 ${lockStatus.lockPath}`);
  }

  await removeRemoteLock(config, client);

  return {
    ...lockStatus,
    removed: true,
  };
}
