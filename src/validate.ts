import path from 'node:path';

import type {
  CompressionFormat,
  DeployMode,
  SshReleaseConfig,
  SshReleaseConfigInput,
} from './types.js';

const dangerousTargetPaths = new Set([
  '/',
  '/home',
  '/root',
  '/var',
  '/usr',
  '/etc',
  '/opt',
  '/tmp',
]);

export function validateTargetPath(targetPath: string): string {
  if (!targetPath || !targetPath.trim()) {
    throw new Error('target.path 不能为空');
  }

  const normalizedPath = path.posix.normalize(targetPath.trim());

  if (!normalizedPath.startsWith('/')) {
    throw new Error('target.path 必须是远程绝对路径');
  }

  if (dangerousTargetPaths.has(normalizedPath)) {
    throw new Error(`危险远程路径: ${normalizedPath}`);
  }

  return normalizedPath;
}

export function normalizeConfig(input: SshReleaseConfigInput): SshReleaseConfig {
  const mode = input.deploy?.mode ?? 'release';
  const compression = input.deploy?.compression ?? 'tgz';
  const keepReleases = input.deploy?.keepReleases ?? 5;
  const port = input.server?.port ?? 22;

  if (mode !== 'release' && mode !== 'overwrite') {
    throw new Error('deploy.mode 只支持 release 或 overwrite');
  }

  if (compression !== 'tgz') {
    throw new Error('deploy.compression 第一版只支持 tgz');
  }

  if (!Number.isInteger(keepReleases) || keepReleases < 1) {
    throw new Error('deploy.keepReleases 必须是正整数');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('server.port 必须是 1 到 65535 之间的整数');
  }

  const exclude = input.source?.exclude ?? [];

  if (!Array.isArray(exclude)) {
    throw new Error('source.exclude 必须是字符串数组');
  }

  return {
    source: {
      path: requiredString(input.source?.path, 'source.path'),
      exclude,
    },
    server: {
      host: requiredString(input.server?.host, 'server.host'),
      port,
      username: requiredString(input.server?.username, 'server.username'),
      privateKeyPath: requiredString(input.server?.privateKeyPath, 'server.privateKeyPath'),
    },
    target: {
      path: validateTargetPath(requiredString(input.target?.path, 'target.path')),
      currentSymlink: input.target?.currentSymlink ?? 'current',
      releasesDir: input.target?.releasesDir ?? 'releases',
      tempDir: input.target?.tempDir ?? '.ssh-release-tmp',
    },
    deploy: {
      mode: mode as DeployMode,
      keepReleases,
      compression: compression as CompressionFormat,
      preferTar: input.deploy?.preferTar ?? true,
      fallbackToFileUpload: input.deploy?.fallbackToFileUpload ?? true,
    },
  };
}

function requiredString(value: string | undefined, fieldName: string): string {
  if (!value || !value.trim()) {
    throw new Error(`${fieldName} 不能为空`);
  }

  return value.trim();
}
