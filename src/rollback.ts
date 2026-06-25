export interface RollbackSelection {
  releases: string[];
  currentVersion: string;
  requestedVersion?: string;
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
