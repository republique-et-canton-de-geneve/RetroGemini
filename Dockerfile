# Multi-stage Dockerfile for Team Retrospective
# Compatible with OpenShift and Railway (runs as non-root user)

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

# Install runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline --no-audit

# Copy built assets and server
COPY --from=builder /app/dist ./dist
COPY server.js ./server.js

# Non-root user for platforms like OpenShift
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "server.js"]
