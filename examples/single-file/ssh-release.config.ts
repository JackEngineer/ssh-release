export default {
  source: {
    path: './dist/app.tar.gz',
    exclude: [],
  },

  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: Number(process.env.SSH_RELEASE_PORT || 22),
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
    privateKeyPath: process.env.SSH_RELEASE_PRIVATE_KEY_PATH,
  },

  target: {
    path: '/var/www/example-artifacts',
    currentSymlink: 'current',
    releasesDir: 'releases',
    tempDir: '.ssh-release-tmp',
  },

  deploy: {
    mode: 'release',
    keepReleases: 10,
    compression: 'tgz',
    preferTar: true,
    fallbackToFileUpload: true,
  },
};
