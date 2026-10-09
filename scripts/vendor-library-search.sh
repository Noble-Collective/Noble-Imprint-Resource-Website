#!/usr/bin/env bash
# Vendors the shared Library search matcher (@noble-collective/userdata/library-search, Collective-Shared
# ARCHITECTURE §9d) for the SERVER: src/vendor/library-search.cjs is the SDK's built, dependency-free
# CommonJS file, and tests/unit/fixtures/library-search.{cases,terms}.json are its specification and the
# terms fixture it runs on. Same reasons as scripts/vendor-scripture.sh (the tarball is a devDependency;
# the SDK package pulls in zod).
#
#   bash scripts/vendor-library-search.sh [path/to/Collective-Shared]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
shared="${1:-$here/../Collective-Shared}"
pkg="$shared/packages/userdata"

(cd "$pkg" && npx tsup >/dev/null)
version="$(cd "$pkg" && node -p "require('./package.json').version")"
commit="$(git -C "$shared" rev-parse --short HEAD)"
dirty="$(git -C "$shared" status --porcelain -- packages/userdata/src/library-search packages/userdata/test/library-search.cases.json packages/userdata/test/library-search.terms.json)"
[ -n "$dirty" ] && commit="$commit+uncommitted"

mkdir -p "$here/src/vendor"
{
  echo "// VENDORED — do not edit. @noble-collective/userdata/library-search $version (Collective-Shared $commit)."
  echo "// Regenerate with: bash scripts/vendor-library-search.sh"
  cat "$pkg/dist/library-search/index.cjs" | sed '/^\/\/# sourceMappingURL=/d'
} > "$here/src/vendor/library-search.cjs"
cp "$pkg/test/library-search.cases.json" "$here/tests/unit/fixtures/library-search.cases.json"
cp "$pkg/test/library-search.terms.json" "$here/tests/unit/fixtures/library-search.terms.json"
echo "vendored library-search $version ($commit)"
