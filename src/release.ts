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
