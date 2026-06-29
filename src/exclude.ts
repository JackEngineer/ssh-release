import path from 'node:path';

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function isExcludedPath(relativePath: string, exclude: string[]): boolean {
  const normalizedPath = toPosixPath(relativePath);
  const pathSegments = normalizedPath.split('/');

  return exclude.some((pattern) => {
    const normalizedPattern = toPosixPath(pattern);

    if (!normalizedPattern.includes('/')) {
      return pathSegments.includes(normalizedPattern);
    }

    return wildcardMatch(normalizedPath, normalizedPattern)
      || wildcardMatch(`./${normalizedPath}`, normalizedPattern);
  });
}

function wildcardMatch(value: string, pattern: string): boolean {
  const escapedPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '[^/]*');

  return new RegExp(`^${escapedPattern}$`).test(value);
}
