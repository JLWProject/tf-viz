#!/usr/bin/env bash
# Cross-compiles the tf-hcl-graph CLI for every platform/arch the extension
# ships a vsce --target build for, into bin/<platform>-<arch>/. Run this
# before `vsce package --target <target>` for any of those targets - the
# packaged binary is picked up from bin/ by src/hclGraphCli.ts, matched
# against process.platform/process.arch at runtime.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

# platform-arch (Node's process.platform/process.arch) -> GOOS/GOARCH
declare -a TARGETS=(
  "win32-x64:windows:amd64"
  "win32-arm64:windows:arm64"
  "linux-x64:linux:amd64"
  "linux-arm64:linux:arm64"
  "darwin-x64:darwin:amd64"
  "darwin-arm64:darwin:arm64"
)

for entry in "${TARGETS[@]}"; do
  IFS=':' read -r name goos goarch <<<"$entry"
  outdir="bin/${name}"
  mkdir -p "$outdir"
  binary="tf-hcl-graph"
  [ "$goos" = "windows" ] && binary="tf-hcl-graph.exe"
  echo "building ${name} -> ${outdir}/${binary}"
  GOOS="$goos" GOARCH="$goarch" CGO_ENABLED=0 go build -trimpath -o "${outdir}/${binary}" .
done

echo "done"
