# Build and run the app service
FROM node:22-slim

# better-sqlite3 needs build tools; Caddy fronts Next and the labeler XRPC server
RUN apt-get update && apt-get install -y python3 make g++ caddy && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js — bake deploy timestamp and git SHA into the image
ARG RAILWAY_GIT_COMMIT_SHA
ARG NEXT_PUBLIC_LABELER_ENDPOINT
ENV NEXT_PUBLIC_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_LABELER_ENDPOINT=$NEXT_PUBLIC_LABELER_ENDPOINT
RUN chmod +x scripts/build.sh && ./scripts/build.sh

# Caddy listens on $PORT/8080; Next and labeler stay internal; Tap runs separately via TAP_URL
ENV NEXT_PORT=3000
EXPOSE 8080 3000 4100 4101

# Run the app service (dashboard + labeler)
CMD ["npm", "run", "start:service"]
