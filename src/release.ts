import { access } from 'node:fs/promises';

import {
  createReleasePackage,
  type CreateReleasePackageOptions,
  type ReleasePackage,
} from './package.js';
import {
  createReleaseManifest,
  writeReleaseManifest,
  type ReleaseManifest,
  type WrittenReleaseManifest,
} from './manifest.js';
import { acquireRemoteLock, readRemoteLockStatus } from './lock.js';
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
  manifest?: DeployManifestSummary;
  verified?: boolean;
  verification?: DeployVerificationCheck[];
  warnings: string[];
}

export interface DeployManifestSummary {
  remotePath: string;
  fileCount: number;
  totalBytes: number;
  sha256: string;
}

export interface DeployPlan {
  dryRun: true;
  mode: 'release' | 'overwrite';
  version?: string;
  sourcePath: string;
  targetPath: string;
  currentSymlink?: string;
  upload: DeployPlanUpload;
  switch?: DeployPlanSwitch;
  cleanup: DeployPlanCleanup;
  verification: string[];
}

export interface DeployPlanUpload {
  sourcePath: string;
  archivePath: string;
  manifestPath: string;
  fileCount: number;
  totalBytes: number;
}

export interface DeployPlanSwitch {
  currentSymlink: string;
  target: string;
}

export interface DeployPlanCleanup {
  lockPath: string;
  tempArchivePath: string;
  keepReleases: number;
  oldReleases: string;
}

export type DeployProgressStage = 'source' | 'lock' | 'package' | 'publish' | 'cleanup';

export type DeployProgressStatus = 'start' | 'success' | 'fail';

export interface DeployProgressEvent {
  stage: DeployProgressStage;
  status: DeployProgressStatus;
  error?: string;
}

export interface DeployVerificationCheck {
  name: string;
  status: 'pass';
  message: string;
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

const maxVersionSuffixAttempts = 1000;

export async function resolveUniqueReleaseVersion(
  config: SshReleaseConfig,
  client: RemoteClient,
  baseVersionName: string,
): Promise<string> {
  const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);

  for (let attempt = 1; attempt <= maxVersionSuffixAttempts; attempt += 1) {
    const candidate = attempt === 1 ? baseVersionName : `${baseVersionName}-${attempt}`;
    const candidatePath = remoteJoin(releasesPath, candidate);
    const result = await client.exec(`test -e ${shellQuote(candidatePath)} && echo exists || true`);

    if (result.stdout.trim() !== 'exists') {
      return candidate;
    }
  }

  throw new Error(`无法为版本 ${baseVersionName} 生成唯一目录名，已尝试 ${maxVersionSuffixAttempts} 次`);
}

export async function deploy(
  config: SshReleaseConfig,
  client: RemoteClient,
  options: DeployOptions = {},
): Promise<DeployResult> {
  await withDeployProgress(options, 'source', () => ensureSourceExists(config.source.path));

  const releaseDate = options.now ?? new Date();
  let versionName = createVersionName(releaseDate);
  const packageFactory = options.createPackage ?? createReleasePackage;
  const releaseLock = await withDeployProgress(options, 'lock', () => acquireRemoteLock(config, client));

  if (config.deploy.mode === 'release') {
    versionName = await resolveUniqueReleaseVersion(config, client, versionName);
  }

  let releasePackage: ReleasePackage | undefined;
  let manifest: ReleaseManifest | undefined;
  let manifestFile: WrittenReleaseManifest | undefined;
  let result: DeployResult | undefined;
  let deployError: unknown;
  let cleanupError: unknown;

  try {
    releasePackage = await withDeployProgress(options, 'package', async () => {
      const createdPackage = await packageFactory({
        sourcePath: config.source.path,
        exclude: config.source.exclude,
        versionName,
      });

      try {
        manifest = await createReleaseManifest({
          version: versionName,
          createdAt: releaseDate,
          sourcePath: config.source.path,
          exclude: config.source.exclude,
        });
        manifestFile = await writeReleaseManifest(manifest);
        return createdPackage;
      } catch (error) {
        await createdPackage.cleanup();
        throw error;
      }
    });

    if (!manifest || !manifestFile) {
      throw new Error('发布清单生成失败');
    }

    if (config.deploy.mode === 'overwrite') {
      result = await withDeployProgress(
        options,
        'publish',
        () => deployOverwrite(config, client, releasePackage as ReleasePackage, manifest as ReleaseManifest, manifestFile as WrittenReleaseManifest, versionName),
      );
      return result;
    }

    result = await withDeployProgress(
      options,
      'publish',
      () => deployRelease(config, client, releasePackage as ReleasePackage, manifest as ReleaseManifest, manifestFile as WrittenReleaseManifest, versionName),
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

      if (manifestFile) {
        try {
          await manifestFile.cleanup();
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

      if (result && !deployError && !cleanupError) {
        result.verification = await verifyDeployResult(config, client, result);
        result.verified = true;
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
  const releaseDate = options.now ?? new Date();
  const versionName = createVersionName(releaseDate);
  const tempArchivePath = remoteJoin(config.target.path, config.target.tempDir, `${versionName}.tgz`);
  const lockPath = remoteJoin(config.target.path, '.ssh-release.lock');
  const manifest = await createReleaseManifest({
    version: versionName,
    createdAt: releaseDate,
    sourcePath: config.source.path,
    exclude: config.source.exclude,
  });

  if (config.deploy.mode === 'overwrite') {
    return {
      dryRun: true,
      mode: 'overwrite',
      sourcePath: config.source.path,
      targetPath: config.target.path,
      upload: createDeployPlanUpload(config, manifest, tempArchivePath, remoteJoin(config.target.path, 'manifest.json')),
      cleanup: {
        lockPath,
        tempArchivePath,
        keepReleases: config.deploy.keepReleases,
        oldReleases: 'overwrite 模式不清理版本目录',
      },
      verification: [
        '目标目录存在',
        'manifest.json hash 匹配',
        '远端锁已清理',
      ],
    };
  }

  const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);
  const releasePath = remoteJoin(releasesPath, versionName);
  const currentSymlink = remoteJoin(config.target.path, config.target.currentSymlink);
  const switchTarget = remoteJoin(config.target.releasesDir, versionName);

  return {
    dryRun: true,
    mode: 'release',
    version: versionName,
    sourcePath: config.source.path,
    targetPath: releasePath,
    currentSymlink,
    upload: createDeployPlanUpload(config, manifest, tempArchivePath, remoteJoin(releasePath, 'manifest.json')),
    switch: {
      currentSymlink,
      target: switchTarget,
    },
    cleanup: {
      lockPath,
      tempArchivePath,
      keepReleases: config.deploy.keepReleases,
      oldReleases: `发布成功后保留最新 ${config.deploy.keepReleases} 个版本，并保留当前版本`,
    },
    verification: [
      '版本目录存在',
      'current 指向新版本',
      'manifest.json hash 匹配',
      '远端锁已清理',
    ],
  };
}

function createDeployPlanUpload(
  config: SshReleaseConfig,
  manifest: ReleaseManifest,
  archivePath: string,
  manifestPath: string,
): DeployPlanUpload {
  return {
    sourcePath: config.source.path,
    archivePath,
    manifestPath,
    fileCount: manifest.totals.files,
    totalBytes: manifest.totals.bytes,
  };
}

async function deployRelease(
  config: SshReleaseConfig,
  client: RemoteClient,
  releasePackage: ReleasePackage,
  manifest: ReleaseManifest,
  manifestFile: WrittenReleaseManifest,
  versionName: string,
): Promise<DeployResult> {
  const warnings: string[] = [];
  const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);
  const releasePath = remoteJoin(releasesPath, versionName);
  const tempPath = remoteJoin(config.target.path, config.target.tempDir);
  const remoteArchivePath = remoteJoin(tempPath, `${versionName}.tgz`);
  const remoteManifestPath = remoteJoin(releasePath, 'manifest.json');
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

  await client.uploadFile(manifestFile.localPath, remoteManifestPath);
  await client.exec(`ln -sfn ${shellQuote(remoteJoin(config.target.releasesDir, versionName))} ${shellQuote(currentSymlinkPath)}`);
  await cleanupRemoteArchive(client, remoteArchivePath, warnings);
  await cleanupOldReleases(config, client, releasesPath, versionName, warnings);

  return {
    mode: 'release',
    version: versionName,
    targetPath: releasePath,
    currentSymlink: currentSymlinkPath,
    usedFallback,
    manifest: createDeployManifestSummary(manifest, manifestFile, remoteManifestPath),
    warnings,
  };
}

async function deployOverwrite(
  config: SshReleaseConfig,
  client: RemoteClient,
  releasePackage: ReleasePackage,
  manifest: ReleaseManifest,
  manifestFile: WrittenReleaseManifest,
  versionName: string,
): Promise<DeployResult> {
  const warnings: string[] = [];
  const tempPath = remoteJoin(config.target.path, config.target.tempDir);
  const remoteArchivePath = remoteJoin(tempPath, `${versionName}.tgz`);
  const remoteManifestPath = remoteJoin(config.target.path, 'manifest.json');

  await client.exec(`mkdir -p ${shellQuote(config.target.path)} ${shellQuote(tempPath)}`);
  await client.uploadFile(releasePackage.archivePath, remoteArchivePath);

  const usedFallback = await publishPackageToRemotePath(
    config,
    client,
    remoteArchivePath,
    config.target.path,
    false,
  );

  await client.uploadFile(manifestFile.localPath, remoteManifestPath);
  await cleanupRemoteArchive(client, remoteArchivePath, warnings);

  return {
    mode: 'overwrite',
    targetPath: config.target.path,
    usedFallback,
    manifest: createDeployManifestSummary(manifest, manifestFile, remoteManifestPath),
    warnings,
  };
}

function createDeployManifestSummary(
  manifest: ReleaseManifest,
  manifestFile: WrittenReleaseManifest,
  remotePath: string,
): DeployManifestSummary {
  return {
    remotePath,
    fileCount: manifest.totals.files,
    totalBytes: manifest.totals.bytes,
    sha256: manifestFile.sha256,
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

async function verifyDeployResult(
  config: SshReleaseConfig,
  client: RemoteClient,
  result: DeployResult,
): Promise<DeployVerificationCheck[]> {
  if (result.mode === 'overwrite') {
    return [
      await verifyRemoteDirectory(client, result.targetPath, '目标目录', '远端目标目录存在'),
      ...await verifyOptionalManifest(client, result),
      await verifyRemoteLockReleased(config, client),
    ];
  }

  if (!result.version || !result.currentSymlink) {
    throw new Error('release 发布结果缺少版本号或 current 路径，无法校验远端状态');
  }

  return [
    await verifyRemoteDirectory(client, result.targetPath, '版本目录', '远端版本目录存在'),
    await verifyCurrentSymlink(client, result.currentSymlink, remoteJoin(config.target.releasesDir, result.version)),
    ...await verifyOptionalManifest(client, result),
    await verifyRemoteLockReleased(config, client),
  ];
}

async function verifyOptionalManifest(
  client: RemoteClient,
  result: DeployResult,
): Promise<DeployVerificationCheck[]> {
  if (!result.manifest) {
    return [];
  }

  return [await verifyRemoteManifest(client, result.manifest)];
}

async function verifyRemoteManifest(
  client: RemoteClient,
  manifest: DeployManifestSummary,
): Promise<DeployVerificationCheck> {
  try {
    await client.exec(`test -f ${shellQuote(manifest.remotePath)}`);
  } catch (error) {
    throw new Error(`manifest 校验失败: ${formatError(error)}`);
  }

  const actualHash = await readRemoteFileSha256(client, manifest.remotePath);

  if (actualHash !== manifest.sha256) {
    throw new Error(`manifest hash 不匹配: 期望 ${manifest.sha256}，实际 ${actualHash || '空'}`);
  }

  return {
    name: '发布清单',
    status: 'pass',
    message: `manifest.json 已上传并校验，文件数 ${manifest.fileCount}`,
  };
}

async function readRemoteFileSha256(
  client: RemoteClient,
  remotePath: string,
): Promise<string> {
  const quotedPath = shellQuote(remotePath);
  const result = await client.exec(`if command -v sha256sum >/dev/null 2>&1; then sha256sum ${quotedPath} | awk '{print $1}'; elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${quotedPath} | awk '{print $1}'; else echo ''; fi`);
  const hash = result.stdout.trim();

  if (!hash) {
    throw new Error('远端缺少 sha256sum 或 shasum，无法校验 manifest hash');
  }

  return hash;
}

async function verifyRemoteDirectory(
  client: RemoteClient,
  remotePath: string,
  name: string,
  successMessage: string,
): Promise<DeployVerificationCheck> {
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
): Promise<DeployVerificationCheck> {
  let actualTarget: string;

  try {
    const result = await client.exec(`readlink ${shellQuote(currentSymlinkPath)}`);
    actualTarget = result.stdout.trim();
  } catch (error) {
    throw new Error(`current 校验失败: ${formatError(error)}`);
  }

  if (actualTarget !== expectedTarget) {
    throw new Error(`current 未指向新版本: 期望 ${expectedTarget}，实际 ${actualTarget || '空'}`);
  }

  return {
    name: '当前版本',
    status: 'pass',
    message: 'current 已指向新版本',
  };
}

async function verifyRemoteLockReleased(
  config: SshReleaseConfig,
  client: RemoteClient,
): Promise<DeployVerificationCheck> {
  const lockStatus = await readRemoteLockStatus(config, client);

  if (lockStatus.locked) {
    throw new Error(`发布锁未清理: ${lockStatus.lockPath}`);
  }

  return {
    name: '远端锁',
    status: 'pass',
    message: '发布锁已清理',
  };
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
