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
# Stage 2: Production
# =============================================================================
FROM nginx:alpine AS production

# Install gettext for envsubst (environment variable substitution)
RUN apk add --no-cache gettext

# Create non-root user for OpenShift compatibility
# OpenShift runs containers with arbitrary user IDs
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

# Copy nginx configuration template (not the final config)
COPY nginx.conf.template /etc/nginx/nginx.conf.template

# Copy built application from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Set correct permissions for OpenShift
# OpenShift requires that the application can run with any user ID
RUN chown -R appuser:appgroup /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html && \
    chown -R appuser:appgroup /var/cache/nginx && \
    chown -R appuser:appgroup /var/log/nginx && \
    touch /var/run/nginx.pid && \
    chown -R appuser:appgroup /var/run/nginx.pid && \
    # Make nginx config directory writable for envsubst
    chown -R appuser:appgroup /etc/nginx

# Default port (Railway will override via $PORT)
ENV PORT=8080

# Expose port (documentation only, actual port is set by $PORT)
EXPOSE 8080

# Switch to non-root user
USER appuser

# Health check (uses $PORT)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Start nginx with envsubst to replace $PORT in config
CMD envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'
