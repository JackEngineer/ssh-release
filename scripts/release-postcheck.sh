#!/usr/bin/env bash
set -euo pipefail

if [ "${1:-}" = "" ]; then
  echo "Usage: scripts/release-postcheck.sh <version>" >&2
  exit 2
fi

VERSION="${1#v}"
NPM_CACHE="${NPM_CONFIG_CACHE:-/private/tmp/ssh-release-npm-cache}"

echo "release_postcheck_version=$VERSION"

RUN_ID="$(
  gh run list \
    --workflow Publish \
    --branch "v$VERSION" \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId'
)"

if [ "$RUN_ID" = "" ] || [ "$RUN_ID" = "null" ]; then
  echo "Publish workflow run for v$VERSION was not found" >&2
  exit 1
fi

gh run view "$RUN_ID" --json status,conclusion,url --jq '
  if .status == "completed" and .conclusion == "success" then
    "publish_workflow=ok " + .url
  else
    error("publish workflow is not successful: status=" + .status + " conclusion=" + (.conclusion // ""))
  end
'

npm view ssh-release version dist-tags.latest --json | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const version = process.argv[1];
    const data = JSON.parse(input);
    if (data.version !== version || data["dist-tags.latest"] !== version) {
      console.error(`npm registry mismatch: version=${data.version} latest=${data["dist-tags.latest"]}`);
      process.exit(1);
    }
  });
' "$VERSION"

PACK_DIR="$(mktemp -d)"
trap 'rm -rf "$PACK_DIR"' EXIT

npm install -g "ssh-release@$VERSION" --prefix "$PACK_DIR/prefix" --cache "$NPM_CACHE"
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

gh release view "v$VERSION" --json tagName,isDraft,isPrerelease,url --jq '
  if .isDraft == false and .isPrerelease == false then
    "github_release=ok " + .url
  else
    error("GitHub Release is not ready")
  end
'

echo "release_postcheck=ok"
