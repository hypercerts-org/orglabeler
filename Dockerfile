FROM node:22-slim

# better-sqlite3 needs build tools
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js
RUN npm run build

# Expose ports: Next.js (3000), LabelerServer (4100), Metrics (4101)
EXPOSE 3000 4100 4101

# Run both processes with concurrently
CMD ["npm", "run", "start:all"]
