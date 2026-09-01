#!/usr/bin/env bash
# Packages all six platform-specific .vsix files in one shot - loops
# scripts/package-target.sh across every target vsce supports for this
# extension, writing into dist-vsix/ (gitignored via the repo's *.vsix
# rule). Run `npm run build:native` (or the combined `npm run package`,
# which does this automatically) first so tools/tf-hcl-graph/bin/<target>/
# actually has fresh binaries for each target before packaging - a stale
# binary would silently ship a `.vsix` missing whatever the Go source's
# latest changes were.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p dist-vsix

VALID_TARGETS=(win32-x64 win32-arm64 linux-x64 linux-arm64 darwin-x64 darwin-arm64)

for t in "${VALID_TARGETS[@]}"; do
  bash scripts/package-target.sh "$t" --out dist-vsix
done

echo "done - dist-vsix/ now has all 6 platform .vsix files"
