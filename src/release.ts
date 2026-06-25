import { access } from 'node:fs/promises';

import {
  createReleasePackage,
  type CreateReleasePackageOptions,
  type ReleasePackage,
} from './package.js';
import { acquireRemoteLock } from './lock.js';
import {
  readRemoteReleaseNames,
  remoteJoin,
  shellQuote,
} from './remote.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

export interface DeployResult {
  mode: 'release' | 'overwrite';
  version?: string;
  targetPath: string;
  currentSymlink?: string;
  usedFallback: boolean;
  warnings: string[];
}

export interface DeployPlan {
  dryRun: true;
  mode: 'release' | 'overwrite';
  version?: string;
  sourcePath: string;
  targetPath: string;
  currentSymlink?: string;
}

export type DeployProgressStage = 'source' | 'lock' | 'package' | 'publish' | 'cleanup';

export type DeployProgressStatus = 'start' | 'success' | 'fail';

export interface DeployProgressEvent {
  stage: DeployProgressStage;
  status: DeployProgressStatus;
  error?: string;
}

export interface DeployOptions {
  now?: Date;
  createPackage?: (options: CreateReleasePackageOptions) => Promise<ReleasePackage>;
  onProgress?: (event: DeployProgressEvent) => void | Promise<void>;
}

export function createVersionName(date = new Date()): string {
  return [
    date.getFullYear().toString(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

export function selectReleasesToDelete(
  releases: string[],
  currentVersion: string | undefined,
  keepReleases: number,
): string[] {
  if (!Number.isInteger(keepReleases) || keepReleases < 1) {
    throw new Error('keepReleases 必须是正整数');
  }

  const sortedReleases = [...new Set(releases)].sort();
  const retained = new Set(sortedReleases.slice(-keepReleases));

  if (currentVersion) {
    retained.add(currentVersion);
  }

  return sortedReleases.filter((release) => !retained.has(release));
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export async function deploy(
  config: SshReleaseConfig,
  client: RemoteClient,
  options: DeployOptions = {},
): Promise<DeployResult> {
  await withDeployProgress(options, 'source', () => ensureSourceExists(config.source.path));

  const versionName = createVersionName(options.now ?? new Date());
  const packageFactory = options.createPackage ?? createReleasePackage;
  const releaseLock = await withDeployProgress(options, 'lock', () => acquireRemoteLock(config, client));
  let releasePackage: ReleasePackage | undefined;
  let result: DeployResult | undefined;
  let deployError: unknown;
  let cleanupError: unknown;

  try {
    releasePackage = await withDeployProgress(options, 'package', () => packageFactory({
      sourcePath: config.source.path,
      exclude: config.source.exclude,
      versionName,
    }));

    if (config.deploy.mode === 'overwrite') {
      result = await withDeployProgress(
        options,
        'publish',
        () => deployOverwrite(config, client, releasePackage as ReleasePackage, versionName),
      );
      return result;
    }

    result = await withDeployProgress(
      options,
      'publish',
      () => deployRelease(config, client, releasePackage as ReleasePackage, versionName),
    );
    return result;
  } catch (error) {
    deployError = error;
    throw error;
  } finally {
    await withDeployProgress(options, 'cleanup', async () => {
      if (releasePackage) {
        try {
          await releasePackage.cleanup();
        } catch (error) {
          cleanupError = error;
        }
      }

      try {
        await releaseLock();
      } catch (error) {
        const message = `远程发布锁清理失败: ${formatError(error)}`;

        if (result) {
          result.warnings.push(message);
        } else if (!deployError && !cleanupError) {
          cleanupError = error;
        }
      }

      if (cleanupError && !deployError) {
        throw cleanupError;
      }
    });
  }
}

export async function createDeployPlan(
  config: SshReleaseConfig,
  options: Pick<DeployOptions, 'now'> = {},
): Promise<DeployPlan> {
  await ensureSourceExists(config.source.path);

  if (config.deploy.mode === 'overwrite') {
    return {
      dryRun: true,
      mode: 'overwrite',
      sourcePath: config.source.path,
      targetPath: config.target.path,
    };
  }

  const versionName = createVersionName(options.now ?? new Date());
  const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);

  return {
    dryRun: true,
    mode: 'release',
    version: versionName,
    sourcePath: config.source.path,
    targetPath: remoteJoin(releasesPath, versionName),
    currentSymlink: remoteJoin(config.target.path, config.target.currentSymlink),
  };
}

async function deployRelease(
  config: SshReleaseConfig,
  client: RemoteClient,
  releasePackage: ReleasePackage,
  versionName: string,
): Promise<DeployResult> {
  const warnings: string[] = [];
  const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);
  const releasePath = remoteJoin(releasesPath, versionName);
  const tempPath = remoteJoin(config.target.path, config.target.tempDir);
  const remoteArchivePath = remoteJoin(tempPath, `${versionName}.tgz`);
  const currentSymlinkPath = remoteJoin(config.target.path, config.target.currentSymlink);

  await client.exec(`mkdir -p ${shellQuote(releasesPath)} ${shellQuote(tempPath)} ${shellQuote(releasePath)}`);
  await client.uploadFile(releasePackage.archivePath, remoteArchivePath);

  const usedFallback = await publishPackageToRemotePath(
    config,
    client,
    remoteArchivePath,
    releasePath,
    true,
  );

  await client.exec(`ln -sfn ${shellQuote(remoteJoin(config.target.releasesDir, versionName))} ${shellQuote(currentSymlinkPath)}`);
  await cleanupRemoteArchive(client, remoteArchivePath, warnings);
  await cleanupOldReleases(config, client, releasesPath, versionName, warnings);

  return {
    mode: 'release',
    version: versionName,
    targetPath: releasePath,
    currentSymlink: currentSymlinkPath,
    usedFallback,
    warnings,
  };
}

async function deployOverwrite(
  config: SshReleaseConfig,
  client: RemoteClient,
  releasePackage: ReleasePackage,
  versionName: string,
): Promise<DeployResult> {
  const warnings: string[] = [];
  const tempPath = remoteJoin(config.target.path, config.target.tempDir);
  const remoteArchivePath = remoteJoin(tempPath, `${versionName}.tgz`);

  await client.exec(`mkdir -p ${shellQuote(config.target.path)} ${shellQuote(tempPath)}`);
  await client.uploadFile(releasePackage.archivePath, remoteArchivePath);

  const usedFallback = await publishPackageToRemotePath(
    config,
    client,
    remoteArchivePath,
    config.target.path,
    false,
  );

  await cleanupRemoteArchive(client, remoteArchivePath, warnings);

  return {
    mode: 'overwrite',
    targetPath: config.target.path,
    usedFallback,
    warnings,
  };
}

async function publishPackageToRemotePath(
  config: SshReleaseConfig,
  client: RemoteClient,
  remoteArchivePath: string,
  remoteTargetPath: string,
  cleanBeforeFallback: boolean,
): Promise<boolean> {
  if (!config.deploy.preferTar) {
    await client.uploadDirectory(config.source.path, remoteTargetPath, config.source.exclude);
    return true;
  }

  try {
    await client.exec(`tar -xzf ${shellQuote(remoteArchivePath)} -C ${shellQuote(remoteTargetPath)}`);
    return false;
  } catch (error) {
    if (!config.deploy.fallbackToFileUpload) {
      throw error;
    }

    if (cleanBeforeFallback) {
      await client.exec(`rm -rf ${shellQuote(remoteTargetPath)} && mkdir -p ${shellQuote(remoteTargetPath)}`);
    } else {
      await client.exec(`mkdir -p ${shellQuote(remoteTargetPath)}`);
    }

    await client.uploadDirectory(config.source.path, remoteTargetPath, config.source.exclude);
    return true;
  }
}

async function cleanupRemoteArchive(
  client: RemoteClient,
  remoteArchivePath: string,
  warnings: string[],
): Promise<void> {
  try {
    await client.exec(`rm -f ${shellQuote(remoteArchivePath)}`);
  } catch (error) {
    warnings.push(`远程临时包清理失败: ${formatError(error)}`);
  }
}

async function cleanupOldReleases(
  config: SshReleaseConfig,
  client: RemoteClient,
  releasesPath: string,
  currentVersion: string,
  warnings: string[],
): Promise<void> {
  try {
    const releases = await readRemoteReleaseNames(client, releasesPath);
    const releasesToDelete = selectReleasesToDelete(
      [...releases, currentVersion],
      currentVersion,
      config.deploy.keepReleases,
    );

    for (const release of releasesToDelete) {
      await client.exec(`rm -rf ${shellQuote(remoteJoin(releasesPath, release))}`);
    }
  } catch (error) {
    warnings.push(`旧版本清理失败: ${formatError(error)}`);
  }
}

async function ensureSourceExists(sourcePath: string): Promise<void> {
  try {
    await access(sourcePath);
  } catch {
    throw new Error(`source.path 不存在: ${sourcePath}`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withDeployProgress<T>(
  options: DeployOptions,
  stage: DeployProgressStage,
  run: () => Promise<T>,
): Promise<T> {
  await emitDeployProgress(options, { stage, status: 'start' });

  try {
    const result = await run();
    await emitDeployProgress(options, { stage, status: 'success' });
    return result;
  } catch (error) {
    await emitDeployProgress(options, {
      stage,
      status: 'fail',
      error: formatError(error),
    });
    throw error;
  }
}

async function emitDeployProgress(
  options: DeployOptions,
  event: DeployProgressEvent,
): Promise<void> {
  await options.onProgress?.(event);
}
