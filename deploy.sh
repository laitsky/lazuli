#!/bin/bash
# =============================================================================
# Lazuli - Deployment Script
# =============================================================================
# Handles Docker Compose deployment with automatic UID/GID detection
# and proper container lifecycle management.
#
# Usage:
#   ./deploy.sh              # Full redeploy (rebuild + restart)
#   ./deploy.sh --no-build   # Restart without rebuilding
#   ./deploy.sh --down       # Stop and remove containers
#   ./deploy.sh --logs       # Follow logs after deploy
# =============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory (where docker-compose.yml lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# -----------------------------------------------------------------------------
# Helper Functions
# -----------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# -----------------------------------------------------------------------------
# Export UID/GID for Docker volume permissions
# -----------------------------------------------------------------------------
export_user_ids() {
    # Export current user's UID and GID for Docker build args
    # This ensures container user matches host user for volume permissions
    # Note: We use HOST_UID/HOST_GID because UID is a read-only variable in bash
    export HOST_UID=$(id -u)
    export HOST_GID=$(id -g)
    log_info "Using HOST_UID=$HOST_UID, HOST_GID=$HOST_GID for container user"
}

# -----------------------------------------------------------------------------
# Ensure logs directory exists with correct permissions
# -----------------------------------------------------------------------------
setup_logs_dir() {
    local logs_dir="$SCRIPT_DIR/logs/api"
    if [ ! -d "$logs_dir" ]; then
        log_info "Creating logs directory: $logs_dir"
        mkdir -p "$logs_dir"
    fi
}

# -----------------------------------------------------------------------------
# Check if containers are running
# -----------------------------------------------------------------------------
containers_running() {
    docker compose ps --status running -q 2>/dev/null | grep -q .
}

# -----------------------------------------------------------------------------
# Stop and remove containers gracefully
# -----------------------------------------------------------------------------
stop_containers() {
    if containers_running; then
        log_info "Stopping running containers..."
        docker compose down --remove-orphans
        log_success "Containers stopped"
    else
        log_info "No running containers to stop"
    fi
}

# -----------------------------------------------------------------------------
# Pull latest images (for base images like redis)
# -----------------------------------------------------------------------------
pull_images() {
    log_info "Pulling latest base images..."
    docker compose pull --quiet redis || true
}

# -----------------------------------------------------------------------------
# Build and start containers
# -----------------------------------------------------------------------------
deploy() {
    local build_flag="$1"

    export_user_ids
    setup_logs_dir

    if [ "$build_flag" = "--no-build" ]; then
        log_info "Starting containers without rebuild..."
        docker compose up -d
    else
        log_info "Building and starting containers..."
        pull_images
        # Use --build to rebuild, --force-recreate to ensure fresh containers
        docker compose up -d --build --force-recreate
    fi

    log_success "Deployment complete!"
    echo ""
    log_info "Container status:"
    docker compose ps
}

# -----------------------------------------------------------------------------
# Follow logs
# -----------------------------------------------------------------------------
follow_logs() {
    log_info "Following logs (Ctrl+C to exit)..."
    docker compose logs -f
}

# -----------------------------------------------------------------------------
# Health check - wait for services to be healthy
# -----------------------------------------------------------------------------
wait_for_health() {
    log_info "Waiting for services to be healthy..."
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if docker compose ps | grep -q "(healthy)"; then
            log_success "Services are healthy!"
            return 0
        fi
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo ""
    log_warn "Health check timeout - services may still be starting"
    log_info "Check status with: docker compose ps"
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    echo "==========================================="
    echo "  Lazuli Deployment Script"
    echo "==========================================="
    echo ""

    case "${1:-}" in
        --down)
            stop_containers
            ;;
        --logs)
            follow_logs
            ;;
        --no-build)
            stop_containers
            deploy "--no-build"
            wait_for_health
            ;;
        --help|-h)
            echo "Usage: $0 [OPTION]"
            echo ""
            echo "Options:"
            echo "  (none)       Full redeploy: stop, rebuild, and start"
            echo "  --no-build   Restart containers without rebuilding"
            echo "  --down       Stop and remove all containers"
            echo "  --logs       Follow container logs"
            echo "  --help       Show this help message"
            echo ""
            echo "Environment variables (auto-detected):"
            echo "  HOST_UID     Host user ID (currently: $(id -u))"
            echo "  HOST_GID     Host group ID (currently: $(id -g))"
            ;;
        *)
            stop_containers
            deploy
            wait_for_health
            ;;
    esac
}

main "$@"
