#!/bin/bash

# Identity Server Management Script
# This is the ONLY management script for the OIDC Identity Server
# Handles all operations: build, start, stop, backend switching, migration, testing
# 
# Usage: ./rebuild.sh [COMMAND] [BACKEND] [OPTIONS]
# 
# Commands:
#   rebuild [backend]     - Rebuild and restart with specified backend (default: postgresql)
#   start [backend]       - Start services with specified backend
#   stop                  - Stop all services
#   restart [backend]     - Restart services with specified backend
#   status                - Show service status
#   logs [service]        - Show logs for specific service or all
#   migrate [backend]     - Run migration to multi-tenant (PostgreSQL only)
#   test [backend]        - Run data provider tests
#   clean                 - Clean all containers, volumes, and images
#   dev                   - Run development server outside Docker
#   help                  - Show this help

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${CYAN}================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}================================${NC}"
}

# Check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Validate data provider
validate_data_provider() {
    local provider=${1:-postgresql}
    if [ "$provider" = "dynamodb" ] || [ "$provider" = "postgresql" ]; then
        echo "$provider"
    else
        print_warning "Unknown data provider '$provider', defaulting to PostgreSQL"
        echo "postgresql"
    fi
}

# Set data provider environment
set_data_provider() {
    local provider=$(validate_data_provider "$1")
    export DATA_PROVIDER="$provider"
    
    if [ "$provider" = "dynamodb" ]; then
        print_status "⚡ Using DynamoDB Local backend" >&2
    else
        print_status "🐘 Using PostgreSQL backend" >&2
    fi
    
    echo "$provider"
}

# Build and start services
rebuild() {
    local provider=$(set_data_provider "$1")
    
    print_header "Rebuilding Identity Server with $provider backend"
    check_docker
    
    print_status "🔄 Stopping all containers and removing orphans..."
    docker-compose down --remove-orphans
    
    print_status "🔨 Building and starting containers..."
    DATA_PROVIDER="$provider" docker-compose down && DATA_PROVIDER="$provider" docker-compose build --no-cache && DATA_PROVIDER="$provider" docker-compose up -d
    
    print_status "🔄 Restarting test client..."
    docker-compose restart test-client
    
    print_success "✅ Rebuild complete!"
    show_endpoints "$provider"
}

# Start services
start_services() {
    local provider=$(set_data_provider "$1")
    
    print_header "Starting Identity Server with $provider backend"
    check_docker
    
    print_status "🚀 Starting containers..."
    DATA_PROVIDER="$provider" docker-compose up -d
    
    print_status "⏳ Waiting for services to stabilize..."
    sleep 5
    
    print_success "✅ Services started!"
    show_endpoints "$provider"
}

# Stop services
stop_services() {
    print_header "Stopping Identity Server"
    check_docker
    
    print_status "🛑 Stopping all containers..."
    docker-compose down
    
    print_success "✅ All services stopped!"
}

# Restart services
restart_services() {
    local provider=$(set_data_provider "$1")
    
    print_header "Restarting Identity Server with $provider backend"
    stop_services
    sleep 2
    start_services "$provider"
}

# Show service status
show_status() {
    print_header "Identity Server Status"
    check_docker
    
    echo "Docker containers:"
    docker ps --filter "name=identity-server" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    
    echo ""
    echo "Service health:"
    if curl -s http://localhost:3005/health > /dev/null 2>&1; then
        print_success "Identity Server: ✅ Up"
    else
        print_error "Identity Server: ❌ Down"
    fi
    
    if curl -s http://localhost:3006 > /dev/null 2>&1; then
        print_success "Test Client: ✅ Up"
    else
        print_error "Test Client: ❌ Down"
    fi
}

# Show logs
show_logs() {
    local service="$1"
    
    if [ -z "$service" ]; then
        print_header "All Service Logs"
        docker-compose logs -f
    else
        print_header "Logs for $service"
        docker-compose logs -f "$service"
    fi
}

# Run migration
run_migration() {
    local provider=$(validate_data_provider "$1")
    
    if [ "$provider" != "postgresql" ]; then
        print_error "Migration is only supported for PostgreSQL backend"
        exit 1
    fi
    
    print_header "Running Multi-Tenant Migration for PostgreSQL"
    check_docker
    
    # Check if core PostgreSQL is running
    if ! docker ps | grep -q "core-postgres"; then
        print_error "Core PostgreSQL service is not running"
        print_status "Please start core services with: core-services start"
        exit 1
    fi
    
    print_status "🔄 Running database migration using PostgreSQL container..."
    
    # First, create the identity_server database if it doesn't exist
    print_status "📝 Creating identity_server database if needed..."
    docker exec core-postgres psql -U postgres -c "CREATE DATABASE identity_server;" 2>/dev/null || true
    
    # Run the migration SQL script
    print_status "🔄 Applying database schema migration..."
    if docker exec -i core-postgres psql -U postgres -d identity_server < scripts/migrate-database.sql; then
        print_success "✅ Migration completed successfully!"
        print_status ""
        print_status "🌐 You can now start the identity server with:"
        print_status "  ./rebuild.sh start"
    else
        print_error "❌ Migration failed. Please check the error messages above."
        exit 1
    fi
}

# Run tests
run_tests() {
    local provider=$(set_data_provider "$1")
    
    print_header "Testing $provider Backend"
    check_docker
    
    # Start services if not running
    if ! docker ps | grep -q "identity-server"; then
        print_status "Starting services for testing..."
        start_services "$provider"
    fi
    
    print_status "⏳ Waiting for services to stabilize..."
    sleep 15
    
    print_status "🔍 Testing $provider endpoint..."
    if curl -s http://localhost:3005/health > /dev/null; then
        print_success "✅ $provider backend is running"
    else
        print_error "❌ $provider backend failed to start"
        exit 1
    fi
    
    print_status "🧪 Running multi-tenant functionality test..."
    if docker exec identity-server npm run test:multi-tenant; then
        print_success "✅ $provider multi-tenant test passed"
    else
        print_error "❌ $provider multi-tenant test failed"
        exit 1
    fi
}

# Test both backends
test_all_backends() {
    print_header "Testing All Data Provider Backends"
    
    # Test PostgreSQL
    print_status "📋 Test 1: PostgreSQL Backend"
    run_tests "postgresql"
    
    # Test DynamoDB
    print_status "📋 Test 2: DynamoDB Backend"
    run_tests "dynamodb"
    
    print_success "🎉 All backend tests completed successfully!"
}

# Clean up
clean_all() {
    print_header "Cleaning Identity Server"
    check_docker
    
    print_warning "This will remove all containers, volumes, and images for the Identity Server."
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker-compose down -v --rmi all 2>/dev/null || true
        print_success "✅ Cleanup completed!"
    else
        print_status "Cleanup cancelled."
    fi
}

# Development mode
dev_mode() {
    print_header "Starting Development Server"
    
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Are you in the correct directory?"
        exit 1
    fi
    
    # Start only database services
    print_status "🚀 Starting database services..."
    docker-compose up -d postgres dynamodb-local
    sleep 5
    
    print_status "📦 Installing dependencies..."
    npm install
    
    print_status "🔧 Starting development server..."
    npm run dev
}

# Show service endpoints
show_endpoints() {
    local provider="$1"
    echo ""
    echo "🌐 Services available at:"
    echo "  - Identity Server: http://localhost:3005"
    echo "  - Admin Interface: http://localhost:3005/admin"
    echo "  - Test Client: http://localhost:3006"
    echo ""
    echo "🗄️ Data Provider: $provider"
    echo ""
    echo "📊 Check logs with:"
    echo "  - ./rebuild.sh logs identity-server"
    echo "  - ./rebuild.sh logs test-client"
    echo ""
    echo "🔄 Available operations:"
    echo "  - ./rebuild.sh restart $provider    # Restart with same backend"
    echo "  - ./rebuild.sh rebuild postgresql   # Switch to PostgreSQL"
    echo "  - ./rebuild.sh rebuild dynamodb     # Switch to DynamoDB"
    echo "  - ./rebuild.sh migrate postgresql   # Run multi-tenant migration"
    echo "  - ./rebuild.sh test                 # Test current backend"
}

# Show help
show_help() {
    echo "Identity Server Management Script"
    echo "This is the ONLY management script for the OIDC Identity Server"
    echo ""
    echo "Usage: $0 [COMMAND] [BACKEND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  rebuild [backend]     - Rebuild and restart with specified backend (default: postgresql)"
    echo "  start [backend]       - Start services with specified backend"
    echo "  stop                  - Stop all services"
    echo "  restart [backend]     - Restart services with specified backend"
    echo "  status                - Show service status"
    echo "  logs [service]        - Show logs for specific service or all"
    echo "  migrate [backend]     - Run migration to multi-tenant (PostgreSQL only)"
    echo "  test [backend]        - Run data provider tests for specific backend"
    echo "  test-all              - Test both PostgreSQL and DynamoDB backends"
    echo "  clean                 - Clean all containers, volumes, and images"
    echo "  dev                   - Run development server outside Docker"
    echo "  help                  - Show this help"
    echo ""
    echo "Backends:"
    echo "  postgresql            - Use PostgreSQL database (default)"
    echo "  dynamodb              - Use DynamoDB Local"
    echo ""
    echo "Examples:"
    echo "  $0 rebuild            # Rebuild with PostgreSQL (default)"
    echo "  $0 rebuild dynamodb   # Rebuild with DynamoDB"
    echo "  $0 start postgresql   # Start with PostgreSQL"
    echo "  $0 migrate            # Run PostgreSQL migration"
    echo "  $0 test dynamodb      # Test DynamoDB backend"
    echo "  $0 test-all           # Test both backends"
    echo "  $0 logs identity-server  # Show identity server logs"
    echo "  $0 status             # Show service status"
}

# Main script logic
COMMAND="${1:-rebuild}"
BACKEND="$2"

case "$COMMAND" in
    rebuild)
        rebuild "$BACKEND"
        ;;
    start)
        start_services "$BACKEND"
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services "$BACKEND"
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "$BACKEND"
        ;;
    migrate)
        run_migration "$BACKEND"
        ;;
    test)
        if [ -z "$BACKEND" ]; then
            run_tests "$(validate_data_provider)"
        else
            run_tests "$BACKEND"
        fi
        ;;
    test-all)
        test_all_backends
        ;;
    clean)
        clean_all
        ;;
    dev)
        dev_mode
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        # Backward compatibility: if first arg is a backend, assume rebuild
        if [ "$COMMAND" = "postgresql" ] || [ "$COMMAND" = "dynamodb" ]; then
            rebuild "$COMMAND"
        else
            print_error "Unknown command: $COMMAND"
            show_help
            exit 1
        fi
        ;;
esac
