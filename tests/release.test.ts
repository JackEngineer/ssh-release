import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVersionName,
  selectReleasesToDelete,
} from '../src/release.js';

test('creates timestamp version names in yyyyMMdd-HHmmss format', () => {
  const date = new Date('2026-06-25T15:30:00+08:00');

  assert.equal(createVersionName(date), '20260625-153000');
});

test('selects old releases for cleanup while preserving current release', () => {
  const releases = [
    '20260625-120000',
    '20260625-121000',
    '20260625-122000',
    '20260625-123000',
  ];

  assert.deepEqual(
    selectReleasesToDelete(releases, '20260625-121000', 2),
    ['20260625-120000'],
  );
});

test('does not delete releases when keepReleases covers all versions', () => {
  assert.deepEqual(
    selectReleasesToDelete(['20260625-120000', '20260625-121000'], '20260625-121000', 5),
    [],
  );
});
