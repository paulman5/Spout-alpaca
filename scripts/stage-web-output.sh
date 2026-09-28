#!/usr/bin/env bash
# Copy the prebuilt Vercel output from the Linux work tree into the Windows staging tree.
set -eu
REPO="${REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
WORK="${WORK:-$HOME/spout-build}"
STAGE="${STAGE:-$REPO/.deploy-web}"
mkdir -p "$STAGE/.vercel"
cp "$WORK/apps/web/.vercel/project.json" "$STAGE/.vercel/project.json"
rm -rf "$STAGE/.vercel/output"
rsync -rL "$WORK/apps/web/.vercel/output/" "$STAGE/.vercel/output/"
ls "$STAGE/.vercel/output"
echo "OUTPUT_STAGED in $STAGE"
