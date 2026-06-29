#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
CLI="${SSH_RELEASE_CLI:-$ROOT_DIR/dist/cli.js}"
LOCAL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ssh-release-dogfood-local.XXXXXX")"
TARGET="/tmp/ssh-release-dogfood-$(date +%Y%m%d-%H%M%S)"
REMOTE_CLEANED=0

require_env() {
  local name="$1"

  if [ -z "${!name:-}" ]; then
    echo "$name is required" >&2
    exit 2
  fi
}

remote_exec() {
  local port="${SSH_RELEASE_PORT:-22}"
  local remote="${SSH_RELEASE_USER}@${SSH_RELEASE_HOST}"
  local strict_host_key_checking="${SSH_RELEASE_STRICT_HOST_KEY_CHECKING:-no}"

  if [ -n "${SSH_RELEASE_PASSWORD:-}" ]; then
    SSHPASS="$SSH_RELEASE_PASSWORD" sshpass -e ssh \
      -o StrictHostKeyChecking="$strict_host_key_checking" \
      -o PreferredAuthentications=password \
      -o PubkeyAuthentication=no \
      -o NumberOfPasswordPrompts=1 \
      -o ConnectTimeout=15 \
      -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=2 \
      -p "$port" \
      "$remote" \
      "$@"
    return
  fi

  if [ -n "${SSH_RELEASE_PRIVATE_KEY_PATH:-}" ]; then
    ssh \
      -o StrictHostKeyChecking="$strict_host_key_checking" \
      -o ConnectTimeout=15 \
      -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=2 \
      -i "$SSH_RELEASE_PRIVATE_KEY_PATH" \
      -p "$port" \
      "$remote" \
      "$@"
    return
  fi

  ssh \
    -o StrictHostKeyChecking="$strict_host_key_checking" \
    -o ConnectTimeout=15 \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=2 \
    -p "$port" \
    "$remote" \
    "$@"
}

cleanup_remote() {
  if [ "$REMOTE_CLEANED" = "1" ]; then
    return
  fi

  if remote_exec "case '$TARGET' in /tmp/ssh-release-dogfood-*) rm -rf '$TARGET' ;; *) echo unsafe-target >&2; exit 2 ;; esac" >/dev/null 2>&1; then
    REMOTE_CLEANED=1
  fi
}

cleanup() {
  local status=$?

  if [ "$status" -ne 0 ]; then
    echo "dogfood failed: exit=$status" >&2
    echo "remote target: $TARGET" >&2
  fi

  cleanup_remote || true

  if [ "$status" -eq 0 ] || [ "${SSH_RELEASE_KEEP_LOCAL_ON_FAILURE:-1}" = "0" ]; then
    rm -rf "$LOCAL_ROOT"
  else
    echo "local logs retained: $LOCAL_ROOT" >&2
    echo "Set SSH_RELEASE_KEEP_LOCAL_ON_FAILURE=0 to remove local logs after failures." >&2
  fi

  exit "$status"
}

trap cleanup EXIT

require_env SSH_RELEASE_HOST
require_env SSH_RELEASE_USER

if [ -z "${SSH_RELEASE_PASSWORD:-}" ] && [ -z "${SSH_RELEASE_PRIVATE_KEY_PATH:-}" ]; then
  echo "SSH_RELEASE_PASSWORD or SSH_RELEASE_PRIVATE_KEY_PATH is required" >&2
  exit 2
fi

if [ -n "${SSH_RELEASE_PASSWORD:-}" ] && ! command -v sshpass >/dev/null 2>&1; then
  echo "sshpass is required when SSH_RELEASE_PASSWORD is set" >&2
  exit 2
fi

if [ ! -f "$CLI" ]; then
  echo "CLI entry not found: $CLI" >&2
  echo "Run npm run build first, or set SSH_RELEASE_CLI to a built cli.js path." >&2
  exit 2
fi

mkdir -p "$LOCAL_ROOT/app/dist/assets"
printf '%s\n' 'dogfood release v1' > "$LOCAL_ROOT/app/dist/index.html"
printf '%s\n' 'asset v1' > "$LOCAL_ROOT/app/dist/assets/app.txt"

cat > "$LOCAL_ROOT/app/ssh-release.config.ts" <<EOF_CONFIG
export default {
  source: {
    path: './dist',
    exclude: ['.DS_Store'],
  },
  server: {
    host: process.env.SSH_RELEASE_HOST,
    port: Number(process.env.SSH_RELEASE_PORT || 22),
    username: process.env.SSH_RELEASE_USER,
    password: process.env.SSH_RELEASE_PASSWORD,
    privateKeyPath: process.env.SSH_RELEASE_PRIVATE_KEY_PATH,
  },
  target: {
    path: '$TARGET',
  },
  deploy: {
    mode: 'release',
    keepReleases: 5,
  },
};
EOF_CONFIG

cd "$LOCAL_ROOT/app"

node "$CLI" --version --json > "$LOCAL_ROOT/version.json"
node "$CLI" doctor --json > "$LOCAL_ROOT/doctor.json"
node "$CLI" deploy --json --progress > "$LOCAL_ROOT/deploy1.ndjson"

sleep 1
printf '%s\n' 'dogfood release v2' > "$LOCAL_ROOT/app/dist/index.html"
printf '%s\n' 'asset v2' > "$LOCAL_ROOT/app/dist/assets/app.txt"

node "$CLI" deploy --json --progress > "$LOCAL_ROOT/deploy2.ndjson"
node "$CLI" rollback --json --progress > "$LOCAL_ROOT/rollback.ndjson"
node "$CLI" list --json > "$LOCAL_ROOT/list.json"

node - "$LOCAL_ROOT" "$TARGET" <<'NODE_VALIDATE'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const target = process.argv[3];

function unwrap(file) {
  const doc = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  if (doc.ok !== true) {
    throw new Error(`${file} ok is not true: ${JSON.stringify(doc)}`);
  }
  return doc.result;
}

function ndjson(file) {
  return fs.readFileSync(path.join(root, file), 'utf8')
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function finalResult(file) {
  const rows = ndjson(file);
  const row = rows.findLast((entry) => Object.prototype.hasOwnProperty.call(entry, 'result'));
  if (!row || row.ok !== true) {
    throw new Error(`${file} missing ok final result`);
  }
  return row.result;
}

const version = unwrap('version.json');
const doctorDoc = JSON.parse(fs.readFileSync(path.join(root, 'doctor.json'), 'utf8'));
const deploy1 = finalResult('deploy1.ndjson');
const deploy2 = finalResult('deploy2.ndjson');
const rollbackRows = ndjson('rollback.ndjson');
const rollback = finalResult('rollback.ndjson');
const list = unwrap('list.json');
const rollbackProgress = rollbackRows
  .filter((row) => row.event === 'progress')
  .map((row) => `${row.stage}:${row.status}`);
const expectedRollbackProgress = [
  'lock:start',
  'lock:success',
  'switch:start',
  'switch:success',
  'cleanup:start',
  'cleanup:success',
  'verify:start',
  'verify:success',
];
const verificationNames = rollback.verification?.map((check) => check.name) ?? [];
const checks = [
  ['doctor ok', doctorDoc.ok === true && doctorDoc.result.ok === true],
  ['deploy1 target', deploy1.targetPath?.startsWith(`${target}/releases/`)],
  ['deploy1 verified', deploy1.verified === true],
  ['deploy2 target', deploy2.targetPath?.startsWith(`${target}/releases/`)],
  ['deploy2 verified', deploy2.verified === true],
  ['rollback progress', JSON.stringify(rollbackProgress) === JSON.stringify(expectedRollbackProgress)],
  ['rollback verified', rollback.verified === true],
  ['rollback target first version', rollback.version === deploy1.version],
  ['list current first version', list.currentVersion === deploy1.version],
  ['rollback verification names', ['目标版本', '当前版本', '远端锁'].every((name) => verificationNames.includes(name))],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);

if (failed.length) {
  console.error(JSON.stringify({
    dogfood: 'fail',
    failed,
    root,
    target,
    cliVersion: version.version,
    rollbackProgress,
    rollback,
    list,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  dogfood: 'ok',
  root,
  target,
  cliVersion: version.version,
  firstVersion: deploy1.version,
  secondVersion: deploy2.version,
  rollbackVersion: rollback.version,
  rollbackVerified: rollback.verified,
  rollbackProgress,
  currentAfterRollback: list.currentVersion,
}, null, 2));
NODE_VALIDATE

cleanup_remote
remote_exec "test ! -e '$TARGET' && echo remote_cleanup=ok"
