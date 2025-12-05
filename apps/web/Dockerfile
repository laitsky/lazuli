# =============================================================================
# Lazuli Web - Production Dockerfile
# =============================================================================
# Multi-stage build using Turborepo prune pattern for optimized Docker images.
# This Dockerfile creates a minimal production image for the Next.js frontend.
#
# Build command (from monorepo root):
#   docker build -f apps/web/Dockerfile -t lazuli-web .
#
# Run command:
#   docker run -p 3001:3001 lazuli-web
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Pruner
# -----------------------------------------------------------------------------
# Uses turbo prune to create a minimal monorepo subset containing only the
# web package and its dependencies, reducing the build context significantly.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS pruner

# Install turbo globally for the prune command
RUN bun add -g turbo
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

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
# Stage 3: Builder
# -----------------------------------------------------------------------------
# Builds the Next.js application for production.
# Uses standalone output mode for minimal Docker images.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy everything from installer (dependencies + source code)
COPY --from=installer /app .

# Build argument for API URL (passed at build time)
# This gets baked into the Next.js bundle for client-side requests
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Set environment for build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js application
# This creates the optimized production build in apps/web/.next
# With output: 'standalone' in next.config.ts, it creates a self-contained server
RUN bun run build --filter=@lazuli/web

# -----------------------------------------------------------------------------
# Stage 4: Runner
# -----------------------------------------------------------------------------
# Minimal production image using the Next.js standalone output.
# Only includes the necessary files to run the application.
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS runner

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

# Install wget for health checks (not included in Alpine by default)
RUN apk add --no-cache wget

# Create a non-root user for security best practices
RUN addgroup --system --gid 1001 lazuli && \
    adduser --system --uid 1001 --ingroup lazuli lazuli

WORKDIR /app

# Copy the standalone server and required files
# The standalone output includes a minimal Node.js server and all dependencies
COPY --from=builder --chown=lazuli:lazuli /app/apps/web/.next/standalone ./
COPY --from=builder --chown=lazuli:lazuli /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=lazuli:lazuli /app/apps/web/public ./apps/web/public

# Switch to non-root user
USER lazuli

# Expose the web port (default: 3001)
EXPOSE 3001

# Health check to verify the web app is responding
# Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3001 || exit 1

# Run the Next.js standalone server with Bun
# The standalone server is located at apps/web/server.js after build
WORKDIR /app/apps/web
CMD ["bun", "run", "server.js"]
