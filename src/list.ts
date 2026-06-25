import {
  readCurrentVersion,
  readRemoteReleaseEntries,
  remoteJoin,
} from './remote.js';
import type { RemoteClient } from './ssh.js';
import type { SshReleaseConfig } from './types.js';

export interface ListedRelease {
  version: string;
  modifiedAt: Date;
  current: boolean;
}

export interface ListReleasesResult {
  mode: 'release' | 'overwrite';
  targetPath: string;
  currentVersion?: string;
  releases: ListedRelease[];
}

export async function listReleases(
  config: SshReleaseConfig,
  client: RemoteClient,
): Promise<ListReleasesResult> {
  if (config.deploy.mode === 'overwrite') {
    return {
      mode: 'overwrite',
      targetPath: config.target.path,
      releases: [],
    };
  }

  const releasesPath = remoteJoin(config.target.path, config.target.releasesDir);
  const currentSymlinkPath = remoteJoin(config.target.path, config.target.currentSymlink);
  const [currentVersion, releases] = await Promise.all([
    readCurrentVersion(client, currentSymlinkPath),
    readRemoteReleaseEntries(client, releasesPath),
  ]);

  return {
    mode: 'release',
    targetPath: config.target.path,
    currentVersion,
    releases: releases.map((release) => ({
      ...release,
      current: release.version === currentVersion,
    })),
  };
}
