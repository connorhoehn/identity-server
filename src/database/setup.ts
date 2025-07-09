import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';

export async function setupDatabase() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'identity_server',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    // Create database if it doesn't exist
    await createDatabaseIfNotExists();

    // Check if we have the new multi-tenant schema
    const hasMultiTenantSchema = await checkMultiTenantSchema(pool);

    if (hasMultiTenantSchema) {
      logger.info('Multi-tenant schema detected, skipping table creation');
      
      // Only ensure default data exists in multi-tenant schema
      await ensureDefaultMultiTenantData(pool);
    } else {
      logger.info('Legacy schema detected, creating single-tenant tables');
      
      // Create legacy single-tenant tables
      await createLegacyTables(pool);
      
      // Create default admin user if it doesn't exist
      await createDefaultAdmin(pool);

      // Create default test client if it doesn't exist
      await createDefaultTestClient(pool);
    }

    logger.info('Database setup completed successfully');
  } catch (error) {
    logger.error('Database setup failed:', error);
    throw error;
  }
}

async function checkMultiTenantSchema(pool: Pool): Promise<boolean> {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'pool_id'
      ) as has_pool_id
    `);
    return result.rows[0].has_pool_id;
  } catch (error) {
    return false;
  }
}

async function createLegacyTables(pool: Pool) {
  // Create legacy users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(255) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      given_name VARCHAR(255),
      family_name VARCHAR(255),
      name VARCHAR(255),
      nickname VARCHAR(255),
      picture TEXT,
      profile TEXT,
      website TEXT,
      email_verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(255) PRIMARY KEY,
      user_id VARCHAR(255) REFERENCES users(id) ON DELETE CASCADE,
      session_data JSONB,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
  `);

  // Create legacy clients table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id VARCHAR(255) UNIQUE NOT NULL,
      client_secret VARCHAR(255) NOT NULL,
      client_name VARCHAR(255) NOT NULL,
      redirect_uris TEXT[] NOT NULL DEFAULT '{}',
      grant_types TEXT[] NOT NULL DEFAULT '{"authorization_code", "refresh_token"}',
      response_types TEXT[] NOT NULL DEFAULT '{"code"}',
      scope VARCHAR(255) NOT NULL DEFAULT 'openid profile email',
      token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'client_secret_basic',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_clients_client_id ON clients(client_id);
  `);
}

async function ensureDefaultMultiTenantData(pool: Pool) {
  // For multi-tenant schema, just ensure we have the user_sessions table
  // since it's not part of the migration script but still needed
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id VARCHAR(255) PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      session_data JSONB,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
  `);

  // Create default admin user in the default pool if needed
  await createDefaultMultiTenantAdmin(pool);
}

async function createDatabaseIfNotExists() {
  const adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'postgres', // Connect to default database
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });

  try {
    const dbName = process.env.DB_NAME || 'identity_server';
    const result = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [dbName]
    );

    if (result.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${dbName}"`);
      logger.info(`Database ${dbName} created successfully`);
    }
  } catch (error) {
    logger.warn('Could not create database (may already exist):', error);
  } finally {
    await adminPool.end();
  }
}

async function createDefaultAdmin(pool: Pool) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@localhost';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

    // Check if admin user exists
    const existingAdmin = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [adminEmail]
    );

    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);
      const adminId = uuidv4();

      await pool.query(
        `INSERT INTO users (id, email, password_hash, given_name, family_name, name, email_verified, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        [
          adminId,
          adminEmail,
          passwordHash,
          'Admin',
          'User',
          'Admin User',
          true,
        ]
      );

      logger.info(`Default admin user created with email: ${adminEmail}`);
    }
  } catch (error) {
    logger.error('Failed to create default admin user:', error);
  }
}

async function createDefaultTestClient(pool: Pool) {
  try {
    // First, ensure the post_logout_redirect_uris column exists
    await pool.query(`
      ALTER TABLE clients 
      ADD COLUMN IF NOT EXISTS post_logout_redirect_uris TEXT[] DEFAULT '{}'
    `);

    const clientId = process.env.CLIENT_ID || 'local-test-client';
    const clientSecret = process.env.CLIENT_SECRET || 'local-test-client-secret';
    const redirectUris = (process.env.CLIENT_REDIRECT_URIS || 'http://localhost:3006/callback').split(',');
    const postLogoutRedirectUris = (process.env.POST_LOGOUT_REDIRECT_URIS || 'http://localhost:3006/,http://localhost:3006/logout-callback').split(',');

    // Check if test client exists
    const existingClient = await pool.query(
      'SELECT id FROM clients WHERE client_id = $1',
      [clientId]
    );

    if (existingClient.rows.length === 0) {
      await pool.query(
        `INSERT INTO clients (client_id, client_secret, client_name, redirect_uris, post_logout_redirect_uris, grant_types, response_types, scope, token_endpoint_auth_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          clientId,
          clientSecret,
          'Local Test Client',
          redirectUris,
          postLogoutRedirectUris,
          ['authorization_code', 'refresh_token'],
          ['code'],
          'openid profile email',
          'client_secret_basic',
        ]
      );

      logger.info(`Default test client created with client_id: ${clientId}`);
    }
  } catch (error) {
    logger.error('Failed to create default test client:', error);
  }
}

async function createDefaultMultiTenantAdmin(pool: Pool) {
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@localhost';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const defaultPoolId = 'default-pool';

    // Check if admin user exists in the default pool
    const existingAdmin = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND pool_id = $2',
      [adminEmail, defaultPoolId]
    );

    if (existingAdmin.rows.length === 0) {
      const passwordHash = await bcrypt.hash(adminPassword, 10);

      await pool.query(
        `INSERT INTO users (pool_id, email, password_hash, given_name, family_name, name, email_verified, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        [
          defaultPoolId,
          adminEmail,
          passwordHash,
          'Admin',
          'User',
          'Admin User',
          true,
          'CONFIRMED',
        ]
      );

      logger.info(`Default admin user created in pool ${defaultPoolId} with email: ${adminEmail}`);
    }
  } catch (error) {
    logger.error('Failed to create default multi-tenant admin user:', error);
  }
}
