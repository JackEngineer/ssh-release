import assert from 'node:assert/strict';
import test from 'node:test';

import { selectRollbackTarget } from '../src/rollback.js';

const releases = [
  '20260625-120000',
  '20260625-121000',
  '20260625-122000',
];

test('selects previous release by default', () => {
  assert.equal(
    selectRollbackTarget({
      releases,
      currentVersion: '20260625-122000',
    }),
    '20260625-121000',
  );
});

test('selects requested rollback release when it exists', () => {
  assert.equal(
    selectRollbackTarget({
      releases,
      currentVersion: '20260625-122000',
      requestedVersion: '20260625-120000',
    }),
    '20260625-120000',
  );
});

test('rejects missing rollback target', () => {
  assert.throws(
    () => selectRollbackTarget({
      releases,
      currentVersion: '20260625-122000',
      requestedVersion: '20260625-090000',
    }),
    /回滚目标不存在/,
  );
});
