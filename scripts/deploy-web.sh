#!/usr/bin/env bash
# Build the Next.js console on Linux (Docker) and deploy the prebuilt output to Vercel.
#
# Why this shape: the Vercel project cannot receive the whole pnpm monorepo from a
# subdirectory upload (workspace:* deps fail with npm), and building on Windows
# produces a file-tracing map that the deploy step cannot resolve. Building inside
# node:24-alpine and deploying with --prebuilt from the repo root works everywhere.
#
# Usage (from WSL/Linux, repo mounted at $REPO):
#   NEXT_PUBLIC_API_URL=https://api.example.com REPO=/path/to/repo ./scripts/deploy-web.sh
# Then, on the machine that holds the Vercel login:
#   cd "$REPO" && vercel deploy --prebuilt --prod --yes
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
WORK="${WORK:-$HOME/spout-build}"
API_URL="${NEXT_PUBLIC_API_URL:?set NEXT_PUBLIC_API_URL to the public API base URL}"

mkdir -p "$WORK"
rsync -a --delete \
  --exclude node_modules --exclude .next --exclude dist --exclude reference --exclude target \
  --exclude .turbo --exclude .playwright-mcp --exclude ".vercel/output" --exclude .pnpm-store \
  "$REPO/" "$WORK/"

# vercel pull writes sensitive env values as "[SENSITIVE]"; the public API URL is not a secret.
ENVFILE="$WORK/apps/web/.vercel/.env.production.local"
if [ -f "$ENVFILE" ]; then
  sed -i "s#^NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=\"$API_URL\"#" "$ENVFILE"
fi
# Hoisted node_modules (no pnpm symlinks): the traced function output must not contain
# dangling symlinks, because the output is copied to Windows before the upload.
if ! grep -q "node-linker=hoisted" "$WORK/.npmrc" 2>/dev/null; then
  echo "node-linker=hoisted" >> "$WORK/.npmrc"
  docker run --rm -v "$WORK:/repo" node:24-alpine sh -c 'rm -rf /repo/node_modules /repo/apps/web/node_modules /repo/packages/shared/node_modules'
fi
# Previous build artifacts are root-owned (created inside the container): clean them the same way.
docker run --rm -v "$WORK:/repo" node:24-alpine sh -c 'rm -rf /repo/apps/web/.next /repo/apps/web/.vercel/output'

docker run --rm -v "$WORK:/repo" -w /repo -e CI=1 -e NEXT_PUBLIC_API_URL="$API_URL" node:24-alpine sh -c '
  corepack enable && corepack prepare pnpm@9.15.9 --activate &&
  pnpm install --frozen-lockfile --filter @spout/web... &&
  pnpm --filter @spout/shared build &&
  cd apps/web && npx -y vercel@58 build --prod --yes'

# The deploy step resolves filePathMap entries against the local filesystem, so the
# upload must run from a tree whose node_modules match the Linux build exactly.
# Stage the whole build tree (real files, no symlinks) next to the repo.
STAGE="${STAGE:-$REPO/.deploy-web}"
mkdir -p "$STAGE/.vercel"
# NTFS cannot take every attribute/name; rsync exit 23 (partial transfer) is acceptable here.
rsync -rL --delete --exclude .git --exclude .pnpm-store --exclude reference --exclude ".vercel/output" "$WORK/" "$STAGE/" || [ $? -eq 23 ]
STAGE="$STAGE" WORK="$WORK" REPO="$REPO" bash "$(dirname "$0")/stage-web-output.sh"
echo "Now run, where the Vercel CLI is logged in: cd \"$STAGE\" && vercel deploy --prebuilt --prod --yes"
