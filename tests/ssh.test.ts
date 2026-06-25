import assert from 'node:assert/strict';
import test from 'node:test';

import { createScpRemoteTarget } from '../src/ssh.js';

test('formats scp remote target without shell quote characters', () => {
  assert.equal(
    createScpRemoteTarget('deploy@example.com', '/var/www/site/.ssh-release-tmp/release.tgz'),
    'deploy@example.com:/var/www/site/.ssh-release-tmp/release.tgz',
  );
});
