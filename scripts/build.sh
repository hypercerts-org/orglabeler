#!/bin/bash
# Build script for Railway deployments.
# Bakes the deploy timestamp into the Next.js build as a public env var
# so the footer can show when the app was last deployed.
set -e

export NEXT_PUBLIC_DEPLOY_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "Building with NEXT_PUBLIC_DEPLOY_TIME=$NEXT_PUBLIC_DEPLOY_TIME"
npm run build
