#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
cd "$ROOT_DIR"

NPM_CACHE="${NPM_CONFIG_CACHE:-/private/tmp/ssh-release-npm-cache}"
VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
LOCK_VERSION="$(node -p "JSON.parse(require('fs').readFileSync('package-lock.json', 'utf8')).version")"
CURRENT_BRANCH="$(git branch --show-current)"
STATUS_OUTPUT="$(git status --short --branch)"

echo "$STATUS_OUTPUT"
echo "release_preflight_version=$VERSION"

if [ "$LOCK_VERSION" != "$VERSION" ]; then
  echo "package-lock.json version $LOCK_VERSION does not match package.json version $VERSION" >&2
  exit 1
fi

if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "release preflight must run on main, current branch is $CURRENT_BRANCH" >&2
  exit 1
fi

if [ -n "$(git status --short)" ]; then
  echo "working tree is not clean" >&2
  exit 1
fi

if [ -n "$(git tag --list "v$VERSION")" ]; then
  echo "local tag v$VERSION already exists" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/v$VERSION" >/dev/null 2>&1; then
  echo "remote tag v$VERSION already exists" >&2
  exit 1
fi

npm run prepublishOnly
npm publish --dry-run --cache "$NPM_CACHE"

PACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR"' EXIT

npm pack --pack-destination "$PACK_DIR" --cache "$NPM_CACHE"
npm install -g "$PACK_DIR"/ssh-release-"$VERSION".tgz --prefix "$PACK_DIR/prefix" --cache "$NPM_CACHE"

BIN="$PACK_DIR/prefix/bin/ssh-release"
"$BIN" --version | grep -Fx "$VERSION" >/dev/null
"$BIN" --help | grep -F -- 'ssh-release init [--template default|single-file|static-site]' >/dev/null

mkdir -p "$PACK_DIR/work"
(
  cd "$PACK_DIR/work"
  "$BIN" init --template static-site
  test -f ssh-release.config.ts
  grep -F "path: './dist'" ssh-release.config.ts >/dev/null
  grep -F "path: '/var/www/example-static-site'" ssh-release.config.ts >/dev/null
)

echo "release_preflight=ok"
