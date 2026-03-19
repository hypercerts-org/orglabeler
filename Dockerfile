# Stage 1: Get tap binary from official image
FROM ghcr.io/bluesky-social/indigo/tap:latest AS tap-bin

# Stage 2: Build and run the application
FROM node:22-slim

# better-sqlite3 needs build tools; musl is needed for the tap binary (Alpine-built)
RUN apt-get update && apt-get install -y python3 make g++ musl && rm -rf /var/lib/apt/lists/*

# Copy tap binary from the official image
COPY --from=tap-bin /tap /usr/local/bin/tap

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js — bake deploy timestamp and git SHA into the image
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_DEPLOY_TIME=""
RUN NEXT_PUBLIC_DEPLOY_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") npm run build

# Expose ports: Next.js (3000), LabelerServer (4100), Metrics (4101), Tap (2480)
EXPOSE 3000 4100 4101 2480

# Run both processes with concurrently
CMD ["npm", "run", "start:all"]
