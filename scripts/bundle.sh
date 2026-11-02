#!/usr/bin/env bash
# Builds the release tarball: server dist with production node_modules, web dist, deploy files.
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./apps/server/package.json').version")
out="dist/farmhand-${version}"
rm -rf dist && mkdir -p "$out/apps/server" "$out/apps/web"
pnpm build
cp -r apps/server/dist apps/server/package.json "$out/apps/server/"
cp -r apps/web/dist "$out/apps/web/"
cp -r deploy LICENSE NOTICE README.md "$out/"
cp -r packages "$out/packages"
# Production node_modules for the server only (workspace links resolved by pnpm deploy).
pnpm --filter @farmhand/server deploy --legacy --prod "$out/apps/server/deployed" >/dev/null
mv "$out/apps/server/deployed/node_modules" "$out/apps/server/node_modules"
rm -rf "$out/apps/server/deployed" "$out/packages"
tar -C dist -czf "dist/farmhand-${version}.tar.gz" "farmhand-${version}"
echo "dist/farmhand-${version}.tar.gz"
