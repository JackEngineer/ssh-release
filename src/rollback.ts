import {
  readCurrentVersion,
  readRemoteReleaseNames,
  remoteJoin,
  shellQuote,
} from './remote.js';
import { acquireRemoteLock, readRemoteLockStatus, waitForRemoteLockReleased } from './lock.js';
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
  verified?: boolean;
  verification?: RollbackVerificationCheck[];
  warnings: string[];
}

export interface RollbackVerificationCheck {
  name: string;
  status: 'pass';
  message: string;
}

export type RollbackProgressStage = 'lock' | 'switch' | 'cleanup' | 'verify';

export type RollbackProgressStatus = 'start' | 'success' | 'fail';

export interface RollbackProgressEvent {
  stage: RollbackProgressStage;
  status: RollbackProgressStatus;
  error?: string;
}

export interface RollbackOptions {
  onProgress?: (event: RollbackProgressEvent) => void | Promise<void>;
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
  options: RollbackOptions = {},
): Promise<RollbackResult> {
  if (config.deploy.mode === 'overwrite') {
    throw new Error('overwrite 模式不支持回滚');
  }

  const releaseLock = await withRollbackProgress(
    options,
    'lock',
    () => acquireRemoteLock(config, client, { createTargetPath: false }),
  );
  let result: RollbackResult | undefined;
  let rollbackError: unknown;
  let cleanupError: unknown;

  try {
    result = await withRollbackProgress(options, 'switch', async () => {
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

      return {
        version: targetVersion,
        currentSymlink: currentSymlinkPath,
        warnings: [],
      };
    });
    return result;
  } catch (error) {
    rollbackError = error;
    throw error;
  } finally {
    await withRollbackProgress(options, 'cleanup', async () => {
      try {
        await releaseLock();
        await waitForRemoteLockReleased(config, client, { label: '回滚锁' });
      } catch (error) {
        const message = `远程回滚锁清理失败: ${formatError(error)}`;

        if (result) {
          result.warnings.push(message);
        }

        if (!rollbackError) {
          cleanupError = error;
        }
      }

      if (cleanupError && !rollbackError) {
        throw cleanupError;
      }
    });

    const rollbackResult = result;

    if (rollbackResult && !rollbackError && !cleanupError) {
      await withRollbackProgress(options, 'verify', async () => {
        rollbackResult.verification = await verifyRollbackResult(config, client, rollbackResult);
        rollbackResult.verified = true;
      });
    }
  }
}

async function verifyRollbackResult(
  config: SshReleaseConfig,
  client: RemoteClient,
  result: RollbackResult,
): Promise<RollbackVerificationCheck[]> {
  return [
    await verifyRemoteDirectory(
      client,
      remoteJoin(config.target.path, config.target.releasesDir, result.version),
      '目标版本',
      '目标版本目录存在',
    ),
    await verifyCurrentSymlink(client, result.currentSymlink, remoteJoin(config.target.releasesDir, result.version)),
    await verifyRemoteLockReleased(config, client),
  ];
}

async function verifyRemoteDirectory(
  client: RemoteClient,
  remotePath: string,
  name: string,
  successMessage: string,
): Promise<RollbackVerificationCheck> {
  try {
    await client.exec(`test -d ${shellQuote(remotePath)}`);
  } catch (error) {
    throw new Error(`${name}校验失败: ${formatError(error)}`);
  }

  return {
    name,
    status: 'pass',
    message: successMessage,
  };
}

async function verifyCurrentSymlink(
  client: RemoteClient,
  currentSymlinkPath: string,
  expectedTarget: string,
): Promise<RollbackVerificationCheck> {
  let actualTarget: string;

  try {
    const result = await client.exec(`readlink ${shellQuote(currentSymlinkPath)}`);
    actualTarget = result.stdout.trim();
  } catch (error) {
    throw new Error(`current 校验失败: ${formatError(error)}`);
  }

  if (actualTarget !== expectedTarget) {
    throw new Error(`current 未指向目标版本: 期望 ${expectedTarget}，实际 ${actualTarget || '空'}`);
  }

  return {
    name: '当前版本',
    status: 'pass',
    message: 'current 已指向目标版本',
  };
}

async function verifyRemoteLockReleased(
  config: SshReleaseConfig,
  client: RemoteClient,
): Promise<RollbackVerificationCheck> {
  const lockStatus = await readRemoteLockStatus(config, client);

  if (lockStatus.locked) {
    throw new Error(`回滚锁未清理: ${lockStatus.lockPath}`);
  }

  return {
    name: '远端锁',
    status: 'pass',
    message: '回滚锁已清理',
  };
}

async function withRollbackProgress<T>(
  options: RollbackOptions,
  stage: RollbackProgressStage,
  run: () => Promise<T>,
): Promise<T> {
  await emitRollbackProgress(options, { stage, status: 'start' });

  try {
    const result = await run();
    await emitRollbackProgress(options, { stage, status: 'success' });
    return result;
  } catch (error) {
    await emitRollbackProgress(options, {
      stage,
      status: 'fail',
      error: formatError(error),
    });
    throw error;
  }
}

async function emitRollbackProgress(
  options: RollbackOptions,
  event: RollbackProgressEvent,
): Promise<void> {
  await options.onProgress?.(event);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
