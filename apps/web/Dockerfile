# syntax=docker/dockerfile:1.7
# =============================================================================
# Lazuli Web - Production Dockerfile
# =============================================================================
# Multi-stage build using Turborepo prune pattern for optimized Docker images.
# This Dockerfile creates a minimal production image for the Vite frontend.
#
# Build command (from monorepo root):
#   docker build -f apps/web/Dockerfile -t lazuli-web .
#
# Run command:
#   docker run -p 3001:3001 lazuli-web
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 0: Base
# -----------------------------------------------------------------------------
# Shared base image to keep cache mounts reusable across stages.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS base

WORKDIR /app

# Keep Bun's install cache in a consistent location for BuildKit caching
ENV BUN_INSTALL_CACHE_DIR=/root/.bun/install/cache
# Add Bun global bin to PATH for globally installed packages (e.g., turbo)
ENV PATH="/root/.bun/bin:${PATH}"

# -----------------------------------------------------------------------------
# Stage 1: Pruner
# -----------------------------------------------------------------------------
# Uses turbo prune to create a minimal monorepo subset containing only the
# web package and its dependencies, reducing the build context significantly.
# -----------------------------------------------------------------------------
FROM base AS pruner

# Install turbo globally for the prune command
RUN bun add -g turbo

# Copy the entire monorepo for pruning
# turbo prune needs access to all package.json files to understand dependencies
COPY . .

# Prune the monorepo to only include @lazuli/web and its dependencies
# --docker flag creates an optimized output structure for Docker builds:
#   - /out/json: Contains only package.json and lockfile (for dependency install)
#   - /out/full: Contains the full pruned source code
RUN turbo prune @lazuli/web --docker

# -----------------------------------------------------------------------------
# Stage 2: Installer
# -----------------------------------------------------------------------------
# Installs dependencies using the pruned package.json files.
# This stage is separated to maximize Docker layer caching.
# -----------------------------------------------------------------------------
FROM base AS installer

# First, copy only package.json files and lockfile for dependency installation
# This layer will be cached unless dependencies change
# Note: turbo prune --docker places bun.lockb inside out/json/ directory
COPY --from=pruner /app/out/json/ .

# Install dependencies with frozen lockfile for reproducible builds
# --frozen-lockfile ensures the lockfile isn't modified during install
# --ignore-scripts skips lifecycle scripts (e.g., husky prepare) not needed in Docker
RUN --mount=type=cache,target=/root/.bun bun install --frozen-lockfile --ignore-scripts

# Now copy the full pruned source code
# This layer will be rebuilt when source code changes, but dependencies are cached
COPY --from=pruner /app/out/full/ .

# -----------------------------------------------------------------------------
# Stage 3: Builder
# -----------------------------------------------------------------------------
# Builds the Vite application for production.
# -----------------------------------------------------------------------------
FROM base AS builder

# Copy everything from installer (dependencies + source code)
COPY --from=installer /app .

# Build argument for API URL (passed at build time)
# This gets baked into the Vite bundle for client-side requests
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL

# Set environment for build
ENV NODE_ENV=production

# Build the Vite application
# This creates the optimized production build in apps/web/dist
RUN --mount=type=cache,target=/root/.bun \
    bun run build --filter=@lazuli/web

# -----------------------------------------------------------------------------
# Stage 4: Runner
# -----------------------------------------------------------------------------
# Minimal production image serving static files with a simple HTTP server.
# Only includes the necessary files to run the application.
# -----------------------------------------------------------------------------
FROM base AS runner

# Set production environment
ENV NODE_ENV=production
ENV PORT=3001

# Install wget for health checks (not included in Alpine by default)
RUN apk add --no-cache wget

# Create a non-root user for security best practices
RUN addgroup --system --gid 1001 lazuli && \
    adduser --system --uid 1001 --ingroup lazuli lazuli

WORKDIR /app

# Copy the built static files
COPY --from=builder --chown=lazuli:lazuli /app/apps/web/dist ./dist

# Switch to non-root user
USER lazuli

# Expose the web port (default: 3001)
EXPOSE 3001

# Health check to verify the web app is responding
# Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001 || exit 1

# Serve the static files using Bun's built-in server
# Using bunx to run serve package for static file serving
CMD ["bunx", "serve", "-s", "dist", "-l", "3001"]
