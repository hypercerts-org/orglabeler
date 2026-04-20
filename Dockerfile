# Build and run the app service
FROM node:22-slim

# better-sqlite3 needs build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js — bake deploy timestamp and git SHA into the image
ARG RAILWAY_GIT_COMMIT_SHA
ENV NEXT_PUBLIC_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA
RUN chmod +x scripts/build.sh && ./scripts/build.sh

# Expose ports for the app service only; Tap runs separately via TAP_URL
EXPOSE 3000 4100 4101

# Run the app service (dashboard + labeler)
CMD ["npm", "run", "start:service"]
