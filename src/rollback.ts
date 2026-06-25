import {
  readCurrentVersion,
  readRemoteReleaseNames,
  remoteJoin,
  shellQuote,
} from './remote.js';
import { acquireRemoteLock } from './lock.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

export interface RollbackSelection {
  releases: string[];
  currentVersion: string;
  requestedVersion?: string;
}

export interface RollbackResult {
  version: string;
  currentSymlink: string;
  warnings: string[];
}

export function selectRollbackTarget(selection: RollbackSelection): string {
  const releases = [...new Set(selection.releases)].sort();

  if (selection.requestedVersion) {
    if (!releases.includes(selection.requestedVersion)) {
      throw new Error(`回滚目标不存在: ${selection.requestedVersion}`);
    }

    return selection.requestedVersion;
  }

  const currentIndex = releases.indexOf(selection.currentVersion);

  if (currentIndex === -1) {
    throw new Error(`当前版本不存在: ${selection.currentVersion}`);
  }

  if (currentIndex === 0) {
    throw new Error('没有可回滚版本');
  }

  return releases[currentIndex - 1];
}

export async function rollback(
  config: SshReleaseConfig,
  client: RemoteClient,
  requestedVersion?: string,
): Promise<RollbackResult> {
  if (config.deploy.mode === 'overwrite') {
    throw new Error('overwrite 模式不支持回滚');
  }

  const releaseLock = await acquireRemoteLock(config, client, { createTargetPath: false });
  let result: RollbackResult | undefined;
  let rollbackError: unknown;

  try {
    const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);
    const currentSymlinkPath = remoteJoin(config.target.path, config.target.currentSymlink);
    const releases = await readRemoteReleaseNames(client, releasesPath);
    const currentVersion = await readCurrentVersion(client, currentSymlinkPath);

    if (!currentVersion) {
      throw new Error('当前版本不存在');
    }

    const targetVersion = selectRollbackTarget({
      releases,
      currentVersion,
      requestedVersion,
    });

    await client.exec(`ln -sfn ${shellQuote(remoteJoin(config.target.releasesDir, targetVersion))} ${shellQuote(currentSymlinkPath)}`);

    result = {
      version: targetVersion,
      currentSymlink: currentSymlinkPath,
      warnings: [],
    };
    return result;
  } catch (error) {
    rollbackError = error;
    throw error;
  } finally {
    try {
      await releaseLock();
    } catch (error) {
      const message = `远程发布锁清理失败: ${formatError(error)}`;

      if (result) {
        result.warnings.push(message);
      } else if (!rollbackError) {
        throw error;
      }
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
