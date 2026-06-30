import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { loadConfigFile } from '../src/config.js';

const examples = [
  {
    name: 'static-site',
    sourcePath: './dist',
    targetPath: '/var/www/example-static-site',
  },
  {
    name: 'single-file',
    sourcePath: './dist/app.tar.gz',
    targetPath: '/var/www/example-artifacts',
  },
  {
    name: 'github-actions',
    sourcePath: './dist',
    targetPath: '/var/www/example-ci-app',
  },
  {
    name: 'real-world-static-site',
    sourcePath: './dist',
    targetPath: '/var/www/acme-marketing-site',
  },
];

const sensitivePattern = new RegExp([
  ['47', '114', '97', '21'].join('\\.'),
  ['xiao', 'mao', '1994'].join(''),
  'npm_[A-Za-z0-9]{20,}',
  'password:\\s*[\'"`]',
  'host:\\s*[\'"`](?!/var/www)',
].join('|'), 'i');

test('README exposes a short path to runnable examples', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /3 分钟接入/);
  assert.match(readme, /examples\/static-site/);
  assert.match(readme, /examples\/single-file/);
  assert.match(readme, /examples\/github-actions/);
  assert.match(readme, /examples\/real-world-static-site/);
  assert.match(readme, /ssh-release init --template static-site/);
  assert.doesNotMatch(readme, /^cp examples\/static-site\/ssh-release\.config\.ts/m);
  assert.doesNotMatch(readme, /raw\.githubusercontent\.com\/JackEngineer\/ssh-release\/main\/examples\/static-site\/ssh-release\.config\.ts/);
});

test('example configs load with environment variables and stay inside safe placeholders', async () => {
  await withExampleEnv(async () => {
    for (const example of examples) {
      const configPath = path.resolve('examples', example.name, 'ssh-release.config.ts');
      const configContent = await readFile(configPath, 'utf8');
      const readmeContent = await readFile(
        path.resolve('examples', example.name, 'README.md'),
        'utf8',
      );
      const config = await loadConfigFile(configPath);

      assert.equal(config.source.path, example.sourcePath);
      assert.equal(config.server.host, 'example.com');
      assert.equal(config.server.username, 'deploy');
      assert.equal(config.server.password, 'example-password');
      assert.equal(config.target.path, example.targetPath);
      assert.equal(config.deploy.mode, 'release');
      assert.match(configContent, /process\.env\.SSH_RELEASE_HOST/);
      assert.match(configContent, /process\.env\.SSH_RELEASE_USER/);
      assert.match(configContent, /process\.env\.SSH_RELEASE_PASSWORD/);
      assert.doesNotMatch(`${configContent}\n${readmeContent}`, sensitivePattern);
    }
  });
});

test('GitHub Actions example keeps deploy credentials in secrets', async () => {
  const workflow = await readFile(
    new URL('../examples/github-actions/deploy.yml', import.meta.url),
    'utf8',
  );

  assert.match(workflow, /environment: production/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /node-version: '24'/);
  assert.match(workflow, /npx ssh-release doctor --json/);
  assert.match(workflow, /npx ssh-release deploy --json --progress/);
  assert.match(workflow, /secrets\.SSH_RELEASE_HOST/);
  assert.match(workflow, /secrets\.SSH_RELEASE_USER/);
  assert.match(workflow, /secrets\.SSH_RELEASE_PASSWORD/);
  assert.doesNotMatch(workflow, /actions\/checkout@v4|actions\/setup-node@v4|node-version: 20/);
  assert.doesNotMatch(workflow, sensitivePattern);
});

test('real-world static site example shows a complete business repository shape', async () => {
  const readme = await readFile(
    new URL('../examples/real-world-static-site/README.md', import.meta.url),
    'utf8',
  );
  const packageJson = JSON.parse(await readFile(
    new URL('../examples/real-world-static-site/package.json', import.meta.url),
    'utf8',
  )) as { scripts: Record<string, string> };
  const packageLock = JSON.parse(await readFile(
    new URL('../examples/real-world-static-site/package-lock.json', import.meta.url),
    'utf8',
  )) as { lockfileVersion: number; name: string };
  const workflow = await readFile(
    new URL('../examples/real-world-static-site/.github/workflows/deploy.yml', import.meta.url),
    'utf8',
  );

  assert.match(readme, /真实业务场景/);
  assert.match(readme, /package\.json/);
  assert.match(readme, /npm run build/);
  assert.match(readme, /npm run release:doctor/);
  assert.match(readme, /npm run release:plan/);
  assert.match(readme, /npm run release:rollback:plan/);
  assert.match(readme, /current -> releases\/<version>/);
  assert.equal(packageJson.scripts.build, 'node scripts/build.js');
  assert.equal(packageJson.scripts['release:doctor'], 'npx --yes ssh-release doctor');
  assert.equal(packageJson.scripts['release:plan'], 'npx --yes ssh-release deploy --plan');
  assert.equal(packageJson.scripts['release:deploy'], 'npx --yes ssh-release deploy --json --progress');
  assert.equal(packageJson.scripts['release:rollback:plan'], 'npx --yes ssh-release rollback --plan');
  assert.equal(packageJson.scripts['release:rollback'], 'npx --yes ssh-release rollback --json --progress');
  assert.equal(packageLock.name, 'acme-marketing-site');
  assert.equal(packageLock.lockfileVersion, 3);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /npm run release:doctor -- --json/);
  assert.match(workflow, /npm run release:plan -- --json/);
  assert.match(workflow, /npm run release:deploy/);
  assert.match(workflow, /secrets\.SSH_RELEASE_HOST/);
  assert.match(workflow, /secrets\.SSH_RELEASE_USER/);
  assert.match(workflow, /secrets\.SSH_RELEASE_PASSWORD/);
  assert.doesNotMatch(`${readme}\n${workflow}\n${JSON.stringify(packageJson)}`, sensitivePattern);
});

async function withExampleEnv(run: () => Promise<void>): Promise<void> {
  const previous = {
    SSH_RELEASE_HOST: process.env.SSH_RELEASE_HOST,
    SSH_RELEASE_USER: process.env.SSH_RELEASE_USER,
    SSH_RELEASE_PASSWORD: process.env.SSH_RELEASE_PASSWORD,
  };

  process.env.SSH_RELEASE_HOST = 'example.com';
  process.env.SSH_RELEASE_USER = 'deploy';
  process.env.SSH_RELEASE_PASSWORD = 'example-password';

  try {
    await run();
  } finally {
    restoreEnv('SSH_RELEASE_HOST', previous.SSH_RELEASE_HOST);
    restoreEnv('SSH_RELEASE_USER', previous.SSH_RELEASE_USER);
    restoreEnv('SSH_RELEASE_PASSWORD', previous.SSH_RELEASE_PASSWORD);
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
