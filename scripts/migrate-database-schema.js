#!/usr/bin/env node

const { Client } = require('pg');

async function migrateSchema() {
  console.log('🔄 Starting database schema migration...');
  
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'identity_server',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres123',
  });

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL database');

    await client.query('BEGIN');

    // Check if migration is needed
    const checkPoolId = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'pool_id'
    `);

    if (checkPoolId.rows.length > 0) {
      console.log('ℹ️  Database already migrated to multi-tenant schema');
      await client.query('ROLLBACK');
      return;
    }

    // Check if tables exist
    const checkTables = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name IN ('users', 'clients')
    `);

    if (checkTables.rows.length === 0) {
      console.log('ℹ️  No existing tables found, will create new multi-tenant schema');
      await client.query('ROLLBACK');
      return;
    }

    console.log('🔄 Migrating existing tables to multi-tenant schema...');

    // Backup existing tables
    await client.query('ALTER TABLE users RENAME TO users_backup_pre_migration');
    await client.query('ALTER TABLE clients RENAME TO clients_backup_pre_migration');
    console.log('✅ Backed up existing tables');

    // Drop old indexes that might conflict
    await client.query('DROP INDEX IF EXISTS idx_users_email');
    await client.query('DROP INDEX IF EXISTS idx_clients_client_id');
    console.log('✅ Cleaned up old indexes');

    await client.query('COMMIT');
    console.log('✅ Schema migration completed successfully!');
    console.log('');
    console.log('📋 Next steps:');
    console.log('1. Start the identity server to create new multi-tenant tables');
    console.log('2. Run the data migration: ./rebuild.sh migrate postgresql');
    console.log('3. Verify everything works correctly');
    console.log('4. Remove backup tables: users_backup_pre_migration, clients_backup_pre_migration');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

// Check if required pg package is available
try {
  require('pg');
} catch (error) {
  console.error('❌ pg package not found. Please install it first:');
  console.error('npm install pg');
  process.exit(1);
}

// Run migration
migrateSchema()
  .then(() => {
    console.log('🎉 Database schema migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Database schema migration failed:', error.message);
    process.exit(1);
  });
