import { writeFile } from 'node:fs/promises';

export const CONFIG_FILE_NAME = 'ssh-release.config.ts';

export function createConfigTemplate(): string {
  return `export default {
  source: {
    path: './dist',
    exclude: ['.DS_Store', 'node_modules'],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: 22,
    username: process.env.SSH_RELEASE_USER,
    privateKeyPath: '~/.ssh/id_rsa',
  },

  target: {
    path: '/var/www/my-app',
    currentSymlink: 'current',
    releasesDir: 'releases',
    tempDir: '.ssh-release-tmp',
  },

  deploy: {
    mode: 'release',
    keepReleases: 5,
    compression: 'tgz',
    preferTar: true,
    fallbackToFileUpload: true,
  },
};
`;
}

export async function writeConfigTemplate(configPath = CONFIG_FILE_NAME): Promise<void> {
  await writeFile(configPath, createConfigTemplate(), { flag: 'wx' });
}
