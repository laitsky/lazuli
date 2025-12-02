# =============================================================================
# Lazuli API - Production Dockerfile
# =============================================================================
# Multi-stage build using Turborepo prune pattern for optimized Docker images.
# This Dockerfile creates a minimal production image for the Express.js API.
#
# Build command (from monorepo root):
#   docker build -f apps/api/Dockerfile -t lazuli-api .
#
# Run command:
#   docker run -p 3000:3000 --env-file .env lazuli-api
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Pruner
# -----------------------------------------------------------------------------
# Uses turbo prune to create a minimal monorepo subset containing only the
# API package and its dependencies, reducing the build context significantly.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS pruner

# Install turbo globally for the prune command
RUN bun add -g turbo

WORKDIR /app

# Copy the entire monorepo for pruning
# turbo prune needs access to all package.json files to understand dependencies
COPY . .

# Prune the monorepo to only include @lazuli/api and its dependencies
# --docker flag creates an optimized output structure for Docker builds:
#   - /out/json: Contains only package.json and lockfile (for dependency install)
#   - /out/full: Contains the full pruned source code
RUN turbo prune @lazuli/api --docker

# -----------------------------------------------------------------------------
# Stage 2: Installer
# -----------------------------------------------------------------------------
# Installs dependencies using the pruned package.json files.
# This stage is separated to maximize Docker layer caching.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS installer

WORKDIR /app

# First, copy only package.json files and lockfile for dependency installation
# This layer will be cached unless dependencies change
# Note: turbo prune --docker places bun.lockb inside out/json/ directory
COPY --from=pruner /app/out/json/ .

# Install dependencies with frozen lockfile for reproducible builds
# --frozen-lockfile ensures the lockfile isn't modified during install
RUN bun install --frozen-lockfile

# Now copy the full pruned source code
# This layer will be rebuilt when source code changes, but dependencies are cached
COPY --from=pruner /app/out/full/ .

# -----------------------------------------------------------------------------
# Stage 3: Runner
# -----------------------------------------------------------------------------
# Minimal production image that runs the API directly with Bun.
# No build step needed - Bun runs TypeScript natively.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS runner

# Set production environment
ENV NODE_ENV=production

# Install wget for health checks (not included in Alpine by default)
USER root
RUN apk add --no-cache wget

# Create a non-root user for security best practices
RUN addgroup --system --gid 1001 lazuli && \
    adduser --system --uid 1001 --ingroup lazuli lazuli

WORKDIR /app

# Copy the full application with all dependencies from installer stage
# We need node_modules for the Express.js API runtime
COPY --from=installer --chown=lazuli:lazuli /app .

# Switch to non-root user
USER lazuli

# Expose the API port (default: 3000)
EXPOSE 3000

# Set the working directory to the API app
WORKDIR /app/apps/api

# Health check to verify the API is responding
# Checks the /health endpoint every 30 seconds
# start-period gives time for exchange markets to warm up
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Run the TypeScript source directly with Bun
# Bun has native TypeScript support, no transpilation needed
CMD ["bun", "run", "src/index.ts"]
