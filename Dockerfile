# Multi-stage Dockerfile for Team Retrospective
# Compatible with OpenShift, Railway, and standard Docker (runs as non-root user)

# =============================================================================
# Stage 1: Build
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --prefer-offline --no-audit

# Copy source code
COPY . .

# Build the application
RUN npm run build

# =============================================================================
# Stage 2: Production runtime with WebSocket server
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install su-exec for dropping privileges and runtime dependencies
RUN apk add --no-cache su-exec

COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

# Copy built assets, server, version info, and entrypoint
COPY --from=builder /app/dist ./dist
COPY server.js ./server.js
COPY server ./server
COPY socketAdapter.js ./socketAdapter.js
COPY utils ./utils
COPY VERSION ./VERSION
COPY CHANGELOG.md ./CHANGELOG.md
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Create data directory (will be overwritten by volume mounts)
RUN mkdir -p /data

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Entrypoint fixes volume permissions then drops to UID 1000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["node", "server.js"]
