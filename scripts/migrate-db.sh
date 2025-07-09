#!/bin/bash

# Database Migration Script for Identity Server
# This script creates the identity_server database and runs the schema migration

set -e

# Configuration
DB_HOST="localhost"
DB_PORT="5432"
DB_USER="postgres"
DB_PASSWORD="postgres123"
DB_NAME="identity_server"
POSTGRES_DB="postgres"

echo "================================"
echo "Identity Server Database Migration"
echo "================================"

# Check if PostgreSQL is running
echo "[INFO] 🔍 Checking PostgreSQL connection..."
if ! pg_isready -h $DB_HOST -p $DB_PORT -U $DB_USER; then
    echo "[ERROR] ❌ PostgreSQL is not running or not accessible"
    echo "Please ensure PostgreSQL is running on $DB_HOST:$DB_PORT"
    exit 1
fi

echo "[SUCCESS] ✅ PostgreSQL is running"

# Create the identity_server database if it doesn't exist
echo "[INFO] 🗄️ Creating identity_server database if it doesn't exist..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $POSTGRES_DB -tc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || {
    echo "[INFO] 📝 Creating database: $DB_NAME"
    PGPASSWORD=$DB_PASSWORD createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME
    echo "[SUCCESS] ✅ Database created: $DB_NAME"
}

# Run the migration SQL script
echo "[INFO] 🔄 Running database migration..."
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f scripts/migrate-database.sql

echo ""
echo "[SUCCESS] ✅ Database migration completed!"
echo ""
echo "🌐 You can now start the identity server with:"
echo "  ./rebuild.sh start"
echo ""
