#!/usr/bin/env bash
# Vendors the shared session-identity rule (@noble-collective/userdata/session-identity, Collective-Shared
# plans/2026-10-05-common-web-sign-in.md §2) for the SERVER: src/vendor/session-identity.cjs is the SDK's
# built, dependency-free CommonJS file (trustedEmail + bounded display name / https photo).
#
# Why a vendored file and not the SDK tarball: the tarball is a devDependency (browser bundles only;
# the Dockerfile runs `npm ci --omit=dev`), and the SDK as a package depends on zod, which must not
# go on the server. Same pattern as scripts/vendor-scripture.sh. Copies from the INSTALLED tarball
# (re-vendor the tarball first), so the server and the bundle always carry the same SDK version;
# tests/unit/auth.test.js fails if the two drift.
#
#   bash scripts/vendor-session-identity.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
pkg="$here/node_modules/@noble-collective/userdata"
version="$(grep -m1 '"version"' "$pkg/package.json" | sed 's/.*: *"\(.*\)".*/\1/')"

mkdir -p "$here/src/vendor"
{
  echo "// VENDORED — do not edit. @noble-collective/userdata/session-identity $version (from vendor/ tarball)."
  echo "// Regenerate with: bash scripts/vendor-session-identity.sh"
  sed '/^\/\/# sourceMappingURL=/d' "$pkg/dist/session-identity.cjs"
} > "$here/src/vendor/session-identity.cjs"
echo "vendored session-identity $version"
