#!/usr/bin/env bash
# Packages a platform-specific .vsix containing only that platform's
# tf-hcl-graph binary. `vsce`'s own --ignore-other-target-folders flag (as of
# @vscode/vsce 3.9.2) is wired up for the npm-optionalDependencies convention
# (e.g. `@esbuild/win32-x64`) and doesn't actually filter arbitrary bundled
# folders, so instead this builds a temporary .vscodeignore on top of the
# real one that excludes every *other* target's tools/tf-hcl-graph/bin/<target>/
# folder, and points `vsce package --ignoreFile` at it.
#
# Usage: scripts/package-target.sh <target> [extra vsce package args...]
#   e.g. scripts/package-target.sh win32-x64
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TARGET="${1:?usage: scripts/package-target.sh <target> [extra vsce package args...]}"
shift

VALID_TARGETS=(win32-x64 win32-arm64 linux-x64 linux-arm64 darwin-x64 darwin-arm64)

valid=0
for t in "${VALID_TARGETS[@]}"; do
  [ "$t" = "$TARGET" ] && valid=1
done
if [ "$valid" -ne 1 ]; then
  echo "error: '${TARGET}' is not a supported target. Valid: ${VALID_TARGETS[*]}" >&2
  exit 1
fi

tmpignore="$(mktemp -t vscodeignore-target)"
trap 'rm -f "$tmpignore"' EXIT

cp .vscodeignore "$tmpignore"
for t in "${VALID_TARGETS[@]}"; do
  if [ "$t" != "$TARGET" ]; then
    echo "tools/tf-hcl-graph/bin/${t}/**" >>"$tmpignore"
  fi
done

echo "packaging target ${TARGET} (excluding bin/ for: ${VALID_TARGETS[*]/${TARGET}/})"
npx vsce package --target "$TARGET" --ignoreFile "$tmpignore" "$@"
