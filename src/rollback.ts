import {
  readCurrentVersion,
  readRemoteReleaseNames,
  remoteJoin,
  shellQuote,
} from './remote.js';
import { acquireRemoteLock, readRemoteLockStatus } from './lock.js';
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

export interface RollbackPlanSwitch {
  currentSymlink: string;
  from: string;
  target: string;
}

export interface RollbackPlanCleanup {
  lockPath: string;
  oldReleases: string;
}

export interface RollbackPlan {
  dryRun: true;
  mode: 'release';
  version: string;
  requestedVersion?: string;
  currentVersion: string;
  targetPath: string;
  currentSymlink: string;
  switch: RollbackPlanSwitch;
  cleanup: RollbackPlanCleanup;
  verification: string[];
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

export async function createRollbackPlan(
  config: SshReleaseConfig,
  client: RemoteClient,
  requestedVersion?: string,
): Promise<RollbackPlan> {
  if (config.deploy.mode === 'overwrite') {
    throw new Error('overwrite 模式不支持回滚');
  }

  const lockStatus = await readRemoteLockStatus(config, client);

  if (lockStatus.locked) {
    throw new Error(`远程已有发布任务正在运行，请确认后删除 ${lockStatus.lockPath}`);
  }

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

  return {
    dryRun: true,
    mode: 'release',
    version: targetVersion,
    requestedVersion,
    currentVersion,
    targetPath: remoteJoin(releasesPath, targetVersion),
    currentSymlink: currentSymlinkPath,
    switch: {
      currentSymlink: currentSymlinkPath,
      from: remoteJoin(config.target.releasesDir, currentVersion),
      target: remoteJoin(config.target.releasesDir, targetVersion),
    },
    cleanup: {
      lockPath: lockStatus.lockPath,
      oldReleases: '回滚只切换 current，不删除任何版本目录',
    },
    verification: [
      '远端锁未占用',
      '目标版本目录存在',
      'current 将指向目标版本',
    ],
  };
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
