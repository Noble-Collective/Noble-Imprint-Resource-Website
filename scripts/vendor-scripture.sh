#!/usr/bin/env bash
# Vendors the shared scripture parser (@noble-collective/userdata/scripture, Collective-Shared
# ARCHITECTURE §9c) for the SERVER: src/vendor/scripture.cjs is the SDK's built, dependency-free
# CommonJS file, and tests/unit/fixtures/scripture.cases.json is its specification.
#
# Why a vendored file and not the SDK tarball: the tarball is a devDependency (browser bundles only;
# the Dockerfile runs `npm ci --omit=dev`), and the SDK as a package depends on zod, which must not
# go on the server. The scripture subpath itself has no dependencies.
#
#   bash scripts/vendor-scripture.sh [path/to/Collective-Shared]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
shared="${1:-$here/../Collective-Shared}"
pkg="$shared/packages/userdata"

(cd "$pkg" && npx tsup >/dev/null)
version="$(cd "$pkg" && node -p "require('./package.json').version")"
commit="$(git -C "$shared" rev-parse --short HEAD)"
dirty="$(git -C "$shared" status --porcelain -- packages/userdata/src/scripture packages/userdata/test/scripture.cases.json)"
[ -n "$dirty" ] && commit="$commit+uncommitted"

mkdir -p "$here/src/vendor"
{
  echo "// VENDORED — do not edit. @noble-collective/userdata/scripture $version (Collective-Shared $commit)."
  echo "// Regenerate with: bash scripts/vendor-scripture.sh"
  cat "$pkg/dist/scripture/index.cjs" | sed '/^\/\/# sourceMappingURL=/d'
} > "$here/src/vendor/scripture.cjs"
cp "$pkg/test/scripture.cases.json" "$here/tests/unit/fixtures/scripture.cases.json"
echo "vendored scripture $version ($commit)"
